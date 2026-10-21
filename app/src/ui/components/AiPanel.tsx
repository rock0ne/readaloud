// The AI study assistant panel (spec 17.6, ADR-30): explain a paragraph, summarise a page, a chapter
// or the whole document, check a chapter for mistakes and answer questions, with the reader's key.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { scopeHash } from '../../core/ai/assistant';
import {
  bookScope,
  chapterScope,
  pageScope,
  paragraphScope,
  replaceCitations,
  resultKey,
  scopeWords,
  speakable,
  type AiScope,
  type ScopeKind,
} from '../../core/ai/prompts';
import type { DocIndex } from '../../core/model';
import type { PageIndex } from '../../core/text/pages';
import type { AiResult, AiSuggestion, DocRecord } from '../../core/types';
import { modelName, useAiInfo } from '../ai';
import type { AiStep, useAiJob } from '../hooks/useAiJob';
import { toast, useServices } from '../services';
import { speakAloud } from '../speak';
import { Reply, type CiteHelpers } from './Reply';

/** Above this many words a request is confirmed first, since it is charged to the reader. */
const BIG_WORDS = 20_000;

const SCOPES: Array<{ kind: ScopeKind; label: string }> = [
  { kind: 'paragraph', label: 'Paragraph' },
  { kind: 'page', label: 'Page' },
  { kind: 'chapter', label: 'Chapter' },
  { kind: 'book', label: 'Whole document' },
];

interface Props {
  doc: DocRecord;
  index: DocIndex;
  pages: PageIndex;
  currentId: string | undefined;
  chapterIndex: number;
  results: AiResult[];
  ai: ReturnType<typeof useAiJob>;
  cite: CiteHelpers;
  onSaveNote: (sentenceId: string, text: string) => void;
  onAddFlag: (s: AiSuggestion) => Promise<void>;
  onUpdateResult: (r: AiResult) => void;
  onDeleteResult: (r: AiResult) => void;
}

const words = (n: number) => n.toLocaleString();

function wroteIt(r: AiResult): string {
  const when = new Date(r.createdAt).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  return `${r.provider === 'anthropic' ? modelName(r.model) : r.model} · ${when}`;
}

export function AiPanel(props: Props) {
  const { doc, index, pages, currentId, chapterIndex, results, ai, cite } = props;
  const services = useServices();
  const info = useAiInfo();
  const [kind, setKind] = useState<ScopeKind>('page');
  const [question, setQuestion] = useState('');
  const [speaking, setSpeaking] = useState<string | null>(null);
  const speech = useRef<AbortController | null>(null);
  useEffect(() => () => speech.current?.abort(), []);

  const anchor = currentId ?? index.order[0]?.sentence.id;
  const blockId = anchor ? index.get(anchor)?.block.id : undefined;
  const pageKey = anchor ? pages.ofSentence(anchor)?.key : undefined;
  const scope = useMemo<AiScope | null>(() => {
    if (kind === 'paragraph') return blockId ? paragraphScope(doc, pages, blockId) : null;
    if (kind === 'page') {
      const page = pageKey ? pages.get(pageKey) : pages.pages[0];
      return page ? pageScope(doc, page) : null;
    }
    if (kind === 'chapter') return chapterScope(doc, pages, chapterIndex);
    return bookScope(doc, pages);
  }, [kind, doc, pages, blockId, pageKey, chapterIndex]);

  const byKey = useMemo(() => new Map(results.map((r) => [r.key, r])), [results]);
  const busy = ai.job !== null;

  const send = (steps: AiStep[], q?: string) => {
    if (!info) return;
    const n = steps.reduce((sum, st) => sum + scopeWords(st.scope), 0);
    const many = steps.length > 1;
    if (many || n > BIG_WORDS) {
      const what = many ? `${steps.length} requests, about ${words(n)} words in all,` : `about ${words(n)} words`;
      if (!confirm(`This sends ${what} to ${info.company}, charged to your account. Continue?`)) return;
    }
    void ai.run(steps, q).then((ok) => {
      if (ok && q !== undefined) setQuestion('');
    });
  };

  const readAloud = (key: string, text: string) => {
    speech.current?.abort();
    if (speaking === key) return setSpeaking(null);
    const ac = new AbortController();
    speech.current = ac;
    setSpeaking(key);
    speakAloud(services, speakable(text), ac.signal)
      .catch((e: Error) => !ac.signal.aborted && toast(e.message, 'error'))
      .finally(() => speech.current === ac && setSpeaking(null));
  };

  // The sentence a saved note is attached to: the first one cited, else the start of the part.
  const anchorOf = (r: AiResult): string | undefined => {
    const cited = /\[\s*(b\d+\.s\d+)/.exec(r.text)?.[1];
    if (cited && cite.valid(cited)) return cited;
    if (r.scope === 'book') return index.order[0]?.sentence.id;
    const chapter = /^c(\d+)$/.exec(r.scope);
    if (chapter) return index.firstSentenceOfChapter(Number(chapter[1]))?.sentence.id;
    return pages.get(r.scope)?.firstSentenceId ?? index.block(r.scope)?.sentences[0]?.id;
  };

  const copy = (text: string) => {
    const plain = replaceCitations(text, (ids) => {
      const ps = [...new Set(ids.map((id) => cite.pageOf(id)).filter(Boolean))];
      return ps.length ? `(p. ${ps.join(', ')})` : '';
    });
    navigator.clipboard?.writeText(plain).then(
      () => toast('Copied.'),
      () => toast('Could not copy here.', 'error'),
    );
  };

  const card = (r: AiResult | undefined, made: AiScope, title: string, action: string, redo: AiStep) => (
    <ResultCard
      key={`${made.key}|${title}`}
      doc={doc}
      result={r}
      scope={made}
      title={title}
      action={action}
      busy={busy || !info}
      speaking={!!r && speaking === r.key}
      cite={cite}
      index={index}
      onRun={() => send([redo])}
      onRead={(x) => readAloud(x.key, x.text)}
      onCopy={(x) => copy(x.text)}
      onSaveNote={(x) => {
        const at = anchorOf(x);
        if (at) props.onSaveNote(at, `${title}\n\n${x.text}`);
      }}
      onSuggestion={(x, s, state) => {
        const next = { ...x, suggestions: (x.suggestions ?? []).map((y) => (y.sentenceId === s.sentenceId ? { ...y, state } : y)) };
        props.onUpdateResult(next);
      }}
      onAddFlag={(x, s) =>
        void props.onAddFlag(s).then(() => props.onUpdateResult({ ...x, suggestions: (x.suggestions ?? []).map((y) => (y.sentenceId === s.sentenceId ? { ...y, state: 'flagged' } : y)) }))
      }
    />
  );

  const sections = () => {
    if (!scope) return <p class="hint">Start reading to choose a part of the document.</p>;
    const id = doc.id;
    if (scope.kind === 'paragraph') return card(byKey.get(resultKey(id, 'explanation', scope.key)), scope, 'Explanation', 'Explain this paragraph', { scope, task: 'explain', label: `Explanation · ${scope.label}` });
    if (scope.kind === 'page') return card(byKey.get(resultKey(id, 'page-summary', scope.key)), scope, `Summary of ${scope.phrase}`, 'Summarise this page', { scope, task: 'summary', label: `Summary · ${scope.label}` });
    if (scope.kind === 'chapter')
      return (
        <>
          {card(byKey.get(resultKey(id, 'chapter-summary', scope.key)), scope, 'Chapter summary', 'Summarise this chapter', { scope, task: 'summary', label: `Summary · ${scope.label}` })}
          {card(byKey.get(resultKey(id, 'page-summaries', scope.key)), scope, 'Page by page', 'Summarise page by page', { scope, task: 'page-summaries', label: `Page by page · ${scope.label}` })}
          {card(byKey.get(resultKey(id, 'proofread', scope.key)), scope, 'Likely mistakes', 'Check for mistakes', { scope, task: 'proofread', label: `Mistakes · ${scope.label}` })}
        </>
      );
    const chapters = doc.chapters.map((_c, i) => chapterScope(doc, pages, i)).filter((c) => c.blocks.some((b) => b.sentences.length));
    const done = chapters.filter((c) => byKey.has(resultKey(id, 'chapter-summary', c.key)));
    return (
      <>
        {card(byKey.get(resultKey(id, 'book-overview', 'book')), scope, 'Overview', 'Give an overview', { scope, task: 'summary', label: 'Overview · Whole document' })}
        <section class="ai-card">
          <div class="ai-card-head">
            <strong>Chapter summaries</strong>
            <span class="hint">
              {done.length} of {chapters.length}
            </span>
          </div>
          {done.map((c) => (
            <details key={c.key}>
              <summary>{c.label}</summary>
              {card(byKey.get(resultKey(id, 'chapter-summary', c.key)), c, 'Chapter summary', 'Summarise this chapter', { scope: c, task: 'summary', label: `Summary · ${c.label}` })}
            </details>
          ))}
          <div class="ai-actions">
            <button
              disabled={busy || !info || done.length === chapters.length}
              onClick={() => send(chapters.filter((c) => !byKey.has(resultKey(id, 'chapter-summary', c.key))).map((c) => ({ scope: c, task: 'summary', label: `Summary · ${c.label}` })))}
            >
              {done.length ? 'Summarise the rest' : 'Summarise every chapter'}
            </button>
          </div>
        </section>
      </>
    );
  };

  const answers = scope ? results.filter((r) => r.kind === 'answer' && r.scope === scope.key).sort((a, b) => b.createdAt.localeCompare(a.createdAt)) : [];
  const ask = () => scope && question.trim() && send([{ scope, task: 'answer', label: `Answer · ${scope.label}` }], question.trim());

  return (
    <section class="ai-panel" aria-label="AI assistant">
      <div class="panel-head">
        {info === undefined ? (
          <span class="hint">Checking the AI assistant…</span>
        ) : info === null ? (
          <p class="ai-off">
            The AI assistant is off. To use it, add your own key for Claude, ChatGPT or Gemini in <a href="#/settings">Settings</a>. Nothing is sent
            anywhere until you do.
          </p>
        ) : (
          <span class="hint">
            Using {info.id === 'anthropic' ? modelName(info.model) : `${info.label} (${info.model})`} from {info.company}. <a href="#/settings">Change</a>
          </span>
        )}
      </div>

      <div class="scope-switch" role="radiogroup" aria-label="Part of the document">
        {SCOPES.map((s) => (
          <button key={s.kind} role="radio" aria-checked={kind === s.kind} class={kind === s.kind ? 'active' : ''} onClick={() => setKind(s.kind)}>
            {s.label}
          </button>
        ))}
      </div>
      {scope && (
        <p class="hint scope-line">
          {scope.label} · about {words(scopeWords(scope))} words{info ? ` are sent to ${info.company}` : ''}. Your notes are never sent.
        </p>
      )}

      {ai.job && (
        <section class="ai-card writing" aria-live="polite">
          <div class="ai-card-head">
            <strong>
              Writing: {ai.job.label}
              {ai.job.progress ? ` (${ai.job.progress})` : ''}
            </strong>
            <button onClick={ai.stop}>Stop</button>
          </div>
          <p class="hint">Unfinished: it is saved only when the reply is complete.</p>
          {ai.job.text && <Reply text={ai.job.text} cite={cite} />}
        </section>
      )}

      {ai.problem && (
        <div class={`ai-problem${ai.problem.kind === 'stopped' ? ' stopped' : ''}`} role="alert">
          <span>{ai.problem.message}</span>
          {(ai.problem.kind === 'auth' || ai.problem.kind === 'off') && <a href="#/settings">Open Settings</a>}
          <button class="link" aria-label="Dismiss" onClick={ai.clearProblem}>
            ×
          </button>
        </div>
      )}

      {sections()}

      {scope && (
        <section class="ai-card ask">
          <label class="ai-card-head" for="ai-question">
            <strong>Ask about {scope.kind === 'paragraph' ? 'this paragraph' : scope.kind === 'book' ? 'the whole document' : scope.label}</strong>
          </label>
          <textarea
            id="ai-question"
            rows={2}
            value={question}
            disabled={!info}
            placeholder="Type a question. Enter to ask, Shift+Enter for a new line."
            onInput={(e) => setQuestion(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                ask();
              }
            }}
          />
          <div class="ai-actions">
            <button class="primary" disabled={busy || !info || !question.trim()} onClick={ask}>
              Ask
            </button>
          </div>
          {answers.map((r) => (
            <article key={r.key} class="answer">
              <p class="question">{r.question}</p>
              <Reply text={r.text} cite={cite} />
              {r.truncated && <p class="warn">This reply was cut off at the length limit.</p>}
              <div class="ai-meta">{wroteIt(r)}</div>
              <div class="ai-actions">
                <button onClick={() => readAloud(r.key, r.text)}>{speaking === r.key ? 'Stop' : 'Read aloud'}</button>
                <button
                  onClick={() => {
                    const at = anchorOf(r);
                    if (at) props.onSaveNote(at, `Question: ${r.question ?? ''}\n\n${r.text}`);
                  }}
                >
                  Save as note
                </button>
                <button onClick={() => copy(`${r.question ?? ''}\n\n${r.text}`)}>Copy</button>
                <button class="link danger" onClick={() => confirm('Delete this answer?') && props.onDeleteResult(r)}>
                  Delete
                </button>
              </div>
            </article>
          ))}
        </section>
      )}
    </section>
  );
}

interface CardProps {
  doc: DocRecord;
  result: AiResult | undefined;
  scope: AiScope;
  title: string;
  /** The button that makes it: "Summarise this page". */
  action: string;
  busy: boolean;
  speaking: boolean;
  cite: CiteHelpers;
  index: DocIndex;
  onRun: () => void;
  onRead: (r: AiResult) => void;
  onCopy: (r: AiResult) => void;
  onSaveNote: (r: AiResult) => void;
  onSuggestion: (r: AiResult, s: AiSuggestion, state: AiSuggestion['state']) => void;
  onAddFlag: (r: AiResult, s: AiSuggestion) => void;
}

function ResultCard({ doc, result: r, scope, title, action, busy, speaking, cite, index, onRun, onRead, onCopy, onSaveNote, onSuggestion, onAddFlag }: CardProps) {
  const [stale, setStale] = useState(false);
  useEffect(() => {
    let alive = true;
    setStale(false);
    if (r?.inputHash) void scopeHash(doc, scope).then((h) => alive && setStale(h !== r.inputHash));
    return () => {
      alive = false;
    };
  }, [doc, scope.key, r?.inputHash]);

  if (!r)
    return (
      <section class="ai-card unmade">
        <div class="ai-actions">
          <button disabled={busy} onClick={onRun}>
            {action}
          </button>
        </div>
      </section>
    );

  const isProofread = r.kind === 'proofread';
  return (
    <section class="ai-card">
      <div class="ai-card-head">
        <strong>{title}</strong>
      </div>
      {stale && (
        <p class="warn">
          Out of date: the text has changed since this was written.{' '}
          <button class="link" disabled={busy} onClick={onRun}>
            Redo it
          </button>
        </p>
      )}
      {isProofread ? <Suggestions result={r} cite={cite} index={index} onState={onSuggestion} onAddFlag={onAddFlag} /> : <Reply text={r.text} cite={cite} />}
      {r.truncated && <p class="warn">This reply was cut off at the length limit.</p>}
      <div class="ai-meta">{wroteIt(r)}</div>
      <div class="ai-actions">
        {!isProofread && <button onClick={() => onRead(r)}>{speaking ? 'Stop' : 'Read aloud'}</button>}
        {!isProofread && <button onClick={() => onSaveNote(r)}>Save as note</button>}
        {!isProofread && <button onClick={() => onCopy(r)}>Copy</button>}
        <button disabled={busy} onClick={onRun}>
          Redo
        </button>
      </div>
    </section>
  );
}

function Suggestions({ result, cite, index, onState, onAddFlag }: { result: AiResult; cite: CiteHelpers; index: DocIndex; onState: CardProps['onSuggestion']; onAddFlag: CardProps['onAddFlag'] }) {
  const list = result.suggestions ?? [];
  if (list.length === 0) {
    const none = /^\s*NONE\s*$/i.test(result.text);
    return (
      <div>
        <p>{none ? 'No likely mistakes were found.' : 'No mistakes could be read from the reply.'}</p>
        {!none && (
          <details>
            <summary>Show the reply</summary>
            <pre class="raw">{result.text}</pre>
          </details>
        )}
      </div>
    );
  }
  const open = list.filter((s) => s.state === 'new').length;
  return (
    <div>
      <p class="hint">
        {list.length} likely mistake{list.length === 1 ? '' : 's'}, {open} still to look at. They are suggestions: check each before you add it as a flag.
      </p>
      <ol class="suggestions">
        {list.map((s) => (
          <li key={s.sentenceId} class={`suggestion ${s.state}`}>
            <blockquote class="quote open">{index.get(s.sentenceId)?.sentence.text ?? ''}</blockquote>
            <p>
              <strong>{s.issue}</strong>
            </p>
            {s.fix && <p class="fix">Suggested: {s.fix}</p>}
            <div class="ai-actions">
              <button onClick={() => cite.onCite(s.sentenceId)}>Listen</button>
              {s.state === 'flagged' ? (
                <span class="hint">Flagged</span>
              ) : (
                <button onClick={() => onAddFlag(result, s)}>Add as flag</button>
              )}
              {s.state === 'dismissed' ? (
                <button class="link" onClick={() => onState(result, s, 'new')}>
                  Restore
                </button>
              ) : (
                s.state === 'new' && (
                  <button class="link" onClick={() => onState(result, s, 'dismissed')}>
                    Dismiss
                  </button>
                )
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
