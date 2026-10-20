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
| 9 Storage | done | U9 | 2026-10-20 | summaries, bytes, ordinal (ADR-19); atomic add (ADR-20) |
| 10 Web Speech + registry | done | U10 + Edge gate | 2026-10-21 | gate: see M3 |
| 11 Player | done | U11 | 2026-10-20 | never advances on unheard text (ADR-14) |
| 12 Library | done | browser | 2026-10-21 | five formats added in one go |
| 13 Reader | done | browser + Edge | 2026-10-21 | |
| 14 Flags + corrections | done | U12 + browser | 2026-10-21 | export matches spec 10.2 |
| 15 Resume + JSON | done | U13 | 2026-10-20 | browser round trip not yet done (M7) |
| 16 PWA, hints, offline | done | browser | 2026-10-21 | update toast added; install = M8 |
| Phase 1 gate | waiting on Rockson | | | see below |

## Phase 1 gate

- [x] U1–U13 green (74 tests), `pnpm build` clean, bundle budget met.
- [ ] M1–M8 done in Edge. Done or partly done: M2 (sample PDF), M3, M4, M5,
      M6. Waiting on Rockson: M1 and M2 with his chapter, M3 by ear, M8
      install. Not yet run in a browser: M7.
- [ ] Rockson has listened to one chapter of his book in the installed app,
      flagged mistakes with F, and exported `corrections.md`.

## Manual checks

Run on 2026-10-21. "Pane" is the Chromium browser pane in the Claude app (only
Basic Windows voices). "Edge" is Edge 155, headless and muted, with a
throwaway profile, driven over the remote-debugging port. Sound was never
heard, so every "by ear" item is still Rockson's.

- **M1 docx**: generated sample only. Heading became a chapter, paragraphs
  intact. Real chapter: waiting on Rockson.
- **M2 pdf**: generated two-page sample. Running header and page numbers
  dropped, wrapped lines joined, headings found, title from metadata, the
  warning shown once. Real PDF: waiting on Rockson.
- **M3 voices**: Edge lists 321 natural voices, Natural first. **Read 3
  sentences** spoke all three (5.7 s, 5.7 s, 6.1 s, with word boundaries).
  Sonia and Ryan each spoke a full test sentence (4.8 s and 4.6 s). The
  automatic choice is Libby, the first natural en-GB voice, as spec 7.1 says.
  Pane: only Basic voices and the H1 banner. By ear: waiting on Rockson.
- **M4 library**: all five formats added at once; delete works; errors appear
  as toasts. Duplicate detection and large-EPUB progress are unit-tested only.
- **M5 reader**: Edge: Play spoke the heading, paused, moved on; Pause held
  the sentence. Pane: arrow keys, F, N and G work; Contents jumps to a nested
  EPUB entry. Not yet checked: click to seek, R, [ and ], speed 2.0 by ear,
  and a 15-second sentence by ear.
- **M6 flags**: F and N flag, N opens the note, Ctrl+Enter saves, flagged
  sentences are underlined, `corrections.md` matches spec 10.2. Not yet
  checked: F during playback.
- **M7 resume**: unit-tested only.
- **M8 PWA**: manifest, icons, service worker (25 files precached) and
  Content Security Policy are live. The update toast was shown after a
  simulated update. Install and offline relaunch: waiting on Rockson.
- **M10 mobile emulation** (Phase 3 check, done early): no sideways scroll at
  375 px; transport buttons 48 px; FLAG 96×56 always visible; the bottom
  sheet now ends at the controls (ADR-20).

## Needs Rockson

1. **Open the app.** Double-click `app/start-readaloud.cmd`. It serves the app
   at `http://127.0.0.1:4173` and opens Edge. Always use that address: each
   address keeps its own library.
2. **Voice gate by ear (M3).** In Settings, pick Sonia or Ryan (the choice is
   saved), press **Read 3 sentences**, and say whether all three sounded
   natural and complete.
3. **Install (M8).** In Edge use "Install ReadAloud" from the address bar or
   the menu. Close the launcher window and reopen the installed app: the
   library should still open.
4. **Your chapter (M1, M2 and the Phase 1 gate).** Put one chapter as `.docx`
   and as PDF (and `.md` if you have it) in `app/test/fixtures/private/`, which
   git ignores. Then listen to it, press F on mistakes, and export
   `corrections.md`.
5. **From Step 17 (Phase 2):** an Azure AI Speech resource (Free F0) in the
   production tenant, with its region and key typed into Settings on each
   device.
6. **Optional:** install Node 22 LTS. Today the build uses a portable Node in
   a temporary folder (see handoff section 7).

## Open issues

- The toolchain lives in a temporary scratchpad folder. If it is cleaned up,
  the builder needs Node again before `pnpm` works (handoff section 7).
- Automatic voice choice is Libby, not Sonia, because spec 7.1 takes the
  first natural voice for the locale. An explicit pick is saved, so this only
  matters until Rockson chooses one.
- Delete asks with the browser's own confirm box. It works in Edge and on
  Android, but the Claude browser pane dismisses it, so tests there must stub
  `window.confirm`.

## Versions installed

```
dependencies:    idb 8.0.4, jszip 3.10.2, mammoth 1.13.0, marked 18.1.1,
                 pdfjs-dist 6.4.299, preact 10.29.8
devDependencies: @preact/preset-vite 2.10.6, @types/node 24.19.2,
                 fake-indexeddb 6.2.6, jsdom 30.1.3, typescript 7.0.2,
                 vite 8.3.4, vite-plugin-pwa 2.0.0, vitest 5.0.5
runtime:         Node 22.23.3 (portable), pnpm 11.19 via corepack
```

## Measurements

| Measure | Result | Budget |
|---|---|---|
| Main JS bundle, gzipped | 27.5 kB | < 250 kB |
| Parse a 500k-char `.docx` (Node + jsdom) | 0.97 s | < 5 s |
| Parse a 1 MB EPUB (Node + jsdom) | 0.86 s | < 6 s |
| Edge natural voice, one ~80-char sentence | about 5.7 s, start after 0.1–0.5 s | — |

- Azure characters used for one chapter: (Phase 2)
- Kokoro synthesis speed on the PC / phone: (Phase 4)
