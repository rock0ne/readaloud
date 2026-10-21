// Writing a note on a sentence (M or ✎ Note), with an optional drawing pad for a pen (spec 17.6).
import { useEffect, useRef, useState } from 'preact/hooks';
import { InkPad } from './InkPad';

interface Props {
  quote: string;
  place: string;
  text?: string;
  sketch?: string | undefined;
  onSave: (text: string, sketch: string | undefined) => void;
  onClose: () => void;
}

export function NoteEditor({ quote, place, text: initial = '', sketch: initialSketch, onSave, onClose }: Props) {
  const [text, setText] = useState(initial);
  const [sketch, setSketch] = useState(initialSketch);
  const [drawing, setDrawing] = useState(Boolean(initialSketch));
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => ref.current?.focus(), []);
  const empty = !text.trim() && !sketch;
  const save = () => {
    if (empty) return;
    onSave(text.trim(), sketch);
    onClose();
  };
  return (
    <div
      class="note-sheet note-editor"
      role="dialog"
      aria-label="Write a note"
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
    >
      <div class="hint">{place}</div>
      <blockquote class="quote note-quote">{quote}</blockquote>
      <textarea
        ref={ref}
        rows={4}
        value={text}
        placeholder="Your note (Ctrl+Enter to save). On Windows you can write in this box with a pen."
        onInput={(e) => setText(e.currentTarget.value)}
      />
      {drawing ? (
        <InkPad value={sketch} onChange={setSketch} />
      ) : (
        <button class="link" onClick={() => setDrawing(true)}>
          ✍ Add a drawing
        </button>
      )}
      <p class="hint">Notes stay on this device and are never sent to the AI.</p>
      <div class="sheet-actions">
        <button onClick={onClose}>Cancel</button>
        <button class="primary" disabled={empty} onClick={save}>
          Save note
        </button>
      </div>
    </div>
  );
}
