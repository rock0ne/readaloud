// Go to a page or find text (ADR-34): a bar above the controls. Enter goes to the next match,
// Shift+Enter to the one before; the first press goes to the next match after where you are.
import { useEffect, useRef, useState } from 'preact/hooks';
import type { DocIndex } from '../../core/model';
import type { PageIndex } from '../../core/text/pages';
import { MAX_HITS, findSentences, pageFor, typedPage } from '../../core/text/search';

interface Props {
  index: DocIndex;
  pages: PageIndex;
  currentId: string | undefined;
  onGo: (sentenceId: string) => void;
  onClose: () => void;
}

export function FindBar({ index, pages, currentId, onGo, onClose }: Props) {
  const [page, setPage] = useState('');
  const [pageProblem, setPageProblem] = useState('');
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<string[]>([]);
  const [at, setAt] = useState(-1);
  const findBox = useRef<HTMLInputElement>(null);
  useEffect(() => findBox.current?.focus(), []);

  useEffect(() => {
    const t = setTimeout(() => {
      setHits(findSentences(index, query));
      setAt(-1);
    }, 150);
    return () => clearTimeout(t);
  }, [index, query]);

  const first = pages.pages[0]?.label ?? '1';
  const last = pages.pages.at(-1)?.label ?? first;

  const goPage = () => {
    const p = pageFor(pages.pages, page);
    if (!p) {
      setPageProblem(typedPage(page) ? `There is no page ${typedPage(page)}. Pages run from ${first} to ${last}.` : '');
      return;
    }
    setPageProblem('');
    onGo(p.firstSentenceId);
  };

  const show = (i: number) => {
    const id = hits[i];
    if (!id) return;
    setAt(i);
    onGo(id);
  };

  const step = (dir: 1 | -1) => {
    if (!hits.length) return;
    if (at >= 0) return show((at + dir + hits.length) % hits.length);
    const here = currentId ? (index.get(currentId)?.ordinal ?? -1) : -1;
    const ord = (id: string) => index.get(id)?.ordinal ?? 0;
    const i = dir === 1 ? hits.findIndex((id) => ord(id) > here) : hits.findLastIndex((id) => ord(id) < here);
    show(i >= 0 ? i : dir === 1 ? 0 : hits.length - 1);
  };

  const hitPage = at >= 0 && hits[at] ? pages.ofSentence(hits[at])?.label : undefined;
  const count =
    query.trim().length < 2
      ? ''
      : hits.length === 0
        ? 'Not found'
        : `${at >= 0 ? at + 1 : '–'} of ${hits.length}${hits.length >= MAX_HITS ? '+' : ''}${hitPage ? ` · p. ${hitPage}` : ''}`;

  return (
    <div class="find-bar" role="search">
      <form
        class="go-page"
        onSubmit={(e) => {
          e.preventDefault();
          goPage();
        }}
      >
        <label>
          Page{' '}
          <input type="text" inputMode="numeric" size={4} value={page} onInput={(e) => setPage(e.currentTarget.value)} aria-label="Page number" />
        </label>
        <span class="hint">of {last}</span>
        <button type="submit">Go</button>
      </form>
      <form
        class="find"
        onSubmit={(e) => {
          e.preventDefault();
          step(1);
        }}
      >
        <input
          ref={findBox}
          type="search"
          value={query}
          placeholder="Find in this document"
          aria-label="Find in this document"
          onInput={(e) => setQuery(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && e.shiftKey) {
              e.preventDefault();
              step(-1);
            }
          }}
        />
        <span class="hint count" aria-live="polite">
          {count}
        </span>
        <button type="button" disabled={!hits.length} onClick={() => step(-1)} aria-label="Previous match" title="Previous match (Shift+Enter)">
          ↑
        </button>
        <button type="submit" disabled={!hits.length} aria-label="Next match" title="Next match (Enter)">
          ↓
        </button>
      </form>
      <button class="link close" aria-label="Close" title="Close (Esc)" onClick={onClose}>
        ×
      </button>
      {pageProblem && <p class="hint problem">{pageProblem}</p>}
    </div>
  );
}
