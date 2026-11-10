import type { ComponentChildren } from 'preact';

/** Keep the phone's reading space clear without removing any desktop controls. */
export function ReadingTools({ compact, children }: { compact: boolean; children: ComponentChildren }) {
  return compact ? <details class="reading-tools">
    <summary>Voice, speed &amp; notes</summary>
    <div class="reading-tools-content">{children}</div>
  </details> : <div class="reading-tools-content desktop-reading-tools">{children}</div>;
}
