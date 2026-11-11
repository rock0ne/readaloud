import type { Settings } from '../../core/types';

export type ReadingLayout = 'scroll' | 'single' | 'spread';
export const readingLayout = (s: Pick<Settings, 'layout' | 'twoPages'>): ReadingLayout =>
  s.layout === 'scroll' ? 'scroll' : s.twoPages ? 'spread' : 'single';
export const layoutSettings = (choice: ReadingLayout): Pick<Settings, 'layout' | 'twoPages'> =>
  ({ layout: choice === 'scroll' ? 'scroll' : 'pages', twoPages: choice === 'spread' });

export function ReadingLayoutPicker({ value, onChange }: { value: ReadingLayout; onChange: (value: ReadingLayout) => void }) {
  return <label class="reading-layout-picker"><span class="sr-only">Reading layout</span>
    <select aria-label="Reading layout" value={value} onChange={(e) => onChange(e.currentTarget.value as ReadingLayout)}>
      <option value="scroll">Scroll</option>
      <option value="single">One page</option>
      <option value="spread">Two-page spread</option>
    </select>
  </label>;
}
