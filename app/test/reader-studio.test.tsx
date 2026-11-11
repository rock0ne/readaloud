import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { ReaderChrome, ReaderTransport, ReadingProgress } from '../src/ui/components/ReaderChrome';
import { PreparedModeNotice } from '../src/ui/components/PlaybackMode';
import { TextPane } from '../src/ui/components/TextPane';
import { useKeys } from '../src/ui/hooks/useKeys';
import { useCompactReader } from '../src/ui/hooks/useCompactReader';
import { defaultSettings, withDefaults } from '../src/core/store/settings';
import { makeDoc, sampleBlocks } from './helpers/docs';

const root = document.createElement('div');
document.body.append(root);
afterEach(() => { act(() => render(null, root)); vi.restoreAllMocks(); });

describe('quiet reader chrome', () => {
  it('makes audiobook resume and return to live reader explicit, without a global mode picker', () => {
    const onReader = vi.fn(), onResume = vi.fn();
    act(() => render(<PreparedModeNotice audiobook busy={false} playing={false} onReader={onReader} onResume={onResume} />, root));
    expect(root.querySelector('select')).toBeNull();
    const buttons = root.querySelectorAll<HTMLButtonElement>('button');
    expect(buttons[0]?.textContent).toBe('Resume saved audiobook');
    act(() => buttons[0]!.click()); act(() => buttons[1]!.click());
    expect(onResume).toHaveBeenCalledOnce(); expect(onReader).toHaveBeenCalledOnce();
    act(() => render(<PreparedModeNotice audiobook={false} busy={false} playing={false} onReader={onReader} onResume={onResume} />, root));
    expect(root.textContent).toBe('');
  });
  it('identifies Reader Play rather than silently resuming strict audiobook mode', () => {
    act(() => render(<ReaderTransport playing={false} audiobook onPrevious={() => {}} onNext={() => {}} onReplay={() => {}} onToggle={() => {}} />, root));
    expect(root.querySelector('[aria-label="Read now"]')?.getAttribute('title')).toContain('no preparation required');
  });
  it('keeps all seven tools accessible and dispatches only the chosen tool', () => {
    const onPanel = vi.fn();
    act(() => render(<ReaderChrome title="A long book title" chapter="Chapter 2 · page 5" panel="toc" onPanel={onPanel}
      flags={2} notes={3} aiBusy={false} focused={false} onFocus={() => {}} fullscreen={false} onFullscreen={() => {}}
      paged={false} onLayout={() => {}} onFind={() => {}} transport={null} />, root));
    const tools = root.querySelectorAll<HTMLButtonElement>('.panel-buttons button');
    expect(tools).toHaveLength(7);
    expect(tools[1]?.textContent).toBe('Audiobook');
    expect(tools[0]?.getAttribute('aria-expanded')).toBe('true');
    act(() => tools[1]!.click());
    expect(onPanel).toHaveBeenCalledExactlyOnceWith('audiobook');
    expect(root.querySelector('.doc-title')?.textContent).toBe('A long book title');
    expect(root.querySelector('[aria-label="Back to library"]')?.getAttribute('href')).toBe('#/');
    expect(root.querySelectorAll('.tool-count')).toHaveLength(2);
  });
  it('exposes focus, layout and full-screen state without hiding their exit controls', () => {
    const focus = vi.fn(), fullscreen = vi.fn(), layout = vi.fn(), find = vi.fn();
    act(() => render(<ReaderChrome title="Book" chapter="One" panel={null} onPanel={() => {}}
      flags={0} notes={0} aiBusy={false} focused fullscreen paged onFocus={focus} onFullscreen={fullscreen}
      onLayout={layout} onFind={find} transport={null} />, root));
    for (const [label, fn] of [['Leave focus mode', focus], ['Leave full screen', fullscreen], ['Switch to continuous scroll', layout], ['Go to a page or find text', find]] as const) {
      const button = root.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!;
      expect(button).not.toBeNull(); act(() => button.click()); expect(fn).toHaveBeenCalledTimes(1);
    }
  });
  it('routes previous, play/pause, next and replay to the existing player callbacks', () => {
    const callbacks = { onPrevious: vi.fn(), onNext: vi.fn(), onToggle: vi.fn(), onReplay: vi.fn() };
    act(() => render(<ReaderTransport playing={false} {...callbacks} />, root));
    for (const button of root.querySelectorAll<HTMLButtonElement>('button')) act(() => button.click());
    for (const fn of Object.values(callbacks)) expect(fn).toHaveBeenCalledTimes(1);
    expect(root.querySelector('[aria-label="Play"]')).not.toBeNull();
    act(() => render(<ReaderTransport playing {...callbacks} />, root));
    expect(root.querySelector('[aria-label="Pause"]')).not.toBeNull();
  });
  it('labels progress as reading position, not elapsed audio time', () => {
    act(() => render(<ReadingProgress percent={26.83} page="Page 4 / 9" chapter="Governance" />, root));
    const progress = root.querySelector('progress')!;
    expect(progress.value).toBe(26.83); expect(progress.max).toBe(100);
    expect(progress.getAttribute('aria-label')).toBe('Reading position in book');
    expect(root.querySelector('.progress-percent')?.textContent).toBe('26.8%');
  });
});

describe('book text and keyboard preservation', () => {
  it('renders facing pages with original sentence IDs, flags and seek targets', () => {
    const doc = makeDoc(sampleBlocks), seek = vi.fn();
    act(() => render(<TextPane blocks={doc.blocks} sheets={[
      { key: 'one', label: '1', blocks: doc.blocks.slice(0, 2) }, { key: 'two', label: '2', blocks: doc.blocks.slice(2) },
    ]} flagged={new Set([doc.blocks[1]!.sentences[0]!.id])} currentId={undefined} skipCode onSeek={seek} />, root));
    expect(root.querySelectorAll('.sheets.two article')).toHaveLength(2);
    const sentences = doc.blocks.flatMap((b) => b.sentences);
    expect(Array.from(root.querySelectorAll<HTMLElement>('[data-sid]')).map((el) => el.dataset.sid)).toEqual(sentences.map((s) => s.id));
    expect(root.querySelectorAll('.s.flagged')).toHaveLength(1);
    const sentence = root.querySelector<HTMLElement>('.s.flagged')!;
    act(() => sentence.click());
    expect(seek).toHaveBeenCalledExactlyOnceWith(sentence.dataset.sid);
    expect(root.textContent).toContain('First sentence here. Second sentence here.');
  });
  it('lets native buttons own Space rather than starting narration', () => {
    const toggle = vi.fn(), escape = vi.fn();
    function Keys() { useKeys({ Space: toggle, Escape: escape }); return <button>Contents</button>; }
    act(() => render(<Keys />, root));
    const button = root.querySelector('button')!;
    const event = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
    act(() => { button.dispatchEvent(event); });
    expect(toggle).not.toHaveBeenCalled(); expect(event.defaultPrevented).toBe(false);
    act(() => { button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(escape).toHaveBeenCalledTimes(1);
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true })); });
    expect(toggle).toHaveBeenCalledTimes(1);
  });
  it('does not hijack inputs or native links', () => {
    const fn = vi.fn();
    function Keys() { useKeys({ f: fn }); return <><input /><a href="#/">Library</a></>; }
    act(() => render(<Keys />, root));
    for (const element of root.querySelectorAll('input, a')) act(() => { element.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', bubbles: true })); });
    expect(fn).not.toHaveBeenCalled();
  });
  it('turns pages from toolbar buttons while preserving native Space and panel scrolling', () => {
    const next = vi.fn(), previous = vi.fn(), play = vi.fn();
    function Keys() { useKeys({ PageDown: next, PageUp: previous, Space: play }); return <><header class="reader-topbar"><button>Contents</button><input /></header><aside><button>Panel action</button></aside></>; }
    act(() => render(<Keys />, root));
    const button = root.querySelector('.reader-topbar button')!;
    for (const key of ['PageDown', 'PageUp', ' ']) act(() => { button.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles:true })); });
    expect(next).toHaveBeenCalledTimes(1); expect(previous).toHaveBeenCalledTimes(1); expect(play).not.toHaveBeenCalled();
    for (const element of root.querySelectorAll('input, aside button')) act(() => { element.dispatchEvent(new KeyboardEvent('keydown', { key:'PageDown', bubbles:true })); });
    expect(next).toHaveBeenCalledTimes(1);
  });
  it('renders one transport and moves it on resize, without CSS-only duplicate controls', () => {
    let matches = false;
    const listeners = new Set<() => void>();
    vi.stubGlobal('matchMedia', () => ({ get matches() { return matches; }, addEventListener: (_: string, fn: () => void) => listeners.add(fn), removeEventListener: (_: string, fn: () => void) => listeners.delete(fn) }));
    function Responsive() { const compact = useCompactReader(); const transport = () => <ReaderTransport playing={false} onPrevious={() => {}} onNext={() => {}} onToggle={() => {}} onReplay={() => {}} />;
      return <><header>{compact ? null : transport()}</header><footer>{compact ? transport() : null}</footer></>; }
    act(() => render(<Responsive />, root));
    expect(root.querySelectorAll('.transport')).toHaveLength(1); expect(root.querySelector('header .transport')).not.toBeNull();
    matches = true; act(() => { listeners.forEach((fn) => fn()); });
    expect(root.querySelectorAll('.transport')).toHaveLength(1); expect(root.querySelector('footer .transport')).not.toBeNull();
    matches = false; act(() => { listeners.forEach((fn) => fn()); });
    expect(root.querySelectorAll('.transport')).toHaveLength(1); expect(root.querySelector('header .transport')).not.toBeNull();
    act(() => render(null, root)); expect(listeners.size).toBe(0); vi.unstubAllGlobals();
  });
});

describe('appearance upgrade', () => {
  it('defaults old installations to their existing system colours without changing audio identity', () => {
    const old = defaultSettings();
    const { readerTone: _tone, ...saved } = old;
    const updated = withDefaults({ ...saved, preparedAudioOnly: true, layout: 'scroll', rate: 1.3,
      voiceByEngine: { kokoro: 'bm_george' }, pronunciation: { enabled: false, list: 'Tunde = TOON-day' } });
    expect(updated.readerTone).toBe('system'); expect(updated.preparedAudioOnly).toBe(true);
    expect(updated.layout).toBe('scroll'); expect(updated.stopAtPageEnd).toBe(old.stopAtPageEnd);
    expect(updated.rate).toBe(1.3); expect(updated.voiceByEngine.kokoro).toBe('bm_george');
    expect(updated.pronunciation).toEqual({ enabled: false, list: 'Tunde = TOON-day' });
    expect(updated.schemaVersion).toBe(old.schemaVersion);
  });
  it('retains each new palette and rejects malformed imported values', () => {
    for (const readerTone of ['system', 'paper', 'sepia', 'night'] as const) expect(withDefaults({ ...defaultSettings(), readerTone }).readerTone).toBe(readerTone);
    expect(withDefaults({ ...defaultSettings(), readerTone: 'invalid' as 'paper' }).readerTone).toBe('system');
  });
});
