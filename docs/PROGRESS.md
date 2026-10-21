# Progress

One line per step. Keep it short. Newest at the bottom of each section.

## Status

| Step | Status | Verified by | Date | Notes |
|---|---|---|---|---|
| 1 Scaffold | done | build + smoke test | 2026-10-20 | Vite 8, Preact, TS 7 strict; commit b6c6f10 |
| 2 Segmentation | done | U1 | 2026-10-20 | two abbreviation sets (ADR-18) |
| 3 Normalise + chunk | done | U2 | 2026-10-20 | digit dash digit reads "to" |
| 4 HTML to blocks | done | U3 | 2026-10-20 | header/footer kept (ADR-18) |
| 5 Builder, TXT, MD | done | U4, U5 | 2026-10-20 | |
| 6 EPUB | done | U6 | 2026-10-20 | nav + NCX, DRM refused, progress |
| 7 DOCX | done | U7 | 2026-10-20 | style warnings merged (ADR-20) |
| 8 PDF | done | U8 + browser | 2026-10-21 | buffer-detach bug fixed (ADR-20) |
| 9 Storage | done | U9 | 2026-10-20 | summaries, bytes, ordinal (ADR-19); atomic add (ADR-20); atomic re-read (ADR-23) |
| 10 Web Speech + registry | done | U10 + Edge gate | 2026-10-21 | gate: see M3; registry rule changed (ADR-22) |
| 11 Player | done | U11 | 2026-10-21 | never advances on unheard text (ADR-14); one pending start (ADR-23) |
| 12 Library | done | browser + phone | 2026-10-21 | five formats; Paste text added (ADR-24) |
| 13 Reader | done | browser + Edge | 2026-10-21 | Media Session added (ADR-22) |
| 14 Flags + corrections | done | U12 + browser | 2026-10-21 | repeated quotes placed by context (ADR-23) |
| 15 Resume + JSON | done | U13 | 2026-10-20 | browser round trip not yet done (M7) |
| 16 PWA, hints, offline | done | browser | 2026-10-21 | reloads when a new version takes over (ADR-25); install = M8 |
| 17–20 Azure | dropped | | 2026-10-21 | ADR-21 |
| 22 PWA on the S21+ | partly | phone | 2026-10-21 | runs in Firefox; upload works; voice too slow (ADR-24); not yet on the home screen |
| 24 Kokoro web engine | done (PC) | U-kokoro + Edge M11 | 2026-10-21 | main voice, bf_emma (ADR-22) |
| Phase 1 gate | waiting on Rockson | | | see below |

## Phase 1 gate

- [x] Unit tests green: 97 tests in 14 files on 2026-10-21, covering the
      Kokoro work (ADR-22), the second-review fixes (ADR-23) and reloading
      on update (ADR-25). `pnpm build`
      clean, bundle budget met.
- [ ] M1–M8 done in Edge. Done or partly done: M2 (sample PDF), M3, M4, M5,
      M6. Waiting on Rockson: M1 and M2 with his chapter, M8 install, and
      everything by ear. Not yet run in a browser: M7. Still unchecked in
      M5/M6 (not only waiting on Rockson): click to seek by hand, R, [ and ],
      speed 2.0, a 15-second sentence, F during playback.
- [ ] A voice Rockson accepts is in the app: Kokoro is built in (ADR-22);
      Rockson has not yet listened to it inside the app.
- [ ] Rockson has listened to one chapter of his book in the installed app,
      flagged mistakes with F, and exported `corrections.md`.

## Manual checks

Run on 2026-10-21. "Pane" is the Chromium browser pane in the Claude app.
"Edge" is Edge 155, headless and muted, with a throwaway profile, driven over
the remote-debugging port. "Phone" is the S21+ (SM-G996B, Android 15) in
Firefox 158, reached over USB (`adb reverse`). Sound was never heard, so
every "by ear" item is still Rockson's.

- **M1 docx**: generated sample only. Real chapter: waiting on Rockson.
- **M2 pdf**: generated two-page sample. Real PDF: waiting on Rockson.
- **M3 voices**: now Kokoro. Edge: Emma is chosen automatically; the passage
  was read with no gaps after the first sentence; first audio about 0.7 s
  after Play. Each clip was checked with Whisper and is word-exact (after the
  short-sentence fix, ADR-22). By ear: waiting on Rockson.
- **M4 library**: all five formats added at once; delete works; errors appear
  as toasts. Paste text: pane, text became "Paste check" and opened. Phone:
  the Android file picker offered `.docx`, `.md` and `.txt`; three files were
  added at once.
- **M5 reader**: Edge: Play, Pause, the highlight follows. Pane: arrow keys,
  F, N and G; Contents jumps to a nested EPUB entry. Not yet checked: see
  the gate above.
- **M6 flags**: F and N flag, N opens the note, Ctrl+Enter saves,
  `corrections.md` matches spec 10.2. F during playback not yet checked.
- **M7 resume**: unit-tested only.
- **M8 PWA**: manifest, icons, service worker (28 files precached, 25 MB with
  the voice runtime). Install: waiting on Rockson.
- **M10 mobile emulation**: no sideways scroll at 375 px (checked before
  Paste text was added; the header now wraps instead of overflowing).
- **M11 offline (Kokoro)**: Edge with every request blocked (also
  localhost) and the browser offline: the page came from the service worker,
  and the voice made 8 new clips and read the passage to the end.
- **Kokoro remove**: Settings, "Remove from this device": model (4 files)
  and 11 voices deleted; the browser voice took over; downloading again took
  13–20 s.
- **Media Session**: Edge: title and chapter set; state "playing", then
  "paused" after Pause.
- **Phone voice**: downloaded in about 10 s. Settings, "Read 3 sentences",
  on the final build: ready "on this device's processor" after 13 s; the
  three sentences finished 26.0 s, 20.2 s and 21.6 s after each started;
  the status then says speech is made "about 3.1× slower than it plays, so
  reading will keep pausing". Not heard. Before that, the voice stalled on
  "Loading" three times (ADR-22): an old page left running after an update
  (ADR-25).

## Needs Rockson

1. **Listen on the PC.** Double-click `app/start-readaloud.cmd`. In Settings,
   press "Download natural voice" (330 MB, once), then open a document and
   press Play. Say whether Emma is right or pick another voice.
2. **Phone engine (ADR-24).** The sherpa-onnx Kokoro voice engine is
   installed on the test phone (2026-10-21, with your approval) and makes
   speech faster than it plays (1.26x). Set it as the preferred engine:
   Settings, General management, Text-to-speech, Preferred engine, "TTS
   Engine: Next-gen Kaldi". Its voice is the speaker number in its own app:
   21 is Emma (woman, UK), 26 is George (man, UK).
3. **Custom voices (ADR-24).** SAPI 5 voices cannot appear in this app.
   Choose: more Kokoro voices inside ReadAloud, a separate SAPI 5 adapter so
   Kokoro works in other Windows programs, or both.
4. **Install (M8).** In Edge use "Install ReadAloud" from the address bar or
   the menu. Close the launcher window and reopen the installed app.
5. **Your chapter (M1, M2 and the Phase 1 gate).** Put one chapter as `.docx`
   and as PDF in `app/test/fixtures/private/`, which git ignores. Then listen,
   press F on mistakes, and export `corrections.md`.
6. **Optional:** install Node 22 LTS. Today the build uses a portable Node in
   a temporary folder (see handoff section 7).

## Open issues

- The toolchain lives in a temporary scratchpad folder. If it is cleaned up,
  the builder needs Node again before `pnpm` works (handoff section 7).
- Edge's Microsoft voices stay as the fallback ("Browser voices") until the
  natural voice is downloaded. Removing them is Rockson's call (ADR-21).
- The app does not check its own speech with speech recognition (ADR-21,
  ADR-22). Rockson's ear is the check.
- Delete and Remove ask with the browser's own confirm box. The Claude
  browser pane dismisses it, so tests there must stub `window.confirm`.
- The phone keeps locking after 5 minutes during tests; ask Rockson before
  changing any phone setting.

## Versions installed

```
dependencies:    idb 8.0.4, jszip 3.10.2, kokoro-js 1.2.1, mammoth 1.13.0,
                 marked 18.1.1, pdfjs-dist 6.4.299, preact 10.29.8
  via kokoro-js: @huggingface/transformers 3.8.1,
                 onnxruntime-web 1.22.0-dev.20250409, phonemizer 1.2.1
devDependencies: @preact/preset-vite 2.10.6, @types/node 24.19.2,
                 fake-indexeddb 6.2.6, jsdom 30.1.3, typescript 7.0.2,
                 vite 8.3.4, vite-plugin-pwa 2.0.0, vitest 5.0.5
runtime:         Node 22.23.3 (portable), pnpm 11.19 via corepack
```

## Measurements

| Measure | Result | Budget |
|---|---|---|
| Main JS bundle, gzipped | 27.5 kB (before Kokoro; the voice loads in its own worker) | < 250 kB |
| Parse a 500k-char `.docx` (Node + jsdom) | 0.97 s | < 5 s |
| Parse a 1 MB EPUB (Node + jsdom) | 0.86 s | < 6 s |
| Kokoro download, PC / phone | 13–20 s / about 10 s for 326 MB | — |
| Kokoro first audio after Play, PC | about 0.7 s (with warm-up) | — |

Kokoro speed, 2026-10-21 ("x real time" = seconds of speech made per second;
below 1 means reading has to keep pausing). Two sentences, voice bf_emma.

| Device and browser | How | Speed |
|---|---|---|
| PC, RTX 3060 | WebGPU, fp32 (what the app uses on the PC) | 4.1x |
| PC, Ryzen 9 5950X | wasm fp32, 4 threads / 8 threads | 1.1x / 1.5x |
| PC, Ryzen 9 5950X | wasm q8, 4 threads | 0.64x |
| S21+, Firefox 158 | wasm fp32, 1 thread (what the app gets on the phone) | 0.2x to 0.3x |
| S21+, Firefox 158 | wasm fp32, 4 threads (COEP require-corp, test page only; in the app the voice stalled while loading, cause unknown, ADR-22) | 0.68x |
| S21+, native | sherpa-onnx 1.13.8 Kokoro voice engine, v1.0 model, speaker 21 (bf_emma), 4 threads, its own test screen: 16.7 s of speech in 13.2 s | 1.26x |

Voice listening test, 2026-10-21. One 77-word passage, PC = Ryzen 9 5950X,
RTX 3060 12 GB. "Word check" = Whisper large-v3-turbo transcript against the
text, ignoring its spelling of numbers and US spellings.

| Sample | Runs on | Speed vs real time | Word check |
|---|---|---|---|
| Kokoro bf_emma, bm_george, af_heart, af_bella | CPU (Node) | about 5× faster | all exact |
| Qwen3 designed British woman, British man | RTX 3060 | about 3.7× slower | exact |
| Qwen3 built-in Ryan | RTX 3060 | about 3.6× slower | changed "until" to "in the" |
| Qwen3 built-in Aiden | RTX 3060 | about 3.8× slower | "mornings" for "morning" |
