import { useEffect, useState } from 'preact/hooks';
import type { DocRecord } from '../../core/types';
import { DRAFT_PARAGRAPH_LIMIT, draftFileName, draftMarkdown, draftText } from '../../core/text/draft';
import { downloadText } from '../services';
import { guardNavigation } from '../routes';

interface Props {
  doc: DocRecord;
  currentBlockId: string | undefined;
  onCreate: () => Promise<void>;
  onSave: (blockId: string, text: string, undo: boolean, listen: boolean) => Promise<DocRecord>;
  onRestore: () => Promise<void>;
  onDirty: (dirty: boolean) => void;
}

export function DraftPanel({ doc, currentBlockId, onCreate, onSave, onRestore, onDirty }: Props) {
  const [allowed, setAllowed] = useState(false);
  const [blockId, setBlockId] = useState(currentBlockId ?? doc.blocks[0]?.id ?? '');
  const block = doc.blocks.find((b) => b.id === blockId);
  const [text, setText] = useState(block?.text ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dirty = !!doc.draft && text !== (block?.text ?? '');
  useEffect(() => { onDirty(dirty || busy); return () => onDirty(false); }, [dirty, busy, onDirty]);
  useEffect(() => {
    if (!dirty && !busy) return;
    const unload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    addEventListener('beforeunload', unload);
    const unguard = guardNavigation(() => busy ? false : confirm('Discard your unsaved paragraph edit and leave this book?'));
    return () => { removeEventListener('beforeunload', unload); unguard(); };
  }, [dirty, busy, doc.draft]);

  const perform = async (undo = false, listen = false) => {
    if (busy) return;
    if (undo && dirty && !confirm('Discard the unsaved text and undo the last saved edit?')) return;
    setBusy(true); setError('');
    try {
      const saved = await onSave(blockId, text, undo, listen);
      const id = undo ? doc.draft?.edits.at(-1)?.blockId ?? blockId : blockId;
      setBlockId(id); setText(saved.blocks.find((b) => b.id === id)?.text ?? '');
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const create = async () => {
    if (!allowed || busy) return;
    setBusy(true); setError('');
    try { await onCreate(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const chooseCurrent = () => {
    if (dirty && !confirm('Discard the unsaved paragraph edit?')) return;
    const b = doc.blocks.find((b) => b.id === currentBlockId);
    if (b) { setBlockId(b.id); setText(b.text); setError(''); }
  };
  const restore = async () => {
    if (busy || !confirm('Restore this document to its original imported text? All saved paragraph edits will be removed. Export the edited text first if you want to keep it.')) return;
    setBusy(true); setError('');
    try { await onRestore(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  return <section class="draft-panel" aria-label="Edit reading draft">
    <h2>Edit draft</h2>
    {!doc.draft ? <>
      <p>Edit this document directly in ReadAloud, then listen to the revision. A recovery copy of the original import is kept behind the scenes. Your library entry stays the same; no extra book is created.</p>
      <label class="check"><input type="checkbox" checked={allowed} disabled={busy} onChange={(e) => setAllowed(e.currentTarget.checked)} /> I own this text or have permission to edit it.</label>
      <p class="hint">This does not unlock protected books or remove DRM. Changes apply to this app's reading text, not automatically to the EPUB or Word file on disk.</p>
      <button class="primary" disabled={!allowed || busy} onClick={() => void create()}>{busy ? 'Keeping recovery copy…' : 'Enable editing this document'}</button>
    </> : <>
      <p class="hint">Editing this document · revision {doc.draft.revision}. Changes stay on this device. The original import is retained for recovery.</p>
      <p>Click a sentence in the book, then choose <strong>Edit selected paragraph</strong>. The box edits one paragraph or heading, not the whole chapter.</p>
      <button disabled={busy || !currentBlockId} onClick={chooseCurrent}>Edit selected paragraph</button>
      <label class="draft-text-label">{doc.chapters.find((c) => c.index === block?.chapterIndex)?.title ?? 'Draft'} · {block?.type === 'heading' ? 'Heading' : `Paragraph ${(block?.index ?? 0) + 1}`}
        <textarea aria-label="Draft paragraph text" rows={10} value={text} maxLength={DRAFT_PARAGRAPH_LIMIT} disabled={busy}
          onInput={(e) => setText(e.currentTarget.value)} />
      </label>
      <p class="hint" role="status">{busy ? 'Saving / loading revision…' : dirty ? 'Unsaved changes' : 'Saved text'} · Plain text only. Line breaks stay inside this paragraph. Empty-paragraph deletion and publication layout editing are not supported.</p>
      <div class="draft-actions">
        <button disabled={busy || !dirty || !text.trim()} onClick={() => void perform()}>Save changes</button>
        <button class="primary" disabled={busy || !text.trim()} onClick={() => void perform(false, true)}>Save &amp; listen from here</button>
        <button disabled={busy || !dirty} onClick={() => { if (confirm('Discard the unsaved paragraph edit?')) setText(block?.text ?? ''); }}>Discard unsaved edit</button>
        <button disabled={busy || !doc.draft.edits.length} onClick={() => void perform(true)}>Undo last saved edit</button>
      </div>
      <p class="hint">Save &amp; listen uses live speech from this paragraph onward. Changed passages never use the old recording. Unchanged saved clips are reused; Audiobook studio can prepare missing clips. Existing downloaded audio files do not change.</p>
      <h3>Keep a copy outside ReadAloud</h3>
      <div class="draft-actions">
        <button disabled={busy || dirty} onClick={() => downloadText(draftFileName(doc, 'txt'), draftText(doc))}>Export edited TXT</button>
        <button disabled={busy || dirty} onClick={() => downloadText(draftFileName(doc, 'md'), draftMarkdown(doc), 'text/markdown')}>Export edited Markdown</button>
      </div>
      <p class="hint">Export after saving. These are reading-text exports, not a rebuilt EPUB or Word file. Original images, layout and all metadata are not preserved. Library settings/notes backup is not a draft-text backup.</p>
      <details><summary>{doc.draft.edits.length} saved edits available to undo (last 50)</summary>
        <ol>{[...doc.draft.edits].reverse().map((e, i) => <li key={`${e.at}-${i}`}>Paragraph {doc.blocks.findIndex((b) => b.id === e.blockId) + 1} · {new Date(e.at).toLocaleString()}</li>)}</ol>
      </details>
      <button class="link" disabled={busy || dirty} onClick={() => void restore()}>Restore original imported document</button>
    </>}
    {error && <p class="error" role="alert">{error}</p>}
  </section>;
}
