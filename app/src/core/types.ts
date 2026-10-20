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
  note: string;                // free text, may be ''
  fixedText: string;           // corrected sentence, may be ''
  status: FlagStatus;
  createdAt: string;
  updatedAt: string;
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
  schemaVersion: 1;
  enginePreference: EngineId[];                 // default ['webspeech', 'azure', 'kokoro']
  voiceByEngine: Partial<Record<EngineId, string>>;
  rate: number;                                 // default 1.0
  locale: string;                               // default 'en-GB'
  azure: { region: string; key: string } | null;
  skipCodeBlocks: boolean;                      // default true
  announceHeadings: boolean;                    // default true
  pauseAfterHeadingMs: number;                  // default 600
  pauseBetweenSentencesMs: number;              // default 150 (direct engines only)
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
