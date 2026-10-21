// Paste text to read (ADR-24). It becomes a plain-text document, like an added .txt file.
import { useState } from 'preact/hooks';
import { pastedTitle } from '../../core/ingest';
import { Dialog } from './Dialog';

interface Props {
  initial?: string;
  onAdd: (file: File) => void;
  onClose: () => void;
}

export function PasteText({ initial = '', onAdd, onClose }: Props) {
  const [text, setText] = useState(initial);
  const [title, setTitle] = useState('');
  const add = () => onAdd(new File([text], `${pastedTitle(text, title)}.txt`, { type: 'text/plain' }));
  return (
    <Dialog
      title="Paste text"
      onClose={onClose}
      actions={
        <>
          <button onClick={onClose}>Cancel</button>
          <button class="primary" onClick={add} disabled={!text.trim()}>
            Add and read
          </button>
        </>
      }
    >
      <label class="field paste-field">
        Text
        <textarea
          rows={10}
          value={text}
          autofocus
          placeholder="Paste here: Ctrl+V on the PC, or long-press and Paste on the phone."
          onInput={(e) => setText(e.currentTarget.value)}
        />
      </label>
      <label class="field paste-field">
        Title (optional)
        <input type="text" value={title} placeholder={text.trim() ? pastedTitle(text, '') : 'The first line is used'} onInput={(e) => setTitle(e.currentTarget.value)} />
      </label>
    </Dialog>
  );
}
