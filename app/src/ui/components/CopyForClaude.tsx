// Copy for Claude (ADR-32): the request for the part being read, as one text to paste into
// claude.ai, so a reader can use their Claude subscription without a key; the reply comes back as a note.
import { useEffect, useState } from 'preact/hooks';
import { chatPrompt, cleanPastedReply, scopeWords, type AiScope, type AiTask } from '../../core/ai/prompts';
import type { ParsedDocument } from '../../core/types';

const CLAUDE_URL = 'https://claude.ai/new';
/** Above this many words a chat may not take the text in one go. */
const LONG_WORDS = 100_000;

interface Choice {
  task: AiTask;
  label: string;
  /** The note's title when the reply is saved. */
  title: string;
}

function choices(scope: AiScope): Choice[] {
  const ask: Choice = { task: 'answer', label: 'Answer a question', title: 'Answer' };
  if (scope.kind === 'paragraph') return [{ task: 'explain', label: 'Explain it', title: 'Explanation' }, ask];
  if (scope.kind === 'page') return [{ task: 'summary', label: 'Summarise it', title: 'Summary' }, ask];
  if (scope.kind === 'chapter') {
    return [
      { task: 'summary', label: 'Summarise it', title: 'Chapter summary' },
      { task: 'page-summaries', label: 'Summarise it page by page', title: 'Page by page' },
      { task: 'proofread', label: 'Check it for mistakes', title: 'Likely mistakes' },
      ask,
    ];
  }
  return [{ task: 'summary', label: 'Give an overview', title: 'Overview' }, ask];
}

interface Props {
  doc: ParsedDocument;
  scope: AiScope;
  valid: (sentenceId: string) => boolean;
  onSaveNote: (sentenceId: string, text: string) => void;
}

/** What was copied, so a reply pasted after moving on is still filed under the right part. */
interface Copied {
  title: string;
  start: string | undefined;
  opened: boolean;
}

export function CopyForClaude({ doc, scope, valid, onSaveNote }: Props) {
  const options = choices(scope);
  const [pick, setPick] = useState(0);
  const choice = options[pick] ?? options[0]!;
  const [question, setQuestion] = useState('');
  const [copied, setCopied] = useState<Copied | null>(null);
  const [manual, setManual] = useState<string | null>(null);
  const [reply, setReply] = useState('');
  useEffect(() => {
    setPick(0);
    setManual(null);
  }, [scope.key]);

  const n = scopeWords(scope);
  const ready = choice.task !== 'answer' || question.trim().length > 0;

  const copy = async (open: boolean) => {
    const text = chatPrompt(doc, scope, choice.task, question);
    const made = {
      title: choice.task === 'answer' ? `Question: ${question.trim()}` : `${choice.title} · ${scope.label}`,
      start: scope.blocks.find((b) => b.sentences.length)?.sentences[0]?.id,
    };
    setManual(null);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      setCopied({ ...made, opened: false });
      setManual(text);
      return;
    }
    let opened = false;
    if (open) {
      const w = window.open(CLAUDE_URL, '_blank');
      if (w) {
        w.opener = null;
        opened = true;
      }
    }
    setCopied({ ...made, opened });
  };

  const save = () => {
    const text = cleanPastedReply(reply);
    if (!text) return;
    const cited = /\[\s*(b\d+\.s\d+)/.exec(text)?.[1];
    const at = cited && valid(cited) ? cited : (copied?.start ?? scope.blocks.find((b) => b.sentences.length)?.sentences[0]?.id);
    if (!at) return;
    const title = copied?.title ?? `${choice.title} · ${scope.label}`;
    onSaveNote(at, `${title} (from Claude)\n\n${text}`);
    setReply('');
  };

  const openLink = (
    <a href={CLAUDE_URL} target="_blank" rel="noopener noreferrer">
      Open claude.ai
    </a>
  );

  return (
    <div class="copy-claude">
      <p class="hint">
        Use your own Claude subscription, no key needed. This copies {scope.label.toLowerCase() === 'whole document' ? 'the whole document' : scope.label} (about{' '}
        {n.toLocaleString()} words) with the instructions. Nothing leaves this device until you paste it into Claude.
      </p>
      {n > LONG_WORDS && <p class="warn">This is long. If Claude says it is too long for one chat, copy a chapter at a time.</p>}
      <label class="field">
        What Claude should do
        <select value={String(pick)} onChange={(e) => setPick(Number(e.currentTarget.value))}>
          {options.map((o, i) => (
            <option key={o.task} value={String(i)}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      {choice.task === 'answer' && (
        <label class="field">
          Your question
          <input type="text" value={question} placeholder="Type your question" onInput={(e) => setQuestion(e.currentTarget.value)} />
        </label>
      )}
      <div class="ai-actions">
        <button class="primary" disabled={!ready} onClick={() => void copy(true)}>
          Copy and open Claude
        </button>
        <button disabled={!ready} onClick={() => void copy(false)}>
          Copy only
        </button>
      </div>
      <div aria-live="polite">
        {copied && !manual && (
          <p class="hint done">
            {copied.opened ? 'Copied. Claude is open in a new tab: paste it there and send. ' : 'Copied. Open Claude, paste it and send. '}
            {!copied.opened && openLink}
          </p>
        )}
        {manual !== null && (
          <>
            <p class="hint done">This browser would not copy it. Select the text below, copy it, then {openLink}.</p>
            <textarea rows={4} readOnly value={manual} onFocus={(e) => e.currentTarget.select()} />
          </>
        )}
      </div>
      <label class="field">
        Claude's reply
        <textarea rows={4} value={reply} placeholder="Copy Claude's reply and paste it here." onInput={(e) => setReply(e.currentTarget.value)} />
      </label>
      <p class="hint">Sentence ids in the reply, like [b12.s3], become page links in your note.</p>
      <div class="ai-actions">
        <button disabled={!reply.trim()} onClick={save}>
          Save as note
        </button>
      </div>
    </div>
  );
}
