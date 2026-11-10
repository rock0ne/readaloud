import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { useState } from 'preact/hooks';
import { DraftPanel } from '../src/ui/components/DraftPanel';
import { ReaderChrome } from '../src/ui/components/ReaderChrome';
import { reviseDraft } from '../src/core/text/draft';
import { makeDoc, sampleBlocks } from './helpers/docs';

const root = document.createElement('div'); document.body.append(root);
afterEach(() => { act(() => render(null, root)); vi.restoreAllMocks(); });
const draft = () => makeDoc(sampleBlocks, { draft: { baseDocId: 'original', baseSourceHash: 'base-hash', revision: 0, edits: [] } });
const button = (label: string) => Array.from(root.querySelectorAll('button')).find((b) => b.textContent === label)!;
const type = (value: string) => {
  const input = root.querySelector('textarea')!;
  act(() => { input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); });
};

describe('draft editor controls', () => {
  it('offers Edit draft as a primary reader tool', () => {
    const onPanel = vi.fn();
    act(() => render(<ReaderChrome title="Book" chapter="Chapter" panel={null} onPanel={onPanel} flags={0} notes={0} aiBusy={false}
      focused={false} onFocus={() => {}} fullscreen={false} onFullscreen={() => {}} paged onLayout={() => {}} onFind={() => {}} transport={null} />, root));
    act(() => button('Edit draft').click()); expect(onPanel).toHaveBeenCalledExactlyOnceWith('draft');
  });
  it('requires the own/permission choice before enabling direct editing', async () => {
    const create = vi.fn(async () => {});
    act(() => render(<DraftPanel doc={makeDoc(sampleBlocks)} currentBlockId="b1" onRestore={async () => {}} onCreate={create} onSave={vi.fn()} onDirty={() => {}} />, root));
    expect(button('Enable editing this document').disabled).toBe(true);
    expect(root.textContent).toContain('does not unlock protected books');
    await act(async () => { const check = root.querySelector('input')!; check.checked = true; check.dispatchEvent(new Event('change', { bubbles: true })); });
    await act(async () => { button('Enable editing this document').click(); });
    expect(create).toHaveBeenCalledOnce();
  });
  it('saves and listens only on the explicit command, supports undo, and keeps unsaved text on failure', async () => {
    const save = vi.fn();
    function Editor() {
      const [doc, setDoc] = useState(draft);
      return <DraftPanel doc={doc} currentBlockId="b1" onRestore={async () => {}} onCreate={vi.fn()} onDirty={() => {}}
        onSave={async (id, text, undo, listen) => {
          save(id, text, undo, listen); const updated = reviseDraft(doc, id, text, undo); setDoc(updated); return updated;
        }} />;
    }
    act(() => render(<Editor />, root));
    type('New draft sentence.'); expect(save).not.toHaveBeenCalled();
    expect(root.textContent).toContain('Unsaved changes');
    await act(async () => { button('Save & listen from here').click(); });
    expect(save).toHaveBeenLastCalledWith('b1', 'New draft sentence.', false, true);
    expect(root.textContent).toContain('revision 1'); expect(root.textContent).toContain('Saved text');
    await act(async () => { button('Undo last saved edit').click(); });
    expect(root.querySelector('textarea')?.value).toBe('First sentence here. Second sentence here.');
    act(() => render(<DraftPanel doc={draft()} currentBlockId="b1" onRestore={async () => {}} onCreate={vi.fn()} onDirty={() => {}}
      onSave={async () => { throw new Error('Storage failed; nothing saved.'); }} />, root));
    type('Do not lose this unsaved text.');
    await act(async () => { button('Save changes').click(); });
    expect(root.querySelector('[role="alert"]')?.textContent).toBe('Storage failed; nothing saved.');
    expect(root.querySelector('textarea')?.value).toBe('Do not lose this unsaved text.');
  });
  it('does not discard the paragraph while seeking; changing the edit target requires discard confirmation', () => {
    const doc = draft();
    const props = { doc, currentBlockId: 'b1', onRestore: async () => {}, onCreate: vi.fn(), onDirty: vi.fn(), onSave: vi.fn() };
    act(() => render(<DraftPanel {...props} />, root)); type('An unsaved revision.');
    act(() => render(<DraftPanel {...props} currentBlockId="b3" />, root));
    expect(root.querySelector('textarea')?.value).toBe('An unsaved revision.');
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    act(() => button('Edit selected paragraph').click());
    expect(root.querySelector('textarea')?.value).toBe('An unsaved revision.');
    vi.mocked(window.confirm).mockReturnValue(true);
    act(() => button('Edit selected paragraph').click());
    expect(root.querySelector('textarea')?.value).toBe('Final paragraph.');
  });
  it('blocks browser unload and export while unsaved, and renders literal text without executing HTML', () => {
    act(() => render(<DraftPanel doc={draft()} currentBlockId="b1" onRestore={async () => {}} onCreate={vi.fn()} onDirty={vi.fn()} onSave={vi.fn()} />, root));
    type('<img src=x onerror="alert(1)"> literal text.');
    expect(root.querySelector('img')).toBeNull();
    expect(button('Export edited TXT').disabled).toBe(true);
    const event = new Event('beforeunload', { cancelable: true }); act(() => { window.dispatchEvent(event); });
    expect(event.defaultPrevented).toBe(true);
  });
});
