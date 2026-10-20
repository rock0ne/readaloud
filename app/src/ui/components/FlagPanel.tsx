// Flags panel (spec 11.5). Each item keeps a local draft so typing survives re-renders.
import { useEffect, useState } from 'preact/hooks';
import type { DocRecord, Flag, FlagStatus } from '../../core/types';
import { correctionsFileName, correctionsMarkdown, sortFlags } from '../../core/flags/corrections';
import type { DocIndex } from '../../core/model';
import { downloadText } from '../services';

interface Props {
  doc: DocRecord;
  index: DocIndex;
  flags: Flag[];
  currentId: string | undefined;
  onSave: (flag: Flag) => void;
  onDelete: (flag: Flag) => void;
  onJump: (sentenceId: string) => void;
}

function patched(f: Flag, p: Partial<Flag>): Flag | null {
  const changed = Object.entries(p).some(([k, v]) => f[k as keyof Flag] !== v);
  return changed ? { ...f, ...p, updatedAt: new Date().toISOString() } : null;
}

function FlagItem({ flag, here, onSave, onDelete, onJump }: { flag: Flag; here: boolean } & Pick<Props, 'onSave' | 'onDelete' | 'onJump'>) {
  const [note, setNote] = useState(flag.note);
  const [fix, setFix] = useState(flag.fixedText);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    setNote(flag.note);
    setFix(flag.fixedText);
  }, [flag.updatedAt]);
  const save = (p: Partial<Flag>) => {
    const next = patched(flag, p);
    if (next) onSave(next);
  };
  return (
    <li class={`flag status-${flag.status}${here ? ' here' : ''}`}>
      <div class="flag-where">
        {flag.chapterTitle || `Chapter ${flag.chapterIndex + 1}`} · Paragraph {flag.paragraphInChapter}
        <span class="spacer" />
        <button class="link" onClick={() => onJump(flag.sentenceId)} title="Go to this sentence">
          Go to
        </button>
      </div>
      <blockquote class={open ? 'quote open' : 'quote'} onClick={() => setOpen(!open)}>
        {flag.quote}
      </blockquote>
      <label>
        Note
        <textarea rows={2} value={note} onInput={(e) => setNote(e.currentTarget.value)} onBlur={() => save({ note })} />
      </label>
      <label>
        Corrected sentence
        <textarea rows={2} value={fix} placeholder="Optional" onInput={(e) => setFix(e.currentTarget.value)} onBlur={() => save({ fixedText: fix })} />
      </label>
      <div class="flag-actions">
        <select value={flag.status} onChange={(e) => save({ status: e.currentTarget.value as FlagStatus })} aria-label="Status">
          <option value="open">Open</option>
          <option value="fixed">Fixed</option>
          <option value="dismissed">Dismissed</option>
        </select>
        <button class="link danger" onClick={() => confirm('Delete this flag?') && onDelete(flag)}>
          Delete
        </button>
      </div>
    </li>
  );
}

export function FlagPanel({ doc, index, flags, currentId, onSave, onDelete, onJump }: Props) {
  const [includeDismissed, setIncludeDismissed] = useState(false);
  const shown = sortFlags(flags, index).filter((f) => includeDismissed || f.status !== 'dismissed');
  const open = flags.filter((f) => f.status === 'open').length;

  return (
    <section class="flag-panel" aria-label="Flags">
      <div class="panel-head">
        <strong>
          {flags.length} flag{flags.length === 1 ? '' : 's'} · {open} open
        </strong>
        <button
          class="primary"
          disabled={flags.length === 0}
          onClick={() => downloadText(correctionsFileName(doc), correctionsMarkdown(doc, flags, { includeDismissed }), 'text/markdown')}
        >
          Export corrections.md
        </button>
        <label class="check">
          <input type="checkbox" checked={includeDismissed} onChange={(e) => setIncludeDismissed(e.currentTarget.checked)} />
          Include dismissed
        </label>
      </div>
      {shown.length === 0 && <p class="hint">Press F while listening to flag the sentence you just heard. Press N to add a note.</p>}
      <ol class="flags">
        {shown.map((f) => (
          <FlagItem key={f.id} flag={f} here={f.sentenceId === currentId} onSave={onSave} onDelete={onDelete} onJump={onJump} />
        ))}
      </ol>
    </section>
  );
}
