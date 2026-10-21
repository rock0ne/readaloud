// Runs one AI task and turns the reply into stored results (spec 17, ADR-30).
import type { AiResult, ParsedDocument } from '../types';
import { newId, nowIso } from '../util/ids';
import { sha256Hex } from '../util/hash';
import { AnthropicProvider } from './anthropic';
import { GeminiProvider } from './gemini';
import { OpenAiProvider } from './openai';
import type { AiProvider, FetchFn } from './provider';
import { AiError } from './provider';
import { blockLine, buildRequest, pageScope, parseSuggestions, resultKey, splitPages, summaryKind, type AiScope, type AiTask } from './prompts';
import type { AiProviderId } from '../types';

export const PROVIDER_IDS: readonly AiProviderId[] = ['anthropic', 'openai', 'gemini'];

export function makeProviders(fetchFn?: FetchFn): Record<AiProviderId, AiProvider> {
  return { anthropic: new AnthropicProvider(fetchFn), openai: new OpenAiProvider(fetchFn), gemini: new GeminiProvider(fetchFn) };
}

export interface AiStore {
  putAiResult(r: AiResult): Promise<void>;
}

export interface AssistantDeps {
  provider: AiProvider;
  model: string;
  key: string;
  store: AiStore;
}

export interface RunOptions {
  question?: string;
  signal?: AbortSignal;
  onText?: (sofar: string) => void;
}

/**
 * A fingerprint of the text a scope sends now; a stored result with another one is out of date.
 * Only the sentences count, so a new title or chapter label does not make a result out of date.
 */
export function scopeHash(_doc: ParsedDocument, scope: AiScope): Promise<string> {
  const lines = scope.blocks.filter((b) => b.sentences.length).map(blockLine);
  return sha256Hex(new TextEncoder().encode(lines.join('\n')));
}

/** Sends the task, stores what comes back and returns it; the first result is the main one. */
export async function runAi(deps: AssistantDeps, docId: string, doc: ParsedDocument, scope: AiScope, task: AiTask, opts: RunOptions = {}): Promise<AiResult[]> {
  const question = opts.question?.trim() ?? '';
  if (task === 'answer' && !question) throw new AiError('request', 'Type a question first.');
  const request = buildRequest(doc, scope, task, question);
  const inputHash = await scopeHash(doc, scope);
  opts.signal?.throwIfAborted();
  const reply = await deps.provider.complete(request, {
    key: deps.key,
    model: deps.model,
    ...(opts.signal ? { signal: opts.signal } : {}),
    ...(opts.onText ? { onText: opts.onText } : {}),
  });
  const text = reply.text.trim();
  if (!text) throw new AiError('server', `${deps.provider.company} sent an empty reply. Try again.`);
  const base = {
    docId,
    provider: deps.provider.id,
    model: reply.model,
    createdAt: nowIso(),
    text,
    inputHash,
    ...(reply.usage ? { usage: reply.usage } : {}),
    ...(reply.truncated ? { truncated: true } : {}),
  };
  const results: AiResult[] = [];
  if (task === 'summary' || task === 'explain') {
    const kind = summaryKind(scope.kind);
    results.push({ ...base, key: resultKey(docId, kind, scope.key), kind, scope: scope.key });
  } else if (task === 'page-summaries') {
    results.push({ ...base, key: resultKey(docId, 'page-summaries', scope.key), kind: 'page-summaries', scope: scope.key });
    const byLabel = splitPages(text, scope.pages.map((p) => p.label));
    for (const page of scope.pages) {
      const part = byLabel.get(page.label);
      // Each page's part is stored as that page's summary, fingerprinted as the page alone.
      if (part) results.push({ ...base, text: part, inputHash: await scopeHash(doc, pageScope(doc, page)), key: resultKey(docId, 'page-summary', page.key), kind: 'page-summary', scope: page.key });
    }
  } else if (task === 'proofread') {
    const sentences = new Map(scope.blocks.flatMap((b) => b.sentences.map((s) => [s.id, s.text] as const)));
    results.push({ ...base, key: resultKey(docId, 'proofread', scope.key), kind: 'proofread', scope: scope.key, suggestions: parseSuggestions(text, sentences) });
  } else {
    results.push({ ...base, key: resultKey(docId, 'answer', newId()), kind: 'answer', scope: scope.key, question });
  }
  for (const r of results) await deps.store.putAiResult(r);
  return results;
}
