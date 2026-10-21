// How the text being read looks (ADR-33): font, size and line spacing, in Settings and in the
// reader's Aa panel. System fonts only, so nothing is downloaded.
import type { ReaderFont, Settings } from '../../core/types';
import { useServices, useSettings } from '../services';

export const READER_FONTS: Record<ReaderFont, { label: string; stack: string }> = {
  serif: { label: 'Book (serif)', stack: 'var(--serif)' },
  sans: { label: 'Clean (sans-serif)', stack: 'var(--ui)' },
  wide: { label: 'Wide and clear', stack: "Verdana, 'Segoe UI', 'Noto Sans', sans-serif" },
  mono: { label: 'Typewriter: every letter the same width, for spotting typos', stack: "Consolas, 'Roboto Mono', 'Noto Sans Mono', monospace" },
};

export function TextControls() {
  const s = useSettings();
  const services = useServices();
  const update = (p: Partial<Settings>) => void services.updateSettings(p);
  return (
    <>
      <label class="field">
        Font
        <select value={s.readerFont} onChange={(e) => update({ readerFont: e.currentTarget.value as ReaderFont })}>
          {(Object.keys(READER_FONTS) as ReaderFont[]).map((f) => (
            <option key={f} value={f}>
              {READER_FONTS[f].label}
            </option>
          ))}
        </select>
      </label>
      <label class="field">
        Text size <strong>{s.fontSizePx}px</strong>
        <input type="range" min={14} max={30} step={1} value={s.fontSizePx} onInput={(e) => update({ fontSizePx: Number(e.currentTarget.value) })} />
      </label>
      <label class="field">
        Line spacing <strong>{s.lineSpacing.toFixed(1)}</strong>
        <input type="range" min={1.2} max={2.4} step={0.1} value={s.lineSpacing} onInput={(e) => update({ lineSpacing: Number(e.currentTarget.value) })} />
      </label>
      <p class="font-preview">Sphinx of black quartz, judge my vow. Is that 1, l or I? 0 or O?</p>
    </>
  );
}
