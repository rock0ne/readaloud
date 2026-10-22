# Third-party notices

ReadAloud is licensed under the GNU General Public License, version 3 or later
(`LICENSE`). Its downloads contain the parts below, and each keeps its own
licence. The full licence texts come inside every download, in the folder
`licences/` (in the app: Settings, About, Licences):

- `licences/web.txt`: the licence files of every package whose code is in the
  web app. The build lists the packages from its own bundle (`app/licences.ts`),
  so the list always matches the download, and the build stops if one has no
  licence text.
- `licences/android.txt` (Android app only): the native code and the Android
  libraries. These texts are kept in `app/licences/`, and
  `app/licences/index.json` says where each one comes from, with its SHA-256.
- `licences/LICENSE.txt` (ReadAloud's own licence) and this file.

`app/pnpm-lock.yaml` names every exact web package version.

## In the web app (the Windows zip, the GitHub Pages site, and the Android app's pages)

| Part | Version | Licence | Source |
|---|---|---|---|
| eSpeak NG, compiled to JavaScript inside `phonemizer`: it turns text into phonemes for the Kokoro voice (see "What is not known") | phonemizer 1.2.1 | GPL-3.0-or-later (eSpeak NG); Apache-2.0 (phonemizer's own code) | https://github.com/espeak-ng/espeak-ng, https://github.com/xenova/phonemizer.js |
| kokoro-js (`app/src/ui/android/phonemes.ts` is ported from its `phonemize`) | 1.2.1 | Apache-2.0 | https://github.com/hexgrad/kokoro (folder `kokoro.js`) |
| Transformers.js | 3.8.1 | Apache-2.0 | https://github.com/huggingface/transformers.js |
| ONNX Runtime Web (`ort/` in the build), with onnxruntime-common | 1.22.0-dev.20250409 (commit 89f8206b); onnxruntime-common 1.21.0 | MIT, with the third-party notices of ONNX Runtime | https://github.com/microsoft/onnxruntime |
| PDF.js (`pdfjs-dist`) | 6.4.299 | Apache-2.0 | https://github.com/mozilla/pdf.js |
| Mammoth (`.docx`), with underscore, lop, option, dingbat-to-unicode, base64-js, @xmldom/xmldom and xmlbuilder | 1.13.0 | BSD-2-Clause; the others MIT | https://github.com/mwilliamson/mammoth.js |
| JSZip (`.epub`) | 3.10.2 | MIT or GPL-3.0-or-later (dual) | https://github.com/Stuk/jszip |
| pako, JSZip's own copy inside its ready-built file | 1.0.x (exact version not known) | MIT; its zlib code under the zlib licence | https://github.com/nodeca/pako |
| marked (`.md`) | 18.1.1 | MIT | https://github.com/markedjs/marked |
| Preact | 10.29.8 | MIT | https://github.com/preactjs/preact |
| idb | 8.0.4 | ISC | https://github.com/jakearchibald/idb |
| Capacitor core | 8.5.0 | MIT | https://github.com/ionic-team/capacitor |
| Workbox (`workbox-core`, `-precaching`, `-routing`, inside the offline service worker; not in the Android app) | 7.4.1 | MIT | https://github.com/GoogleChrome/workbox |

## Also in the Android app

| Part | Version | Licence | Source |
|---|---|---|---|
| Capacitor for Android | 8.5.0 | MIT | https://github.com/ionic-team/capacitor |
| sherpa-onnx: `libsherpa-onnx-jni.so`, and the Java classes in `app/android/app/src/main/java/com/k2fsa/sherpa/onnx/`, ported from its Kotlin API | commit 9ac4cd24, 41 commits after tag v1.13.8 | Apache-2.0 | https://github.com/k2-fsa/sherpa-onnx/tree/9ac4cd243143fd2a2fdda29a8e461ecf5fac1852 |
| Linked into `libsherpa-onnx-jni.so`: kaldi-native-fbank 1.22.3, kaldi-decoder 0.3.0, kaldifst 1.8.0, OpenFst 1.8.5 (k2-fsa copy), simple-sentencepiece 0.7, nlohmann/json 3.12.0, hclust-cpp 2026-02-25, Eigen 5.0.1 | as pinned by sherpa-onnx | Apache-2.0; nlohmann/json MIT; hclust-cpp BSD-2-Clause; Eigen MPL-2.0 | see `app/licences/index.json` |
| ONNX Runtime (`libonnxruntime.so`) | 1.28.2 (commit 33ca9628) | MIT, with the third-party notices of ONNX Runtime | https://github.com/microsoft/onnxruntime |
| AndroidX, Kotlin, kotlinx coroutines, Apache Cordova framework and three annotation libraries: 50 libraries, each listed in `licences/android.txt` | resolved by Gradle | Apache-2.0 | https://developer.android.com/jetpack/androidx |

The two native libraries are copied, unchanged, from the k2-fsa project's
Kokoro engine APK
`sherpa-onnx-1.13.8-arm64-v8a-eng-tts-engine-kokoro-multi-lang-v1_0.apk`
(SHA-256 `402c3628712668fb5eb8cc838add6a8f62caffd69ccc53af75384dde1e2142ec`).
They contain no eSpeak NG.

## Downloaded once, at first use, not in the downloads

- **Kokoro-82M**, the voice model, by hexgrad, Apache-2.0
  (https://huggingface.co/hexgrad/Kokoro-82M).
  - On Windows and in the browser, the ONNX version
    (https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX) comes from
    Hugging Face.
  - The Android app downloads it from this project's release
    `kokoro-voice-2`: the k2-fsa export `kokoro-multi-lang-v1_0` (Apache-2.0),
    with its own LICENSE and README, taken unchanged from the engine APK
    above. It holds no eSpeak NG data.

## What is not known

- **eSpeak NG inside `phonemizer` 1.2.1.** The package ships eSpeak NG
  already compiled to JavaScript. The eSpeak NG revision and the build
  settings it was made from are not recorded in the package, so the exact
  corresponding source cannot be named. eSpeak NG's source is at
  https://github.com/espeak-ng/espeak-ng, phonemizer's at
  https://github.com/xenova/phonemizer.js.
- **The native libraries' build settings** are not recorded.

## Corrections to ReadAloud 0.2.0 and earlier

Earlier versions of this file had three errors:

1. They said eSpeak NG is built into `libsherpa-onnx-jni.so`. It is not: that
   library has no eSpeak NG code. In the engine app that 0.2.0 needed, eSpeak
   NG was in the engine's own `libpiper-phonemize-jni.so` and data files.
2. They named sherpa-onnx v1.13.8. Both native libraries come from commit
   `9ac4cd24`, 41 commits after the v1.13.8 tag.
3. They named pako 1.0.11. The pako inside JSZip's ready-built file is
   JSZip's own copy, and its exact 1.0.x version is not known.

The Android app 0.2.0 and earlier also carried no licence texts. From 0.3.0,
every download carries them in `licences/`.
