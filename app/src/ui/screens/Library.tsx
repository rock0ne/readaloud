import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { ACCEPT, IngestError, parseBytes } from '../../core/ingest';
import { correctionsFileName, correctionsMarkdown } from '../../core/flags/corrections';
import { DuplicateDocumentError } from '../../core/store/repo';
import { sha256Hex } from '../../core/util/hash';
import type { DocSummary, PositionRecord } from '../../core/types';
import { DataTransfer } from '../components/DataTransfer';
import { PasteText } from '../components/PasteText';
import { downloadText, navigate, toast, useServices, useSettings } from '../services';
import { readHref } from '../routes';

interface Busy {
  name: string;
  done: number;
  total: number;
}

function when(iso?: string): string {
  if (!iso) return 'never';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export function Library() {
  const { repo } = useServices();
  const settings = useSettings();
  const [docs, setDocs] = useState<DocSummary[] | null>(null);
  const [positions, setPositions] = useState<Map<string, PositionRecord>>(new Map());
  const [busy, setBusy] = useState<Busy | null>(null);
  const [dragging, setDragging] = useState(false);
  /** text for the Paste dialog; null while it is closed */
  const [pasting, setPasting] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    const [list, pos] = await Promise.all([repo.listSummaries(), repo.listPositions()]);
    setDocs(list);
    setPositions(new Map(pos.map((p) => [p.docId, p])));
  }, [repo]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Ctrl+V anywhere in the library opens the Paste dialog with that text.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (pasting !== null || target?.closest('input, textarea, [contenteditable]')) return;
      const text = e.clipboardData?.getData('text/plain') ?? '';
      if (!text.trim()) return;
      e.preventDefault();
      setPasting(text);
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [pasting]);

  const addFiles = async (files: File[]) => {
    let lastAdded: string | null = null;
    for (const file of files) {
      setBusy({ name: file.name, done: 0, total: 0 });
      try {
        const bytes = await file.arrayBuffer();
        const hash = await sha256Hex(bytes);
        const existing = await repo.findByHash(hash);
        if (existing) throw new DuplicateDocumentError(existing.id);
        const parsed = await parseBytes(bytes, file.name, {
          locale: settings.locale,
          onProgress: (done, total) => setBusy({ name: file.name, done, total }),
        });
        const doc = await repo.addDocument(parsed, bytes, file.name, hash);
        lastAdded = doc.id;
        toast(`Added “${doc.title}”.`);
        for (const w of doc.warnings.slice(0, 3)) toast(w);
      } catch (e) {
        if (e instanceof DuplicateDocumentError) {
          toast(`${file.name} is already in the library.`);
          if (files.length === 1) navigate(readHref(e.existingId));
        } else if (e instanceof IngestError) {
          toast(e.message, 'error');
        } else {
          toast(`Could not read ${file.name}: ${(e as Error).message}`, 'error');
        }
      }
    }
    setBusy(null);
    await refresh();
    if (files.length === 1 && lastAdded) navigate(readHref(lastAdded));
  };

  const exportCorrections = async (id: string) => {
    const doc = await repo.getDocument(id);
    if (!doc) return;
    const flags = await repo.listFlags(id);
    if (flags.length === 0) return toast('No flags in this document yet.');
    downloadText(correctionsFileName(doc), correctionsMarkdown(doc, flags), 'text/markdown');
  };

  const reparse = async (id: string) => {
    const doc = await repo.getDocument(id);
    const bytes = await repo.getSource(id);
    if (!doc || !bytes) return toast('The original file is not stored, so it cannot be re-read.', 'error');
    setBusy({ name: doc.sourceName, done: 0, total: 0 });
    try {
      const parsed = await parseBytes(bytes, doc.sourceName, { locale: settings.locale });
      const lost = await repo.replaceParsed(id, parsed);
      toast(lost.length ? `Re-read. ${lost.length} flags no longer match the text; export corrections first if you need them.` : 'Re-read with the current parser.');
    } catch (e) {
      toast((e as Error).message, 'error');
    }
    setBusy(null);
    await refresh();
  };

  const remove = async (d: DocSummary) => {
    if (!confirm(`Remove “${d.title}” and its flags from this device?`)) return;
    await repo.deleteDocument(d.id);
    await refresh();
  };

  return (
    <main
      class={`library${dragging ? ' dragging' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.target === e.currentTarget) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const files = Array.from(e.dataTransfer?.files ?? []);
        if (files.length) void addFiles(files);
      }}
    >
      <header class="bar">
        <h1>ReadAloud</h1>
        <div class="spacer" />
        <button class="primary" onClick={() => input.current?.click()} disabled={busy !== null}>
          Add files
        </button>
        <button onClick={() => setPasting('')} disabled={busy !== null}>
          Paste text
        </button>
        <a class="button" href="#/settings">
          Settings
        </a>
      </header>
      <input
        ref={input}
        type="file"
        multiple
        accept={ACCEPT}
        hidden
        onChange={(e) => {
          const files = Array.from(e.currentTarget.files ?? []);
          e.currentTarget.value = '';
          if (files.length) void addFiles(files);
        }}
      />

      {pasting !== null && (
        <PasteText
          initial={pasting}
          onClose={() => setPasting(null)}
          onAdd={(file) => {
            setPasting(null);
            void addFiles([file]);
          }}
        />
      )}

      {busy && (
        <div class="busy" role="status">
          Reading {busy.name}
          {busy.total > 0 ? ` (part ${busy.done} of ${busy.total})` : '…'}
          <progress max={busy.total || undefined} value={busy.total ? busy.done : undefined} />
        </div>
      )}

      {docs === null ? null : docs.length === 0 ? (
        <section class="empty">
          <h2>Add a document to start listening</h2>
          <p>Drop a .txt, .md, .docx, .pdf or .epub file here, use Add files, or Paste text.</p>
          <p class="hint">For proofreading a book, the Word (.docx) or Markdown manuscript reads more accurately than a PDF.</p>
        </section>
      ) : (
        <ul class="doc-list">
          {docs.map((d) => {
            const pos = positions.get(d.id);
            const pct = pos?.ordinal !== undefined && d.sentenceCount > 0 ? Math.round(((pos.ordinal + 1) / d.sentenceCount) * 100) : 0;
            return (
              <li key={d.id} class="doc">
                <a class="doc-main" href={readHref(d.id)}>
                  <span class="doc-title">{d.title}</span>
                  <span class="doc-meta">
                    <span class={`badge badge-${d.format}`}>{d.format}</span>
                    {pct}% · opened {when(d.lastOpenedAt)}
                  </span>
                  <span class="progress" style={{ '--pct': `${pct}%` }} />
                </a>
                <div class="doc-actions">
                  <button onClick={() => exportCorrections(d.id)} title="Download corrections.md">
                    Corrections
                  </button>
                  <button onClick={() => reparse(d.id)} title="Read the stored file again with the current parser">
                    Re-read
                  </button>
                  <button class="danger" onClick={() => remove(d)}>
                    Delete
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <footer class="bar footer">
        <DataTransfer onImported={refresh} />
        <span class="spacer" />
        <span class="hint">Documents, flags and positions stay on this device.</span>
      </footer>
    </main>
  );
}
