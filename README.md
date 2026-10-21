# ReadAloud

Listen to your documents in a natural voice, and flag mistakes while you
listen. It was made for proofreading a finished book by ear, and it works for
anything you would rather hear than read.

- Reads `.txt`, `.md`, `.docx`, `.pdf` and `.epub` files, and text you paste.
- Natural voices from [Kokoro](https://huggingface.co/hexgrad/Kokoro-82M),
  made on your own device: no account, no subscription, no cloud voice service.
  Eleven English voices, British and American.
- The sentence being read is highlighted. Press **F** to flag it, or **N** to
  flag it and add a note. Then download a corrections file in Markdown: every
  flag with its chapter and paragraph, the quoted sentence and your note.
- Remembers where you stopped in each document. Works offline once it is set up.
- Your documents never leave your device.

Runs on **Windows** (in Microsoft Edge) and on **Android** phones.

## Windows

### Option 1: the web version (easiest)

1. Open **https://rock0ne.github.io/readaloud/** in Microsoft Edge.
2. Install it: select **App available** in the address bar (or **Settings and
   more > Apps > Install this site as an app**). It then opens from its own
   icon and works offline.
3. The first time you read with the natural voice, select **Download natural
   voice**. Edge downloads the Kokoro model (about 330 MB) from Hugging Face,
   once.

### Option 2: the download (runs from your own PC)

1. From [Releases](https://github.com/rock0ne/readaloud/releases), download
   `ReadAloud-windows-<version>.zip` and unzip it anywhere.
2. Double-click `ReadAloud.cmd`. If Windows asks whether to run it, choose
   **Run** (or **More info**, then **Run anyway**). ReadAloud opens in Edge.
3. Keep the small window open while you use it, or install the app from Edge as
   above and it opens from its icon without the window.

It needs nothing installed: a small script in Windows PowerShell, which every
Windows 10 and 11 PC has, serves the app at `http://127.0.0.1:4173/` on this
PC only. On a PC without WebGPU the voice is faster this way than in the web
version, because it can use several processor threads. If your organisation
blocks PowerShell scripts, use the web version.

The web version and the download keep separate libraries, because each address
has its own storage in the browser. Pick one and stay with it, or move your
library between them with **Export JSON** and **Import JSON**.

## Android

Needs a 64-bit ARM phone (almost all phones from the last few years) with
Android 7.0 or later.

1. Install the **sherpa-onnx Kokoro voice engine** from the
   [k2-fsa project](https://k2-fsa.github.io/sherpa/onnx/tts/apk-engine.html):
   [`sherpa-onnx-1.13.8-arm64-v8a-eng-tts-engine-kokoro-multi-lang-v1_0.apk`](https://huggingface.co/csukuangfj2/sherpa-onnx-apk/resolve/main/tts-engine-new/1.13.8/sherpa-onnx-1.13.8-arm64-v8a-eng-tts-engine-kokoro-multi-lang-v1_0.apk)
   (367 MB, SHA-256
   `402c3628712668fb5eb8cc838add6a8f62caffd69ccc53af75384dde1e2142ec`).
   ReadAloud reads the voice model from it. You do not have to make it your
   phone's default text-to-speech engine.
2. Install `ReadAloud-<version>.apk` from
   [Releases](https://github.com/rock0ne/readaloud/releases). Your phone asks
   you to allow installing apps from your browser or file manager the first
   time. Every release is signed with the same key (`CN=rock0ne`, certificate
   SHA-256 `c5f96167fa4b6633523624bd275745a088d48ed875ff13e5104c6050475dbc0f`),
   so new versions install over the old one and keep your library.

Or install both from a computer with [adb](https://developer.android.com/tools/adb),
with the phone connected by USB and USB debugging on:

```bash
adb install sherpa-onnx-1.13.8-arm64-v8a-eng-tts-engine-kokoro-multi-lang-v1_0.apk
```

```bash
adb install -r ReadAloud-0.1.1.apk
```

The first sentence takes about 12 seconds after you press Play while the model
loads. After that, ReadAloud prepares about 40 seconds of speech ahead. A
phone that is warm (for example while charging) slows down, and then the voice
can pause for a few seconds between some sentences.

## Proofreading with it

1. **Add files** or **Paste text** in the library.
2. Open the document, pick a voice and a speed (0.8x to 3x), press Play.
3. While it reads:

   | Key | Does |
   |---|---|
   | Space | Play or pause |
   | ← / → | Previous or next sentence |
   | R | Read the sentence again |
   | F | Flag the sentence |
   | N | Flag it and write a note |
   | [ / ] | Slower or faster |
   | Esc | Close the panel or leave the note |

   On a phone, tap the flag button instead. Click or tap a sentence to read
   from there.
4. Download the corrections file from the **Flags** panel (or from the
   document in the library) and fix the mistakes in your manuscript.

## Privacy

Documents, flags, notes and settings are stored in the browser on your device
(IndexedDB) and nowhere else. There is no account, server or analytics. The
only downloads are the app itself and, once, the Kokoro model from Hugging
Face. On Android the voice is made on the phone from the engine app's files.

## Build it yourself

The web app needs [Node.js](https://nodejs.org/) 22 and pnpm 11
(`corepack enable` gives you the pinned pnpm):

```bash
cd app
pnpm install
pnpm test
pnpm build
```

- `app/dist` is the web app. `app/start-readaloud.cmd` serves it on Windows
  with no Node; `powershell -ExecutionPolicy Bypass -File app\windows\package.ps1`
  makes the Windows zip.
- The Android app is built on Linux or in WSL with JDK 21, the Android SDK
  (platform 36) and the engine APK above, whose two native libraries it uses.
  See `app/android/build-apk.sh`. Sign the release APK with your own key.
- `docs/` has the design, every decision with its reasons
  (`docs/04-DECISIONS.md`) and the progress log.

## How it works

- The web app is Preact and TypeScript, built with Vite as an installable
  web app with an offline service worker.
- In the browser, [kokoro-js](https://github.com/hexgrad/kokoro) runs Kokoro
  through Transformers.js and ONNX Runtime Web, on the graphics card (WebGPU)
  when there is one, otherwise on the processor (WebAssembly).
- On Android the same app runs inside [Capacitor](https://capacitorjs.com/).
  [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) makes the speech natively.
  [eSpeak NG](https://github.com/espeak-ng/espeak-ng) turns the text into
  phonemes first, so numbers and names are spoken too.

## Limits

- English only (Kokoro's British and American voices).
- No text recognition: a scanned PDF (pictures of pages) cannot be read.
- DRM-protected EPUBs are refused. Files up to 50 MB (EPUB up to 500 MB).
- The Android app is for arm64 phones only.

## Licence

GNU General Public License version 3 or later: see [`LICENSE`](LICENSE).
ReadAloud includes eSpeak NG, which is under the same licence. The other
parts and their licences are in
[`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md).

Thanks to hexgrad for Kokoro, to the k2-fsa project for sherpa-onnx and its
Kokoro engine, to Xenova and Hugging Face for kokoro-js, phonemizer and
Transformers.js, and to the eSpeak NG, ONNX Runtime and PDF.js projects.
