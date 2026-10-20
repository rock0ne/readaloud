# 03 — Test plan

Unit tests run with `pnpm test` (vitest, jsdom, fake-indexeddb). Manual checks
are done in **Microsoft Edge** unless stated. Nothing from Rockson's book is
ever committed; real chapters live in `app/test/fixtures/private/` (git-ignored).

## Fixtures (committed, synthetic)

- `test/fixtures/sample.txt` — three paragraphs separated by blank lines; one
  short unpunctuated line "Part One" followed by a blank line (becomes a heading);
  a paragraph with a hard-wrapped sentence across two lines.
- `test/fixtures/sample.md` — YAML front matter; `# Title`; `## Chapter One`;
  paragraphs containing: "Dr. Smith met Mrs. Jones at 3 p.m. They left."; a
  quoted sentence ending in `.”`; a list with three items; a link `[site](https://example.com/x)`;
  a fenced code block; one sentence longer than 300 characters with commas and a
  semicolon; footnote markers `[1]` and `²`; an em-dash sentence; a bare URL;
  `## Chapter Two` with two paragraphs.
- `test/helpers/make-epub.ts` — builds an EPUB3 in memory with JSZip:
  `mimetype`, `META-INF/container.xml`, `OEBPS/content.opf` (title "Test Book",
  language `en-GB`, nav item with `properties="nav"`, three XHTML spine items, one
  `linear="no"` notes item), `OEBPS/nav.xhtml` (TOC with entries for ch1, ch2,
  and `ch2.xhtml#part2` fragment), `OEBPS/ch1.xhtml` (uses `<h1>`),
  `OEBPS/ch2.xhtml` (chapter title in `<div class="title">`, a `<p id="part2">`),
  `OEBPS/ch3.xhtml`, URL-encoded href `OEBPS/ch%203.xhtml` for ch3. A second
  builder `makeEpub2()` with `toc.ncx` instead of nav.
- `test/helpers/make-docx.ts` — minimal `.docx` with JSZip: `[Content_Types].xml`,
  `_rels/.rels`, `word/document.xml` with a `Heading1` styled paragraph and two
  body paragraphs, `word/styles.xml` defining `Heading1`.
- `test/helpers/pdf-items.ts` — synthetic pdf.js text items for two pages: body
  lines at fontSize 10, a title line at 18, a page number "12" at the bottom, a
  running header "My Book" at the top of both pages, a hyphenated line break
  "incred-" / "ible", an indented paragraph start.

## Unit tests

- **U1 segment** (`segment.test.ts`): splits "Hello there. How are you? Fine!"
  into 3 with correct offsets; keeps "Dr. Smith met Mrs. Jones at 3 p.m. They
  left." as 2 sentences; closing quote `.”` stays attached; offsets satisfy
  `text.slice(start, end) === segment`; fallback regex path produces the same
  count on the first two cases when `Intl.Segmenter` is stubbed to undefined.
- **U2 normalize**: URL → `link`; `[12]` and `²` removed; ` — ` → `, `;
  `well-known` kept; NBSP collapsed; `chunk` of a 600-char sentence returns
  pieces all ≤ 280, joined back equals the original minus split whitespace;
  split prefers `;` over `,`; a 280-char string returns one piece.
- **U3 htmlToDocument**: headings map to levels; `li` excludes nested lists;
  `blockquote` with two `p` → two `quote` blocks; `pre` → one `code`; `tr` cells
  joined with `; `; a `div` with only inline text → paragraph; a `div` with
  block children recurses; `script/style/nav/aside` removed; `img` ignored;
  anchors collect `id`s; XHTML parse error falls back to HTML.
- **U4 build**: chapter level = smallest heading level; front-matter chapter
  created; no headings → one chapter; toc has levels ≤ 3; every sentence's
  `block.text.slice(start,end) === text`; code block has one sentence;
  `charCount` correct.
- **U5 txt+md**: `sample.txt` → heading detected, hard-wrap joined; `sample.md`
  → front matter gone, title from `h1`, two chapters, link text kept and URL
  absent, code block typed `code`, long sentence has ≥ 2 chunks.
- **U6 epub**: title/language read; spine order preserved; `linear="no"` skipped;
  TOC mapped: ch1 → first block of ch1, fragment `part2` → the `p#part2` block,
  div-styled title promoted to heading; URL-encoded href resolved; EPUB2 NCX
  variant yields the same chapters; DRM `encryption.xml` referencing XHTML →
  `IngestError('drm')`.
- **U7 docx**: generated docx → heading + 2 paragraphs; mammoth warnings land
  in `warnings`.
- **U8 pdf reconstruction**: lines grouped by y; items joined with spaces by
  gap; running header dropped on both pages; page number dropped; hyphen joined
  to "incredible"; indented line starts a new paragraph; 18-pt line becomes a
  heading level 1; `scanned` detection when chars/page < 50.
- **U9 store**: add/get/list/delete document with cascade; duplicate hash
  rejected via unique index; settings defaults returned when empty; flags by
  doc; audio put/get updates `lastUsed`.
- **U10 webspeech + registry**: `waitForVoices` resolves on `voiceschanged`;
  quality mapping (`Online (Natural)` + `localService=false` → neural); `speak`
  resolves on `end`, resolves (not rejects) on `interrupted`; the watchdog
  **rejects** with `SpeechStalledError` when no event fires (fake timers); an
  implausibly early `end` on a long chunk rejects too; abort calls `cancel()`.
  `pickEngine`: with Web Speech offering only Basic voices and another engine
  offering a neural voice, the neural engine wins; with only Basic voices
  anywhere, the fallback pass picks one.
- **U11 player**: given a doc with heading, paragraph (2 sentences), code,
  paragraph: emits sentences in order; skips code when `skipCodeBlocks`;
  heading pause awaited (fake timers); `pause` aborts and `resume` restarts the
  same sentence; `next/prev` move; `ended` emitted; position saved after
  debounce; rate passed to a direct engine is capped at 2.0; an engine that
  rejects once is retried and playback continues; an engine that rejects twice
  puts the player in `error` on the **same** sentence and never advances.
- **U12 corrections**: exact Markdown output for two flags in two chapters
  (snapshot test), dismissed omitted unless included, order by position.
- **U13 export/import**: bundle has no Azure key; exact match by id, then
  hash; title+charCount is only a *possible* match and is not applied unless
  confirmed; imported flags and positions are remapped to the local `docId`; a
  flag with the same id and a newer `updatedAt` replaces the local one, an
  older one does not; a flag whose sentence moved is re-anchored by quote; a
  flag that cannot be placed is reported, not dropped silently; newer position
  wins; unmatched doc reported.
- **U14 azure** (Phase 2): SSML escaping of `& < > " '`; headers present; HD
  voices excluded; 401 → "key rejected"; 429 retried once; abort propagates.
- **U15 audio-cache**: prune removes least-recently-used until ≤ 250 MB when
  over 300 MB (use small fake budgets via injected constants).
- **U16 prefetch + pacing**: with a fake clock and a fake audio engine: no more
  than 18 requests in any rolling 60 s; segments group consecutive sentences
  of one block up to 600 chars; a 429 backs off without failing the segment;
  playback starts only once 30 s of audio (or the chapter rest) is ready; seek
  aborts outstanding requests and restarts from the new position.

## Manual checks (record results in `PROGRESS.md`)

- **M1 docx**: add a real `.docx` (a chapter from `fixtures/private/`): headings
  become chapters; paragraphs intact; no stray styling text.
- **M2 pdf**: add a real text PDF: no page numbers or running headers read;
  hyphenated words joined; headings detected; warning shown once.
- **M3 voices (Edge)**: Settings lists "Natural" voices first (Sonia, Ryan,
  Libby…); Test speaks naturally. In Chrome: only Basic voices and the H1 banner.
- **M4 library**: add all five formats; duplicate detected; delete; errors from
  spec 14 as toasts; large EPUB shows progress.
- **M5 reader (Edge)**: Space plays; highlight follows and scrolls; click a
  sentence to seek; ←/→, R, [, ], G, Esc behave per spec 11.3; chapter change
  via Contents; speed 2.0 still intelligible; a 15-second-plus sentence is not
  cut off (chunking works).
- **M6 flags**: F during playback does not interrupt; N opens the note; flagged
  sentences underlined; edit inline; `corrections.md` downloads and matches
  spec 10.2.
- **M7 resume**: close the tab mid-chapter; reopen; playback resumes at the
  saved sentence; JSON export then import into a fresh profile restores flags.
- **M8 PWA**: install from Edge; standalone window; relaunch with the preview
  server stopped still opens the library.
- **M9 azure (Chrome, Phase 2)**: enter key; Verify lists voices; a chapter
  plays gapless; speed 3.0; media keys work; characters used recorded.
- **M10 mobile emulation**: controls thumb-reachable; FLAG always visible; note
  sheet; bottom-sheet panels.
- **M11 kokoro (Phase 4)**: model downloads with progress; airplane mode
  playback; note synthesis speed.

## Phone checklist (Phase 3)

1. `adb reverse tcp:4173 tcp:4173`; open `http://localhost:4173` in Chrome on
   the phone; install to home screen.
2. Enter Azure key; import JSON from the PC; open the book.
3. Play; lock the screen; confirm audio continues ≥ 2 minutes; lock-screen
   controls pause/resume.
4. FLAG ten times while listening at 1.5×; add two notes.
5. Export JSON; import on the PC; flags appear in the Flags panel.
6. Battery and data after a 30-minute listen noted in `PROGRESS.md`.
