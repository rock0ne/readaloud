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
- Write notes while you listen (**M**), typed or with a pen, and download them.
- An optional AI study assistant with your own key for Claude, ChatGPT or
  Gemini: summaries of a page, a chapter or the whole document, page by page,
  explanations of a paragraph, answers to your questions and a check for
  mistakes. It is off until you add a key.
- Your documents stay on your device. Only if you use the AI assistant is the
  part you ask about sent, to the company whose key you added.

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
   `ReadAloud-windows-<version>.zip`. Check that its SHA-256 matches the one
   on the release page (`Get-FileHash <zip> -Algorithm SHA256` in
   PowerShell), then unzip it anywhere.
2. Double-click `ReadAloud.cmd`. ReadAloud opens in Edge. The script is not
   code-signed, so Windows may ask whether to run it: run it only if the
   SHA-256 matched. If Windows says it protected your PC, or your
   organisation blocks it, use the web version instead.
3. Keep the small window open while you use it, or install the app from Edge as
   above and it opens from its icon without the window.

It needs nothing installed: a small script in Windows PowerShell, which every
Windows 10 and 11 PC has, serves the app at `http://127.0.0.1:4173/` on this
PC only. `ReadAloud.cmd` starts it with `-ExecutionPolicy Bypass`, which
applies to that one PowerShell window only and does not override your
organisation's rules. On a PC without WebGPU the voice is faster this way than in the web
version, because it can use several processor threads. If your organisation
blocks PowerShell scripts, use the web version.

The web version and the download keep separate libraries, because each address
has its own storage in the browser. Pick one and stay with it, or move your
library between them with **Export JSON** and **Import JSON**.

## Android

Needs a 64-bit ARM phone (almost all phones from the last few years) with
Android 7.0 or later.

1. Install `ReadAloud-<version>.apk` from
   [Releases](https://github.com/rock0ne/readaloud/releases). Your phone asks
   you to allow installing apps from your browser or file manager the first
   time. Every release is signed with the same key (`CN=rock0ne`, certificate
   SHA-256 `c5f96167fa4b6633523624bd275745a088d48ed875ff13e5104c6050475dbc0f`),
   so new versions install over the old one and keep your library.
2. Open ReadAloud and press **Download natural voice**. The voice downloads
   once, about 330 MB (Wi-Fi is best), from this project's own release
   [`kokoro-voice-2`](https://github.com/rock0ne/readaloud/releases/tag/kokoro-voice-2).
   ReadAloud checks it against its SHA-256 and unpacks it; after that it works
   offline. Keep the app open while it downloads: if it stops, the next try
   goes on from where it stopped.

ReadAloud is the only app you need. Coming from 0.2.0: download the voice in
ReadAloud once, then you can uninstall the sherpa-onnx Kokoro engine app.
ReadAloud 0.2.0 and earlier still need that engine app: see the
[0.2.0 README](https://github.com/rock0ne/readaloud/blob/v0.2.0/README.md#android).

Or install it from a computer with [adb](https://developer.android.com/tools/adb),
with the phone connected by USB and USB debugging on:

```bash
adb install -r ReadAloud-0.3.0.apk
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
   | M | Write a note on the sentence (no flag) |
   | [ / ] | Slower or faster |
   | / | Go to a page or find text |
   | Page Up / Page Down | Previous or next page, page by page |
   | Esc | Close the panel or leave the note |

   On a phone, tap the flag button instead. Click or tap a sentence to read
   from there. In Settings you can set an extra pause at a full stop and the
   pause between paragraphs; both get shorter as you speed up. The **Aa**
   button changes the font, text size and line spacing, and switches between
   one long scroll (the reading flows on, say in the car) and page by page
   (for study: one page, or two side by side on a wide screen, stopping at
   the end of each page). 🔍 goes to a page or finds text.
4. Download the corrections file from the **Flags** panel (or from the
   document in the library) and fix the mistakes in your manuscript.

## Notes and the AI assistant

- **Notes.** Press **M** or ✎ Note to write a note on the sentence being read.
  On Windows you can write in the note box with a pen and Windows turns the
  handwriting into text, or add a drawing. The **Notes** panel lists your
  notes in reading order and downloads them as a Markdown file.
- **AI assistant (optional).** In Settings, choose Claude, ChatGPT or Gemini,
  follow the link to that company's key page, make a key and paste it. Choose
  how long the app keeps it: until you close the app, or from 1 day up to
  1 year. The **AI** panel in a document then summarises the paragraph, page,
  chapter or whole document, explains a paragraph, answers your questions
  and checks a chapter for mistakes, which you can add as flags.
- **Copy for Claude (no key).** With a Claude subscription, the AI panel can
  copy the part you are reading with the instructions and open claude.ai:
  paste it there and send. Paste Claude's reply back to keep it as a note,
  with page links. ReadAloud cannot sign in to Claude for you: Anthropic does
  not let other apps use Claude sign-in.
- Replies point to the sentences they rely on: press "p. 12" to go there, and
  "Back to where I was" to return. A reply can be read aloud or saved as a note.
- Each request is charged to your own account with that company. Before a
  large request the app says how many words it will send.

## Privacy

Documents, flags, notes and settings are stored in the browser on your device
(IndexedDB) and nowhere else. There is no account, server or analytics. The
only downloads are the app itself and, once, the Kokoro voice: on Windows from
Hugging Face, in the Android app from this project's own release.
If you choose one of Edge's online Microsoft voices instead of Kokoro (they
are marked "online" in the voice list), Edge sends each sentence to Microsoft
to be spoken.

The AI assistant is off until you add a key. Then, only when you press one of
its buttons, the text of that part of the document (never your notes) goes
straight from your device to the company whose key you added, under that
company's terms. Your key is kept only in this browser on this device, for as
long as you chose, and is never included in an export. Forgetting the key in
the app does not cancel it: to cancel it, delete it on the company's key page.
Copy for Claude sends nothing itself: the text reaches Claude only when you
paste it there.

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
  (platform 36) and the sherpa-onnx Kokoro engine APK from the
  [k2-fsa project](https://k2-fsa.github.io/sherpa/onnx/tts/apk-engine.html)
  ([`sherpa-onnx-1.13.8-arm64-v8a-eng-tts-engine-kokoro-multi-lang-v1_0.apk`](https://huggingface.co/csukuangfj2/sherpa-onnx-apk/resolve/main/tts-engine-new/1.13.8/sherpa-onnx-1.13.8-arm64-v8a-eng-tts-engine-kokoro-multi-lang-v1_0.apk),
  SHA-256 `402c3628712668fb5eb8cc838add6a8f62caffd69ccc53af75384dde1e2142ec`), whose two native libraries it uses. See
  `app/android/build-apk.sh`. Sign the release APK with your own key.
  `app/android/make-voice-zip.py` makes the voice download from the same APK.
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
- The AI assistant calls the provider's API straight from the browser and
  shows the reply as it is written. There is no server in between.

## Limits

- English only (Kokoro's British and American voices).
- No text recognition: a scanned PDF (pictures of pages) cannot be read.
- DRM-protected EPUBs are refused. Files up to 50 MB (EPUB up to 500 MB).
- The Android app is for arm64 phones only.
- OneNote pages and OneDrive or SharePoint links cannot be opened yet. A Word
  file opens with Add files, or with Open with on Windows.

## Licence

GNU General Public License version 3 or later: see [`LICENSE`](LICENSE).
ReadAloud includes eSpeak NG, which is under the same licence. The other
parts and their licences are in
[`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md), which also says what is
not known about them. Every download carries the full licence texts in its
`licences/` folder; in the app, open Settings, About, Licences.

Thanks to hexgrad for Kokoro, to the k2-fsa project for sherpa-onnx and its
Kokoro engine, to Xenova and Hugging Face for kokoro-js, phonemizer and
Transformers.js, and to the eSpeak NG, ONNX Runtime and PDF.js projects.
