# 00 — Handoff to the building model

Written 2026-10-20 by the designing model (Fable). The builder will be a smaller
model; this document carries everything that is not in the spec itself.

## 1. What Rockson wants, in his words

- A read-aloud app for **Windows and his Samsung phone** (Galaxy S21+).
- Voices that sound like a **human reading**. The built-in Windows and Android
  voices are far too robotic. Speechify sounds right but is very expensive.
- Reads **`.txt`, `.md`, `.pdf`, `.docx`, `.epub`**.
- He reads lots of files, and his **book is finished**: he needs to listen through
  it quickly, mark mistakes as he hears them, and fix them afterwards.

## 2. The one fact the whole design rests on

> **Superseded on 2026-10-21 (ADR-21).** Rockson listened and rejected the
> Microsoft voices as not natural, Azure included. The Edge engine below stays
> only until a non-Microsoft engine works. Read ADR-21 before any voice work.

The robotic sound is the **voice model**, not the app. Windows gives ordinary
apps old SAPI voices. Speechify, Edge Read Aloud and Azure use neural voices.

Microsoft Edge exposes its online neural voices (names like
"Microsoft Sonia Online (Natural) - English (United Kingdom)") to any web page
through the standard Web Speech API. So a web app opened in Edge on Windows gets
Speechify-grade voices free, with no account and no backend. Chrome and the
Android WebView do not get them. That is why:

- Phase 1 is a **PWA opened in Edge on Windows** using the Web Speech API.
- The phone uses **Azure AI Speech** (the same voices, official API, free tier
  0.5M neural characters a month, roughly one listen-through of an 80k-word book).
- **Kokoro-82M** (open model, runs offline in the browser and on Android) comes in
  Phase 4 for offline use. Quality is close to the cloud voices.

## 3. Locked decisions (do not reopen)

See `04-DECISIONS.md` for the reasoning. Summary:

1. Engine order: Web Speech (Edge natural) → Azure → Kokoro → system voices as fallback.
2. Windows packaging: PWA installed from Edge. No Electron/Tauri in Phases 1–4.
3. Phone: first try the same PWA installed from Chrome on the phone (Phase 3a).
   Wrap with Capacitor (Phase 3b) only if 3a fails the gate (background playback
   or file access). Do not start with Capacitor.
4. Every format is converted to **HTML first**, then one shared
   `htmlToDocument()` builds the document model. PDF builds pseudo-HTML blocks.
5. Audio engines always synthesise at rate 1.0; speed is applied with the
   `<audio>` element's `playbackRate`. This maximises cache hits.
6. Highlighting is **sentence-level**. Word-level is Phase 5 and optional.
7. EPUB is parsed directly with JSZip + DOMParser (container.xml → OPF → spine).
   Do not use epub.js.
8. No `edge-tts`. It is an undocumented endpoint and Microsoft has already
   removed parts of it.
9. No OCR. A scanned PDF gets a clear error message.
10. UI framework: Preact + TypeScript + Vite. Storage: IndexedDB via `idb`.

## 4. What exists right now

Phase 1 (Steps 1–16) is built, tested and committed. `docs/PROGRESS.md` has
the step-by-step status, the manual checks done, and what still needs Rockson.

```
ReadAloudApp/
  CLAUDE.md, BUILD-APPROACH.md, docs/      as before
  app/
    src/core/        no UI imports: types, text/, ingest/ (txt md docx epub pdf),
                     model.ts, store/ (db, repo, settings, export), engines/
                     (webspeech, registry), player/, flags/
    src/ui/          Preact: screens/ (Library, Reader, Settings), components/,
                     hooks/, styles/ (base, reader, mobile)
    test/            vitest, one file per unit-test group, helpers/ build
                     sample .docx and .epub in memory
    vite.config.ts   PWA manifest + file handlers, CSP meta (build only)
```

## 5. Where to start

Phase 1 is waiting on Rockson for its gate (see PROGRESS "Needs Rockson"):
listen by ear in Edge, then proof one real chapter in the installed app. Do
not start Phase 2 until that gate is ticked, unless Rockson says otherwise.
Phase 2 starts at Step 17 and needs his Azure key.

## 6. Gotchas that will otherwise cost hours

Web Speech API (Phase 1):

- `speechSynthesis.getVoices()` is often **empty on first call**. Wait for the
  `voiceschanged` event with a 3-second timeout, then read again.
- Natural voices have `localService === false` and "Natural" in the name. Filter
  on that to label them "neural". If none are present, the app is not running in
  Edge or is offline: show the hint from spec 14.
- Chromium **cuts off utterances longer than about 15 seconds**. Never speak more
  than one sentence per utterance, and split long sentences into chunks of at
  most 280 characters (spec 6.3). This is why `Sentence.chunks` exists.
- `onend` sometimes never fires. Run a **watchdog** per utterance (spec 7.2).
  When it expires, treat the chunk as **not spoken**: retry once, then pause
  with an error on that sentence. Never skip unheard text (ADR-14).
- `speechSynthesis.cancel()` suppresses `onend` for the cancelled utterance.
  Treat your own cancel as a normal stop, not an error.
- Speech will not start without a **user gesture** first. The Play button is the
  gesture; do not autoplay on load.
- Natural voices ignore `rate` above about 2.0 or get choppy. Clamp to 2.0 for
  this engine. Higher speeds are only available on audio engines.
- `onboundary` events are unreliable for the online voices. Do not depend on them.

Ingestion:

- `pdfjs-dist` needs its worker configured in Vite:
  `GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()`.
- `mammoth` is about 1 MB. Import it with a dynamic `import()` inside the docx
  loader so it is not in the main bundle.
- EPUB XHTML must be parsed with `DOMParser` as `application/xhtml+xml`; if that
  yields a `parsererror` element, re-parse as `text/html`. The `epub:type`
  attribute is read with `el.getAttribute('epub:type')`, not with a CSS
  selector (the colon breaks selectors).
- EPUB hrefs are URL-encoded and relative to the OPF file's folder. Decode with
  `decodeURIComponent` and resolve relative paths before looking them up in the zip.
- `Intl.Segmenter` is available in Edge, Chrome and Android WebView. Keep the
  regex fallback in spec 6.1 only for environments without it.

Azure (Phase 2):

- REST endpoint, headers and SSML are in spec 7.3. Escape `& < > " '` in the text
  before putting it in SSML.
- **CORS risk**: browsers calling the TTS REST endpoint directly may be blocked
  by CORS. Verify in Step 17 with a single fetch. If blocked, the fallback is the
  official JS Speech SDK (`microsoft-cognitiveservices-speech-sdk`), which works
  in browsers over WebSocket. Record the outcome in `04-DECISIONS.md`.
- Free tier allows 20 synthesis requests per 60 s. Pace every request through
  the limiter, group sentences into segments, and buffer before playing
  (spec 8.3, ADR-15). Concurrency limits alone are not enough.
- Never log the key. Never put it in a URL.

Phone (Phase 3):

- Mobile browsers suspend JavaScript when the screen is off unless media is
  playing through an `<audio>` element. The Azure engine plays through `<audio>`,
  so it can continue; the Web Speech engine cannot. Use the Media Session API so
  lock-screen controls work.
- Request `navigator.storage.persist()` once so the library is not evicted.

## 7. Toolchain

- **There is no Node on the Windows PATH.** Phase 1 was built with a portable
  Node 22 copied into a Claude session scratchpad:
  `<session scratchpad>/nodewin/`
  (`env.sh` beside it puts it on PATH and `cd`s into `app/`). pnpm 11 comes
  from `corepack`. That folder is temporary. If it is gone, ask Rockson to
  install Node 22 LTS, or unpack the official portable zip into your own
  scratchpad. Then update the two ReadAloud entries in the parent
  `Fable/.claude/launch.json`.
- Rockson starts the built app with `app/start-readaloud.cmd` (double-click).
  It uses system Node if present, else the portable one above, serves
  `app/dist` on `http://127.0.0.1:4173` and opens Edge. Rebuild before he
  uses a change.
- The preview tool reads `launch.json` from the **parent** `Fable/` folder,
  not from `ReadAloudApp/`. The `readaloud-preview` entry serves `app/dist` on
  `http://127.0.0.1:4173` (run `pnpm build` first). `localhost` does not reach
  it from the browser pane, because the pane resolves `localhost` to IPv6.
- After a rebuild, the service worker serves the previous build once; the
  second load shows the new one. Reload twice before judging a change.
- The browser pane has only Basic Windows voices. Natural voices need real
  Edge. To check them without sound, start Edge with `--headless=new
  --mute-audio --remote-debugging-port=<port> --user-data-dir=<your scratchpad>/edge-qa`
  and drive it over CDP. Pass `userGesture: true` to `Runtime.evaluate`,
  otherwise Edge refuses speech with `not-allowed`. Stop it afterwards by its
  `--user-data-dir` only: Rockson's own Edge is usually running.
- Android builds (Phase 3b only) are done in WSL Ubuntu, not Windows: the
  Windows sandbox blocks the JVM loopback socket Gradle needs. JDK 21 and the
  Android SDK (platform 36) are already under `~/.local` in WSL from an earlier
  Capacitor project. Flow: `pnpm build` → `npx cap sync android` →
  `./gradlew assembleDebug` in `app/android` → `adb install` to the S21+.
- Rockson's phone pairs over adb.

## 8. Things only Rockson can supply

Ask for them in `docs/PROGRESS.md` under "Needs Rockson", and keep working on
everything else:

- An Azure AI Speech resource (Free F0) in his **production** tenant and its
  region + key, entered by him into the Settings screen. Never the lab tenant.
- One chapter of the book as `.docx` and as PDF, plus the `.md` if he has one,
  for `app/test/fixtures/private/` (git-ignored). Do not copy book text into any
  committed file.
- Voice preference (UK voices Sonia/Ryan are the default guess).

## 9. How to save tokens while building

- Read only the spec sections the current step names.
- Do not paste whole files back into the conversation; summarise what changed.
- Write tests first for core modules; they are cheaper than manual rechecking.
- Keep `PROGRESS.md` short: one line per step plus open issues.
