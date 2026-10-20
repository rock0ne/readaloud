// Player state machine and reading loop (spec 8.1, 8.2, 8.5; ADR-14).
import type { EngineId, PlayerEvent, PlayerState, PositionRecord, Settings, Voice, VoiceEngine } from '../types';
import type { EngineRegistry } from '../engines/registry';
import { DocIndex } from '../model';
import type { DocRecord } from '../types';
import { clampRate } from '../store/settings';

export interface PositionStore {
  savePosition(pos: PositionRecord): Promise<void>;
}

export interface AudioOutput {
  /** Plays an encoded clip at `rate`; resolves when it ends or `signal` aborts. */
  play(blob: Blob, rate: number, signal: AbortSignal): Promise<void>;
}

export interface PlayerDeps {
  positions: PositionStore;
  registry: EngineRegistry;
  settings: () => Settings;
  /** Persist a changed engine/voice choice (explicit user pick). */
  saveVoiceChoice?: (engineId: EngineId, voiceId: string) => Promise<void>;
  audio?: AudioOutput;
  now?: () => number;
}

export const RETRY_DELAY_MS = 500;
export const POSITION_DEBOUNCE_MS = 1000;
export const PREV_RESTART_MS = 3000;
export const STOPPED_MESSAGE = 'Speech stopped at this sentence. Press Play to try again.';

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

export class Player {
  private index: DocIndex | null = null;
  private doc: DocRecord | null = null;
  private pos = 0;
  private sentenceStartedAt = 0;
  private controller: AbortController | null = null;
  private loop: Promise<void> = Promise.resolve();
  private listeners = new Set<(e: PlayerEvent) => void>();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private engine: VoiceEngine | null = null;
  private voice: Voice | null = null;
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
    this.doc = doc;
    this.index = new DocIndex(doc);
    const at = startAt ? this.index.get(startAt) : undefined;
    this.pos = at ? at.ordinal : 0;
    this.setState({ status: 'idle', docId: doc.id, ...(this.currentSentenceId ? { sentenceId: this.currentSentenceId } : {}) });
    if (this.currentSentenceId) this.emit({ type: 'sentence', sentenceId: this.currentSentenceId });
  }

  async play(): Promise<void> {
    if (!this.index || this.index.order.length === 0) return;
    if (this._state.status === 'playing' || this._state.status === 'buffering') return;
    if (this._state.status === 'ended' || this.pos >= this.index.order.length) this.pos = 0;
    if (!this.engine || !this.voice) {
      const pick = await this.deps.registry.pick(this.deps.settings());
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
    this.controller?.abort();
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
    this.setState({ rate: clampRate(r) });
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
        for (const chunk of sentence.chunks) {
          const ok = await this.speakWithRetry(engine, voice, chunk, signal);
          if (signal.aborted) return;
          if (!ok) {
            // ADR-14: never advance past text that was not confirmed spoken.
            this.setState({ status: 'error', error: STOPPED_MESSAGE });
            this.emit({ type: 'error', message: STOPPED_MESSAGE });
            this.flushPosition();
            return;
          }
        }
        const lastOfBlock = sentence.index === block.sentences.length - 1;
        if (isHeading && lastOfBlock) await abortableSleep(settings.pauseAfterHeadingMs, signal);
        else if (engine.kind === 'direct') await abortableSleep(settings.pauseBetweenSentencesMs, signal);
        if (signal.aborted) return;
      }
      this.pos++;
    }
  }

  private async speakWithRetry(engine: VoiceEngine, voice: Voice, text: string, signal: AbortSignal): Promise<boolean> {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (signal.aborted) return true;
      try {
        await this.speakOnce(engine, voice, text, signal);
        return true;
      } catch (e) {
        if (signal.aborted) return true;
        console.warn('[player] chunk failed', attempt + 1, e);
        if (attempt === 0) await abortableSleep(RETRY_DELAY_MS, signal);
      }
    }
    return false;
  }

  private async speakOnce(engine: VoiceEngine, voice: Voice, text: string, signal: AbortSignal): Promise<void> {
    const rate = this._state.rate;
    if (engine.kind === 'direct') {
      if (!engine.speak) throw new Error(`${engine.label} cannot speak directly.`);
      await engine.speak(text, { voice, rate: Math.min(rate, engine.maxEngineRate) }, signal);
      return;
    }
    if (!engine.synthesize || !this.deps.audio) throw new Error(`${engine.label} needs an audio output.`);
    this.setState({ status: 'buffering' });
    const blob = await engine.synthesize(text, { voice, rate: 1.0 }, signal);
    if (signal.aborted) return;
    this.setState({ status: 'playing' });
    await this.deps.audio.play(blob, rate, signal);
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
