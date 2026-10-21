// Player state machine and reading loop (spec 8.1, 8.2, 8.5; ADR-14).
import type { EngineId, PlayerEvent, PlayerState, PositionRecord, Sentence, Settings, Voice, VoiceEngine } from '../types';
import type { EngineRegistry } from '../engines/registry';
import { DocIndex } from '../model';
import type { DocRecord } from '../types';
import { clampRate } from '../store/settings';
import { sha256Hex } from '../util/hash';

export interface PositionStore {
  savePosition(pos: PositionRecord): Promise<void>;
}

export interface AudioOutput {
  /**
   * Plays an encoded clip at `rate`; resolves when it ends or `signal` aborts. `onProgress`, if
   * given, receives the share of the clip played so far (0..1) while it plays.
   */
  play(blob: Blob, rate: number, signal: AbortSignal, onProgress?: (fraction: number) => void): Promise<void>;
  /** Changes the speed of the clip that is playing now. */
  setRate?(rate: number): void;
}

/** Stored clips for audio engines (spec 8.4). The Repo implements it. */
export interface AudioCache {
  getAudio(key: string): Promise<Blob | undefined>;
  putAudio(key: string, blob: Blob): Promise<void>;
  pruneAudio(): Promise<number>;
}

export interface PlayerDeps {
  positions: PositionStore;
  registry: EngineRegistry;
  settings: () => Settings;
  /** Persist a changed engine/voice choice (explicit user pick). */
  saveVoiceChoice?: (engineId: EngineId, voiceId: string) => Promise<void>;
  audio?: AudioOutput;
  audioCache?: AudioCache;
  now?: () => number;
}

export const RETRY_DELAY_MS = 500;
export const POSITION_DEBOUNCE_MS = 1000;
export const PREV_RESTART_MS = 3000;
export const STOPPED_MESSAGE = 'Speech stopped at this sentence. Press Play to try again.';
/** Audio engines: chunks prepared ahead of the one playing, at least (spec 8.3). */
export const PREFETCH_CHUNKS = 3;
/**
 * ...and at least this much text, about 40 s of speech: on the phone Kokoro makes speech only a
 * little faster than it plays, so a long sentence after short ones must be started early (ADR-28).
 */
export const PREFETCH_CHARS = 600;
/** Never more chunks ahead than this. */
export const PREFETCH_MAX_CHUNKS = 12;
/** Finished clips kept in memory for replay and previous. */
export const KEEP_CLIPS = 8;
const PRUNE_EVERY_PUTS = 50;
/** Audio engines: sentences of this many words or fewer are made together with a neighbour. */
export const SHORT_SENTENCE_WORDS = 2;
/** Longest joined text; stays under Kokoro's split limit (KOKORO_MAX_CHARS). */
export const UNIT_MAX_CHARS = 300;

/** Consecutive sentences of one block made as one clip; `starts` are character offsets in `text`. */
interface Unit {
  first: number;
  count: number;
  text: string;
  starts: number[];
}

interface Clip {
  promise: Promise<Blob>;
  controller: AbortController;
  ready: boolean;
}

function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted || ms <= 0) return resolve();
    const t = setTimeout(done, ms);
    function done() {
      clearTimeout(t);
      signal.removeEventListener('abort', done);
      resolve();
    }
    signal.addEventListener('abort', done);
  });
}

/** Waits for `p`, or resolves with undefined as soon as `signal` aborts (leaving `p` running). */
function untilAborted<T>(p: Promise<T>, signal: AbortSignal): Promise<T | undefined> {
  if (signal.aborted) return Promise.resolve(undefined);
  return new Promise((resolve, reject) => {
    const onAbort = () => resolve(undefined);
    signal.addEventListener('abort', onAbort, { once: true });
    p.then(
      (v) => {
        signal.removeEventListener('abort', onAbort);
        resolve(v);
      },
      (e: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(e);
      },
    );
  });
}

export class Player {
  private index: DocIndex | null = null;
  private doc: DocRecord | null = null;
  private pos = 0;
  private sentenceStartedAt = 0;
  private controller: AbortController | null = null;
  private loop: Promise<void> = Promise.resolve();
  /** play() waiting for the voice to be chosen; startGen cancels it (ADR-23). */
  private starting: Promise<void> | null = null;
  private startGen = 0;
  private listeners = new Set<(e: PlayerEvent) => void>();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private engine: VoiceEngine | null = null;
  private voice: Voice | null = null;
  /** Audio-engine clips by chunk text, oldest first; all for `clipOwner` (engine|voice). */
  private clips = new Map<string, Clip>();
  private clipOwner = '';
  private cachePuts = 0;
  private _state: PlayerState;
  basicFallback = false;
  private readonly deps: PlayerDeps;

  constructor(deps: PlayerDeps) {
    this.deps = deps;
    const s = deps.settings();
    this._state = { status: 'idle', rate: clampRate(s.rate), engineId: s.enginePreference[0] ?? 'webspeech' };
  }

  get state(): PlayerState {
    return this._state;
  }

  get currentSentenceId(): string | undefined {
    return this.index?.order[this.pos]?.sentence.id;
  }

  get currentVoice(): Voice | null {
    return this.voice;
  }

  /** Resolves when the current reading loop has exited (tests). */
  get settled(): Promise<void> {
    return this.loop;
  }

  subscribe(fn: (e: PlayerEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(e: PlayerEvent): void {
    for (const fn of this.listeners) fn(e);
  }

  private setState(patch: Partial<PlayerState>): void {
    const next: PlayerState = { ...this._state, ...patch };
    if (!('error' in patch) && patch.status && patch.status !== 'error') delete next.error;
    this._state = next;
    this.emit({ type: 'state', state: next });
  }

  async load(doc: DocRecord, startAt?: string): Promise<void> {
    await this.halt('idle');
    this.flushPosition();
    this.dropClips();
    this.doc = doc;
    this.index = new DocIndex(doc);
    const at = startAt ? this.index.get(startAt) : undefined;
    this.pos = at ? at.ordinal : 0;
    this.setState({ status: 'idle', docId: doc.id, ...(this.currentSentenceId ? { sentenceId: this.currentSentenceId } : {}) });
    if (this.currentSentenceId) this.emit({ type: 'sentence', sentenceId: this.currentSentenceId });
  }

  play(): Promise<void> {
    if (!this.index || this.index.order.length === 0) return Promise.resolve();
    if (this._state.status === 'playing' || this._state.status === 'buffering') return Promise.resolve();
    // One start at a time: Play pressed again while the voice is being chosen joins it (ADR-23).
    this.starting ??= this.start().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  private async start(): Promise<void> {
    const gen = ++this.startGen;
    if (!this.index) return;
    if (this._state.status === 'ended' || this.pos >= this.index.order.length) this.pos = 0;
    if (!this.engine || !this.voice) {
      const pick = await this.deps.registry.pick(this.deps.settings());
      if (gen !== this.startGen) return; // paused, stopped or loaded another document meanwhile
      if (!pick) {
        this.setState({ status: 'error', error: 'No voice is available on this device.' });
        this.emit({ type: 'error', message: 'No voice is available on this device.' });
        return;
      }
      this.engine = pick.engine;
      this.voice = pick.voice;
      this.basicFallback = pick.basicFallback;
      this.setState({ engineId: pick.engine.id, voiceId: pick.voice.id });
    }
    const controller = new AbortController();
    this.controller = controller;
    this.setState({ status: 'playing' });
    this.loop = this.run(controller.signal).catch((e: unknown) => {
      const message = e instanceof Error ? e.message : String(e);
      this.setState({ status: 'error', error: message });
      this.emit({ type: 'error', message });
    });
  }

  pause(): void {
    this.startGen++; // also cancels a start that is still choosing the voice
    if (this._state.status !== 'playing' && this._state.status !== 'buffering') return;
    this.controller?.abort();
    this.setState({ status: 'paused' });
    this.flushPosition();
  }

  resume(): Promise<void> {
    return this.play();
  }

  async toggle(): Promise<void> {
    if (this._state.status === 'playing' || this._state.status === 'buffering') this.pause();
    else await this.play();
  }

  stop(): void {
    this.startGen++;
    this.controller?.abort();
    this.dropClips();
    this.setState({ status: 'idle' });
    this.flushPosition();
  }

  next(): void {
    this.moveTo(this.pos + 1);
  }

  prev(): void {
    const now = this.deps.now?.() ?? Date.now();
    const playing = this._state.status === 'playing';
    if (playing && now - this.sentenceStartedAt > PREV_RESTART_MS) this.moveTo(this.pos);
    else this.moveTo(this.pos - 1);
  }

  replay(): void {
    this.moveTo(this.pos);
  }

  seek(sentenceId: string): void {
    const at = this.index?.get(sentenceId);
    if (at) this.moveTo(at.ordinal);
  }

  setRate(r: number): void {
    const rate = clampRate(r);
    this.setState({ rate });
    this.deps.audio?.setRate?.(rate);
  }

  async setVoice(engineId: EngineId, voiceId: string): Promise<void> {
    const engine = this.deps.registry.get(engineId);
    const voice = (await this.deps.registry.voices(engineId)).find((v) => v.id === voiceId);
    if (!engine || !voice) return;
    const wasPlaying = this._state.status === 'playing' || this._state.status === 'buffering';
    await this.halt('paused');
    this.engine = engine;
    this.voice = voice;
    this.basicFallback = false;
    this.setState({ engineId, voiceId });
    await this.deps.saveVoiceChoice?.(engineId, voiceId);
    if (wasPlaying) await this.play();
  }

  /** Forget the chosen engine so the next play() re-picks (e.g. after going offline). */
  resetVoice(): void {
    this.engine = null;
    this.voice = null;
  }

  private moveTo(target: number): void {
    if (!this.index) return;
    const clamped = Math.max(0, Math.min(this.index.order.length - 1, target));
    const wasPlaying = this._state.status === 'playing' || this._state.status === 'buffering';
    if (wasPlaying) this.controller?.abort();
    this.pos = clamped;
    const id = this.currentSentenceId;
    if (id) {
      this.setState({ sentenceId: id, ...(wasPlaying ? {} : { status: this._state.status === 'ended' ? 'paused' : this._state.status }) });
      this.emit({ type: 'sentence', sentenceId: id });
      this.schedulePosition();
    }
    if (wasPlaying) {
      this.setState({ status: 'paused' });
      void this.loop.then(() => this.play());
    }
  }

  private async halt(status: 'idle' | 'paused'): Promise<void> {
    this.startGen++;
    const running = this._state.status === 'playing' || this._state.status === 'buffering';
    this.controller?.abort();
    if (running) this.setState({ status });
    await this.loop;
  }

  private async run(signal: AbortSignal): Promise<void> {
    const index = this.index;
    const engine = this.engine;
    const voice = this.voice;
    if (!index || !engine || !voice) return;

    while (!signal.aborted) {
      const item = index.order[this.pos];
      if (!item) {
        // Stay on the last sentence so the saved position and highlight are meaningful.
        this.pos = Math.max(0, index.order.length - 1);
        this.setState({ status: 'ended' });
        this.emit({ type: 'ended' });
        this.flushPosition();
        return;
      }
      const settings = this.deps.settings();
      const { sentence, block } = item;
      this.sentenceStartedAt = this.deps.now?.() ?? Date.now();
      this.setState({ sentenceId: sentence.id });
      this.emit({ type: 'sentence', sentenceId: sentence.id });
      this.schedulePosition();

      const skip = (block.type === 'code' && settings.skipCodeBlocks) || sentence.chunks.length === 0;
      if (!skip) {
        const isHeading = block.type === 'heading' && settings.announceHeadings;
        if (isHeading && sentence.index === 0) await abortableSleep(settings.pauseAfterHeadingMs / 2, signal);
        if (signal.aborted) return;
        const unit = engine.kind === 'audio' ? this.unitAt(this.pos) : null;
        const pieces = unit ? [unit.text] : sentence.chunks;
        for (const [c, chunk] of pieces.entries()) {
          const ahead = engine.kind === 'audio' ? this.upcoming(this.pos, c) : [];
          const follow = unit ? (fraction: number) => this.follow(unit, fraction) : undefined;
          const ok = await this.speakWithRetry(engine, voice, chunk, ahead, signal, follow);
          if (signal.aborted) return;
          if (!ok) {
            // ADR-14: never advance past text that was not confirmed spoken.
            this.setState({ status: 'error', error: STOPPED_MESSAGE });
            this.emit({ type: 'error', message: STOPPED_MESSAGE });
            this.flushPosition();
            return;
          }
        }
        if (unit) this.follow(unit, 1);
        const lastOfBlock = index.order[this.pos]!.sentence.index === block.sentences.length - 1;
        if (isHeading && lastOfBlock) await abortableSleep(settings.pauseAfterHeadingMs, signal);
        else await abortableSleep(settings.pauseBetweenSentencesMs, signal);
        if (signal.aborted) return;
      }
      this.pos++;
    }
  }

  private async speakWithRetry(
    engine: VoiceEngine,
    voice: Voice,
    text: string,
    ahead: string[],
    signal: AbortSignal,
    follow?: (fraction: number) => void,
  ): Promise<boolean> {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (signal.aborted) return true;
      try {
        await this.speakOnce(engine, voice, text, ahead, signal, follow);
        return true;
      } catch (e) {
        if (signal.aborted) return true;
        console.warn('[player] chunk failed', attempt + 1, e);
        if (attempt === 0) await abortableSleep(RETRY_DELAY_MS, signal);
      }
    }
    return false;
  }

  private async speakOnce(
    engine: VoiceEngine,
    voice: Voice,
    text: string,
    ahead: string[],
    signal: AbortSignal,
    follow?: (fraction: number) => void,
  ): Promise<void> {
    const rate = this._state.rate;
    if (engine.kind === 'direct') {
      if (!engine.speak) throw new Error(`${engine.label} cannot speak directly.`);
      await engine.speak(text, { voice, rate: Math.min(rate, engine.maxEngineRate) }, signal);
      return;
    }
    if (!engine.synthesize || !this.deps.audio) throw new Error(`${engine.label} needs an audio output.`);
    this.prefetch(engine, voice, [text, ...ahead]);
    const clip = this.clip(engine, voice, text);
    if (!clip.ready) this.setState({ status: 'buffering' });
    // Pausing stops the wait, not the clip, so Play reuses it.
    const blob = await untilAborted(clip.promise, signal);
    if (!blob || signal.aborted) return;
    this.setState({ status: 'playing' });
    await this.deps.audio.play(blob, this._state.rate, signal, follow);
  }

  /**
   * Audio engines: Kokoro mispronounces a one- or two-word sentence said on its own ("Four." came
   * out as "Thor"), so a short sentence is made in one clip with its neighbour in the same block,
   * and the highlight follows by character share (spec 8.3, ADR-22). A short first sentence joins
   * the next one; short sentences after a sentence join it.
   */
  private unitAt(pos: number): Unit | null {
    const item = this.index?.order[pos];
    if (!item) return null;
    const { block, sentence } = item;
    const single = (s: Sentence | undefined): s is Sentence => s !== undefined && s.chunks.length === 1;
    const short = (s: Sentence | undefined): s is Sentence => single(s) && s.speakText.trim().split(/\s+/).length <= SHORT_SENTENCE_WORDS;
    if (!single(sentence)) return null;
    const members: Sentence[] = [sentence];
    let length = sentence.chunks[0]!.length;
    const add = (s: Sentence): boolean => {
      if (length + 1 + s.chunks[0]!.length > UNIT_MAX_CHARS) return false;
      members.push(s);
      length += 1 + s.chunks[0]!.length;
      return true;
    };
    let k = sentence.index + 1;
    const next = block.sentences[k];
    if (short(sentence) && single(next) && add(next)) k++;
    for (let s = block.sentences[k]; short(s) && add(s); s = block.sentences[++k]);
    if (members.length === 1) return null;
    const starts: number[] = [];
    let at = 0;
    for (const m of members) {
      starts.push(at);
      at += m.chunks[0]!.length + 1;
    }
    return { first: pos, count: members.length, text: members.map((m) => m.chunks[0]!).join(' '), starts };
  }

  /** Moves the highlight through a unit as its clip plays; never backwards. */
  private follow(unit: Unit, fraction: number): void {
    let i = 0;
    for (let j = 1; j < unit.count; j++) if (fraction * unit.text.length >= unit.starts[j]!) i = j;
    const target = unit.first + i;
    if (target <= this.pos) return;
    this.pos = target;
    this.sentenceStartedAt = this.deps.now?.() ?? Date.now();
    const id = this.currentSentenceId;
    if (!id) return;
    this.setState({ sentenceId: id });
    this.emit({ type: 'sentence', sentenceId: id });
    this.schedulePosition();
  }

  /** What an audio engine is given for the sentence at `pos`: its unit's text, or its chunks. */
  private pieces(pos: number): string[] {
    const unit = this.unitAt(pos);
    return unit ? [unit.text] : (this.index?.order[pos]?.sentence.chunks ?? []);
  }

  /** The position after the sentence (or unit) at `pos`. */
  private after(pos: number): number {
    const unit = this.unitAt(pos);
    return unit ? unit.first + unit.count : pos + 1;
  }

  /** The texts to prepare after piece `piece` at sentence `from`, in reading order (audio engines, spec 8.3). */
  private upcoming(from: number, piece: number): string[] {
    const out: string[] = [];
    let chars = 0;
    const enough = () => out.length >= PREFETCH_MAX_CHUNKS || (out.length >= PREFETCH_CHUNKS && chars >= PREFETCH_CHARS);
    const index = this.index;
    if (!index) return out;
    const skipCode = this.deps.settings().skipCodeBlocks;
    let list = this.pieces(from).slice(piece + 1);
    for (let p = from; ; ) {
      for (const text of list) {
        if (enough()) return out;
        out.push(text);
        chars += text.length;
      }
      p = this.after(p);
      const item = index.order[p];
      if (!item) return out;
      list = item.block.type === 'code' && skipCode ? [] : this.pieces(p);
    }
  }

  /** The clip for `text`, started if needed. Clips belong to one engine and voice. */
  private clip(engine: VoiceEngine, voice: Voice, text: string): Clip {
    const owner = `${engine.id}|${voice.id}`;
    if (owner !== this.clipOwner) {
      this.dropClips();
      this.clipOwner = owner;
    }
    const existing = this.clips.get(text);
    if (existing) {
      this.clips.delete(text); // re-insert as newest
      this.clips.set(text, existing);
      return existing;
    }
    const controller = new AbortController();
    const clip: Clip = { controller, ready: false, promise: this.fetchClip(engine, voice, text, controller.signal) };
    clip.promise.then(
      () => void (clip.ready = true),
      () => {
        // A failed clip is made again on retry.
        if (this.clips.get(text) === clip) this.clips.delete(text);
      },
    );
    this.clips.set(text, clip);
    return clip;
  }

  /** Starts clips for `window` and cancels unfinished ones outside it (after a seek). */
  private prefetch(engine: VoiceEngine, voice: Voice, window: string[]): void {
    for (const text of window) this.clip(engine, voice, text);
    const wanted = new Set(window);
    let kept = 0;
    for (const [text, c] of [...this.clips].reverse()) {
      if (wanted.has(text)) continue;
      if (!c.ready) {
        c.controller.abort();
        this.clips.delete(text);
      } else if (++kept > KEEP_CLIPS) this.clips.delete(text);
    }
  }

  private dropClips(): void {
    for (const c of this.clips.values()) c.controller.abort();
    this.clips.clear();
  }

  /** Cache first (spec 8.4), then the engine. */
  private async fetchClip(engine: VoiceEngine, voice: Voice, text: string, signal: AbortSignal): Promise<Blob> {
    if (!engine.synthesize) throw new Error(`${engine.label} cannot make audio.`);
    const cache = this.deps.audioCache;
    const key = `${engine.id}|${voice.id}|1.0|${await sha256Hex(new TextEncoder().encode(text))}`;
    const hit = cache ? await cache.getAudio(key).catch(() => undefined) : undefined;
    if (hit) return hit;
    signal.throwIfAborted();
    const blob = await engine.synthesize(text, { voice, rate: 1.0 }, signal);
    if (cache) {
      void cache
        .putAudio(key, blob)
        .then(() => (++this.cachePuts % PRUNE_EVERY_PUTS === 0 ? cache.pruneAudio() : 0))
        .catch(() => undefined);
    }
    return blob;
  }

  private positionRecord(): PositionRecord | null {
    const id = this.currentSentenceId;
    if (!this.doc || !id) return null;
    return { docId: this.doc.id, sentenceId: id, updatedAt: new Date().toISOString(), ordinal: this.pos };
  }

  private schedulePosition(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      const rec = this.positionRecord();
      if (rec) void this.deps.positions.savePosition(rec);
    }, POSITION_DEBOUNCE_MS);
  }

  flushPosition(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    const rec = this.positionRecord();
    if (rec) void this.deps.positions.savePosition(rec);
  }
}
