import { useEffect, useRef, useState } from 'preact/hooks';
import type { Flag } from '../../core/types';

interface Props {
  flag: Flag;
  onSave: (note: string) => void;
  onClose: () => void;
}

/** Quick note entry after pressing N (desktop) or Note (phone). */
export function NoteSheet({ flag, onSave, onClose }: Props) {
  const [text, setText] = useState(flag.note);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => ref.current?.focus(), []);
  const save = () => {
    onSave(text);
    onClose();
  };
  return (
    <div class="note-sheet" role="dialog" aria-label="Note for flagged sentence">
      <blockquote class="quote">{flag.quote}</blockquote>
      <textarea
        ref={ref}
        rows={3}
        value={text}
        placeholder="What is wrong here? (Ctrl+Enter to save)"
        onInput={(e) => setText(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            save();
          }
          if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
          }
        }}
      />
      <div class="sheet-actions">
        <button onClick={onClose}>Cancel</button>
        <button class="primary" onClick={save}>
          Save note
        </button>
      </div>
    </div>
  );
}
