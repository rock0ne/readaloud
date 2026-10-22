# Android app: Kokoro made inside ReadAloud (ADR-27, ADR-37)

The app is the same web app inside a Capacitor 8 shell. Only the voice
backend and the screen-on call are Android code.

## Where the voice comes from

- sherpa-onnx 1.13.8 runs inside ReadAloud's own process. Its native libraries
  (`libsherpa-onnx-jni.so`, `libonnxruntime.so`) are copied at build time from
  the Kokoro engine APK (`SHERPA_ENGINE_APK` in `app/android/build-apk.sh`)
  into `app/android/app/src/main/jniLibs/arm64-v8a/`,
  which is git-ignored.
- The voice files are downloaded by the app once (ADR-37), from
  `readaloud-kokoro-voice-2.zip` on the release `kokoro-voice-2` of
  github.com/rock0ne/readaloud, pinned in the plugin by size and SHA-256. They
  are unpacked into `voice/` in the app's no-backup files folder:
  `kokoro-multi-lang-v1_0/model.onnx`, `voices.bin`, `tokens.txt` and
  `lexicon-gb-en.txt`, with `READY` holding the zip's SHA-256. There is no
  eSpeak NG data: this sherpa-onnx build ignores Kokoro's `data_dir` and
  `lang`, and the app passes phoneme codepoints. `app/android/make-voice-zip.py`
  makes the zip from the engine APK.
- The licence texts of the native code and the Android libraries are in
  `licences/android.txt` inside the APK (ADR-38), made from `app/licences/`.
- Until 0.2.0 the model was read from the Kokoro engine app's assets
  (`com.k2fsa.sherpa.onnx.tts.engine`), which had to be installed. That app is
  no longer needed.
- Why not Android's `TextToSpeech` through the engine app: the phone freezes
  that app's process while it plays no sound itself, so each clip took 18 to
  64 s.

## Plugin `ReadAloudTts` (`app/android/app/src/main/java/uk/rocksonarthur/readaloud/ReadAloudTtsPlugin.java`)

| Method | Does | Returns |
|---|---|---|
| `voice()` | Whether the voice is in place; the download's size; how much an earlier try left. | `{ installed, bytes, downloaded }` |
| `downloadVoice()` | Downloads the zip (going on from `voice.zip.part`), checks its size and SHA-256, unpacks it into a new folder and swaps it in. `download` events carry `{ loaded, total }`. | `{}`; rejects with the reason |
| `removeVoice()` | Releases the model and deletes the voice and any part download. | `{}` |
| `init()` | Loads the model (once; about 4 s). | `{}`; rejects if it does not load |
| `synthesize({ phonemes, sid })` | Makes one clip from the phonemes with speaker `sid`, at the voice's own pace (speed is the player's, spec 8.2), and writes it as a 16-bit WAV file in the app's cache after deleting the previous files. A clip with no sound is rejected. | `{ path }`, an absolute file path |
| `stop()` | Nothing: a clip being made cannot be cut short. | `{}` |
| `keepScreenOn({ on })` | Sets or clears `FLAG_KEEP_SCREEN_ON`. | `{}` |

All model work runs on one worker thread, one clip at a time. Nothing logs
the text or the phonemes: `capacitor.config.json` sets `loggingBehavior` to
`"none"`, because Capacitor otherwise logs each call's arguments, and the
plugin passes no text to sherpa-onnx.

`com.k2fsa.sherpa.onnx.OfflineTts` (and `GeneratedAudio`) is a small Java copy
of sherpa-onnx's Kotlin API: the library finds these classes, their fields and
their native methods by name, so names and field types must match sherpa-onnx
1.13.8 exactly. ReadAloud uses `newFromFile`, `generateWithConfigImpl` (with
`GenerationConfig.phonemeCodepoints`, the text left empty and no callback, as
the engine app does in its phoneme mode), `getSampleRate`, `getNumSpeakers` and
`delete`.

## Phonemes, not text

sherpa-onnx's text route looks each word up in its lexicon and skips, without
a sound or an error, every word it lacks: digits and names. So the web side
makes the phonemes, as kokoro-js does on the PC:

- `app/src/ui/android/phonemes.ts` is kokoro-js 1.2.1's `phonemize`, ported
  unchanged: normalise years, clock times, money, decimals and titles; split
  off punctuation; eSpeak NG through `phonemizer` 1.2.1 (`en` for UK voices,
  `en-us` for US ones); Kokoro's own replacements.
- The module and eSpeak (1.3 MB) load the first time the phone voice speaks.
- The phonemes go to sherpa-onnx as one array of Unicode code points. A
  Kokoro chunk is at most 280 characters (`splitForKokoro`), well inside the
  model's 510-token window.

## Web side (`app/src/ui/android/`)

- `PhoneKokoro` implements `KokoroBackend` (spec 7.4) and the status the
  Kokoro UI shows. It works out each clip's phonemes as soon as the clip is
  asked for, and sends one clip at a time, because the model makes one at a
  time anyway. Clips already cancelled are dropped before they are sent; one
  being made finishes and is discarded. So a jump to another sentence does not
  wait for clips that are no longer needed.
- Each clip: `synthesize` → `fetch(Capacitor.convertFileSrc(path))` →
  `decodeWav` (core, PCM 16-bit) → samples for `KokoroEngine`, which joins
  long sentences as on the PC. The next clip is sent only after the file is
  read, so deleting the previous file is safe.
- Voices: the eleven Kokoro voices of the picker, by their speaker numbers in
  `kokoro-multi-lang-v1_0` (`SHERPA_SPEAKERS`; for example Emma 21, George 26,
  Heart 3, Michael 16). UK voices get British phonemes, US voices American.
- Reading turns `keepScreenOn` on; pause, stop and the end turn it off.

## Build (WSL Ubuntu, handoff 7)

`app/android/build-apk.sh [debug|release]`, run from a checkout on the Linux
disk, does it all: `pnpm build:android` (vite `--mode android` →
`dist-android`), `pnpm exec cap sync android`, the two native libraries from
the engine APK into `jniLibs/arm64-v8a`, then Gradle. It needs `JAVA_HOME`
(JDK 21), `ANDROID_HOME` (platform 36) and `SHERPA_ENGINE_APK`. The voice
download is made apart, with `python -I app/android/make-voice-zip.py
<engine APK> <zip>`, and published once on its own release. A release
build is unsigned; `app/android/sign-apk.sh <keystore> <in> <out>` signs it,
and apksigner asks for the key's password (ADR-29). Install with
`adb install -r`. An APK signed with another key (the debug key, or someone
else's release key) cannot be installed over this one without uninstalling it
first, which deletes the app's library and flags.
