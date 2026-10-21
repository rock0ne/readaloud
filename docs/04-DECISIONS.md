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
