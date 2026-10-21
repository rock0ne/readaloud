# 02 — Build plan

One step per turn. Each step lists what to read, what to create, and the
acceptance check. "U#" and "M#" refer to tests in `03-TEST-PLAN.md`. Record each
finished step in `PROGRESS.md`. Do not start a phase before the previous gate is
ticked.

Conventions: `app/` is the Vite project. Paths below are relative to `app/`.
Commit after every step with a message like `step 05: txt+md loaders`.

---

## Phase 1 — Windows PWA with Edge natural voices

### Step 1 — Scaffold

Read: spec 3, 13; `CLAUDE.md`.
Do:
- At `ReadAloudApp/`: `git init`; `.gitignore` with `app/node_modules`, `app/dist`,
  `.env*`, `app/test/fixtures/private/`, `app/android/` (until Phase 3b).
- `pnpm create vite app --template preact-ts`; then in `app/`: add runtime deps
  `idb marked mammoth pdfjs-dist jszip` and dev deps `vitest fake-indexeddb jsdom
  vite-plugin-pwa`.
- `tsconfig.json`: `strict: true`, `noUncheckedIndexedAccess: true`.
- `vitest.config.ts`: `environment: 'jsdom'`, `setupFiles: ['test/setup.ts']`
  (setup imports `fake-indexeddb/auto`).
- Create the folder tree from spec 3.1 with empty `index.ts` files where needed.
- `src/core/types.ts` = spec section 4 verbatim.
- `test/smoke.test.ts` asserting `1 + 1 === 2`.
Accept: `pnpm dev` serves the template page; `pnpm test` passes; `pnpm build` succeeds.

### Step 2 — Sentence segmentation

Read: spec 6.1.
Create: `src/core/text/segment.ts` exporting `segmentSentences(text, locale)`.
Accept: U1 passes.

### Step 3 — Speak-text normalisation and chunking

Read: spec 6.2, 6.3.
Create: `src/core/text/normalize.ts` exporting `toSpeakText(text, blockType)` and `chunk(text, max = 280)`.
Accept: U2 passes.

### Step 4 — HTML to blocks

Read: spec 5.1.
Create: `src/core/ingest/html.ts` exporting `htmlToDocument(html, opts): RawBlock[]`
and the `RawBlock` type (in `ingest/raw.ts`).
Accept: U3 passes.

### Step 5 — Document builder, format detection, TXT and MD loaders

Read: spec 5.0, 5.2, 5.3, 5.7.
Create: `src/core/text/build.ts` (`buildDocument`), `src/core/ingest/index.ts`
(`detectFormat`, `parseFile`, `IngestError`), `src/core/ingest/txt.ts`, `src/core/ingest/md.ts`.
Accept: U4 and U5 pass. `parseFile` on `test/fixtures/sample.md` yields chapters,
toc, sentences with correct offsets (`block.text.slice(s.start, s.end) === s.text`).

### Step 6 — EPUB loader

Read: spec 5.5; handoff gotchas "Ingestion".
Create: `src/core/ingest/epub.ts`, `src/core/util/paths.ts` (`resolveHref(baseDir, href)`,
`dirname`, `decode`).
Accept: U6 passes (generated EPUB3 fixture with nav TOC, fragment anchors, a
`linear="no"` item, a div-styled chapter title; and an EPUB2 NCX variant).

### Step 7 — DOCX loader

Read: spec 5.4.
Create: `src/core/ingest/docx.ts` with dynamic `import('mammoth')`.
Accept: U7 passes (minimal docx generated in the test with JSZip). M1 with a
real `.docx` (any document; book chapter only from `fixtures/private/`).

### Step 8 — PDF loader

Read: spec 5.6; handoff gotchas (worker URL).
Create: `src/core/ingest/pdf.ts` with pure functions `itemsToLines(items, pageHeight)`,
`dropRunningLines(linesByPage)`, `linesToBlocks(lines)` and the pdf.js wrapper
`parsePdf(bytes)`.
Accept: U8 passes (synthetic items). M2 with a real text PDF: paragraphs are
whole, page numbers gone, hyphenated words joined, headings detected.

### Step 9 — Storage

Read: spec 9.1.
Create: `src/core/store/db.ts` (schema v1 + `upgrade`), `src/core/store/repo.ts`
with: `addDocument(parsed, file, hash)`, `getDocument(id)`, `listDocuments()`,
`deleteDocument(id)`, `getSource(docId)`, `savePosition`, `getPosition`,
`addFlag/updateFlag/deleteFlag/listFlags(docId)`, `getSettings/saveSettings`
(defaults from spec 4), `audio get/put/prune`.
Also `src/core/util/hash.ts` (`sha256Hex(ArrayBuffer)`) and `ids.ts`.
Accept: U9 passes under fake-indexeddb.

### Step 10 — Web Speech engine and registry

Read: spec 7.1, 7.2, 7.5; handoff gotchas "Web Speech API".
Create: `src/core/engines/webspeech.ts`, `src/core/engines/registry.ts`
(`getEngines`, `pickEngine`). Also a minimal Settings screen with a voice list
and a "Test" button that speaks "The quick brown fox jumps over the lazy dog."
Accept: U10 passes (mocked `speechSynthesis`). Then the **voice reality gate**
(review correction, ADR-17), before any UI work beyond Settings:

- M3 in Rockson's installed Edge: the list shows "Natural" voices first, and
  the **Read 3 sentences** test in Settings speaks three consecutive sentences
  with Sonia or Ryan, each `end` event firing after a plausible duration. A
  voice that is listed but does not speak fails the gate.
- In Chrome the list shows only Basic voices and the H1 hint.
- If the gate fails (no natural voices, or they do not speak reliably), stop
  Phase 1 UI work, record the finding in `04-DECISIONS.md`, and bring Phase 2
  (Azure) forward as the primary engine before continuing.

### Step 11 — Player

Read: spec 8.1, 8.2, 8.5 (8.3/8.4 are Phase 2).
Create: `src/core/player/player.ts`.
Accept: U11 passes (fake direct engine; verifies order of sentences, skip of
code blocks, heading pauses, pause/resume restarting the sentence, prev/next,
`ended`, position debounce).

### Step 12 — Library screen and file import

Read: spec 11.1, 11.2, 14.
Create: `src/ui/App.tsx`, `routes.ts`, `screens/Library.tsx`, `components/AddFile.tsx`,
`components/Toast.tsx`, `hooks/useStore.ts`, `styles/base.css`.
Accept: M4: add `.txt .md .docx .pdf .epub`; duplicates detected; progress shown
for large files; delete works; errors from spec 14 appear as toasts.

### Step 13 — Reader screen

Read: spec 11.3, 11.7.
Create: `screens/Reader.tsx`, `components/TextPane.tsx`, `Controls.tsx`,
`SpeedControl.tsx`, `VoicePicker.tsx`, `TocPanel.tsx`, `hooks/usePlayer.ts`,
`hooks/useKeys.ts`, `styles/reader.css`.
Accept: M5 in Edge: play a chapter with Sonia; current sentence highlighted and
auto-scrolled; click-to-seek; keyboard table works; chapter switch via Contents;
speed 0.8–2.0 audible.

### Step 14 — Flags and corrections export

Read: spec 10.1, 10.2, 11.5.
Create: `components/FlagPanel.tsx`, `src/core/flags/corrections.ts`.
Accept: U12 passes (exact `corrections.md` format). M6: F and N while playing;
flagged sentences underlined; edit note/fix inline; export downloads the file.

### Step 15 — Resume and JSON export/import

Read: spec 8.5, 9.2.
Create: `src/core/store/export.ts`; Library footer buttons.
Accept: U13 passes (match by id, hash, title+charCount; newer position wins;
Azure key never present). M7: close and reopen the app, playback resumes at the
saved sentence.

### Step 16 — PWA, hints, offline behaviour

Read: spec 12, 14, 15.
Do: `vite-plugin-pwa` config, manifest, icons (simple generated SVG → PNG is
fine), CSP meta tag, H1 banner, offline switch to Basic voices and back,
`navigator.storage.persist()`, "update available" toast.
Accept: M8: `pnpm build && pnpm preview`, open in Edge, install as app; it
launches standalone; voices work; closing the preview server and relaunching the
installed app still opens the library (shell cached).

### Phase 1 gate

- [ ] U1–U13 green, `pnpm build` clean, bundle budget met (spec 16).
- [ ] M1–M8 done in Edge and recorded in `PROGRESS.md`.
- [ ] Rockson has listened to one chapter of his book in the installed app,
      flagged mistakes with F, and exported `corrections.md`. (Needs Rockson.)

---

## Phase 2 — Azure engine and audio pipeline

> **Dropped on 2026-10-21 (ADR-21).** Rockson rejected Microsoft voices, Azure
> included. Do not build Steps 17–20 as written. The next engine is chosen by
> his listening test; the audio-cache and playback parts of Step 19 will still
> be needed by whichever engine wins.

### Step 17 — Azure CORS spike

Read: spec 7.3; handoff gotchas "Azure".
Do: a throwaway page `spike/azure.html` (not in `src/`, deleted after) with
region + key inputs that calls the voices list and one synthesis via `fetch`
from the browser. Rockson enters the key at runtime; nothing is saved.
Accept: outcome recorded in `04-DECISIONS.md` as ADR-12: "REST from browser
works" or "blocked → use Speech SDK". If blocked, add
`microsoft-cognitiveservices-speech-sdk` to the dependency list in ADR-12 and
adapt 7.3 accordingly.

### Step 18 — Azure engine

Read: spec 7.3 (as adjusted by ADR-12).
Create: `src/core/engines/azure.ts`.
Accept: U14 passes (mocked `fetch`: SSML escaping, headers, voice mapping,
HD/Dragon exclusion, 401/429/403 mapping, abort).

### Step 19 — Audio cache, playback of blobs, prefetch

Read: spec 8.3, 8.4.
Create: `src/core/player/audio-cache.ts`; extend `player.ts` with `playBlob`
(`<audio>` + `playbackRate`, `preservesPitch`), prefetch queue, `buffering`.
Accept: U15 (LRU prune to budget) and U16 (prefetch order, concurrency 2,
abort on seek) pass.

### Step 20 — Settings for Azure, engine badges, Media Session

Read: spec 7.6, 8.6, 11.6.
Do: Azure region/key fields with Verify; voice picker grouped by engine;
status text; Media Session handlers.
Accept: M9 in **Chrome** on the PC (so Edge voices are absent): with the key
entered, a full chapter plays gapless with prefetch; speed 3.0 works; lock the
PC's media keys → play/pause respond.

### Phase 2 gate

- [ ] U14–U16 green. M9 done.
- [ ] Rockson has created the F0 resource in the production tenant and entered
      the key. (Needs Rockson.)
- [ ] Characters used for one chapter noted in `PROGRESS.md` to estimate the
      whole book against the 0.5M/month free allowance.

---

## Phase 3 — Phone

### Step 21 — Mobile layout

Read: spec 11.4; 10.1 (`pauseOnFlag` default on mobile).
Do: `styles/mobile.css`, FLAG button, bottom sheet for panels and note entry,
Wake Lock, touch targets ≥ 44 px.
Accept: M10 in Edge device emulation (Galaxy S20-class viewport): all controls
reachable with one thumb; FLAG always visible; note sheet works.

### Step 22 — Phase 3a: install the PWA on the S21+

Read: handoff 7.
Do: on the PC `pnpm build && pnpm preview --host 127.0.0.1 --port 4173`; with the
phone on USB: `adb reverse tcp:4173 tcp:4173`; on the phone open Chrome at
`http://localhost:4173` (localhost is a secure context, so the PWA installs);
"Add to Home screen". Enter the Azure key on the phone. Import the JSON exported
from the PC.
Accept: a chapter plays with Azure voices on the phone; playback continues with
the screen off (Media Session, audio element); FLAG works; export JSON back to
the PC merges flags. If screen-off playback or file import fails and cannot be
fixed in the web app, go to Step 23; otherwise skip it.

### Step 23 — Phase 3b (conditional): Capacitor wrapper

Read: handoff 7; spec 13 (Phase 3b deps).
Do: `npx cap init` in `app/`, `npx cap add android`; `@capawesome/capacitor-file-picker`
for Add files; `@capacitor-community/keep-awake`; build in WSL
(`pnpm build && npx cap sync android && cd android && ./gradlew assembleDebug`);
`adb install -r` the debug APK. Remove `app/android/` from `.gitignore` and
commit the generated project.
Accept: same as Step 22 using the APK.

### Phase 3 gate

- [ ] Book plays on the S21+ with natural voices, screen off, flags round-trip.
- [ ] Rockson confirms the FLAG button is comfortable to hit while listening.

---

## Phase 4 — Offline voices (Kokoro)

### Step 24 — Kokoro web engine

Done 2026-10-21 as the main voice (ADR-22): M11 passed on the PC; the phone
runs it but too slowly for continuous reading (ADR-24). Kept below as written.

Read: spec 7.4.
Create: `src/core/engines/kokoro.ts` + `src/core/engines/kokoro.worker.ts`;
Settings: Download model (progress, size), Remove model; engine appears in the
picker once downloaded.
Accept: M11: in Edge or Chrome on the PC, download the model, switch engine,
disconnect the network, play a chapter. Speed of synthesis vs playback noted in
`PROGRESS.md`.

### Step 25 — Kokoro on Android (only if Step 23 was done)

ADR-24: the browser route measured 0.2x to 0.3x real time in the app on the S21+
(0.68x at best, on a test page). First try the
sherpa-onnx Kokoro Android voice engine (Rockson's approval needed), then
decide between it and this step.

Read: spec 7.4 "Android native".
Do: write `docs/05-ANDROID-KOKORO.md` first (plugin API, model storage, file
playback), get Rockson's go-ahead in `PROGRESS.md`, then build the Capacitor
plugin around sherpa-onnx.
Accept: airplane-mode playback on the S21+ with a Kokoro UK voice; synthesis
keeps ≥ 2 sentences ahead at 1.0× after the first 10 seconds.

### Phase 4 gate

- [ ] Airplane-mode playback on the PC (and on the phone if 3b exists).

---

## Phase 5 — Optional extras (each needs Rockson's go-ahead)

- Apply corrections to `.md` sources (spec 10.3).
- Word-level highlight via the Azure Speech SDK word-boundary events.
- OneDrive folder sync of the JSON bundle using a persisted directory handle.
- Headset-button mapping (Media Session `nexttrack` → flag) if he wants it.
