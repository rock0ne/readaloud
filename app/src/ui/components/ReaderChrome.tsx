// Original, deliberately quiet reader chrome. No third-party artwork or fonts.
import type { ComponentChildren } from 'preact';

export type ReaderPanel = 'toc' | 'flags' | 'notes' | 'ai' | 'text' | 'audiobook' | 'draft' | null;
type IconName = 'back' | 'previous' | 'next' | 'play' | 'pause' | 'replay' | 'search' | 'focus' | 'expand' | 'close' | 'book';

export function ReaderIcon({ name }: { name: IconName }) {
  const paths: Record<IconName, ComponentChildren> = {
    back: <path d="m14 5-7 7 7 7M7 12h14" />,
    previous: <><path d="M5 5v14" /><path d="m19 5-10 7 10 7Z" /></>,
    next: <><path d="M19 5v14" /><path d="m5 5 10 7-10 7Z" /></>,
    play: <path d="m8 4 12 8-12 8Z" />,
    pause: <><path d="M8 5v14M16 5v14" /></>,
    replay: <><path d="M4 10a8 8 0 1 1 1 7M4 4v6h6" /></>,
    search: <><circle cx="10" cy="10" r="6" /><path d="m15 15 6 6" /></>,
    focus: <><path d="M9 3H3v6M15 3h6v6M21 15v6h-6M9 21H3v-6" /><circle cx="12" cy="12" r="2" /></>,
    expand: <path d="M8 3H3v5m0-5 7 7m6-7h5v5m0-5-7 7M3 16v5h5m-5 0 7-7m11 2v5h-5m5 0-7-7" />,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    book: <><path d="M12 5v15M3 4c4-1 6 0 9 1 3-1 5-2 9-1v15c-4-1-6 0-9 1-3-1-5-2-9-1Z" /></>,
  };
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">{paths[name]}</svg>;
}

export function ReaderTransport({ playing, audiobook = false, onPrevious, onNext, onToggle, onReplay, rangePicker }: {
  playing: boolean; audiobook?: boolean; onPrevious: () => void; onNext: () => void; onToggle: () => void; onReplay: () => void; rangePicker?: ComponentChildren;
}) {
  return <div class="transport" role="group" aria-label="Read aloud controls">
    <button onClick={onPrevious} aria-label="Previous sentence" title="Previous sentence (←)"><ReaderIcon name="previous" /></button>
    <button class="play" onClick={onToggle} aria-label={playing ? 'Pause' : audiobook ? 'Read now' : 'Play'} title={playing ? 'Pause playback (Space)' : 'Read now — live speech, no preparation required (Space)'}><ReaderIcon name={playing ? 'pause' : 'play'} /></button>
    <button onClick={onNext} aria-label="Next sentence" title="Next sentence (→)"><ReaderIcon name="next" /></button>
    <button onClick={onReplay} aria-label="Replay sentence" title="Replay sentence (R)"><ReaderIcon name="replay" /></button>
    {rangePicker}
  </div>;
}

export const PANEL_LABELS: Record<Exclude<ReaderPanel, null>, string> = {
  audiobook: 'Audiobook studio', toc: 'Contents', flags: 'Flags', notes: 'Notes', ai: 'AI assistant', text: 'Appearance',
  draft: 'Edit draft',
};

export function ReaderChrome({ title, chapter, panel, onPanel, flags, notes, aiBusy, focused, onFocus, fullscreen, onFullscreen, paged, onLayout, onFind, transport, layoutPicker }: {
  title: string; chapter: string; panel: ReaderPanel; onPanel: (p: Exclude<ReaderPanel, null>) => void;
  flags: number; notes: number; aiBusy: boolean; focused: boolean; onFocus: () => void;
  fullscreen: boolean; onFullscreen: () => void; paged: boolean; onLayout: () => void; onFind: () => void; transport: ComponentChildren; layoutPicker?: ComponentChildren;
}) {
  return <header class="bar reader-topbar">
    <div class="reader-identity">
      <a class="button icon-button" href="#/" aria-label="Back to library" title="Back to library"><ReaderIcon name="back" /></a>
      <div class="titles"><div class="doc-title" title={title}>{title}</div><div class="chapter-title">{chapter}</div></div>
    </div>
    <div class="desktop-transport">{transport}</div>
    <div class="reader-toolbar-tools">
    <nav class="panel-buttons" aria-label="Reader tools">
      {(['toc', 'audiobook', 'draft', 'flags', 'notes', 'ai', 'text'] as const).map((p) => <button key={p} class={panel === p ? 'active' : ''} aria-expanded={panel === p} aria-controls="reader-tools-panel" onClick={() => onPanel(p)} title={p === 'ai' ? 'AI study assistant, with your own key' : PANEL_LABELS[p]}>
        {p === 'text' ? <span class="appearance-label">Aa <span>Appearance</span></span> : p === 'audiobook' ? 'Audiobook' : p === 'ai' ? `AI${aiBusy ? ' …' : ''}` : PANEL_LABELS[p]}
        {p === 'flags' && flags > 0 ? <span class="tool-count">{flags}</span> : p === 'notes' && notes > 0 ? <span class="tool-count">{notes}</span> : null}
      </button>)}
    </nav>
    <div class="reader-actions">
      <button class="icon-button reader-find" onClick={onFind} aria-label="Go to a page or find text" title="Go to a page or find text (/)"><ReaderIcon name="search" /></button>
      {layoutPicker ?? <button class="icon-button" aria-pressed={paged} onClick={onLayout} aria-label={paged ? 'Switch to continuous scroll' : 'Switch to book pages'} title={paged ? 'Continuous scroll' : 'Book pages — facing pages on a wide screen'}><ReaderIcon name="book" /></button>}
      <button class="icon-button focus-toggle" aria-pressed={focused} onClick={onFocus} aria-label={focused ? 'Leave focus mode' : 'Enter focus mode'} title={focused ? 'Leave focus mode (Escape)' : 'Focus — hide the tools'}><ReaderIcon name={focused ? 'close' : 'focus'} /></button>
      <button class="icon-button fullscreen-toggle" aria-pressed={fullscreen} onClick={onFullscreen} aria-label={fullscreen ? 'Leave full screen' : 'Full screen'} title="Full screen"><ReaderIcon name="expand" /></button>
    </div>
    </div>
  </header>;
}

export function ReadingProgress({ percent, chapter, page }: { percent: number; chapter: string; page: string }) {
  return <div class="reading-progress">
    <progress max="100" value={percent} aria-label="Reading position in book" />
    <span class="progress-page">{page}</span><span class="progress-chapter" title={chapter}>{chapter}</span><span class="progress-percent">{percent.toFixed(1)}%</span>
  </div>;
}
