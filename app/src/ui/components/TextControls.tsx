// How the text being read looks (ADR-33) and is laid out (ADR-35), in Settings and in the
// reader's Aa panel. System fonts only, so nothing is downloaded.
import type { ReaderFont, Settings } from '../../core/types';
import { useServices, useSettings } from '../services';
import { ReadingLayoutPicker, readingLayout, layoutSettings } from './ReadingLayout';

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
      <fieldset class="reader-tone-picker">
        <legend>Reading colour</legend>
        {(['system', 'paper', 'sepia', 'night'] as const).map((tone) => <label class={`tone-swatch tone-${tone}`} key={tone}>
          <input type="radio" name="reader-tone" checked={s.readerTone === tone} onChange={() => update({ readerTone: tone })} />
          <span>Aa</span><small>{tone === 'system' ? 'System' : tone === 'paper' ? 'Paper' : tone === 'sepia' ? 'Sepia' : 'Night'}</small>
        </label>)}
      </fieldset>
      <div class="field">
        <span>Reading layout</span>
        <ReadingLayoutPicker value={readingLayout(s)} onChange={(choice) => update(layoutSettings(choice))} />
        <p class="hint">Two-page spread shows consecutive pages, so you can read ahead while listening. Narrow screens use one page without forgetting your choice.</p>
      </div>
      <div class="field">
        <span>Listening scope</span>
        <p class="hint">Use Read beside the main Play button to choose Whole book, This chapter only or This page only. Whole book reads continuously across pages and chapters in every visual layout. Selecting a page/chapter starts at its beginning when you press Play.</p>
      </div>
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
