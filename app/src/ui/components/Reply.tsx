// An AI reply or a note: '- ' lines become a list and citations become page buttons (spec 17.6).
import type { JSX } from 'preact';
import { splitCitations } from '../../core/ai/prompts';

export interface CiteHelpers {
  valid: (sentenceId: string) => boolean;
  pageOf: (sentenceId: string) => string | undefined;
  quoteOf: (sentenceId: string) => string | undefined;
  onCite: (sentenceId: string) => void;
}

function inline(line: string, h: CiteHelpers): Array<JSX.Element | string> {
  return splitCitations(line.replace(/\*\*/g, ''), h.valid).map((part, i) => {
    if ('text' in part) return part.text;
    const first = part.cite[0]!;
    const pages = [...new Set(part.cite.map((id) => h.pageOf(id)).filter(Boolean))];
    return (
      <button key={i} class="cite" title={`Go to and read: ${h.quoteOf(first) ?? ''}`} onClick={() => h.onCite(first)}>
        {pages.length ? `p. ${pages.join(', ')}` : 'here'}
      </button>
    );
  });
}

export function Reply({ text, cite }: { text: string; cite: CiteHelpers }) {
  const out: JSX.Element[] = [];
  let items: JSX.Element[] = [];
  const flush = () => {
    if (items.length) out.push(<ul key={`u${out.length}`}>{items}</ul>);
    items = [];
  };
  text.split('\n').forEach((raw, i) => {
    const line = raw.trim();
    const bullet = /^[-*•]\s+(.*)$/.exec(line);
    if (bullet) {
      items.push(<li key={i}>{inline(bullet[1] ?? '', cite)}</li>);
      return;
    }
    flush();
    if (!line) return;
    const head = /^(Page \S+|Key terms|Chapters):\s*(.*)$/i.exec(line);
    if (head) {
      out.push(
        <p key={i} class="reply-head">
          <strong>{head[1]}:</strong> {inline(head[2] ?? '', cite)}
        </p>,
      );
      return;
    }
    out.push(<p key={i}>{inline(line, cite)}</p>);
  });
  flush();
  return <div class="reply">{out}</div>;
}
