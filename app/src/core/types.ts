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
  page?: number;       // PDF only: the page the block starts on (ADR-30)
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

export interface SpeakOptions {
  voice: Voice;
  rate: number;                                 // engine rate; 1.0 = normal
  /** Direct engines with `boundaries`: called with a character offset in the text as it is spoken (ADR-31). */
  onBoundary?: (charIndex: number) => void;
}

export interface EngineAvailability { ok: boolean; reason?: string; }

export interface VoiceEngine {
  readonly id: EngineId;
  readonly label: string;
  readonly kind: 'direct' | 'audio';
  readonly maxEngineRate: number;  // webspeech 2.0; audio engines 1.0 (speed via playbackRate)
  /** Direct engines: can be given a paragraph at once and report progress with onBoundary (ADR-31). */
  readonly boundaries?: boolean;
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

// ===== Notes (ADR-30) =====
export interface Note {
  id: string;
  docId: string;
  sentenceId: string;          // the sentence being read when the note was made
  blockId: string;
  chapterIndex: number;
  chapterTitle: string;
  paragraphInChapter: number;
  quote: string;               // Sentence.text when the note was made
  context?: FlagContext;       // places the note again after a re-read, as for flags
  text: string;                // typed note (or pen handwriting turned into text), may be ''
  sketch?: string;             // a drawing, as a PNG data URL
  source: 'me' | 'ai';         // 'ai': a saved AI reply
  createdAt: string;
  updatedAt: string;
}

// ===== AI assistant (ADR-30) =====
export type AiProviderId = 'anthropic' | 'openai' | 'gemini';
export type AiKind = 'page-summary' | 'page-summaries' | 'chapter-summary' | 'book-overview' | 'explanation' | 'proofread' | 'answer';

export interface AiSuggestion {
  sentenceId: string;
  issue: string;               // what looks wrong
  fix: string;                 // the whole corrected sentence
  state: 'new' | 'flagged' | 'dismissed';
}

export interface AiResult {
  key: string;                 // `${docId}|${kind}|${scope}`; answers `${docId}|answer|${id}`
  docId: string;
  kind: AiKind;
  scope: string;               // 'book', 'c3' (chapter index), 'c3p12' (page key), 'b40' (paragraph)
  question?: string;           // answers only
  text: string;                // the reply; cites sentences as [b12.s3]
  suggestions?: AiSuggestion[]; // 'proofread' only
  provider: AiProviderId;
  model: string;
  createdAt: string;
  usage?: { input: number; output: number }; // tokens, when the provider reports them
  truncated?: boolean;         // the reply stopped at the length limit
  inputHash?: string;          // sha256 of the text sent; a different hash now means out of date
}

/** An API key, kept only in IndexedDB on this device and never exported (ADR-30). */
export interface AiKeyRecord { provider: AiProviderId; key: string; savedAt: string; expiresAt: string; }

export interface AiSettings {
  provider: AiProviderId | null;               // null: the assistant is off
  models: Partial<Record<AiProviderId, string>>;
}

// ===== Storage =====
export interface PositionRecord { docId: string; sentenceId: string; updatedAt: string; ordinal?: number; } // ordinal: 0-based sentence index in reading order

/** Lightweight library row, so the library never loads full documents (ADR-19). */
export interface DocSummary {
  id: string; title: string; format: DocFormat; sourceName: string;
  addedAt: string; lastOpenedAt?: string; charCount: number; sentenceCount: number;
}

export interface AudioCacheRecord { key: string; blob: Blob; bytes: number; lastUsed: number; }

export interface Settings {
  schemaVersion: 3;                             // 2: Kokoro first (ADR-22); 3: ai (ADR-30), paragraph pause (ADR-31)
  enginePreference: EngineId[];                 // default ['kokoro', 'webspeech']
  voiceByEngine: Partial<Record<EngineId, string>>;
  rate: number;                                 // default 1.0
  locale: string;                               // default 'en-GB'
  azure: { region: string; key: string } | null;
  skipCodeBlocks: boolean;                      // default true
  announceHeadings: boolean;                    // default true
  pauseAfterHeadingMs: number;                  // default 600
  pauseBetweenSentencesMs: number;              // default 0: added at a full stop (ADR-31)
  pauseBetweenParagraphsMs: number;             // default 700 (ADR-31); all pauses are divided by the speed
  keepAwake: boolean;                           // default true
  pauseOnFlag: boolean;                         // default false on desktop, true on touch devices
  fontSizePx: number;                           // default 18
  theme: 'auto' | 'light' | 'dark';             // default 'auto'
  ai: AiSettings;                               // default { provider: null, models: {} }
}

export interface ExportBundleV1 {
  version: 1;
  exportedAt: string;
  docs: Array<{
    id: string; title: string; format: DocFormat; sourceName: string;
    sourceHash: string; charCount: number;
    position?: PositionRecord; flags: Flag[]; notes?: Note[]; // notes: ADR-30
  }>;
  settings?: Partial<Omit<Settings, 'azure'>>;   // never export the Azure key
}
