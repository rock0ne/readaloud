// Settings defaults (spec 4). `touch` decides pauseOnFlag's default.
import type { Settings } from '../types';

export function defaultSettings(touch = false): Settings {
  return {
    schemaVersion: 1,
    enginePreference: ['webspeech', 'azure', 'kokoro'],
    voiceByEngine: {},
    rate: 1.0,
    locale: 'en-GB',
    azure: null,
    skipCodeBlocks: true,
    announceHeadings: true,
    pauseAfterHeadingMs: 600,
    pauseBetweenSentencesMs: 150,
    keepAwake: true,
    pauseOnFlag: touch,
    fontSizePx: 18,
    theme: 'auto',
  };
}

export function withDefaults(saved: Partial<Settings> | undefined, touch = false): Settings {
  const d = defaultSettings(touch);
  if (!saved) return d;
  return { ...d, ...saved, voiceByEngine: { ...d.voiceByEngine, ...(saved.voiceByEngine ?? {}) } };
}

export const RATE_MIN = 0.8;
export const RATE_MAX = 3.0;

export function clampRate(r: number): number {
  return Math.round(Math.min(RATE_MAX, Math.max(RATE_MIN, r)) * 10) / 10;
}
