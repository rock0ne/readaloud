// Renders one chapter; the current sentence is highlighted imperatively for speed (spec 11.3, 16).
import type { JSX } from 'preact';
import { useEffect, useMemo, useRef } from 'preact/hooks';
import type { Block } from '../../core/types';

interface Props {
  blocks: Block[];
  flagged: ReadonlySet<string>;
  currentId: string | undefined;
  skipCode: boolean;
  onSeek: (sentenceId: string) => void;
}

function sentencesOf(block: Block, flagged: ReadonlySet<string>): Array<JSX.Element | string> {
  const out: Array<JSX.Element | string> = [];
  let cursor = 0;
  for (const s of block.sentences) {
    if (s.start > cursor) out.push(block.text.slice(cursor, s.start));
    out.push(
      <span key={s.id} data-sid={s.id} class={flagged.has(s.id) ? 's flagged' : 's'}>
        {s.text}
      </span>,
    );
    cursor = s.end;
  }
  if (cursor < block.text.length) out.push(block.text.slice(cursor));
  return out;
}

function renderBlock(block: Block, flagged: ReadonlySet<string>, skipCode: boolean): JSX.Element {
  const kids = sentencesOf(block, flagged);
  const key = block.id;
  switch (block.type) {
    case 'heading': {
      const level = block.level ?? 2;
      if (level <= 1) return <h2 key={key}>{kids}</h2>;
      if (level === 2) return <h3 key={key}>{kids}</h3>;
      return <h4 key={key}>{kids}</h4>;
    }
    case 'list-item':
      return <p key={key} class="li">{kids}</p>;
    case 'quote':
      return <blockquote key={key}>{kids}</blockquote>;
    case 'code':
      return <pre key={key} class={skipCode ? 'skipped' : ''} title={skipCode ? 'Code is skipped while reading' : undefined}>{kids}</pre>;
    case 'caption':
      return <p key={key} class="caption">{kids}</p>;
    case 'table-row':
      return <p key={key} class="row">{kids}</p>;
    default:
      return <p key={key}>{kids}</p>;
  }
}

export function TextPane({ blocks, flagged, currentId, skipCode, onSeek }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const content = useMemo(() => blocks.map((b) => renderBlock(b, flagged, skipCode)), [blocks, flagged, skipCode]);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    root.querySelector('.s.current')?.classList.remove('current');
    if (!currentId) return;
    const el = root.querySelector<HTMLElement>(`[data-sid="${CSS.escape(currentId)}"]`);
    if (!el) return;
    el.classList.add('current');
    const r = el.getBoundingClientRect();
    const box = root.getBoundingClientRect();
    if (r.top < box.top + 40 || r.bottom > box.bottom - 40) el.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }, [currentId, content]);

  return (
    <div
      ref={ref}
      class="text-pane"
      onClick={(e) => {
        const target = (e.target as HTMLElement).closest<HTMLElement>('[data-sid]');
        const id = target?.dataset.sid;
        if (id) onSeek(id);
      }}
    >
      <article>{content}</article>
    </div>
  );
}
