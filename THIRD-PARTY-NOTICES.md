# Third-party notices

ReadAloud is licensed under the GNU General Public License, version 3 or later
(`LICENSE`). It is built from, and its downloads contain, the parts below. Each
keeps its own licence; the full licence texts come with each package in
`app/node_modules/` after `pnpm install`, and `app/pnpm-lock.yaml` names every
exact version. `pnpm licenses list --prod` (in `app/`) prints them all.

## In the web app (the Windows zip, the GitHub Pages site, and the Android app's pages)

| Part | Version | Licence | Source |
|---|---|---|---|
| eSpeak NG, compiled to WebAssembly in `phonemizer` | phonemizer 1.2.1 | GPL-3.0-or-later (eSpeak NG); Apache-2.0 (phonemizer's own code) | https://github.com/espeak-ng/espeak-ng, https://github.com/xenova/phonemizer.js |
| kokoro-js (`app/src/ui/android/phonemes.ts` is ported from its `phonemize`) | 1.2.1 | Apache-2.0 | https://github.com/hexgrad/kokoro (folder `kokoro.js`) |
| Transformers.js | 3.8.1 | Apache-2.0 | https://github.com/huggingface/transformers.js |
| ONNX Runtime Web (`ort/` in the build) | 1.22.0-dev.20250409 | MIT | https://github.com/microsoft/onnxruntime |
| PDF.js (`pdfjs-dist`) | 6.4.299 | Apache-2.0 | https://github.com/mozilla/pdf.js |
| Mammoth (`.docx`) | 1.13.0 | BSD-2-Clause | https://github.com/mwilliamson/mammoth.js |
| JSZip (`.epub`), with pako | 3.10.2, 1.0.11 | MIT (JSZip is dual MIT or GPL-3.0-or-later); pako MIT and Zlib | https://github.com/Stuk/jszip, https://github.com/nodeca/pako |
| marked (`.md`) | 18.1.1 | MIT | https://github.com/markedjs/marked |
| Preact | 10.29.8 | MIT | https://github.com/preactjs/preact |
| idb | 8.0.4 | ISC | https://github.com/jakearchibald/idb |
| Workbox (the offline service worker, through vite-plugin-pwa) | 7.4.1 | MIT | https://github.com/GoogleChrome/workbox |

These bring in smaller packages of their own (for example underscore,
@xmldom/xmldom, protobufjs, flatbuffers, long and @huggingface/jinja), under
MIT, ISC, BSD and Apache-2.0 licences.

## Also in the Android app

| Part | Version | Licence | Source |
|---|---|---|---|
| Capacitor (`@capacitor/core`, `@capacitor/android`) | 8.5.0 | MIT | https://github.com/ionic-team/capacitor |
| sherpa-onnx: `libsherpa-onnx-jni.so`, and the Java classes in `app/android/app/src/main/java/com/k2fsa/sherpa/onnx/`, ported from its Kotlin API | 1.13.8 | Apache-2.0 | https://github.com/k2-fsa/sherpa-onnx/tree/v1.13.8 |
| eSpeak NG, built into `libsherpa-onnx-jni.so` | as fetched by sherpa-onnx v1.13.8 (`cmake/espeak-ng-for-piper.cmake`) | GPL-3.0-or-later | https://github.com/csukuangfj/espeak-ng/tree/ed530aa113046142eb5115cf2fc9157854d0ffe1 |
| ONNX Runtime (`libonnxruntime.so`) | as shipped with sherpa-onnx 1.13.8 | MIT | https://github.com/microsoft/onnxruntime |
| AndroidX libraries | see `app/android/variables.gradle` | Apache-2.0 | https://developer.android.com/jetpack/androidx |

The two native libraries are copied, unchanged, from the sherpa-onnx Kokoro
text-to-speech engine APK published by the k2-fsa project.

## Not included, downloaded by the user

- **Kokoro-82M**, the voice model, by hexgrad, Apache-2.0
  (https://huggingface.co/hexgrad/Kokoro-82M). The browser downloads the ONNX
  version (https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX) from
  Hugging Face the first time it is used. On Android it comes from the
  sherpa-onnx Kokoro engine app, which the user installs, with eSpeak NG's
  data (GPL-3.0-or-later).
