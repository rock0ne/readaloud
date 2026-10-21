// JSON export/import buttons with the two-phase import dialog (spec 9.2, ADR-16).
import { useRef, useState } from 'preact/hooks';
import { applyImport, buildExport, exportFileName, parseBundle, planImport, type ImportPlan, type ImportSummary } from '../../core/store/export';
import type { ExportBundleV1 } from '../../core/types';
import { downloadText, toast, useServices } from '../services';
import { Dialog } from './Dialog';

export function DataTransfer({ onImported }: { onImported?: () => void }) {
  const { repo } = useServices();
  const input = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<{ bundle: ExportBundleV1; plan: ImportPlan; confirm: Set<string> } | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);

  const doExport = async () => {
    const bundle = await buildExport(repo);
    downloadText(exportFileName(), JSON.stringify(bundle, null, 1), 'application/json');
    toast(`Exported positions, flags and notes for ${bundle.docs.length} document${bundle.docs.length === 1 ? '' : 's'}.`);
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const bundle = parseBundle(await file.text());
      const plan = await planImport(bundle, repo);
      if (plan.possible.length === 0) await finish(bundle, plan, []);
      else setPending({ bundle, plan, confirm: new Set() });
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      if (input.current) input.current.value = '';
    }
  };

  const finish = async (bundle: ExportBundleV1, plan: ImportPlan, confirmed: string[]) => {
    setPending(null);
    setSummary(await applyImport(bundle, plan, confirmed, repo));
    onImported?.();
  };

  return (
    <>
      <button onClick={doExport}>Export JSON</button>
      <button onClick={() => input.current?.click()}>Import JSON</button>
      <input ref={input} type="file" accept=".json,application/json" hidden onChange={(e) => onFile(e.currentTarget.files?.[0])} />

      {pending && (
        <Dialog
          title="Confirm possible matches"
          onClose={() => setPending(null)}
          actions={
            <>
              <button onClick={() => setPending(null)}>Cancel</button>
              <button class="primary" onClick={() => finish(pending.bundle, pending.plan, [...pending.confirm])}>
                Import
              </button>
            </>
          }
        >
          <p>
            These documents have the same title and length as one in this library, but they may be different revisions.
            Tick only the ones you know are the same file.
          </p>
          {pending.plan.possible.map((p) => (
            <label key={p.bundleDocId} class="check">
              <input
                type="checkbox"
                checked={pending.confirm.has(p.bundleDocId)}
                onChange={(e) => {
                  const next = new Set(pending.confirm);
                  if (e.currentTarget.checked) next.add(p.bundleDocId);
                  else next.delete(p.bundleDocId);
                  setPending({ ...pending, confirm: next });
                }}
              />
              {p.title}
            </label>
          ))}
        </Dialog>
      )}

      {summary && (
        <Dialog title="Import finished" onClose={() => setSummary(null)}>
          <ul class="summary">
            <li>{summary.added} flags added, {summary.updated} updated, {summary.unchanged} unchanged.</li>
            <li>{summary.notesAdded} notes added, {summary.notesUpdated} updated.</li>
            {summary.notesUnplaced > 0 && <li>{summary.notesUnplaced} notes are kept although their sentence is not in this copy of the text.</li>}
            <li>{summary.positionsUpdated} reading positions updated.</li>
            {summary.possibleSkipped.length > 0 && <li>Skipped unconfirmed: {summary.possibleSkipped.join(', ')}.</li>}
            {summary.unmatched.length > 0 && <li>Not in this library, add the file first: {summary.unmatched.join(', ')}.</li>}
          </ul>
          {summary.couldNotPlace.length > 0 && (
            <>
              <p>
                <strong>{summary.couldNotPlace.length} flags could not be placed</strong> because their sentence is no longer in the
                text. They are listed here so nothing is lost:
              </p>
              <ul class="lost">
                {summary.couldNotPlace.map((f, i) => (
                  <li key={i}>
                    <q>{f.quote}</q>
                    {f.note && <> Note: {f.note}</>}
                    {f.fixedText && <> Fix: {f.fixedText}</>}
                  </li>
                ))}
              </ul>
            </>
          )}
        </Dialog>
      )}
    </>
  );
}
