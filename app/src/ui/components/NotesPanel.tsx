// The reader's own notes, in reading order, and notes.md (spec 17.6).
import type { DocIndex } from '../../core/model';
import type { PageIndex } from '../../core/text/pages';
import type { DocRecord, Note } from '../../core/types';
import { isPlaced, notesFileName, notesMarkdown, sortNotes } from '../../core/notes/notes';
import { downloadText } from '../services';
import { Reply, type CiteHelpers } from './Reply';

interface Props {
  doc: DocRecord;
  index: DocIndex;
  pages: PageIndex;
  notes: Note[];
  currentId: string | undefined;
  cite: CiteHelpers;
  onNew: () => void;
  onJump: (sentenceId: string) => void;
  onEdit: (note: Note) => void;
  onDelete: (note: Note) => void;
}

export function NotesPanel({ doc, index, pages, notes, currentId, cite, onNew, onJump, onEdit, onDelete }: Props) {
  const shown = sortNotes(notes, index);
  const pageOf = (id: string) => pages.ofSentence(id)?.label;
  return (
    <section class="notes-panel" aria-label="Notes">
      <div class="panel-head">
        <strong>
          {notes.length} note{notes.length === 1 ? '' : 's'}
        </strong>
        <button onClick={onNew}>✎ Note here</button>
        <button class="primary" disabled={notes.length === 0} onClick={() => downloadText(notesFileName(doc), notesMarkdown(doc, notes, { pageOf }), 'text/markdown')}>
          Export notes.md
        </button>
      </div>
      {shown.length === 0 && (
        <p class="hint">
          Press M, or ✎ Note below, to write a note on the sentence being read. Use a pen, a finger or the mouse to draw. Notes stay on this
          device and are never sent to the AI.
        </p>
      )}
      <ol class="flags notes">
        {shown.map((n) => {
          const placed = isPlaced(n, index);
          const page = placed ? pageOf(n.sentenceId) : undefined;
          return (
            <li key={n.id} class={`flag note${n.sentenceId === currentId ? ' here' : ''}`}>
              <div class="flag-where">
                {n.chapterTitle || `Chapter ${n.chapterIndex + 1}`} · Paragraph {n.paragraphInChapter}
                {page ? ` · page ${page}` : ''}
                {n.source === 'ai' && <span class="badge" title="Saved from the AI assistant">AI</span>}
                <span class="spacer" />
                {placed ? (
                  <button class="link" onClick={() => onJump(n.sentenceId)} title="Go to this sentence">
                    Go to
                  </button>
                ) : (
                  <span class="hint" title="The text has changed and this sentence is no longer in it">
                    (place not found)
                  </span>
                )}
              </div>
              <blockquote class="quote note-quote">{n.quote}</blockquote>
              {n.text && <Reply text={n.text} cite={cite} />}
              {n.sketch && <img class="sketch" src={n.sketch} alt="Drawing" />}
              <div class="flag-actions">
                <button class="link" onClick={() => onEdit(n)}>
                  Edit
                </button>
                <button class="link danger" onClick={() => confirm('Delete this note?') && onDelete(n)}>
                  Delete
                </button>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
