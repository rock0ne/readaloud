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
| 23 Capacitor wrapper | partly | phone | 2026-10-21 | brought forward; Kokoro made inside the app, every word spoken (ADR-27); clips about 40 s ahead (ADR-28); not yet heard by Rockson |
| 29 Public release | done | fresh clone in WSL + headless Edge on the live site | 2026-10-21 | github.com/rock0ne/readaloud, Pages site, releases v0.1.0 and v0.1.1 (clip-order fix, ADR-28) with the Windows zip and the APK signed with Rockson's key (CN=rock0ne, cert SHA-256 c5f96167…5dbc0f), ADR-29 |
| 30 AI assistant, notes, pen | done, not yet with a real key | AI1–AI8, N1–N3 + Edge with a fake Claude service | 2026-10-21 | ADR-30 and its review changes; a live key is Rockson's to try |
| 31 Flow at full stops | done | U11b + Edge, online Ryan voice | 2026-10-21 | ADR-31; Kokoro's trimmed clips not yet heard |
| Phase 1 gate | waiting on Rockson | | | see below |

## Phase 1 gate

- [x] Unit tests green: 156 tests in 19 files on 2026-10-21, with the
      git-ignored book check, covering the Kokoro work (ADR-22),
      the second-review fixes (ADR-23), reloading on update (ADR-25),
      large EPUBs (ADR-26), the Android app's voice (ADR-27), the wider
      lead and the clip order (ADR-28), the AI assistant and notes (ADR-30)
      and the reading flow (ADR-31). `pnpm build` clean, bundle budget met.
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
- **Phone chapter, native engine (ADR-24)**: a 1,362-word test chapter
  (written for the test, not book text) added by the file picker and read
  to "Finished" in Firefox with the sherpa-onnx Kokoro engine as Android's
  preferred engine (ReadAloud lists it as "Basic voice: English"). 13 min
  44 s in all: 8 min 54 s of speech, 4 min 50 s (35%) of silence; the
  silence before each sentence was 3.1 s median, 4.6 s at the 90th
  percentile, 6.4 s at most. Rockson, listening: "a bit slow, reading word
  by word instead of flowing". Cause: Firefox hands over one sentence at a
  time, and the engine makes each one only after the last has played.
- **Rockson's book on the phone (ADR-26)**: both copies picked from the
  phone's Documents folder in Firefox, on the build that had just reloaded
  itself (ADR-25). EPUB (222 MB): added and opened in about 9 s. PDF
  (47.6 MB): added and opened in about 19 s. Compared on the PC, counts
  only: the PDF's words match the EPUB's (0.13% not found in it), but its
  paragraphs, sentences and chapters split differently (75 chapters and
  1,281 contents entries against the EPUB's 41 and 520; 61% of the EPUB's
  sentences appear word for word in the PDF). Proofread from the EPUB.
- **Android app, Kokoro inside the app (ADR-27)**: debug build installed by
  adb; the voice picker lists all 11 Kokoro voices, UK and US, women and men.
  Model loads in about 4 s. Four test sentences (written for the test): no
  word skipped (0 "OOV" lines in the log, against 7 skipped words before the
  phoneme change); "In 1962 there were 43 boats…" lasts 5.3 s against 5.8 s
  for the same sentence spelled out in words; speech made at 1.2x to 1.3x
  real time with the phone cool. Nothing from the plugin in the phone's log
  after `loggingBehavior: "none"`.
- **Android app, test chapter (ADR-27, ADR-28)**: the same 1,362-word test
  chapter pasted in and read to "Finished", twice, no errors. Emma: 77 clips,
  341 s of speech in 439 s (22% silence, Firefox had 35%); gap before a
  sentence 0.35 s median, 15 gaps over 1 s, longest 8.9 s; first sound about
  12 s after Play. George, with the wider lead (ADR-28): 90 clips, 412 s in
  532 s (23% silence), 0.31 s median, 21 gaps over 1 s, longest 9.2 s. The
  long gaps come from the phone slowing down as it warms: straight after the
  runs Kokoro made speech at 0.63x to 0.75x, with the fast cores capped at
  1.35 GHz (charging over USB, battery 31.5 °C rising to 37.8 °C; battery
  saver off). Not heard by Rockson yet.
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
2. **Phone app (ADR-27).** ReadAloud is now an app on the test phone (icon
   "ReadAloud"). Open it, add your book's EPUB with Add files, pick a voice
   (all 11 are there, women and men), press Play, and say whether it flows.
   Try it once unplugged: the phone slowed down while charging. Keep the
   Kokoro engine app installed: ReadAloud uses its voice files. It no longer
   needs to be the phone's preferred engine.
3. **Custom voices (ADR-24).** SAPI 5 voices cannot appear in this app.
   Choose: more Kokoro voices inside ReadAloud, a separate SAPI 5 adapter so
   Kokoro works in other Windows programs, or both.
4. **Install (M8).** In Edge use "Install ReadAloud" from the address bar or
   the menu. Close the launcher window and reopen the installed app.
5. **Your chapter (M1, M2 and the Phase 1 gate).** Put one chapter as `.docx`
   and as PDF in `app/test/fixtures/private/`, which git ignores. Then listen,
   press F on mistakes, and export `corrections.md`.
6. **Optional:** install Node 22 LTS. Node is only needed to build now; the
   launcher runs without it (ADR-29). Builds use a portable Node in a
   temporary folder (see handoff section 7).
7. **Back up the release key** (`readaloud-release.jks`) and its password
   somewhere safe, away from this PC. Without them no update can be installed
   over the published app. Sign each new release with `app/android/sign-apk.sh`.
8. **Try the AI assistant with your own key (ADR-30).** Settings, AI
   assistant: choose a provider, open its key page from the link, make a key,
   paste it and press "Check and save key". Then in a document open **AI**:
   summarise a chapter, ask a question, try Check for mistakes. Say whether
   the replies help, and check the cost on the provider's usage page.
9. **Listen to the new flow (ADR-31)** at 1× and 1.5×. If full stops now feel
   too quick, raise "Extra pause at a full stop" in Settings; if paragraphs
   feel too long or short, move "Pause between paragraphs".
10. **OneNote and Word links: decide.** A Word file already opens with Add
   files or Open with. Opening a OneDrive or SharePoint link, or OneNote,
   needs Microsoft sign-in (Microsoft Graph, an app registration, MSAL as a
   new dependency). Recommended: a later phase with its own decision.
   Second best: keep saving the Word file and adding it.

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
- Android app: the first sound comes about 12 s after Play (about 4 s to
  load the model, then the first clip is made at speaking speed), and once
  the phone is warm Kokoro makes speech slower than it plays, so about one
  sentence in five waits 2 to 9 s (ADR-28). Not solved by more lead or
  threads; a faster (int8) model or preparing a chapter before listening
  would be the next steps, both Rockson's call.

- Version 0.2.0 (ADR-30, ADR-31): the Pages site has it. The Windows zip and
  the unsigned APK are in `app/release` (APK built from a fresh clone in WSL,
  versionCode 3); the APK waits for Rockson's signature, and GitHub Releases
  still end at v0.1.1.

## Versions installed

```
dependencies:    @capacitor/android 8.5.0, @capacitor/core 8.5.0, idb 8.0.4,
                 jszip 3.10.2, kokoro-js 1.2.1, mammoth 1.13.0,
                 marked 18.1.1, pdfjs-dist 6.4.299, phonemizer 1.2.1 (ADR-27),
                 preact 10.29.8
  via kokoro-js: @huggingface/transformers 3.8.1,
                 onnxruntime-web 1.22.0-dev.20250409
devDependencies: @capacitor/cli 8.5.0, @preact/preset-vite 2.10.6, @types/node 24.19.2,
                 fake-indexeddb 6.2.6, jsdom 30.1.3, typescript 7.0.2,
                 vite 8.3.4, vite-plugin-pwa 2.0.0, vitest 5.0.5
runtime:         Node 22.23.3 (portable), pnpm 11.19 via corepack
```

## Measurements

| Measure | Result | Budget |
|---|---|---|
| Main JS bundle, gzipped | 54 kB with the AI assistant and notes (27.5 kB before Kokoro; the voice loads in its own worker) | < 250 kB |
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
| S21+, ReadAloud app | sherpa-onnx 1.13.8 inside the app, phonemes from the web side, 4 threads (ADR-27): cool / after 15 min of reading while charging | 1.2x to 1.3x / 0.6x to 0.9x |

Voice listening test, 2026-10-21. One 77-word passage, PC = Ryzen 9 5950X,
RTX 3060 12 GB. "Word check" = Whisper large-v3-turbo transcript against the
text, ignoring its spelling of numbers and US spellings.

| Sample | Runs on | Speed vs real time | Word check |
|---|---|---|---|
| Kokoro bf_emma, bm_george, af_heart, af_bella | CPU (Node) | about 5× faster | all exact |
| Qwen3 designed British woman, British man | RTX 3060 | about 3.7× slower | exact |
| Qwen3 built-in Ryan | RTX 3060 | about 3.6× slower | changed "until" to "in the" |
| Qwen3 built-in Aiden | RTX 3060 | about 3.8× slower | "mornings" for "morning" |

Reading flow, 2026-10-21 (ADR-31). The built app in headless, muted Edge,
online voice Ryan (United Kingdom), nine short sentences in two paragraphs,
from Play to "Finished".

| Speed | One sentence at a time, 0.15 s pauses (as before) | A paragraph at a time (now) |
|---|---|---|
| 1× | 27.5 s | 25.4 s |
| 1.5× | 19.6 s | 17.2 s |

Seven full stops and one paragraph break: each full stop is about 0.4 s
shorter, and the paragraph break is longer (0.7 s by default, divided by the
speed). At 1.5× the "before" run already had its pauses divided by the speed,
which the old version did not do, so the old version was a little slower
still. Kokoro clips are trimmed to 0.05 s before and 0.2 s after the speech
(they had about 0.3 s and 0.7 s); not yet timed in the app.
