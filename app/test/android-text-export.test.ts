import { describe, expect, it, vi } from 'vitest';
const { save } = vi.hoisted(() => ({ save: vi.fn(async (_opts: unknown) => {}) }));
vi.mock('../src/ui/android/plugin', () => ({ IN_ANDROID_APP: true, readAloudTts: { saveTextExport: save } }));
import { downloadText, onToast } from '../src/ui/services';

describe('Android text export', () => {
  it.each(['text/plain', 'text/markdown', 'application/json'])('uses the native destination picker for %s, including short text', async (mime) => {
    save.mockClear();
    const messages: string[] = [];
    const stop = onToast((t) => messages.push(t.text));
    downloadText('draft.txt', 'Hi', mime);
    await vi.waitFor(() => expect(messages).toContain('File saved.'));
    expect(save).toHaveBeenCalledExactlyOnceWith({ name: 'draft.txt', text: 'Hi', mime });
    stop();
  });
  it('reports cancellation/errors without claiming the file was saved', async () => {
    save.mockRejectedValueOnce(new Error('Saving the file was cancelled'));
    const messages: string[] = [];
    const stop = onToast((t) => messages.push(t.text));
    downloadText('draft.md', 'changed', 'text/markdown');
    await vi.waitFor(() => expect(messages).toContain('Saving the file was cancelled'));
    expect(messages).not.toContain('File saved.');
    stop();
  });
  it('refuses arbitrary MIME types before crossing the native bridge', () => {
    save.mockClear();
    downloadText('not.exe', 'anything', 'application/octet-stream');
    expect(save).not.toHaveBeenCalled();
  });
});
