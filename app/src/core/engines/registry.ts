// Engine registry and neural-first selection (spec 7.1, ADR-13).
import type { EngineId, Settings, Voice, VoiceEngine } from '../types';

export interface Pick {
  engine: VoiceEngine;
  voice: Voice;
  /** true when no natural voice was available anywhere */
  basicFallback: boolean;
}

export class EngineRegistry {
  private readonly engines = new Map<EngineId, VoiceEngine>();
  private voiceCache = new Map<EngineId, Voice[]>();

  constructor(engines: VoiceEngine[]) {
    for (const e of engines) this.engines.set(e.id, e);
  }

  get(id: EngineId): VoiceEngine | undefined {
    return this.engines.get(id);
  }

  all(): VoiceEngine[] {
    return [...this.engines.values()];
  }

  invalidate(): void {
    this.voiceCache = new Map();
  }

  async voices(id: EngineId): Promise<Voice[]> {
    const cached = this.voiceCache.get(id);
    if (cached) return cached;
    const e = this.engines.get(id);
    if (!e) return [];
    const avail = await e.isAvailable();
    const list = avail.ok ? await e.listVoices().catch(() => []) : [];
    this.voiceCache.set(id, list);
    return list;
  }

  async pick(settings: Settings): Promise<Pick | null> {
    const order = [...settings.enginePreference, ...[...this.engines.keys()].filter((k) => !settings.enginePreference.includes(k))];
    const candidates: Array<{ engine: VoiceEngine; voices: Voice[] }> = [];
    for (const id of order) {
      const engine = this.engines.get(id);
      if (!engine) continue;
      const voices = await this.voices(id);
      if (voices.length > 0) candidates.push({ engine, voices });
    }
    const lang = settings.locale.split('-')[0]?.toLowerCase() ?? 'en';
    const byLocale = (v: Voice) => v.lang.toLowerCase().startsWith(lang);
    const exactLocale = (v: Voice) => v.lang.toLowerCase() === settings.locale.toLowerCase();

    // 1. Engines in preference order: the voice the user chose explicitly on that engine (only
    //    explicit picks are saved, and they move their engine first), else its best natural voice.
    //    A saved voice on a later engine does not outrank an earlier engine (ADR-22).
    for (const c of candidates) {
      const saved = settings.voiceByEngine[c.engine.id];
      const v = saved ? c.voices.find((x) => x.id === saved) : undefined;
      if (v) return { engine: c.engine, voice: v, basicFallback: v.quality !== 'neural' && !(await this.anyNeural(candidates)) };
      const neural = c.voices.filter((v) => v.quality === 'neural');
      const best = neural.find(exactLocale) ?? neural.find(byLocale) ?? neural[0];
      if (best) return { engine: c.engine, voice: best, basicFallback: false };
    }
    // 2. Fallback pass: Basic voices only when nothing natural exists.
    for (const c of candidates) {
      const v = c.voices.find(exactLocale) ?? c.voices.find(byLocale) ?? c.voices[0];
      if (v) return { engine: c.engine, voice: v, basicFallback: true };
    }
    return null;
  }

  private async anyNeural(cands: Array<{ voices: Voice[] }>): Promise<boolean> {
    return cands.some((c) => c.voices.some((v) => v.quality === 'neural'));
  }
}
