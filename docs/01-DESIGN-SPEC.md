# 01 — Design specification (v1, 2026-10-20)

This is the contract for ReadAloudApp. Section numbers are referenced from the
build plan. Types in section 4 are copied verbatim into `app/src/core/types.ts`.

---

## 1. Goals and non-goals

Goals

- G1. Read `.txt`, `.md`, `.docx`, `.pdf`, `.epub` aloud with neural voices.
- G2. Run on Windows (Edge PWA) and on a Samsung Android phone (PWA, or
  Capacitor wrapper if the PWA cannot meet the gate).
- G3. Flag the current sentence with one key or one tap while listening; add a
  note; export a `corrections.md` list with exact locations and quoted text.
- G4. Remember position per document; move position and flags between devices
  by JSON export/import.
- G5. Work offline later with Kokoro (Phase 4); degrade gracefully to system
  voices when offline before that.
- G6. Zero backend. Everything is local except calls to the chosen voice service.

Non-goals (for Phases 1–4)

- OCR of scanned PDFs. Editing `.docx`/`.epub` in place. Word-level highlighting
  (Phase 5 option). Accounts, sync servers, analytics. Voice cloning. Any
  undocumented TTS endpoint.

---

## 2. Platforms and runtimes

| Target | Runtime | Voice engine | Notes |
|---|---|---|---|
| Windows | Microsoft Edge (installed PWA) | Web Speech, Edge natural voices | Primary. Also runs in Chrome with Azure/Kokoro. |
| Android (S21+) | Chrome PWA (3a) or Capacitor WebView (3b) | Azure (online), Kokoro (4), system voices (fallback) | Web Speech reaches only the system engine on Android. |

Browser features required: `Intl.Segmenter`, IndexedDB with Blob values,
`DOMParser`, `crypto.subtle`, `<audio>` with `playbackRate`, Service Worker.
Optional: File System Access API (Chromium), Media Session API, Wake Lock API,
WebGPU (Kokoro speed-up).

---

## 3. Architecture

### 3.1 Layers

```
app/src/
  core/                      no UI; unit-tested with vitest
    types.ts                 section 4, verbatim
    ingest/
      index.ts               detectFormat(), parseFile()
      html.ts                htmlToDocument()                (5.1)
      txt.ts  md.ts  docx.ts  epub.ts  pdf.ts                (5.2–5.6)
    text/
      segment.ts             segmentSentences()              (6.1)
      normalize.ts           toSpeakText(), chunk()          (6.2, 6.3)
      build.ts               buildDocument(): blocks -> sentences, chapters, toc (5.7)
    engines/
      registry.ts            engine list, availability, selection (7.1, 7.6)
      webspeech.ts           (7.2)   azure.ts (7.3)   kokoro.ts (7.4)
    player/
      player.ts              state machine, queue, prefetch (8)
      audio-cache.ts         (8.4)
    store/
      db.ts                  idb schema + migrations (9.1)
      repo.ts                typed access: docs, positions, flags, settings
      export.ts              JSON bundle export/import (9.2)
    flags/
      corrections.ts         flags -> corrections.md (10.2)
    util/
      hash.ts (sha256 hex)   ids.ts (uuid)   paths.ts (epub href resolution)
  ui/                        Preact
    App.tsx  routes.ts
    screens/ Library.tsx  Reader.tsx  Settings.tsx
    components/ TextPane.tsx  Controls.tsx  VoicePicker.tsx  SpeedControl.tsx
                FlagPanel.tsx  TocPanel.tsx  AddFile.tsx  Toast.tsx
    hooks/ usePlayer.ts  useStore.ts  useKeys.ts
    styles/ base.css  reader.css  mobile.css
  sw/                        service worker via vite-plugin-pwa (generated)
```

### 3.2 Dependency direction

`ui` → `core`. Never the reverse. `core/engines` and `core/player` know nothing
about Preact. `core/store` is the only module that touches IndexedDB.

### 3.3 Browser globals allowed inside `core/`

`DOMParser`, `Intl`, `crypto.subtle`, `crypto.randomUUID`, `fetch`,
`AbortController`, `Blob`, `URL`, `TextDecoder`, `speechSynthesis` (only in
`engines/webspeech.ts`), `Audio`/`HTMLAudioElement` (only in `player/`),
`indexedDB` (only in `store/`), `navigator.onLine`.

---

## 4. Data model (copy verbatim to `app/src/core/types.ts`)

```ts
// ===== Documents =====
export type DocFormat = 'txt' | 'md' | 'docx' | 'pdf' | 'epub';
export type BlockType =
  | 'heading' | 'paragraph' | 'list-item' | 'quote' | 'code' | 'caption' | 'table-row';

export interface Sentence {
  id: string;          // `${blockId}.s${index}` e.g. "b12.s3"
  blockId: string;
  index: number;       // 0-based within the block
  text: string;        // exact source text (display, flags, apply-to-source)
  start: number;       // offset in block.text, inclusive
  end: number;         // offset in block.text, exclusive
  speakText: string;   // normalised text for the voice engine (6.2)
  chunks: string[];    // speakText split into <= 280-char pieces (6.3); usually [speakText]
}

export interface Block {
  id: string;          // `b${index}`, sequential over the whole document
  index: number;
  type: BlockType;
  level?: number;      // headings only, 1..6
  text: string;        // whitespace-normalised plain text
  chapterIndex: number;
  sentences: Sentence[];
  anchor?: { href: string; ids: string[] }; // ingest-time only; used to map an EPUB TOC
}

export interface Chapter { index: number; title: string; firstBlockId: string; }

export interface TocEntry { title: string; level: number; blockId: string; }

export interface ParsedDocument {
  title: string;
  language: string;    // BCP-47, default 'en-GB'
  format: DocFormat;
  blocks: Block[];
  chapters: Chapter[];
  toc: TocEntry[];
  charCount: number;   // sum of block.text.length
  warnings: string[];  // non-fatal parse notes, shown once after import
}

export interface DocRecord extends ParsedDocument {
  id: string;          // crypto.randomUUID()
  sourceName: string;  // original file name
  sourceHash: string;  // sha256 hex of the original bytes (duplicate detection)
  addedAt: string;     // ISO 8601
  lastOpenedAt?: string;
}

// ===== Voices =====
export type EngineId = 'webspeech' | 'azure' | 'kokoro';
export type VoiceQuality = 'neural' | 'standard';

export interface Voice {
  id: string;          // stable within the engine (voiceURI / Azure ShortName / kokoro voice id)
  engineId: EngineId;
  name: string;        // display name
  lang: string;        // BCP-47
  quality: VoiceQuality;
  offline: boolean;
}

export interface SpeakOptions { voice: Voice; rate: number; } // engine rate; 1.0 = normal

export interface EngineAvailability { ok: boolean; reason?: string; }

export interface VoiceEngine {
  readonly id: EngineId;
  readonly label: string;
  readonly kind: 'direct' | 'audio';
  readonly maxEngineRate: number;  // webspeech 2.0; audio engines 1.0 (speed via playbackRate)
  isAvailable(): Promise<EngineAvailability>;
  listVoices(): Promise<Voice[]>;
  /** kind 'direct': speaks the text; resolves when finished or when `signal` aborts. */
  speak?(text: string, opts: SpeakOptions, signal: AbortSignal): Promise<void>;
  /** kind 'audio': returns encoded audio (audio/mpeg or audio/wav). */
  synthesize?(text: string, opts: SpeakOptions, signal: AbortSignal): Promise<Blob>;
}

// ===== Player =====
export type PlayerStatus = 'idle' | 'buffering' | 'playing' | 'paused' | 'ended' | 'error';

export interface PlayerState {
  status: PlayerStatus;
  docId?: string;
  sentenceId?: string;
  rate: number;        // user speed 0.8..3.0
  engineId: EngineId;
  voiceId?: string;
  error?: string;
}

export type PlayerEvent =
  | { type: 'state'; state: PlayerState }
  | { type: 'sentence'; sentenceId: string }
  | { type: 'ended' }
  | { type: 'error'; message: string };

// ===== Flags =====
export type FlagStatus = 'open' | 'fixed' | 'dismissed';

export interface Flag {
  id: string;
  docId: string;
  sentenceId: string;
  blockId: string;
  chapterIndex: number;
  chapterTitle: string;
  paragraphInChapter: number;  // 1-based ordinal of the block within its chapter
  quote: string;               // Sentence.text at the time of flagging
  context?: FlagContext;       // neighbouring sentences when flagged; places repeated quotes (ADR-23)
  note: string;                // free text, may be ''
  fixedText: string;           // corrected sentence, may be ''
  status: FlagStatus;
  createdAt: string;
  updatedAt: string;
}

/** The sentences before and after a flagged one in reading order ('' at either end). */
export interface FlagContext { before: string; after: string; }

// ===== Storage =====
// ordinal = the sentence's 0-based reading-order index; lets the library show
// progress without loading the document (ADR-19). Optional for old exports.
export interface PositionRecord { docId: string; sentenceId: string; updatedAt: string; ordinal?: number; }

// Small row per document for the library list, so it never loads blocks (ADR-19).
export interface DocSummary {
  id: string; title: string; format: DocFormat; sourceName: string;
  addedAt: string; lastOpenedAt?: string; charCount: number; sentenceCount: number;
}

export interface AudioCacheRecord { key: string; blob: Blob; bytes: number; lastUsed: number; }

export interface Settings {
  schemaVersion: 2;                             // 2: Kokoro first (ADR-22)
  enginePreference: EngineId[];                 // default ['kokoro', 'webspeech']
  voiceByEngine: Partial<Record<EngineId, string>>;
  rate: number;                                 // default 1.0
  locale: string;                               // default 'en-GB'
  azure: { region: string; key: string } | null;
  skipCodeBlocks: boolean;                      // default true
  announceHeadings: boolean;                    // default true
  pauseAfterHeadingMs: number;                  // default 600
  pauseBetweenSentencesMs: number;              // default 150 (all engines)
  keepAwake: boolean;                           // default true
  pauseOnFlag: boolean;                         // default false on desktop, true on touch devices
  fontSizePx: number;                           // default 18
  theme: 'auto' | 'light' | 'dark';             // default 'auto'
}

export interface ExportBundleV1 {
  version: 1;
  exportedAt: string;
  docs: Array<{
    id: string; title: string; format: DocFormat; sourceName: string;
    sourceHash: string; charCount: number;
    position?: PositionRecord; flags: Flag[];
  }>;
  settings?: Partial<Omit<Settings, 'azure'>>;   // never export the Azure key
}
```

---

## 5. Ingestion

### 5.0 Entry point

```ts
export function detectFormat(file: File): DocFormat | null   // by extension, then by magic bytes (PK zip -> docx/epub by content)
export async function parseFile(file: File, settings: Settings): Promise<ParsedDocument>
```

`parseFile` dispatches to a loader; each loader returns `{ title, language, html }`
or, for PDF, pseudo-HTML. Then `htmlToDocument()` (5.1) and `buildDocument()`
(5.7) finish the job. Errors are thrown as `IngestError { code, message }` with
codes: `unsupported`, `drm`, `scanned-pdf`, `corrupt`, `too-large` (> 50 MB).

### 5.1 `htmlToDocument(html, opts): RawBlock[]`

`RawBlock = { type: BlockType; level?: number; text: string; anchor?: {href, ids} }`.

Algorithm:

1. `doc = new DOMParser().parseFromString(html, opts.mime ?? 'text/html')`. If
   `doc.querySelector('parsererror')` exists and mime was XHTML, re-parse as
   `text/html`.
2. Remove: `script, style, nav, aside, header, footer, noscript, svg, math,
   template`. (EPUB front matter navs are rebuilt from the OPF TOC instead.)
3. Walk `doc.body` depth-first. Element → block mapping:
   - `h1..h6` → `heading`, level = digit.
   - `p` → `paragraph`.
   - `li` → `list-item` (text of the li excluding nested `ul/ol`, which are
     walked separately).
   - `blockquote` → each child block becomes `quote`; if it has only inline
     content, the blockquote itself is one `quote`.
   - `pre` → `code` (one block, keep line breaks collapsed to spaces).
   - `figcaption` → `caption`.
   - `tr` → `table-row`, cells joined with `"; "`.
   - `div, section, article, main, td, dd, dt, summary` → if the element has
     **no block-level descendants** and non-empty text, treat as `paragraph`;
     otherwise recurse into children.
   - `br` inside a block counts as a space.
   - `img` contributes nothing (alt text is not read).
4. Text of a block = `textContent` with whitespace collapsed (`\s+` → single
   space, NBSP → space) and trimmed. Blocks with empty text are dropped.
5. `anchor`: for each block, collect `id` attributes found on the element itself
   and any descendant, plus `opts.href` (the source file path inside an EPUB).
6. Return blocks in document order.

### 5.2 `.txt`

Decode as UTF-8 (fall back to windows-1252 if the decoder reports errors).
Paragraphs are separated by one or more blank lines; single newlines inside a
paragraph become spaces. A paragraph that is a single line of at most 80 chars,
has no terminal punctuation, and is followed by a blank line is a `heading`
level 2 (common in plain-text manuscripts). Title = file name without extension.

### 5.3 `.md`

Use `marked` to produce HTML (`marked.parse(text, { gfm: true })`), then 5.1.
Markdown-specific rules before parsing: strip YAML front matter (`---` block at
the very start); `[text](url)` keeps `text` (marked does this). Title = first
`h1` text, else file name. Links' URLs are not read because they do not appear
in `textContent`. Images are ignored.

### 5.4 `.docx`

```ts
const mammoth = await import('mammoth');
const { value: html, messages } = await mammoth.convertToHtml({ arrayBuffer });
```

Then 5.1. Mammoth maps Word heading styles to `h1..h6`. Title = core
properties title if present (mammoth does not expose it; use first `h1`, else
file name). Push mammoth warning messages into `warnings`.

### 5.5 `.epub`

Libraries: `jszip` + `DOMParser`. Steps:

1. `zip = await JSZip.loadAsync(bytes)`.
2. If `META-INF/encryption.xml` exists and references any file whose media type
   is XHTML (`EncryptedData/CipherData/CipherReference[@URI]`), throw
   `IngestError('drm')`. Font-only encryption is ignored with a warning.
3. Parse `META-INF/container.xml` (XML) → `rootfiles/rootfile[@full-path]` →
   `opfPath`. `opfDir = dirname(opfPath)`.
4. Parse OPF (XML):
   - `metadata`: `dc:title` → title; `dc:language` → language (default `en`).
   - `manifest/item`: map `id → { href, mediaType, properties }`, href resolved
     against `opfDir` and URL-decoded (`util/paths.ts`).
   - `spine/itemref[@idref]` in order; skip items with `linear="no"`; skip items
     whose media type is not XHTML/HTML.
5. TOC:
   - EPUB 3: manifest item whose `properties` contains `nav` → load, parse as
     XHTML, find the `nav` element with `getAttribute('epub:type') === 'toc'`;
     walk `ol > li > a` recursively; depth = level; `href` resolved against the
     nav file's folder → `{ title, level, href, fragment }`.
   - EPUB 2 fallback: `spine[@toc]` → manifest item (NCX) → `navMap/navPoint`
     recursively; `navLabel/text`, `content[@src]`.
   - If neither exists, TOC is derived from headings in 5.7.
6. For each spine item: load the string, parse via 5.1 with
   `mime = 'application/xhtml+xml'` and `href = itemPath`. Concatenate blocks.
   The first block of each spine item is marked with its `anchor.href`.
7. Map TOC entries to blocks: entry with `href` and optional `fragment` → the
   first block whose `anchor.href === href` and (`fragment` empty or
   `anchor.ids` includes `fragment`); if the fragment id is not found on any
   block, use the first block of that href. Entries that cannot be mapped are
   dropped with a warning. Mapped TOC entries whose block is not a heading
   promote that block to a `heading` with the entry's level (common in EPUBs
   that use styled `div`s for chapter titles).
8. Chapters: boundaries at every mapped TOC entry with level 1 (if no level-1
   entries, every TOC entry), else at every `h1`/`h2`, else at each spine item.

Large EPUBs: process spine items sequentially; yield to the event loop every
10 items (`await new Promise(r => setTimeout(r))`) so the UI can show progress.

### 5.6 `.pdf`

Library: `pdfjs-dist` (configure the worker; see handoff 6). Output pseudo-HTML
blocks `RawBlock[]` directly (skip 5.1). Algorithm per document:

1. For each page: `const tc = await page.getTextContent()`; for each item with
   `str`: `x = transform[4]`, `y = transform[5]`, `fontSize = hypot(transform[0], transform[1])`,
   `width`, `hasEOL`. Ignore empty/whitespace-only `str`.
2. Group items into **lines** by `y` within `0.5 * medianFontSize` of a line's
   y. Sort lines by y descending (PDF y grows upward). Within a line sort items
   by x ascending; join `str`s, inserting a space when the horizontal gap between
   consecutive items exceeds `0.25 * fontSize` and neither side already has one.
   Line record: `{ text, y, x0, x1, fontSize, page }`.
3. **Running headers/footers**: normalise each line's text by replacing digits
   with `#`. Count across pages the normalised texts that appear in the top or
   bottom 10% of the page height. Any such text appearing on at least
   `max(min(3, pageCount), ceil(0.3 * pageCount))` pages is dropped from every
   page (so a 2-page PDF needs both pages; detection is skipped for 1 page).
   Also drop, inside those zones, lines whose text is only digits, Roman
   numerals, `- N -` or `Page N [of M]`.
4. **Paragraphs**: iterate lines in reading order across pages. Start a new
   paragraph when any holds:
   - vertical gap to previous line > `1.5 * medianLineGap` (same page), or a page break where the previous line ends with `. ! ? " ” ’ )`;
   - this line's `x0` is indented by more than `1.0 * fontSize` relative to the page's modal body `x0`;
   - previous line is shorter than 60% of the median line width **and** ends with sentence punctuation;
   - fontSize differs from the previous line by more than 15%.
   When joining lines: if the previous line ends with `-` and this line starts
   with a lowercase letter, remove the hyphen and join without a space;
   otherwise join with a space.
5. **Headings**: body font size = the fontSize with the most characters.
   A paragraph whose fontSize ≥ `1.25 * body` is a `heading`; level by rank of
   distinct heading sizes (largest = 1, at most 3 levels). A heading paragraph
   longer than 200 chars is demoted to `paragraph`.
6. **Scanned PDF**: if total extracted chars / page count < 50, throw
   `IngestError('scanned-pdf')`.
7. Title = `metadata.info.Title` if non-empty, else first heading, else file name.
   Push a warning: "PDF reading order is reconstructed; prefer the .docx/.md source".

### 5.7 `buildDocument(raw: RawBlock[], meta): ParsedDocument`

1. Assign `id = b${i}`, `index = i`.
2. Chapters: if the loader provided boundaries (EPUB), use them. Otherwise the
   chapter level = the smallest heading level present among headings (if there
   are more than 400 blocks and that level yields fewer than 2 chapters, use
   the next level). Every heading at that level starts a chapter titled with the
   heading text. Blocks before the first chapter heading belong to chapter 0
   titled "Front matter" (or the document title if there are fewer than 3 such
   blocks). If there are no headings, one chapter titled with the document title.
3. `toc`: all headings with level ≤ 3 (or the mapped EPUB TOC).
4. Sentences: for each block, `segmentSentences(block.text, language)` (6.1),
   then `speakText = toSpeakText(text, block.type)` (6.2) and
   `chunks = chunk(speakText)` (6.3). `code` blocks get one sentence equal to the
   whole block (they are skipped at playback when `skipCodeBlocks`).
5. Headings with `announceHeadings`: `speakText` is the heading text unchanged;
   the player adds the pause (8.2). Do not prefix "Chapter" automatically.
6. `charCount` = sum of `block.text.length`. Drop `anchor` before storage.

---

## 6. Segmentation and normalisation

### 6.1 `segmentSentences(text, locale): { text, start, end }[]`

- Use `new Intl.Segmenter(locale, { granularity: 'sentence' })`. For each
  segment, trim leading/trailing whitespace and adjust `start`/`end` to the
  trimmed range. Drop empty segments.
- Post-pass merges: a segment that consists only of closing punctuation
  (`" ” ’ ) ] ’`) or is shorter than 2 characters is merged into the previous
  one. A segment that ends with a known abbreviation followed by a lowercase
  next segment start is merged (abbreviations: `Mr. Mrs. Ms. Dr. Prof. St. No.
  vs. etc. e.g. i.e. Fig. Vol. Ch. pp. approx.`).
- Fallback when `Intl.Segmenter` is undefined: split with
  `/(?<=[.!?…]["”’)\]]?)\s+(?=["“‘(\[]?[A-Z0-9])/` and the same merges.

### 6.2 `toSpeakText(text, blockType): string`

Apply in order:

1. NBSP and other Unicode spaces → space; collapse whitespace; trim.
2. URLs (`https?://\S+` and `www\.\S+`) → `link`. Bare emails → read as-is.
3. Footnote markers: `\[\d+\]`, `\^\d+`, and a superscript digit run
   `[¹²³⁰-⁹]+` → removed.
4. Dashes: ` — `, ` – `, `—`, `–` → `, ` (comma gives a natural pause). A hyphen
   between letters is kept (`well-known`).
5. Ellipsis `…` or `...` → `...` (voices pause correctly).
6. `*`, `_`, `#`, `>` left over from Markdown at token boundaries → removed.
7. For `list-item`: prefix nothing (voices read bullets badly); for `table-row`
   leave the `; ` separators.
8. If the result is empty (e.g. a block of only symbols), return `''` and the
   player skips it.

Numbers, dates, currencies and acronyms are left to the engine.

### 6.3 `chunk(speakText, max = 280): string[]`

If `speakText.length <= max` return `[speakText]`. Otherwise find the split
point among `; : , ` (in that priority) whose index is closest to the midpoint
and lies between 30% and 70% of the length; split after the punctuation. If
none, split at the last space before `max`. Recurse on both halves. Trim pieces
and drop empties.

---

## 7. Voice engines

### 7.1 Registry and selection

```ts
export function getEngines(settings): VoiceEngine[]          // all three, constructed lazily
export async function pickEngine(settings): Promise<{ engine: VoiceEngine; voice: Voice } | null>
```

`pickEngine` must never choose a robotic voice while a natural one is
available (review correction, ADR-13). It runs two passes over
`settings.enginePreference`, skipping engines whose `isAvailable()` is not `ok`:

1. **Neural pass**: engines in preference order. For each: the saved
   `voiceByEngine[engine.id]` if it is still listed (ADR-22: a saved voice no
   longer has to be `neural`, and it no longer outranks an engine earlier in
   the order), else the first `neural` voice whose `lang` starts with the
   locale's language, else the first `neural` voice.
2. **Fallback pass** (only if pass 1 found nothing): the first engine with any
   voice; same voice rule without the `neural` restriction. The UI then shows
   the "Basic voice" status and hint H1.

A voice the user explicitly picked in the voice picker is honoured even if it
is `standard`; automatic selection never picks one. If no engine has any voice,
return `null` and the UI shows hint H1 (section 14).

Quality labels in the UI: `neural` → "Natural", `standard` → "Basic".

### 7.2 `WebSpeechEngine` (kind `direct`, maxEngineRate 2.0)

- `isAvailable()`: `'speechSynthesis' in window`.
- `listVoices()`: `await waitForVoices()` (return immediately if `getVoices()`
  is non-empty, else resolve on `voiceschanged` or after 3000 ms). Map each
  `SpeechSynthesisVoice` → `Voice { id: voiceURI || name, name, lang,
  quality: /natural/i.test(name) && !voice.localService ? 'neural' : 'standard',
  offline: voice.localService }`. Sort: neural first, then by name. If
  `navigator.onLine === false`, filter out online voices.
- `speak(text, opts, signal)`:
  1. `const u = new SpeechSynthesisUtterance(text)`; set `voice`, `lang =
     voice.lang`, `rate = clamp(opts.rate, 0.5, 2.0)`, `pitch = 1`.
  2. Resolve on `end`. Reject on `error` with `event.error` unless the error is
     `interrupted` or `canceled` (those are our own stop → resolve).
  3. Watchdog: `expectedMs = text.length / (14 * rate) * 1000`; timer at
     `expectedMs * 2 + 3000`. On fire: `speechSynthesis.cancel()` and **reject
     with `SpeechStalledError`**. Never resolve on a timeout: for proofreading,
     unheard text must not be treated as heard (review correction, ADR-14).
     Likewise, an `end` that arrives implausibly early (chunk longer than 40
     chars and elapsed < `max(300, 0.15 * expectedMs)` ms) rejects with
     `SpeechStalledError`, because an online voice that loses its connection can
     end without speaking. The player handles the rejection (8.2).
  4. `signal` abort → `speechSynthesis.cancel()` and resolve.
  5. If `speechSynthesis.paused`, call `resume()` before `speak(u)`.
  6. Keep a module-level reference to the current utterance so GC cannot drop
     it before `end` (a known Chromium bug).
- Natural voices are online-only. If `navigator.onLine` is false the engine
  still works with local voices, labelled Basic.

### 7.3 `AzureEngine` (kind `audio`, maxEngineRate 1.0)

- `isAvailable()`: settings.azure non-null, `navigator.onLine`.
- `listVoices()`: `GET https://{region}.tts.speech.microsoft.com/cognitiveservices/voices/list`
  with header `Ocp-Apim-Subscription-Key`. Map `{ ShortName, DisplayName,
  Locale, VoiceType }` → `Voice { id: ShortName, name: `${DisplayName} (${Locale})`,
  lang: Locale, quality: VoiceType === 'Neural' ? 'neural' : 'standard',
  offline: false }`. Cache the list in `settings`-adjacent storage for 24 h.
  Exclude voices whose ShortName contains `HD` or `Dragon` (not in the free tier).
- `synthesize(text, opts, signal)`:
  - `POST https://{region}.tts.speech.microsoft.com/cognitiveservices/v1`
  - headers: `Ocp-Apim-Subscription-Key`, `Content-Type: application/ssml+xml`,
    `X-Microsoft-OutputFormat: audio-24khz-48kbitrate-mono-mp3`,
    `User-Agent: ReadAloudApp`.
  - body:
    ```xml
    <speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="{lang}">
      <voice name="{ShortName}">{escapedText}</voice>
    </speak>
    ```
    (`rate` is always 1.0; do not add `<prosody>`.) Escape `& < > " '`.
  - Response → `Blob` of type `audio/mpeg`. 401 → error "Azure key rejected";
    429 → handled by the limiter in 8.3 (back off, then retry; not an error
    unless it persists for 2 minutes, then "Azure rate limit"); 403 with quota
    text → error "Azure free quota used up for this month".
  - `text` is a segment of up to 600 characters (8.3), not a single sentence.
  - CORS check in build step 17. Fallback: official JS Speech SDK over WebSocket.

### 7.4 `KokoroEngine` (kind `audio`, maxEngineRate 1.0) — the main voice (ADR-22)

- Web: `kokoro-js` inside a dedicated module Web Worker. Model
  `onnx-community/Kokoro-82M-v1.0-ONNX`, `dtype: 'fp32'`, `device: 'webgpu'`
  when an adapter exists, else `'wasm'` (fp32 too: q8 is slower on wasm). The
  ONNX runtime is served from `/ort/`. First use downloads about 326 MB with
  a progress bar; all listed voices are stored then, so every voice works
  offline; Settings can remove it. `generate(text, { voice })` → WAV blob.
  UK voices: women `bf_emma` (default), `bf_isabella`; men `bm_george`,
  `bm_fable`, `bm_lewis`. US: women `af_heart`, `af_bella`, `af_nicole`; men
  `am_michael`, `am_fenrir`, `am_puck`. Names say woman or man and the
  country, e.g. "Emma (woman, United Kingdom)", women first in each country.
  `quality: 'neural'`, `offline: true`.
- A sentence of one or two words is made in one clip with its neighbour in the
  same block (up to 300 characters); the highlight follows by character share
  (ADR-22).
- Android native (3b + 4 only): a Capacitor plugin wrapping sherpa-onnx's Kotlin
  API; same `Voice` ids; returns a file path, converted with
  `Capacitor.convertFileSrc`. Spec at outline level; design when reached.

### 7.5 System voices

Not a separate engine. They are the `standard` voices returned by
`WebSpeechEngine`. On Android they are the Samsung/Google engines.

### 7.6 Engine switching at runtime

Changing engine or voice from the picker stops playback, saves the choice in
settings, and resumes from the current sentence.

---

## 8. Player

### 8.1 State machine

```
idle --play--> buffering --ready--> playing --pause--> paused --resume--> playing
playing --sentence done--> playing (next) | ended (last)
any --stop--> idle      any --error--> error --play--> buffering
```

API:

```ts
class Player {
  constructor(deps: { repo: Repo; engines: EngineRegistry; settings: () => Settings })
  load(doc: DocRecord, startAt?: string): Promise<void>  // sets current sentence (saved position or first)
  play(): Promise<void>  pause(): void  resume(): void  stop(): void
  next(): void  prev(): void  seek(sentenceId: string): void  replay(): void
  setRate(r: number): void  setVoice(engineId: EngineId, voiceId: string): Promise<void>
  subscribe(fn: (e: PlayerEvent) => void): () => void
  get state(): PlayerState
}
```

### 8.2 Playback loop

```
while status === 'playing':
  s = current sentence; emit {type:'sentence', sentenceId}
  if block.type === 'code' && settings.skipCodeBlocks → advance; continue
  if s.speakText === '' → advance; continue
  if block.type === 'heading' && announceHeadings → await sleep(pauseAfterHeadingMs / 2)
  for chunk of s.chunks:
     if engine.kind === 'direct': await engine.speak(chunk, {voice, rate: min(rate, engine.maxEngineRate)}, signal)
     else: blob = await getAudio(chunk); await playBlob(blob, playbackRate = rate, signal)
     if signal aborted → return
  if block.type === 'heading' && announceHeadings → await sleep(pauseAfterHeadingMs)
  else → await sleep(pauseBetweenSentencesMs)
  advance(): next sentence in document order; if none → status 'ended', emit 'ended'
```

**Failure handling (ADR-14).** If `speak`/`synthesize`/`playBlob` rejects
(other than by our own abort), retry the same chunk once after 500 ms. If the
retry fails too, stop the loop with `status = 'error'`, keep `current` on that
sentence, and emit `error` with "Speech stopped at this sentence. Press Play to
try again." The loop never advances past a chunk that was not confirmed spoken.

A new `AbortController` per `play()`; `pause/stop/seek/next/prev/setVoice`
abort it. `pause` keeps `current`; `resume` restarts the current sentence from
its first chunk (simple and predictable). `prev` goes to the previous sentence,
or to the start of the current one if more than 3 s have elapsed since it began.

Rate: user rate 0.8–3.0 in steps of 0.1. Direct engines receive
`min(rate, 2.0)`; audio engines play at `audio.playbackRate = rate` with
`preservesPitch = true`. Rate changes apply from the next chunk.

### 8.3 Prefetch (audio engines)

**Kokoro (ADR-22):** keep the next 3 chunks being made, cache-first (8.4);
keep the last 8 finished clips in memory; on seek, abort unfinished clips that
are no longer ahead. Show `buffering` only when the current clip is not ready.
The Azure rules below are kept for reference only (Azure dropped, ADR-21).

Azure's free tier (F0) allows **20 synthesis transactions per 60 seconds**
([Microsoft quotas](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/speech-services-quotas-and-limits)).
Concurrency limits alone do not enforce that, so (review correction, ADR-15):

- **Pacing**: all Azure requests go through one token-bucket limiter, default
  18 requests per rolling 60 s (setting, so a paid tier can raise it). 429
  responses back off for the `Retry-After` header value, or 10 s if absent,
  and do not count as a failure of the chunk.
- **Grouping**: each request carries a *segment* of consecutive sentences from
  the same block, up to 600 characters (a single sentence longer than that is
  sent alone, already split by `chunk`). At 18 requests/min that is roughly
  10,000 characters a minute of capacity, well above the ~2,700 needed at 3×.
- **Highlight within a segment**: with the Speech SDK path (ADR-12), insert an
  SSML `<bookmark>` before each sentence and switch the highlight on bookmark
  events. With the REST path, estimate each sentence's start as its character
  share of the clip duration.
- **Buffer before play**: start playback when at least 30 s of audio (or the
  rest of the chapter, if shorter) is ready; show "Preparing audio n%". Keep
  preparing ahead in document order, cache-first (8.4). Abort outstanding
  requests on seek.
- Show `buffering` only when the current segment is not ready.

### 8.4 Audio cache

Key: `${engineId}|${voiceId}|1.0|${sha256hex(chunkText)}`. Store `Blob` in the
`audio` object store with `bytes` and `lastUsed`. Budget 300 MB; when exceeded,
delete least-recently-used records until under 250 MB. `getAudio` updates
`lastUsed` on hit.

### 8.5 Position saving

On each `sentence` event, debounce 1000 ms, then write `PositionRecord`. On
`ended`, write the last sentence. On `load`, start from the saved position if
present.

### 8.6 Media Session (Phase 3a)

When the engine is `audio`, set `navigator.mediaSession.metadata`
(title = document title, artist = chapter title) and action handlers for
`play`, `pause`, `previoustrack` (prev), `nexttrack` (next). Keep a silent
`<audio>` element playing only while actual chunks play; do not loop silence.
(Built in ADR-22. The clips themselves play in one reused `<audio>` element,
so no silent element is needed.)

---

## 9. Storage

### 9.1 IndexedDB (`idb`), database `readaloud`, version 1

| Store | Key | Value | Indexes |
|---|---|---|---|
| `docs` | `id` | `DocRecord` (blocks included) | `bySourceHash` (unique) |
| `summaries` | `id` | `DocSummary` (written with every `docs` write) | |
| `sources` | `docId` | `{ docId, bytes: ArrayBuffer }` | |
| `positions` | `docId` | `PositionRecord` | |
| `flags` | `id` | `Flag` | `byDoc` (docId) |
| `audio` | `key` | `AudioCacheRecord` | `byLastUsed` |
| `settings` | `key` | `{ key: 'settings', value: Settings }` | |

`addDocument` writes `docs`, `summaries` and `sources` in one transaction and
aborts it if any write fails, so a document never exists without its source.

Migrations live in `db.ts` `upgrade(db, oldVersion)`. Deleting a document
deletes its summary, source, position and flags (not its cached audio; the cache is
pruned by LRU).

Call `navigator.storage.persist()` once at first launch.

A book-length `DocRecord` with sentences is a few MB; store it as one record.
The Reader renders one chapter at a time, so the whole record is read once per
open.

### 9.2 JSON export/import

Export produces `ExportBundleV1` (section 4) as `readaloud-export-YYYYMMDD.json`
via a download link (or the File System Access API when available).

Import is two-phase so nothing is merged by guesswork (review correction, ADR-16):

1. `planImport(bundle)` matches each bundle document to a local one:
   **exact** by `id`, else **exact** by `sourceHash`; else a **possible**
   match by `(title, charCount)`, which is never applied without the user
   ticking it, because two revisions of a book can share both. The rest are
   **unmatched** ("not in this library; add the file first").
2. `applyImport(plan, confirmedPossibleIds)` for each exact or confirmed match:
   - **Remap**: every imported flag and position gets the *local* `docId`.
   - **Validate references**: a flag whose `sentenceId` exists in the local
     document and whose sentence text equals `quote` is kept as is. Otherwise
     re-anchor it to the first local sentence whose text equals `quote`
     (updating `sentenceId`, `blockId`, chapter fields). If none matches, the
     flag is not imported and is listed in the summary as "could not be placed",
     with its quote and note, so no edit is lost silently.
   - **Merge flags by id**: a new id is added; an existing id is replaced only
     if the imported `updatedAt` is newer (so a note edited on the phone
     updates the PC copy). Equal timestamps keep the local copy.
   - **Position**: the newer `updatedAt` wins, after its `sentenceId` is
     validated the same way (dropped if it cannot be placed).
3. The summary reports counts: added, updated, unchanged, could not be placed,
   possible matches skipped, unmatched documents.

---

## 10. Flags and corrections

### 10.1 Creating a flag

`F` (or the FLAG button) creates a `Flag` for the current sentence with
`note = ''`. `N` creates one and focuses the note field. Flagging does not pause
playback by default (setting `pauseOnFlag`, default false on desktop, true on
mobile). Flagging the same sentence twice edits the existing flag.

`chapterTitle` and `paragraphInChapter` are computed at creation time from the
document (block ordinal within the chapter, counting all block types).

### 10.2 `corrections.md`

```markdown
# Corrections — {document title}

Generated {YYYY-MM-DD HH:mm}. {n} flags ({open} open, {fixed} fixed).
Source: {sourceName}

## {Chapter title}

### {k}. Paragraph {paragraphInChapter}

> {quote}

- Note: {note or "—"}
- Fix: {fixedText or "—"}
- Status: {status}
```

Flags are ordered by document position. Chapters without flags are omitted.
Dismissed flags are omitted unless "include dismissed" is ticked.

### 10.3 Apply to source (Phase 5, Markdown only)

For `.md` sources: for each flag with `fixedText`, find `quote` in the source
text (exact match; if it occurs more than once, use the occurrence nearest the
block's position); replace; write `{name}.corrected.md` and a unified diff.

---

## 11. UI

### 11.1 Routes

`#/` Library · `#/read/:docId` Reader · `#/settings` Settings.

### 11.2 Library

- List of documents: title, format badge, progress % (sentences before the
  saved position / total), last opened. Click opens the Reader.
- "Add files" button (`<input type=file multiple accept=".txt,.md,.docx,.pdf,.epub">`)
  and a full-screen drop zone. Duplicate (`sourceHash` exists) → toast
  "Already in library", open it.
- "Paste text" button (ADR-24): a box for the text and an optional title; Ctrl+V
  anywhere in the library opens it with the clipboard text. The text is stored
  as a `.txt` source titled by its first line, then handled like an added file.
- Row menu: Delete (confirm), Export corrections, Re-parse.
- Footer: Export JSON, Import JSON, Settings.
- Import progress bar for large files (EPUB/PDF show "Chapter x of y").

### 11.3 Reader

Layout (desktop): header (back, title, chapter name, engine/voice badge);
left: text pane; right: collapsible panel with tabs **Contents** and **Flags**;
bottom: controls bar.

Text pane: renders **only the current chapter's blocks**. Each sentence is a
`<span data-sid>`; the current sentence has class `current` and is scrolled
into view (`block: 'center'`) when it is not visible. Clicking a sentence seeks
to it. Flagged sentences get class `flagged` (underline). Headings use
`h2`-style sizing; code blocks are monospaced and dimmed when skipped.

Controls bar: Prev · Play/Pause · Next · Replay · speed (−/value/+) ·
voice picker · **FLAG** · Note · panel toggle. Status text: "Buffering…",
"Edge natural voices", "Basic voice (offline)".

Keyboard (desktop):

| Key | Action |
|---|---|
| Space | play/pause |
| ← / → | previous / next sentence |
| R | replay sentence |
| F | flag current sentence |
| N | flag + focus note field |
| [ / ] | speed −0.1 / +0.1 |
| Esc | close panel / blur note field |
| G | open Contents |

Keys are ignored while a text field has focus (except Esc).

### 11.4 Mobile layout (`max-width: 720px`)

Side panel becomes a bottom sheet. Controls bar 72 px tall. **FLAG** is a
distinct 96 × 56 px button at the right end, always visible. Note entry is a
sheet with a textarea and Save. Font size default 18 px, adjustable in
Settings. Tap a sentence to seek. The screen stays awake while playing when
`keepAwake` (Wake Lock API; fall back silently).

### 11.5 Flags panel

List in document order: chapter/paragraph label, quote (two lines, expandable),
note and fix fields (inline edit, autosave on blur), status toggle
(open/fixed/dismissed), jump-to button. Header: count, "Export corrections.md",
"Include dismissed" checkbox.

### 11.6 Settings

Engine order (drag or up/down buttons), voice per engine (with "Test" button
speaking a fixed sentence), speed, locale, Azure region + key (password field,
"Verify" button that calls the voices list), Kokoro model download/remove
(Phase 4), skip code blocks, announce headings, pause lengths, keep awake, font
size, theme, "Clear audio cache" with size shown, Export/Import JSON.

### 11.7 Accessibility

All controls reachable by keyboard with visible focus. `aria-live="polite"`
region announces status changes. Colour contrast ≥ 4.5:1 for text. Reduced
motion respected.

---

## 12. Service worker / PWA

`vite-plugin-pwa` with `registerType: 'autoUpdate'`, manifest name
"ReadAloud", short name "ReadAloud", display `standalone`, theme colour from the
app, 192/512 icons. Precache the app shell; do not cache Azure responses in the
SW (the IndexedDB cache does that). When a new version takes over an open
page, the page reloads: at once, or when reading pauses or stops, with a toast
saying so (ADR-25).

---

## 13. Dependencies (exact list)

Runtime: `preact`, `idb`, `marked`, `mammoth`, `pdfjs-dist`, `jszip`.
`kokoro-js` (ADR-22, brought forward from Phase 4). Phase 3b adds `@capacitor/core`, `@capacitor/cli`,
`@capacitor/android`, `@capacitor/filesystem`, `@capawesome/capacitor-file-picker`,
`@capacitor-community/keep-awake`.

Dev: `vite`, `typescript`, `@preact/preset-vite`, `vitest`, `fake-indexeddb`,
`jsdom`, `vite-plugin-pwa`.

Install latest stable versions and record them in `PROGRESS.md`. Nothing else
without a decision entry.

---

## 14. Errors, hints and edge cases

| Situation | Behaviour |
|---|---|
| H1: no engine available | Banner: "No natural voice available. Open this app in Microsoft Edge for free natural voices, or add an Azure key in Settings." |
| Not in Edge, no Azure, online | Same banner, plus the Basic voices still work. |
| Offline with online engine selected | Toast: "Offline: using a basic voice until you reconnect." Switch to the first local voice; switch back when `online` fires. |
| Unsupported file | Toast with the extension list. |
| DRM EPUB | "This EPUB is DRM-protected and cannot be read." |
| Scanned PDF | "This PDF has no text layer. Export the text from the source document instead." |
| Corrupt file | "Could not read {name}: {detail}". |
| File > 50 MB | Refused with message. |
| Azure 401/403/429 | Messages per 7.3; the engine stays selected; playback pauses. |
| IndexedDB quota error | Toast: "Storage full. Clear the audio cache in Settings." |
| Empty document after parse | "No readable text found in {name}." |
| Sentence `speakText` empty | Skipped silently. |

---

## 15. Privacy and security

- All documents, flags and positions stay on the device.
- Kokoro keeps text on the device. Browser voices may send each sentence to
  Microsoft or Google (Edge's online voices). The Settings screen says this.
  Azure is dropped (ADR-21).
- The Azure key is stored only in IndexedDB on that device and is excluded from
  JSON export. It is never logged or placed in a URL.
- No analytics, no third-party scripts, no fonts from CDNs. The only remote
  hosts are `huggingface.co` and its CDN (Kokoro model download).
- Content Security Policy in `index.html`: `default-src 'self'; script-src
  'self' 'wasm-unsafe-eval'; connect-src 'self' https://huggingface.co
  https://*.hf.co; img-src 'self' data: blob:; media-src 'self' blob:;
  worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; font-src 'self';
  object-src 'none'; base-uri 'self'`.
- Response headers (dev and preview servers): `Cross-Origin-Opener-Policy:
  same-origin` and `Cross-Origin-Embedder-Policy: credentialless`, so Kokoro
  can use several threads where the browser supports it (ADR-22).

---

## 16. Performance budgets

| Measure | Budget |
|---|---|
| Parse a 500k-char `.docx` | < 5 s on the PC |
| Parse a 1 MB EPUB | < 6 s on the PC, < 15 s on the phone |
| Reader first paint after open | < 1 s |
| Highlight move on sentence change | < 50 ms |
| Audio engines: sentences ready ahead on 4G | ≥ 2 |
| Main JS bundle (gz), excluding lazy loaders | < 250 kB |
