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
100 kB with the same text; the limits per format.

