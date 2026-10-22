# 04 — Decision log

Format: ADR-n · date · decision · why · consequences. Add new entries at the
end; never edit an accepted entry, supersede it.

## ADR-1 · 2026-10-20 · Windows app is a PWA installed from Edge
Why: Edge exposes Microsoft's online neural voices to web pages through the Web
Speech API. Free, official, no backend. Electron/Tauri would add packaging work
and would not get those voices.
Consequences: Phase 1 depends on Edge for natural voices; Chrome users need
Azure or Kokoro.

## ADR-2 · 2026-10-20 · Engine order: Web Speech → Azure → Kokoro → system
Why: zero-cost first, official paid-with-free-tier second, offline third.
Consequences: an abstract `VoiceEngine` interface; engines are swappable.

## ADR-3 · 2026-10-20 · Every format becomes HTML, then one `htmlToDocument()`
Why: `.md` (marked), `.docx` (mammoth) and `.epub` (XHTML) already produce
HTML; one block walker means one set of tests. PDF produces blocks directly.
Consequences: Markdown/Word/EPUB quirks are handled in a single place.

## ADR-4 · 2026-10-20 · Audio engines synthesise at rate 1.0; speed via `playbackRate`
Why: one cached clip per sentence serves every speed; rewinds and re-listens
are free. Chromium preserves pitch when changing `playbackRate`.
Consequences: the Web Speech engine (no audio element) is capped at 2.0.

## ADR-5 · 2026-10-20 · EPUB parsed with JSZip + DOMParser, not epub.js
Why: we need text and structure, not rendering; epub.js is large and
rendering-oriented. The container → OPF → spine chain is small and testable.
Consequences: ~150 lines of parsing code we own; DRM is detected and refused.

## ADR-6 · 2026-10-20 · Preact + TypeScript + Vite; IndexedDB via `idb`
Why: small bundle, familiar JSX, Vite dev loop; `idb` is a thin promise wrapper.
Consequences: no React-only libraries.

## ADR-7 · 2026-10-20 · No backend, no accounts, no sync server
Why: personal tool; privacy; nothing to run or pay for. Cross-device transfer is
a JSON file.
Consequences: Azure key lives on each device; manual JSON export/import.

## ADR-8 · 2026-10-20 · Phone: try the PWA first, Capacitor only if the gate fails
Why: the voice problem is the same either way (Azure/Kokoro); a PWA avoids the
Android build entirely. Install path: `adb reverse` so `http://localhost:4173`
on the phone is a secure context.
Consequences: if screen-off playback or file access fails, Step 23 wraps the
same app in Capacitor using the existing WSL toolchain.

## ADR-9 · 2026-10-20 · Sentence-level highlighting
Why: boundary events are unreliable for Edge online voices and absent from
REST audio. Sentence granularity is what proofreading needs.
Consequences: word-level is an optional Phase 5 item via the Azure Speech SDK.

## ADR-10 · 2026-10-20 · No `edge-tts` or other undocumented endpoints
Why: unofficial; Microsoft has already removed SSML support from it; it can
stop working without notice. The official routes (Edge Web Speech, Azure) give
the same voices.
Consequences: none for the design; it was never on the critical path.

## ADR-11 · 2026-10-20 · No OCR
Why: out of scope; the book exists as `.docx`/`.md`. Scanned PDFs get a clear
error.
Consequences: spec 14 message; could be revisited with Tesseract.js later.

## ADR-12 · (Step 17) · Azure from the browser: REST or Speech SDK
To be filled by the builder after the CORS spike. Record: endpoint used, whether
CORS allowed direct `fetch`, and the chosen path.

## Review of 2026-10-20 (pasted by Rockson) — corrections accepted

An independent read-only review of the written plan raised five issues and
three contradictions. All were accepted and applied on 2026-10-20 by the
builder (Opus), who also wrote the original design as Fable. The reviewer was
not the author.

## ADR-13 · 2026-10-20 · Automatic voice selection is neural-first across engines
Why: walking engines in order and taking the first with any voice let Basic
system voices win in Chrome or on the phone even when Azure or Kokoro natural
voices were available. That defeats the purpose of the app.
Consequences: `pickEngine` runs a neural pass, then a fallback pass (spec 7.1).
A voice the user picks by hand is still honoured.

## ADR-14 · 2026-10-20 · Unconfirmed speech is a failure, never a skip
Why: the original watchdog treated a missing `end` event as success and moved
on, so book text could go unheard during proofreading without any sign.
Consequences: the watchdog and implausibly early `end` events reject; the
player retries the chunk once and then stops in `error` on that sentence
(spec 7.2, 8.2). Tests U10 and U11 assert this.

## ADR-15 · 2026-10-20 · Azure requests are paced, grouped and buffered
Why: Azure F0 allows 20 synthesis transactions per 60 s. Concurrency 2 with a
2-second retry did not enforce that, and one request per sentence would stall
playback at higher speeds.
Consequences: token-bucket limiter (18/60 s default), segments of up to 600
characters, 30 s buffer before play, `Retry-After` back-off (spec 8.3). Phase 2
work; Phase 1 is unaffected.

## ADR-16 · 2026-10-20 · Import merges by `updatedAt`, remaps ids, validates references
Why: skipping existing flag ids lost edits made on the other device; document
ids differ per device; title + character count can match two different
revisions.
Consequences: two-phase import with explicit confirmation for possible
matches, per-flag newest-wins merge, re-anchoring by quote, and a report of
flags that could not be placed (spec 9.2, U13).

## ADR-17 · 2026-10-20 · The Edge natural-voice assumption is tested early
Why: the whole Phase 1 plan rests on Edge exposing natural voices that actually
speak through the Web Speech API. Microsoft's announcement of this dates from
2019, and a listed voice is not proof that it speaks.
Consequences: a voice reality gate right after Step 10 (build plan). If it
fails, Azure moves forward as the primary engine.

## ADR-18 · 2026-10-20 · Small spec adjustments made while building Steps 2–8
- 5.0: every loader returns `LoaderResult` (blocks, warnings, optional chapter
  starts and TOC) instead of raw HTML, because EPUB and PDF need more than HTML.
- 5.1: `header` and `footer` are no longer removed. EPUB chapters often wrap
  their chapter title in `<header>`; removing it lost headings.
- 5.5: a styled block is promoted to a heading only when its text is the TOC
  title (equal, or one contains the other with a length ratio of at least 0.5),
  so a paragraph that merely mentions "Part Two" is not promoted.
- 5.7: the chapter level is the smallest heading level, unless it occurs once
  (a book title) and a deeper level repeats. Fewer than 3 blocks before the
  first chapter are folded into it instead of forming "Front matter".
- 6.1: abbreviations are split into always-join (Mr., Dr., St., No., ...) and
  join-only-before-lowercase (etc., e.g., i.e., ...). The spec's single list
  would have split "Dr. Smith" because the next word is capitalised.
- 6.2: a dash between two numbers reads as "to" ("1990–1995").

## ADR-19 · 2026-10-21 · Storage contract additions made in Step 9
- A `summaries` store holds one small `DocSummary` per document. The library
  list reads only these, so opening the app never loads multi-MB `DocRecord`s.
  Every write to `docs` writes the summary in the same transaction.
- `sources` stores `{ docId, bytes: ArrayBuffer }`, not a `Blob`. ArrayBuffers
  clone reliably in every IndexedDB, including the one the tests use, and the
  re-parse path needs bytes anyway.
- `PositionRecord.ordinal` (optional) is the sentence's reading-order index.
  The library shows progress as `ordinal / sentenceCount` without opening the
  document. Positions from old exports without it still import.
- Spec sections 4 and 9.1 are updated to match. The schema stays at version 1
  because nothing was released before these changes.

## ADR-20 · 2026-10-21 · Fixes from the Step 16 browser check
Found by driving the built app in a browser, not by the unit tests:
- pdf.js transfers (detaches) the `ArrayBuffer` it is given, so storing the
  original bytes afterwards failed. `parseBytes` now gives every loader its own
  copy (`bytes.slice(0)`), and a test checks the caller's buffer is untouched.
- That failure also exposed a non-atomic add: `put()` threw synchronously, the
  requests already queued committed, and the library showed a document with no
  source. `addDocument` now aborts the transaction on any failure (test added).
- mammoth reports each unknown Word style twice in its own wording. These are
  merged into one line: "Word styles not recognised: X. Their text is read as
  normal paragraphs." Other mammoth messages pass through unchanged.
- Speech error codes become plain reasons. Edge returns `not-allowed` when
  speech starts without a click or key press; the app now says so.
- Phone layout: the bottom-sheet panel was fixed to the screen bottom with a
  120 px allowance, but the controls are about 168 px tall, so the last
  contents entries sat under them. The sheet is now anchored to the bottom of
  the reading area, which ends where the controls begin, whatever their height.
- Step 16's "Update available" toast was missing. It now appears when a new
  service worker takes over a page that already had one (not on first install).
- `app/start-readaloud.cmd` serves `app/dist` on `http://127.0.0.1:4173` and
  opens Edge, because Rockson's PC has no Node on the PATH. This is the "local
  static server" CLAUDE.md allows; nothing is deployed or published.

## ADR-21 · 2026-10-21 · Rockson rejects Microsoft voices; the next engine is chosen by ear
Rockson, 2026-10-21: the Microsoft voices do not sound natural, so building on
them is pointless. This covers Edge's online natural voices and Azure Speech,
which uses the same voice family.
Consequences:
- Phase 2 (Azure) is dropped. Do not build Steps 17–20 as written.
- The Web Speech engine stays in the code only until a replacement engine
  works, so the app keeps speaking. Removing it is Rockson's call.
- The replacement is chosen by a listening test. Samples of one neutral
  passage (no book text) are in `Fable/voice-samples-20261021/`, outside the
  repo. Results are in PROGRESS "Measurements".
- Candidates:
  - **Kokoro-82M** (Apache 2.0): runs in the browser on the PC and the phone,
    no internet, about 5× faster than real time on the PC's CPU, read the
    passage word for word. It was already Phase 4 (Step 24).
  - **Qwen3-TTS 1.7B** (Apache 2.0): more expressive, and can design a voice
    from a written description. Needs the PC's RTX 3060; on Windows without
    flash-attention it ran about 3.7× slower than real time, so it would have
    to pre-render chapters on the PC rather than read live. Its built-in
    "Ryan" voice changed words ("until morning" became "in the morning"),
    which is dangerous for proofreading; the two designed British voices were
    word-perfect in this test. Speed in WSL with flash-attention is untested.
- Whatever is chosen, every rendered sentence should be checked against its
  text (speech recognition, as in the test) before the app trusts it for
  proofreading. A voice that silently changes words hides the very mistakes
  Rockson is listening for.

## ADR-22 · 2026-10-21 · Kokoro is the main voice, on the PC and the phone
Rockson, 2026-10-21: "Kokoro sounds natural enough. Build it into the app as
the main voice, on the PC and the phone." He left the voice name blank, so the
default is **bf_emma** (Emma, UK). Picking another voice is remembered.

Built (Step 24, brought forward from Phase 4):
- `KokoroEngine` in core (kind `audio`) over a `KokoroBackend` port. The UI's
  `KokoroClient` runs kokoro-js 1.2.1 in a module worker, one job at a time.
- Model `onnx-community/Kokoro-82M-v1.0-ONNX`, **fp32** on WebGPU and on wasm.
  Spec 7.4 said q8 on wasm. fp32 is what Rockson heard and approved, and q8 is
  slower on wasm anyway (PC: 0.64x real time against fp32's 1.08x).
- Download about 326 MB once, with a progress bar. All 11 voices are stored at
  download time, so every voice works offline. Settings can remove it all.
- Voices: bf_emma, bm_george, bf_isabella, bm_fable, bm_lewis, af_heart,
  af_bella, af_nicole, am_michael, am_fenrir, am_puck. bm_fable replaces
  am_adam, which the model's own voice notes grade lowest.
- The ONNX runtime (22 MB wasm) is served from the app at `/ort/` and
  precached, not fetched from the jsDelivr CDN that transformers.js uses by
  default. The resolve condition `onnxruntime-web-use-extern-wasm` stops Vite
  from bundling a second copy.
- Cross-origin isolation (COOP `same-origin`, COEP `credentialless`) lets the
  runtime use several threads when it runs on the processor in Edge. Firefox
  on Android ignores `credentialless`, so on the phone Kokoro runs on one
  thread: 0.2x to 0.3x real time in the app (S21+, 2026-10-21).
  `require-corp` was tried, because Firefox on Android honours it, and a test
  page reached 0.68x with 4 threads. In the app the voice then stayed on
  "Loading" for over 5 minutes. After switching back to `credentialless` the
  same stall happened twice more, and cleared only after a rebuild and two
  Firefox restarts. Likely cause, found later the same day (ADR-25): each
  rebuild left Firefox running the old page after the new version had
  deleted the old files, so the voice worker could not load them. The
  threads were probably not the problem; `require-corp` was not tried
  again. The app stays on
  `credentialless`, which is the setting verified to read on the phone. The
  model download works under both: it is a CORS fetch. A static server used
  instead of `pnpm preview` must send the same two headers.
- The voice worker says when it has started, reports each loading step
  (graphics-chip check, model, voices, a first test sentence) in the voice
  status line, and reports errors that escape its load. A stall now shows
  where it stopped, and a failure shows the real message or "the voice
  worker could not be loaded", not a bare "the voice worker stopped".
- CSP: `script-src` adds `'wasm-unsafe-eval'`; `connect-src` is now `'self'`
  plus Hugging Face only (the Microsoft host is gone with Azure).
- Settings schema 2: `enginePreference` defaults to `['kokoro', 'webspeech']`.
  Version 1 settings move Kokoro first and drop Azure and its key.
- Registry rule (spec 7.1): engines in preference order; for each, the saved
  voice if still listed, else its best natural voice. A saved browser voice no
  longer outranks Kokoro. The Basic fallback pass is unchanged.
- Player, audio engines: 3 chunks made ahead; finished clips kept in memory (8)
  and in the IndexedDB audio cache; seek drops unfinished clips that are no
  longer ahead; Pause stops waiting but lets a clip finish being made. The
  pause between sentences now applies to every engine.
- Short sentences: Kokoro misreads a one- or two-word sentence on its own
  ("Four." came out as "Thor" or "Thought" in the Whisper check, on the GPU
  and the CPU). Such a sentence is made in one clip with its neighbour in the
  same paragraph (up to 300 characters), and the highlight moves on by
  character share during the clip. With that, the Whisper check was
  word-exact.
- Warm-up: when a document opens and the voice is stored, the worker loads the
  model and makes "Ready." silently, so the first sentence starts about 0.7 s
  after Play on the PC.
- Media Session (spec 8.6): lock-screen and headset play, pause, previous and
  next; title = document, artist = chapter. No silent audio element is needed:
  the real clips play in one reused `<audio>` element.
- After an app update, an open page's old worker file can be gone. The error
  then says to reload the app.

Dependencies: kokoro-js 1.2.1, exact pin (brings @huggingface/transformers
3.8.1, onnxruntime-web 1.22.0-dev and phonemizer 1.2.1). pnpm 11 asks about
install scripts: `app/pnpm-workspace.yaml` sets `allowBuilds` to false for
onnxruntime-node, protobufjs and sharp, which are Node-only.

Still open:
- ADR-21 asks that every sentence be checked by speech recognition before the
  app is trusted for proofreading. The app does not do that itself: it would
  need a second large model on the device. The check was run outside the app
  (Whisper) on the test passage. Rockson's listening stays the judge.
- The phone result is in ADR-24.

## ADR-23 · 2026-10-21 · Fixes from Sol's second review
Sol (read-only review of `28265e0` plus the unfinished Kokoro edits) found three
defects. Each has a test that fails on the old code and passes now.
1. **A flag could move to the wrong sentence.** When the text changed, a flag
   went to the first sentence with the same words, so a flag on the second
   "Yes." landed on the first. Flags now store their neighbouring sentences
   (`Flag.context`, optional, so older flags and exports still load). A quote
   found once is placed there. A repeated quote is placed only where its
   neighbours match, or failing that at its exact old place (same sentence
   id, chapter and paragraph). Otherwise the flag is reported as unplaced and
   Rockson re-flags it, rather than finding a correction on the wrong
   sentence. No database version change: no store or index changed.
2. **Re-read could fail half-way.** It read the saved position after the
   write transaction had already finished. All reads and writes now share one
   transaction, which is aborted on any error, so a re-read either completes
   or changes nothing.
3. **Pressing Play twice while the voice was being chosen read the text twice
   at once.** There is now one pending start; a second Play joins it. Pause,
   Stop and opening another document cancel a start that is still choosing.

Sol's status corrections are applied in PROGRESS: the Azure key request is
removed, the test count covers the Kokoro work, and the unchecked reader
controls are listed.

## ADR-24 · 2026-10-21 · Scope reconciled with Rockson's full request
Rockson's request, as Sol restated it on 2026-10-21:
1. A Windows reader with voices he finds natural, not Microsoft's.
2. An installable Samsung phone version.
3. EPUB, PDF, DOCX and Markdown import, **plus copy-and-paste text**.
4. The proofreading features: flag, note, export corrections, resume.
5. An option for custom voices, which he understood to mean SAPI 5.

What this changes:
- **Paste text (new).** Library: "Paste text" opens a box; Ctrl+V anywhere in
  the library opens it with the clipboard text. Pasted text becomes a
  plain-text document titled by its first line (or a typed title), stored like
  an added `.txt` file, so flags, resume and corrections work the same.
- **Upload** was already there ("Add files", drag and drop, Edge file
  handlers). On the S21+ the Android picker offered `.docx`, `.md` and `.txt`
  and added three at once (2026-10-21).
- **SAPI 5 voices cannot be added to this app.** Checked on Rockson's PC on
  2026-10-21: Windows has SAPI 5 voices (Hazel Desktop, Zira Desktop) and
  OneCore voices (George, Hazel, Susan). Edge 155 offers the three OneCore
  voices and 321 Microsoft online voices, and none of the SAPI 5 ones. A
  browser app only sees what the browser offers, so a SAPI 5 voice installed
  in Windows would not appear in it.
- **Two different "custom voice" deliverables**, so Rockson can choose:
  a. *Inside ReadAloud*: more voices to choose from, made by Kokoro in the
     app. Today 11 Kokoro voices; more Kokoro voices or blends of two voices
     are possible without SAPI.
  b. *Kokoro inside other Windows programs*: a SAPI 5 adapter that runs Kokoro
     and registers it with Windows, for SAPI programs such as Narrator. That
     is a separate Windows program with its own installer (run by Rockson, as
     it writes to the system registry). It would not reach Edge's own Read
     Aloud or Android. Each target program needs its own test. Not started:
     needs Rockson's go-ahead.
- **Phone.** In Firefox on the S21+ (Exynos 2100, no WebGPU), Kokoro in the
  app runs on one thread and makes speech at 0.2x to 0.3x real time, so
  continuous reading keeps pausing. Four threads reached 0.68x on a test page but not
  inside the app (ADR-22), and 0.68x would still pause. Locked decision 3 allows Phase 3b when 3a fails its gate, and this
  is such a failure. Routes, fastest to try first:
  1. The sherpa-onnx Kokoro **Android voice engine** (Apache-2.0 code, from
     the k2-fsa project): native code, installed as an Android text-to-speech
     engine, so Kokoro becomes available to Firefox (and so to ReadAloud's
     "Browser voices") and to other Android reading apps. Rockson approved
     it on 2026-10-21: `sherpa-onnx-1.13.8-arm64-v8a-eng-tts-engine-kokoro-multi-lang-v1_0.apk`
     from huggingface.co/csukuangfj2/sherpa-onnx-apk (linked by the k2-fsa
     docs), 366,940,057 bytes, SHA-256 `402c3628…2142ec` as published,
     signed by CN=k2-fsa, package `com.k2fsa.sherpa.onnx.tts.engine`, no
     internet permission. Installed on the test phone by adb. Its own test
     screen, speaker 21 (bf_emma), 4 threads: 16.7 s of speech in 13.2 s
     (1.26x real time), so it keeps up. The voice is one speaker number for
     the whole engine, set in its app, not ReadAloud's voice picker. Rockson
     set it as the preferred engine himself. Through ReadAloud in Firefox a
     whole test chapter read to the end, but 35% of the time was silence
     (about 3 s before each sentence; PROGRESS), because each sentence is
     made only after the previous one has played. To flow, sentences must be
     made ahead, as the PC does: that needs route 2 (an Android app).
  2. Step 23 + 25: ReadAloud as an Android app (Capacitor) with sherpa-onnx
     inside. More work; the result is a single app.
  3. Chrome on the phone with WebGPU. Chrome is disabled on the test phone;
     turning it on needs Rockson to accept Chrome's terms.

## ADR-25 · 2026-10-21 · Reload when a new version takes over

Context: the service worker updates itself (`autoUpdate`, spec 12): the new
version takes over open pages at once and deletes the old version's files.
A page still running the old code then fails on anything it has not loaded
yet. On the S21+ adding a Markdown file failed with "error loading
dynamically imported module …/md-….js", and the Kokoro voice stalled on
"Loading" after each rebuild (ADR-22). The old toast "Update available.
Reload the app" came too late: the page was already broken.

Decision: the page reloads when a new version takes over. If nothing is
being read, it reloads at once. While reading, it says "ReadAloud was
updated. It reloads when you pause or stop." and reloads then, so no sentence
is cut off; the voice and the open document are already loaded, so reading
carries on until then. The first install, which also changes the
controller, does not reload. Code: `app/src/ui/update.ts`, tested in
`app/test/update.test.ts`. The reading position is saved as it goes
(spec 9), so a reload loses nothing but an unsaved note being typed.

Updates only come when the app is rebuilt on the PC, so this is rare in use.

## ADR-26 · 2026-10-21 · Large EPUBs: read the text, store it without pictures

Context: Rockson's book as an EPUB is 222 MB: 107 PNG
pictures make up 231.8 MB unpacked, and the text is 2.2 MB in 42 XHTML files.
The 50 MB limit (spec 5.0) refused it. The app also stores every original
file for Re-read, which would have kept 222 MB of pictures on the phone, and
the loader was given a second copy of the whole file in memory.

Decision:
- EPUBs may be up to 500 MB; every other format keeps 50 MB. Size is
  checked before the file is read into memory.
- An EPUB is stored without its pictures, fonts and media (`textOnlyEpub`):
  everything the reader uses is kept, so Re-read gives exactly the same
  text. The duplicate check still uses the hash of the file as picked.
- Only the PDF loader gets its own copy of the bytes (pdf.js detaches the
  buffer it is given); the other loaders read in place.

Checked on the PC (Node) with the book itself, which stays in the git-ignored
`app/test/fixtures/private/`: read in 2.6 s; 41 chapters, 520 contents
entries, 22,043 sentences, 227,184 words, no warnings; stored copy 0.68 MB;
Re-read identical. Unit tests: a 51 MB EPUB reads and is stored at under
100 kB with the same text; the limits per format. On the S21+ in Firefox the
EPUB was added and opened in about 9 s (PROGRESS).


## ADR-27 · 2026-10-21 · An Android app that makes Kokoro sentences ahead, inside the app

Context: in Firefox on the S21+ the installed Kokoro engine read a whole
chapter, but 35% of the time was silence, about 3 s before each sentence
(ADR-24, PROGRESS). Firefox hands the engine one sentence at a time, and it
makes each one only after the last has played. Kokoro itself makes speech
faster than real time on the phone, so it can keep ahead if it is asked early.
Rockson chose, in chat on 2026-10-21: "build the ReadAloud Android app that
makes the next sentences ahead with the installed Kokoro engine, keeping exact
highlight and flags."

Decision:
- Step 23 (Capacitor wrapper) is brought forward, before the Phase 1 to 3
  gates, as ADR-22 brought Kokoro forward. Only three packages from spec 13:
  `@capacitor/core`, `@capacitor/cli`, `@capacitor/android`, version 8.5.0
  (8.5.3 came out the day before; 8.5.0 already builds with the WSL
  toolchain). Not added: the file picker (the app's file input opens
  Android's own picker), keep-awake (one call in ReadAloud's own plugin),
  filesystem (clips are read with `fetch` from `convertFileSrc`).
- The voice is made inside ReadAloud's own process by sherpa-onnx 1.13.8,
  from the files of the installed Kokoro engine app
  (`com.k2fsa.sherpa.onnx.tts.engine`): the model, voices and eSpeak data are
  read from that app's assets (`createPackageContext`), so ReadAloud does not
  carry the 330 MB model. sherpa-onnx's two native libraries
  (`libsherpa-onnx-jni.so`, `libonnxruntime.so`, Apache-2.0 and MIT) are taken
  at build time from the same engine APK Rockson approved for ADR-24, and are
  git-ignored. A small Java copy of sherpa-onnx's Kotlin API classes lets the
  library find its fields by name. Design: `docs/05-ANDROID-KOKORO.md`.
- The web side turns each sentence into phonemes exactly as kokoro-js does on
  the PC (its `phonemize`, ported with its normalisation of years, money and
  titles), with the same `phonemizer` 1.2.1 package (eSpeak NG, Apache-2.0),
  now a direct dependency. sherpa-onnx is given the phonemes, not the text.
  So the PC and the phone say each word the same way. As in sherpa-onnx's
  own engine app in this mode, the text itself is not passed to sherpa-onnx.
- All eleven Kokoro voices of the picker, UK and US, female and male, map to
  their speaker numbers in the model (`SHERPA_SPEAKERS`), so the voice is
  chosen in ReadAloud per document as on the PC.
- The player keeps the next 3 clips being made (spec 8.3) while one plays,
  through the same `KokoroEngine` (id `kokoro`) with a phone backend, so the
  highlight and flags work as on the PC.
- A clip with no sound is an error, never a silent success: a proofreader
  would miss the words.
- Capacitor's logging is off (`loggingBehavior: "none"`): in a debug build it
  writes every plugin call to the phone's log, and the phonemes are the book's
  text in another spelling.
- The app's web files are built with `vite build --mode android` into
  `dist-android`, without the service worker: they come from the APK, so
  there is nothing to update in place (ADR-25 does not apply). eSpeak's
  1.3 MB module loads the first time the phone voice speaks.
- The screen stays on while reading. Reading with the screen off is not
  attempted yet.
- App id `uk.rocksonarthur.readaloud`. `app/android/` is committed (Step 23).

Changed the same day, after testing on the phone:
- First design: Android's `TextToSpeech.synthesizeToFile` through the engine
  app. Each clip took 18 to 64 s: the phone freezes the engine app's process
  (cgroup `frozen`) while it plays no sound itself, and thaws it about once a
  minute. Hence sherpa-onnx in ReadAloud's own process, which is in the
  foreground while it reads.
- sherpa-onnx's own text route (its lexicon) skips, silently, every word its
  lexicon lacks: digits ("1962", "43") and names ("Porthwen", "Penrose").
  The engine app's speech service uses the same route (its phoneme switch
  is off in this build, seen in its code), so in Firefox too, numbers and
  names were left out (ADR-24). Without a lexicon it makes no sound at all.
  Hence the phonemes from the web side.

## ADR-28 · 2026-10-21 · Audio clips prepared about 40 s ahead, not 3 clips

Context: in the Android app (ADR-27) a 1,362-word test chapter read with
gaps of about 0.3 s, but some sentences waited 2 to 9 s. Each long wait came
before a long sentence after a run of short ones: three short clips ahead are
only about 6 s of speech, and the phone needs about as long as the sentence
lasts to make it.

Decision: an audio engine's clips are prepared until at least 3 chunks and
at least 600 characters (about 40 s of speech) lie ahead, at most 12 chunks
(`PREFETCH_CHUNKS`, `PREFETCH_CHARS`, `PREFETCH_MAX_CHUNKS` in the player;
spec 8.3). When the voice is made faster than it plays, the extra lead builds
up in the quiet stretches and covers the long sentences. On the PC it costs
nothing noticeable: the clips are made in the background and cached anyway.

Limit, measured the same day: once the phone warms up (it was charging over
USB, battery 31.5 °C to 37.8 °C), Android caps the fast cores at 1.35 GHz and
Kokoro drops to 0.6x to 0.9x real time; then no lead is enough, and about one
sentence in five still waits 2 to 9 s. A second run with the wider lead
measured the same (below 1x for most of it). Thread counts 2, 4, 6 and 8 gave
no clear gain (results moved by 40% between two runs of the same count), so
it stays at 4.

Found in CI the same day: each clip hashes its text and looks in the cache
before asking the engine, and those steps finish in any order, so the engine
could be asked for later sentences before the one about to play. The phone
makes one clip at a time in the order it is asked, so that delays the next
sound by whole clips. Each clip now waits until every clip started before it
has asked the engine (or found its audio in the cache) before asking itself.
It waits only for the asking, not for the clip to be made. Two tests with a
cache that answers in reverse order cover it.

## ADR-29 · 2026-10-21 · Published on GitHub for anyone to use

Context: Rockson wants both apps to work on other people's PCs and phones,
and to share them on his GitHub "so it benefits the community as well".
Until now nothing was published (CLAUDE.md), the Windows launcher needed a
Node that only the build machine had, and the APK was a debug build.

Decision (Rockson's choices, 2026-10-21):

- **Repository**: public, `github.com/rock0ne/readaloud`. Commits carry his
  GitHub no-reply address, not his personal email; the history was rewritten
  once before the first push, which also removed a device serial and two
  private notes from old commits.
- **Licence**: GPL-3.0-or-later, because eSpeak NG (GPL-3.0-or-later) is part
  of the apps: compiled to WebAssembly in `phonemizer` (the Android app's
  phonemes, ADR-27) and built into sherpa-onnx's native library in the APK.
  `THIRD-PARTY-NOTICES.md` lists the other parts and their licences.
- **Windows, two ways**:
  1. The web version on GitHub Pages, `https://rock0ne.github.io/readaloud/`,
     built by `.github/workflows/pages.yml` on every push to `main` (tests
     first) with `--base /<repo>/`. Open it in Edge and install it. GitHub
     Pages cannot send the cross-origin isolation headers (ADR-22), so without
     WebGPU the voice runs on one thread; Edge on most PCs has WebGPU, where it
     makes no difference. Checked in headless Edge with no such headers under
     `/readaloud/`: the service worker installs with scope `/readaloud/` and
     precaches the onnxruntime files from `/readaloud/ort/`.
  2. A zip on GitHub Releases, made by `app/windows/package.ps1`: the built
     app, `ReadAloud.cmd`, `serve.ps1` and a short `README.txt`. `serve.ps1` is
     a small static file server written for Windows PowerShell 5.1 (C# through
     `Add-Type`), which every Windows 10 and 11 PC has: nothing to install, no
     Node, no admin rights. It listens on `127.0.0.1:4173` only, sends the
     isolation headers, answers GET and HEAD only, and refuses paths outside the
     app folder. Rockson's `app/start-readaloud.cmd` now uses the same server, so
     it no longer needs Node either, and it keeps the same address, so his
     library and flags stay where they are.
- **Android**: the APK on GitHub Releases is signed with Rockson's own release
  key. He creates the key and signs the APK himself (keytool and apksigner ask
  for the password; it is never written to a file or seen by the building
  model). The sherpa-onnx Kokoro engine APK is not redistributed: people
  install it from k2-fsa's download first, because ReadAloud reads the model
  and voices from it (ADR-27). `app/android/build-apk.sh` builds the APK from
  source on Linux or WSL.
- New top-level folder `.github/` (the Pages workflow only). New files at the
  root: `README.md`, `LICENSE`, `THIRD-PARTY-NOTICES.md`, `.gitattributes`
  (Windows files keep CRLF, `gradlew` keeps LF).
- CLAUDE.md's "do not deploy or publish anywhere" now allows exactly these
  three places and nothing else.

Not changed: no backend, no accounts, no analytics. Documents never leave the
device; the only downloads are the app itself and the Kokoro model from
Hugging Face. Book files stay git-ignored.

Found while testing: .NET's `Path.GetFullPath` expands short 8.3 names
(`PROGRA~1`), so `serve.ps1` answered 404 to everything when its folder was
given in that form. It now compares against the folder in the same expanded
form.

## ADR-30 · 2026-10-21 · An AI study assistant with the reader's own key, and notes

Context: Rockson (2026-10-21) wants AI in the app to "speed up learning and
reading": people add their own API key for ChatGPT, Claude or Gemini, and the
AI summarises the document chapter by chapter and page by page and answers
questions about it. Notes while reading, and a tablet pen if it needs nothing
extra. "The keys should never be saved to the GitHub", and a key is kept for as
long as the user chooses, up to a year.

Decision:

- **Off until a key is added.** Three providers: Claude (Anthropic), ChatGPT
  (OpenAI) and Gemini (Google), called straight from the browser with `fetch`
  and read as a stream, so text appears as it is written. No SDKs and no new
  dependency: one small file per provider in `core/ai/`. Three SDKs would add
  three dependencies and a lot of code to an offline web app for one HTTP call
  each. Anthropic asks browser callers to send
  `anthropic-dangerous-direct-browser-access: true`; the name warns that a key
  in a web page can be read by that page's scripts. Here the key belongs to the
  person using the page and the app loads no third-party scripts (spec 15).
- **Models.** "Check key" lists the models the key can use, so the list is
  always the account's own. Claude defaults to Claude Opus 5.5
  (`claude-opus-5-5`); the user can pick Sonnet 5.5 or Haiku 5.5 (cheaper),
  Fable 5.1, or any model listed. ChatGPT and Gemini suggest the first listed
  model from a short preference list, otherwise the user picks. Claude 5 models
  get `output_config.effort: "medium"`. Opus 5.5, Opus 5, Sonnet 5.5 and Fable
  5.1 also get `fallbacks: "default"` (beta header
  `server-side-fallback-2026-07-01`): if a safety check declines a request,
  Anthropic retries it on its recommended model instead of failing. If the API
  rejects that option, the app retries once without it. A decline that remains
  is shown as "The model declined this request" and its partial text is not
  kept. The document is sent as its own block marked `cache_control`, so a
  second question about the same chapter costs less.
- **Keys** live only in IndexedDB on that device (store `keys`), with the expiry
  the user picks when saving: 1 day, 7 days, 30 days (default), 90 days, 1 year,
  or a date up to a year ahead. An expired key is deleted the first time the app
  looks for it; "Forget key" deletes it at once. A key goes only to its own
  provider's API, in a header, never in a URL. It is never logged, exported in
  JSON or written to a file, and a test fails if a key-shaped string appears in
  the source, the docs or the README. Every site at `rock0ne.github.io` shares
  one browser storage, so on a `github.io` address Settings says that the
  Windows download (its own address on this PC) is the safer place for a key.
- **Privacy.** Nothing is sent until the user presses a button, and each button
  says what it sends and where ("This chapter, about 4,200 words, to Claude").
  Saving a key needs a tick: the text asked about is sent to that provider with
  the user's key and billed to their account. The Content Security Policy's
  `connect-src` gains exactly the three API hosts. README and Settings say so.
- **What it does** (Reader, AI panel), for the current page, the current
  chapter or the whole book:
  - Summaries: a chapter summary; page-by-page summaries of a chapter (one
    request, one summary per page); a page summary; an overview of the book;
    "Summarise every chapter" (one request per chapter not yet done, with the
    count and the words shown first).
  - Questions about the page, chapter or book.
  - Replies cite sentences (`[b12.s3]` in the reply, shown as "p. 12"). A
    citation jumps to the sentence, highlights it and reads from there. A
    citation of a sentence that was not sent is shown as plain text.
  - "Check for mistakes" in a chapter lists likely typos and grammar mistakes
    with a corrected sentence. Each can be listened to and added as a flag
    (note: the mistake; fix: the corrected sentence) or dismissed. Nothing
    becomes a flag without the user's click, so `corrections.md` still holds
    only what the user confirmed.
  - Any summary or answer can be read aloud with the current voice, or saved
    as a note.
  - Results are kept per document (store `ai`), so a summary is paid for once;
    "Redo" replaces it. They are deleted with the document and not exported.
- **Pages.** A PDF block now keeps the page it starts on (`Block.page`; re-read
  an older PDF from the library to get it). Other formats have no pages, so the
  app makes reading pages of about 1,800 characters (about 300 words, a printed
  page), cut at paragraph ends, never across a chapter, numbered through the
  document. The reader shows the page number.
- **Notes** belong to the sentence being read (M, or the ✎ button). A note has
  typed text, a drawing, or both; AI replies can be saved as notes. The Notes
  panel lists them in reading order and exports `notes-<title>.md`. Notes go in
  the JSON export (an optional `notes` list per document, which older versions
  ignore) and are placed again like flags after a re-read or an import. A note
  whose sentence cannot be found is kept and marked, never dropped.
- **Pen.** Browsers treat a pen like a mouse, so tapping sentences and buttons
  already works. On Windows 11 a pen can write in any text box and Windows turns
  the handwriting into text, so note boxes take handwriting with no extra code.
  A drawing pad (a canvas, thicker lines with more pen pressure, the pen's
  eraser end erases) keeps handwriting or a sketch as a picture. Nothing to
  install.
- Data model: `Settings.schemaVersion` 3 adds `ai` (the provider and a model
  per provider); IndexedDB version 2 adds the stores `notes`, `ai` and `keys`.
- CLAUDE.md: "no accounts other than the user's own Azure key" now also allows
  the AI provider account whose key the user adds.

Not built (Rockson's question about OneNote and Word links): a Word file
already opens with Add files or Open with. A OneDrive or SharePoint link
cannot be fetched by a web page without the owner's sign-in, and OneNote pages
are not files. Both need Microsoft sign-in through Microsoft Graph (an app
registration, MSAL as a new dependency, and an account the app signs in to),
which this project does not have. Recorded as a later option for Rockson to
decide.

Changes after review, same day. Rockson passed on advice from the developer
AI of his training platform. Taken:

- **A cut-off reply is an error.** Each provider ends a stream with a finish
  signal (Claude `stop_reason`, ChatGPT `finish_reason`, Gemini
  `finishReason`). A stream that ends without one is a dropped connection:
  nothing is saved and the reader is told to try again. Stop does the same
  ("Stopped. The unfinished reply was not saved."). When several requests run,
  as in "Summarise every chapter", the ones that finished are kept and the
  message says how many.
- **Out of date.** Each result keeps `inputHash`, the SHA-256 of the sentences
  that were sent. If a re-read changes those sentences, the result shows "Out
  of date" with Redo. Only the sentences count, so a new document title or
  chapter label leaves a result current.
- **Explain this paragraph.** A fourth scope: one paragraph with the paragraph
  either side of it in the same chapter, so the explanation has its context.
- **Back to where I was.** After a jump to a citation, a note or a flag, a bar
  offers the way back to the sentence that was being read.
- **A key for this session only.** "Only until I close the app" keeps the key
  in memory and never stores it. On a `github.io` address it is the default.
- **Forgetting is not cancelling.** Settings says that forgetting a key in the
  app does not cancel it, and links to the provider's key page to delete it.
- **Which voice is reading.** The reader names the voice and where it is made:
  "Kokoro, on this device", "Online Microsoft voice" (Edge sends the text to
  Microsoft) or "Basic voice on this device".
- **Prompts keep the detail.** Every summary and answer is asked to keep the
  names, numbers and dates, and any doubts, conditions or exceptions the text
  states, and to add nothing that is not in the text.

Not taken: a server that keeps the keys and calls the providers. The app has
no backend (CLAUDE.md), and a server holding other people's keys is a larger
risk than a key that stays on the reader's own device.

## ADR-31 · 2026-10-21 · Reading that flows at full stops

**Context.** Rockson, reading his book: a full stop took as long as a new
paragraph, and at 1.5× the speech got faster but the gaps did not, so a book
with many short sentences lost its flow. Measured in Edge with the online Ryan
voice (four short sentences): one utterance per sentence took 12.4 s at 1× and
8.9 s at 1.5×; the same four as one utterance took 11.0 s and 7.4 s, about half
a second lost at every full stop whatever the speed. Edge reported 24 word
boundaries for those four sentences. Kokoro clips start with about 0.3 s and
end with about 0.7 s of near-silence, so with Kokoro each full stop was close
to a second.

**Decision.**
- Browser voices that report word boundaries (`VoiceEngine.boundaries`) are
  given the rest of the paragraph as one utterance, up to 1,200 characters, so
  the voice pauses at a full stop as it would in speech. The highlight follows
  `onBoundary`; a voice that reports none is followed by the clock after 1.5 s.
  If a paragraph fails part way, the sentence it reached is read on its own
  with the usual retry, so ADR-14 still holds.
- Kokoro clips keep 0.05 s before and 0.2 s after the speech (`trimSilence`).
  The audio cache key gains `v2`, so clips made before are not reused.
- Two pauses in Settings, both divided by the speed: an extra pause at a full
  stop (default none) and a pause between paragraphs (default 0.7 s). An extra
  full-stop pause turns paragraph runs off, because a single utterance cannot
  hold a pause; browser voices then add about half a second at each full stop.
- Settings stay at schema version 3, which is not released yet: its migration
  also turns the old fixed 0.15 s full-stop pause into none, and
  `pauseBetweenParagraphsMs` comes from the defaults.

**Consequences.** Faster, more natural reading at every speed; a reader who
wants a slower pace sets the pauses. Pausing in the middle of a paragraph run
resumes at the sentence that was being read. `SpeakOptions.onBoundary` and
`VoiceEngine.boundaries` are added to spec 4.

## ADR-32 · 2026-10-21 · Copy for Claude: a Claude subscription without a key

**Context.** Rockson's US$200 in the Anthropic Console can only be spent through
Claude Code, and he asked whether ReadAloud could sign in to Claude the way
Claude Code does. Anthropic's legal and compliance page for Claude Code says
Claude.ai sign-in is for Anthropic's own apps: other developers may not offer
it in their applications, route requests through Free, Pro or Max plan
credentials, or collect Claude.ai credentials or session tokens. So the app
does not sign in to Claude.

**Decision.**
- The AI panel has **Copy for Claude** for the paragraph, page, chapter or
  whole document. It copies one text: the built-in assistant's instructions,
  the part inside `<document>` tags with its sentence ids, then the task
  (explain, summary, page by page, mistakes or a question). "Check it for
  mistakes" asks for lines a person can read (`- [id] what is wrong →
  corrected sentence`) instead of JSON. "Copy and open Claude" also opens
  `https://claude.ai/new` in a new tab; the reader pastes and sends, and
  Claude answers under the reader's own subscription and terms.
- The reply can be pasted back and saved as a note. Markdown headings and
  extra blank lines are removed; the note goes on the first sentence it cites,
  else the start of the part; sentence ids become page links, as in AI replies.
- The app sends nothing: the text leaves the device only when the reader
  pastes it. No key, no account, and no new host in the Content Security
  Policy (opening a tab is navigation, not a request from the page).
- With no key the card is at the top of the AI panel and only results made
  earlier are listed; with a key it is a fold-out at the bottom.
- If the browser will not copy, the text is shown in a box to copy by hand.

**Consequences.** A reader with a Claude subscription gets summaries and
checks at no extra cost, at the price of two pastes per request. A long
document may not fit one chat; the card says so above 100,000 words. Not yet
tried in the Android app, where opening claude.ai goes through the web view.

## ADR-33 · 2026-10-21 · Reading font and line spacing

**Context.** Rockson asked for font changes on the reading page.

**Decision.**
- Settings gain `readerFont`: `serif` (book, the old look), `sans` (clean),
  `wide` (Verdana where it exists) and `mono` (typewriter, every letter the
  same width, for spotting typos), and `lineSpacing` (1.2 to 2.4, default
  1.7), beside the existing text size. Only fonts already on the device, with
  stacks for Windows and Android, so nothing is downloaded.
- The controls are in Settings, Display, and in the reader's **Aa** panel,
  with a preview line; changes apply at once.
- Settings schema version 4: settings saved by 0.2.0 keep everything and get
  the defaults (book font, 1.7).

## ADR-34 · 2026-10-21 · Go to a page and find text

**Context.** Rockson asked for "move to page" and search at the bottom.

**Decision.**
- 🔍 in the controls, or `/`, opens a bar above the controls with a page box
  ("12", "p. 12" or "page 12") and a find box. Find lists the sentences that
  contain the text, ignoring case, curly quotes and extra spaces, in reading
  order, up to 1,000. Enter goes to the next match (the first press: the next
  one after where you are), Shift+Enter to the one before, and the count shows
  "2 of 12 · p. 40". Esc closes the bar.
- Going somewhere uses the same jump as citations, so "Back to where I was"
  appears.
- Search works per sentence: words that run across two sentences are not found.

## ADR-35 · 2026-10-21 · One long scroll or page by page

**Context.** Rockson asked for "split screen read aloud or one page read". Asked
what he meant, he chose two pages side by side for split screen, and a choice
between one long scroll and page by page: the reading should flow on when he
listens in the car over Bluetooth, and go page by page when he studies.

**Decision.**
- Settings gain `layout` (`scroll`, the default, or `pages`), `twoPages`
  (default on) and `stopAtPageEnd` (default on), in the reader's **Aa** panel
  and in Settings, Display. Settings schema 4 is not yet released, so they join
  it with the reading font (ADR-33) instead of making a version 5.
- Page by page shows the reading pages of spec 17.1: a PDF's own pages,
  otherwise about 1,800 characters. With `twoPages`, two facing pages (1–2,
  3–4 in each chapter) when the text pane is at least 50 times the text size
  wide (900 px at 18 px); otherwise one page. The page turns as the reading
  moves on. ‹ Previous and Next › under the text, or Page Up and Page Down,
  turn the page and move the reading position to its first sentence.
- With `stopAtPageEnd` the reading stops after the last sentence of each page
  (each page, the left one of a pair too). The highlight stays there; Play
  goes on with the next page. One long scroll never stops, for listening.
- The player is only told which sentences to stop after (`setPageEnds`).
  Pages end at a paragraph end, so a paragraph read in one go (ADR-31) is
  never cut.

**Consequences.** A long page scrolls inside the page. No swipe to turn the
page yet: the buttons are under the text.

## ADR-36 · 2026-10-21 · Add-ons: curated, off by default

**Context.** Rockson asked for plugins that could enhance the app, "up to the
reader to make the decision as the plugins are external and may require
internet". Asked how, he chose curated add-ons that are off by default.

**Decision.**
- An add-on is a feature written for ReadAloud and reviewed like the rest of
  it. It ships with the app and stays off until the reader turns it on in
  Settings, Add-ons. No code from anyone else is ever loaded: such a plugin
  would run with the app's rights and could read the book, the notes and the
  AI keys. The Content Security Policy keeps refusing scripts from elsewhere.
- Before it is turned on, each add-on says what it downloads, from where and
  how much; what it sends, to whom; and whether it then works offline.
  Turning it off deletes what it downloaded.
- Downloads come from the app's own site when the licence allows, so no one
  else sees the reader. A service that has to be asked online is named, and
  is sent only what it needs: one word for a dictionary, never the text
  around it.
- Each add-on gets its own decision entry with its source, licence, size and
  hosts. The Content Security Policy gains a host only for an add-on that
  needs it, and a new package still needs its own entry (spec 13).
- First candidates, none built: **more reading fonts** (Atkinson
  Hyperlegible, OpenDyslexic, Lexend; SIL Open Font Licence; a few hundred kB
  from the app's own site); **a dictionary** (one word at a time to a named
  free dictionary service); **reading scanned PDFs** (text recognition with
  Tesseract; several MB once, then offline). Rockson picks which comes first.

**Consequences.** Slower to grow than an open plugin store, but nothing
reaches the book or the keys without review, and the app works the same
with every add-on off.

## ADR-37 · 2026-10-22 · The Android app downloads its own voice

**Context.** Installed on a second phone, ReadAloud 0.2.0 said the voice
engine was missing. The app read the Kokoro model from the sherpa-onnx engine
app (ADR-27), a second 367 MB install that the README asked for but that is
easy to miss. Rockson expected one standalone app, and chose: ReadAloud
downloads the voice itself on first use, from a pinned, checksum-checked copy
on our own GitHub release, as the PC does.

**Decision.**
- The voice is one zip on the release `kokoro-voice-2` of
  github.com/rock0ne/readaloud: `readaloud-kokoro-voice-2.zip`, 328,761,892
  bytes, SHA-256 `207abec0ca2ac0288df2a3b4796fbb2531ab851e3890fd960917d94ab2513eca`. It holds only what the app uses: `model.onnx`,
  `voices.bin`, `tokens.txt` and `lexicon-gb-en.txt` of
  `kokoro-multi-lang-v1_0` with its LICENSE and README, and a NOTICE (360 MB
  unpacked). No eSpeak NG data: sherpa-onnx at 9ac4cd24 documents Kokoro's
  `data_dir` and `lang` as ignored, and ReadAloud passes phoneme codepoints.
  The first zip, `kokoro-voice-1` (with that unused data, whose source
  revision is not known), was replaced the same day and deleted before any
  release used it. `app/android/make-voice-zip.py` makes it from the
  official engine APK (SHA-256 `402c3628…`); the same APK always gives the
  same bytes, so anyone can check it. That release is not marked latest and is
  never changed: a new voice gets a new release and new pins.
- The plugin pins the address, size and SHA-256. "Download natural voice",
  the same button as on the PC, downloads to `voice.zip.part` in the app's
  no-backup files folder, going on from a part left by an earlier try (HTTP
  Range), and reports progress. It checks the size and SHA-256 and deletes a
  file that fails; unpacks into a new folder, refusing any path outside it;
  writes the SHA-256 as `READY`; and swaps the folder in, so a half-unpacked
  voice is never used. It needs about 800 MB free while unpacking and 380 MB
  after (360 MB). The screen stays on during the download, because a locked phone may
  stop it.
- sherpa-onnx loads the model from those files (`newFromFile`). The engine app
  is no longer needed or looked for: its `<queries>` entry is gone, and the
  copy of eSpeak's data that 0.2.0 made from it is deleted. Settings can
  remove the voice, as on the PC.
- The two native libraries still come from the engine APK when the app is
  built (ADR-27).

**Consequences.** One app to install. The first use downloads 329 MB (Wi-Fi
is best), then the voice works offline. A phone updated from 0.2.0 downloads
it once, after which the engine app can be uninstalled. The Android app now
talks to github.com and its download host, from the native side only; the
Content Security Policy is unchanged. The PC still downloads its own copy
from Hugging Face (ADR-22).

## ADR-38 · 2026-10-22 · Licence texts inside every download

**Context.** A review of ReadAloud 0.2.0 for Vidatta's Downloads (Astra,
RA-1 to RA-3, with the evidence in Opus's return of 22 October) found:
- the APK carried no licence texts;
- `THIRD-PARTY-NOTICES.md` had three errors: eSpeak NG "in"
  `libsherpa-onnx-jni.so`, sherpa-onnx "v1.13.8", and pako "1.0.11";
- the zip's README asked for "More info, Run anyway" and said the app "sends
  nothing anywhere";
- the zip's entry names used `\`;
- the voice picker hid which voices are online.

Rockson chose to fix the public copy before releasing 0.3.0.

**Decision.**
- The build writes `licences/` into every download (`app/licences.ts`):
  - `web.txt`: the licence files of every package whose code is in the
    bundle, listed from the bundle's own module ids, the workers' included,
    plus onnxruntime-web's runtime in `ort/`, Workbox in the service worker,
    and pako inside JSZip's ready-built file. The build fails if a package
    has no licence text;
  - `LICENSE.txt` and `NOTICES.md` (copies of the repository's files);
  - for the Android app, `android.txt`: sherpa-onnx and the eight projects
    linked into it, ONNX Runtime with its third-party notices, Capacitor, and
    the 50 Android libraries Gradle resolves (all Apache-2.0; none has a
    NOTICE file).
- Texts that are not in `node_modules` live in `app/licences/`, unchanged
  apart from line endings. `index.json` gives each one's source and SHA-256:
  - the native ones come from the archives fetched and hash-checked for the
    0.2.0 source bundle;
  - ONNX Runtime's `LICENSE` (the same bytes at v1.21.0, 89f8206b and
    33ca9628) and the web build's `ThirdPartyNotices.txt` were fetched from
    microsoft/onnxruntime at those commits.
- Settings has an About section, linking to a Licences page that shows these
  files.
- `THIRD-PARTY-NOTICES.md` is corrected:
  - it gives each part's real version;
  - it says what is not known: the eSpeak NG revision inside phonemizer
    1.2.1, and the native libraries' build settings;
  - it lists the three errors of the earlier versions.
- The zip:
  - entry names use `/`, in a fixed order with one date; `package.ps1`
    checks them;
  - the README asks for the SHA-256 check first and drops "Run anyway";
  - it says that `-ExecutionPolicy Bypass` applies to that one PowerShell
    window, and lists what goes online and when.
- The voice picker marks every voice not made on the device as "online".

**Consequences.**
- Each download now carries its notices.
- One gap stays open: the eSpeak NG revision inside phonemizer 1.2.1 cannot
  be named. Closing it means building eSpeak NG from source, the larger work
  proposed for Vidatta's 0.2.1.
- The 0.2.1 proposal planned to use versionCode 4 and the number ADR-37.
  Both are now taken by 0.3.0, so that proposal needs new numbers.
