# Android app: Kokoro through the phone's voice engine (ADR-27)

The app is the same web app inside a Capacitor 8 shell. Only the voice
backend and the screen-on call are Android code.

## Plugin `ReadAloudTts` (`app/android/app/src/main/java/uk/rocksonarthur/readaloud/ReadAloudTtsPlugin.java`)

| Method | Does | Returns |
|---|---|---|
| `engine()` | Looks for the Kokoro engine among the phone's voice engines. | `{ installed: boolean, label?: string }` |
| `init()` | Binds Android `TextToSpeech` to that engine (once). | `{}`; rejects if the engine does not start |
| `synthesize({ text })` | Writes the text as speech to one WAV file in the app's cache, after deleting the previous file. Speech rate 1.0 (speed is the player's, spec 8.2). | `{ path }`, an absolute file path |
| `stop()` | Stops the clip being made. | `{}` |
| `keepScreenOn({ on })` | Sets or clears `FLAG_KEEP_SCREEN_ON`. | `{}` |

`synthesize` resolves when `UtteranceProgressListener.onDone` fires for its
utterance and rejects on `onError` or `onStop`.

## Model storage

None in ReadAloud. The model and voices live in the engine app, installed
separately (ADR-24, route 1). The engine's speaker number, set in its own app,
is the voice.

## Web side (`app/src/ui/android/`)

- `PhoneKokoro` implements `KokoroBackend` (spec 7.4) and the status the
  Kokoro UI shows. It sends one request at a time, because the engine makes
  one at a time anyway; requests already cancelled are dropped before they are
  sent, and cancelling the one being made calls `stop()`. So a jump to
  another sentence does not wait for clips that are no longer needed.
- Each clip: `synthesize` → `fetch(Capacitor.convertFileSrc(path))` →
  `decodeWav` (core, PCM 16-bit) → samples for `KokoroEngine`, which joins
  long sentences as on the PC. The next request is sent only after the file is
  read, so deleting the previous file is safe.
- The voice list has one entry, "Kokoro (voice set in the Kokoro engine app)".
- Reading turns `keepScreenOn` on; pause, stop and the end turn it off.

## Build (WSL Ubuntu, handoff 7)

On Windows: `pnpm build:android` (vite `--mode android` → `dist-android`) and
`pnpm exec cap sync android`. In WSL: copy `app/android` to the Linux disk,
`./gradlew assembleDebug`, then `adb install -r` the debug APK from Windows.
