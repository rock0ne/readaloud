import type { PlayerState } from '../../core/types';

export function ReadRangePicker({ value, onChange }: { value: PlayerState['readerRange']; onChange: (kind: PlayerState['readerRange']) => void }) {
  return <label class="read-range"><span>Read</span>
    <select aria-label="Read scope" title="Select a scope, then press Play. Page/chapter start at their beginning. Whole book continues from your position." value={value} onChange={(e) => onChange(e.currentTarget.value as PlayerState['readerRange'])}>
      <option value="book">Whole book</option>
      <option value="chapter">This chapter only</option>
      <option value="page">This page only</option>
    </select>
  </label>;
}

export function ReadRangeNotice({ kind, onBook }: { kind: 'page' | 'chapter'; onBook: () => void }) {
  return <section class="read-range-notice" role="status"><span>Finished this {kind}. Play repeats it; whole-book reading continues onward.</span>
    <button onClick={onBook}>Continue whole book</button></section>;
}
