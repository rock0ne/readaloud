import { describe, expect, it } from 'vitest';
import { readSse } from '../src/core/ai/sse';
import { AnthropicProvider } from '../src/core/ai/anthropic';
import { OpenAiProvider } from '../src/core/ai/openai';
import { GeminiProvider } from '../src/core/ai/gemini';
import { AiError, type FetchFn } from '../src/core/ai/provider';
import { dateBounds, expiryAfterDays, expiryOnDate, isExpired, keyHint, keyRecord } from '../src/core/ai/keys';
import { PageIndex, PAGE_CHARS, makePages } from '../src/core/text/pages';
import { bookScope, buildRequest, chapterScope, chatPrompt, cleanPastedReply, pageScope, paragraphScope, parseSuggestions, replaceCitations, scopeIds, scopeText, speakable, splitCitations, splitPages } from '../src/core/ai/prompts';
import { runAi, scopeHash } from '../src/core/ai/assistant';
import type { AiResult } from '../src/core/types';
import type { RawBlock } from '../src/core/ingest/raw';
import { makeDoc } from './helpers/docs';

/** A streamed response cut into awkward pieces, as a network delivers it. */
function streamed(text: string, size = 7, status = 200): Response {
  const bytes = new TextEncoder().encode(text);
  let at = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(c) {
      if (at >= bytes.length) return c.close();
      c.enqueue(bytes.slice(at, at + size));
      at += size;
    },
  });
  return new Response(body, { status, headers: { 'content-type': 'text/event-stream' } });
}

const sse = (events: unknown[], named = false) =>
  events.map((e) => `${named ? `event: ${(e as { type: string }).type}\r\n` : ''}data: ${typeof e === 'string' ? e : JSON.stringify(e)}\r\n\r\n`).join('');

interface Call {
  url: string;
  init: RequestInit;
}

function fakeFetch(...responses: Array<() => Response>): { fetch: FetchFn; calls: Call[] } {
  const calls: Call[] = [];
  let i = 0;
  return {
    calls,
    fetch: async (url, init) => {
      calls.push({ url, init });
      const make = responses[Math.min(i++, responses.length - 1)];
      return make!();
    },
  };
}

const json = (body: unknown, status = 200) => () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const headers = (c: Call) => c.init.headers as Record<string, string>;
const bodyOf = (c: Call) => JSON.parse(String(c.init.body)) as Record<string, unknown>;
const req = { system: 'SYS', document: 'DOC', task: 'TASK' };

describe('AI1 server-sent events', () => {
  it('reads events split across reads, with CRLF line ends and comments', async () => {
    const text = ': keep-alive\r\n\r\nevent: a\r\ndata: one\r\n\r\ndata: two\r\ndata: lines\r\n\r\ndata: last';
    const got = [];
    for await (const ev of readSse(streamed(text, 3).body!)) got.push(ev);
    expect(got).toEqual([
      { event: 'a', data: 'one' },
      { event: 'message', data: 'two\nlines' },
      { event: 'message', data: 'last' },
    ]);
  });
});

describe('AI2 Claude', () => {
  const claudeStream = sse(
    [
      { type: 'message_start', message: { model: 'claude-opus-5-5', usage: { input_tokens: 100, cache_read_input_tokens: 900 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello ' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'reader [b1.s0].' } },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 12 } },
      { type: 'message_stop' },
    ],
    true,
  );

  it('sends the key in a header, the document as a cached block, effort and fallbacks', async () => {
    const f = fakeFetch(() => streamed(claudeStream));
    const seen: string[] = [];
    const reply = await new AnthropicProvider(f.fetch).complete(req, { key: 'test-key', model: 'claude-opus-5-5', onText: (t) => seen.push(t) });
    expect(reply).toEqual({ text: 'Hello reader [b1.s0].', truncated: false, model: 'claude-opus-5-5', usage: { input: 1000, output: 12 } });
    expect(seen).toEqual(['Hello ', 'Hello reader [b1.s0].']);
    const call = f.calls[0]!;
    expect(call.url).toBe('https://api.anthropic.com/v1/messages');
    expect(call.url).not.toContain('test-key');
    expect(headers(call)).toMatchObject({
      'x-api-key': 'test-key',
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
      'anthropic-beta': 'server-side-fallback-2026-07-01',
    });
    const body = bodyOf(call);
    expect(body).toMatchObject({ model: 'claude-opus-5-5', stream: true, system: 'SYS', fallbacks: 'default', output_config: { effort: 'medium' }, max_tokens: 64000 });
    expect(body.messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'DOC', cache_control: { type: 'ephemeral' } },
          { type: 'text', text: 'TASK' },
        ],
      },
    ]);
  });

  it('sends no fallbacks for Haiku 5.5 and no effort for older models', async () => {
    const f = fakeFetch(() => streamed(claudeStream));
    const p = new AnthropicProvider(f.fetch);
    await p.complete(req, { key: 'k', model: 'claude-haiku-5-5' });
    await p.complete(req, { key: 'k', model: 'claude-haiku-4-5' });
    expect(headers(f.calls[0]!)['anthropic-beta']).toBeUndefined();
    expect(bodyOf(f.calls[0]!)).not.toHaveProperty('fallbacks');
    expect(bodyOf(f.calls[0]!).output_config).toEqual({ effort: 'medium' });
    expect(bodyOf(f.calls[1]!)).not.toHaveProperty('output_config');
    expect(bodyOf(f.calls[1]!).max_tokens).toBe(8192);
  });

  it('retries once without fallbacks when the API rejects the option', async () => {
    const f = fakeFetch(json({ type: 'error', error: { type: 'invalid_request_error', message: 'fallbacks: not available' } }, 400), () => streamed(claudeStream));
    const reply = await new AnthropicProvider(f.fetch).complete(req, { key: 'k', model: 'claude-sonnet-5-5' });
    expect(reply.text).toBe('Hello reader [b1.s0].');
    expect(f.calls).toHaveLength(2);
    expect(bodyOf(f.calls[1]!)).not.toHaveProperty('fallbacks');
    expect(headers(f.calls[1]!)['anthropic-beta']).toBeUndefined();
  });

  it('turns a refusal, a refused key and a dropped connection into clear errors', async () => {
    const refusal = sse([{ type: 'message_start', message: { usage: {} } }, { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Part' } }, { type: 'message_delta', delta: { stop_reason: 'refusal' }, usage: {} }]);
    const p = (r: () => Response) => new AnthropicProvider(fakeFetch(r).fetch).complete(req, { key: 'k', model: 'claude-opus-5-5' });
    await expect(p(() => streamed(refusal))).rejects.toMatchObject({ kind: 'refused', message: 'The model declined this request.' });
    await expect(p(json({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }, 401))).rejects.toMatchObject({ kind: 'auth' });
    await expect(p(json({ error: { message: 'slow down' } }, 429))).rejects.toMatchObject({ kind: 'rate' });
    const offline = new AnthropicProvider(async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(offline.complete(req, { key: 'k', model: 'claude-opus-5-5' })).rejects.toMatchObject({ kind: 'network' });
    const truncated = sse([{ type: 'content_block_delta', delta: { type: 'text_delta', text: 'Long' } }, { type: 'message_delta', delta: { stop_reason: 'max_tokens' }, usage: { output_tokens: 5 } }]);
    expect((await p(() => streamed(truncated))).truncated).toBe(true);
  });

  it('lists Claude models and suggests Opus 5.5', async () => {
    const f = fakeFetch(json({ data: [{ id: 'claude-haiku-5-5', display_name: 'Claude Haiku 5.5' }, { id: 'claude-opus-5-5', display_name: 'Claude Opus 5.5' }] }));
    const p = new AnthropicProvider(f.fetch);
    const models = await p.listModels('k');
    expect(models.map((m) => m.name)).toEqual(['Claude Haiku 5.5', 'Claude Opus 5.5']);
    expect(p.suggestModel(models)).toBe('claude-opus-5-5');
    expect(f.calls[0]!.url).toBe('https://api.anthropic.com/v1/models?limit=100');
  });
});

describe('AI3 ChatGPT', () => {
  const chunks = sse([
    { choices: [{ delta: { role: 'assistant', content: '' } }] },
    { choices: [{ delta: { content: 'Short ' } }] },
    { choices: [{ delta: { content: 'answer.' }, finish_reason: 'stop' }] },
    { choices: [], usage: { prompt_tokens: 50, completion_tokens: 3 } },
    '[DONE]',
  ]);

  it('streams the reply with usage and a bearer key', async () => {
    const f = fakeFetch(() => streamed(chunks));
    const reply = await new OpenAiProvider(f.fetch).complete(req, { key: 'test-key', model: 'gpt-5' });
    expect(reply).toEqual({ text: 'Short answer.', truncated: false, model: 'gpt-5', usage: { input: 50, output: 3 } });
    expect(headers(f.calls[0]!).authorization).toBe('Bearer test-key');
    expect(bodyOf(f.calls[0]!)).toMatchObject({ model: 'gpt-5', stream: true, messages: [{ role: 'system', content: 'SYS' }, { role: 'user', content: 'DOC\n\nTASK' }] });
  });

  it('marks a cut-off reply and refuses on a content filter', async () => {
    const cut = sse([{ choices: [{ delta: { content: 'x' }, finish_reason: 'length' }] }, '[DONE]']);
    const filtered = sse([{ choices: [{ delta: {}, finish_reason: 'content_filter' }] }, '[DONE]']);
    expect((await new OpenAiProvider(fakeFetch(() => streamed(cut)).fetch).complete(req, { key: 'k', model: 'gpt-5' })).truncated).toBe(true);
    await expect(new OpenAiProvider(fakeFetch(() => streamed(filtered)).fetch).complete(req, { key: 'k', model: 'gpt-5' })).rejects.toBeInstanceOf(AiError);
  });

  it('lists chat models only, newest first', async () => {
    const f = fakeFetch(json({ data: [{ id: 'gpt-4o', created: 1 }, { id: 'text-embedding-3-small', created: 9 }, { id: 'gpt-5', created: 5 }, { id: 'gpt-4o-realtime-preview', created: 6 }, { id: 'whisper-1', created: 2 }] }));
    const p = new OpenAiProvider(f.fetch);
    const models = await p.listModels('k');
    expect(models.map((m) => m.id)).toEqual(['gpt-5', 'gpt-4o']);
    expect(p.suggestModel(models)).toBe('gpt-5');
  });
});

describe('AI4 Gemini', () => {
  it('keeps the key out of the URL and skips thought parts', async () => {
    const chunks = sse([
      { candidates: [{ content: { parts: [{ text: 'thinking…', thought: true }, { text: 'One ' }] } }] },
      { candidates: [{ content: { parts: [{ text: 'two.' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 40, candidatesTokenCount: 2 } },
    ]);
    const f = fakeFetch(() => streamed(chunks));
    const reply = await new GeminiProvider(f.fetch).complete(req, { key: 'test-key', model: 'gemini-2.5-pro' });
    expect(reply).toEqual({ text: 'One two.', truncated: false, model: 'gemini-2.5-pro', usage: { input: 40, output: 2 } });
    expect(f.calls[0]!.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:streamGenerateContent?alt=sse');
    expect(headers(f.calls[0]!)['x-goog-api-key']).toBe('test-key');
    expect(bodyOf(f.calls[0]!)).toEqual({ systemInstruction: { parts: [{ text: 'SYS' }] }, contents: [{ role: 'user', parts: [{ text: 'DOC' }, { text: 'TASK' }] }] });
  });

  it('treats a safety stop as declined and a bad key as refused', async () => {
    const blocked = sse([{ candidates: [{ finishReason: 'SAFETY' }] }]);
    await expect(new GeminiProvider(fakeFetch(() => streamed(blocked)).fetch).complete(req, { key: 'k', model: 'gemini-2.5-pro' })).rejects.toMatchObject({ kind: 'refused' });
    const bad = json({ error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT' } }, 400);
    await expect(new GeminiProvider(fakeFetch(bad).fetch).listModels('k')).rejects.toMatchObject({ kind: 'auth' });
  });

  it('lists text models that can generate content', async () => {
    const f = fakeFetch(
      json({
        models: [
          { name: 'models/gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', supportedGenerationMethods: ['generateContent', 'countTokens'] },
          { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
          { name: 'models/gemini-2.5-pro', displayName: 'Gemini 2.5 Pro', supportedGenerationMethods: ['generateContent'] },
          { name: 'models/gemini-2.5-flash-preview-tts', supportedGenerationMethods: ['generateContent'] },
        ],
      }),
    );
    const p = new GeminiProvider(f.fetch);
    const models = await p.listModels('k');
    expect(models.map((m) => m.id)).toEqual(['gemini-2.5-flash', 'gemini-2.5-pro']);
    expect(p.suggestModel(models)).toBe('gemini-2.5-pro');
  });
});

describe('AI5 key lifetime', () => {
  const now = new Date('2026-10-21T10:00:00Z');

  it('keeps a key for the chosen days, at most a year', () => {
    expect(expiryAfterDays(now, 30)).toBe('2026-11-20T10:00:00.000Z');
    expect(expiryAfterDays(now, 5000)).toBe(expiryAfterDays(now, 365));
    expect(expiryAfterDays(now, 0)).toBe(expiryAfterDays(now, 1));
  });

  it('accepts a date up to a year ahead and refuses a past one', () => {
    const in2Weeks = expiryOnDate(now, '2026-11-04')!;
    expect(new Date(in2Weeks).getDate()).toBe(4);
    expect(expiryOnDate(now, '2026-10-20')).toBeNull();
    expect(expiryOnDate(now, 'not a date')).toBeNull();
    expect(expiryOnDate(now, '2030-01-01')).toBe(expiryAfterDays(now, 365));
    expect(dateBounds(now).max <= '2027-10-21').toBe(true);
  });

  it('knows when a key has expired and hints at a wrong-looking key', () => {
    const rec = keyRecord('anthropic', '  abc  ', '2026-10-22T00:00:00.000Z', now);
    expect(rec.key).toBe('abc');
    expect(isExpired(rec, now)).toBe(false);
    expect(isExpired(rec, new Date('2026-10-22T00:00:00Z'))).toBe(true);
    expect(keyHint('anthropic', 'abc')).toMatch(/usually start/);
    expect(keyHint('gemini', 'AIza with space')).toMatch(/space/);
    expect(keyHint('openai', 'sk-something')).toBeNull();
  });
});

const para = (n: number, chars: number): RawBlock => ({ type: 'paragraph', text: `Paragraph ${n} ${'word '.repeat(Math.max(1, Math.floor(chars / 5) - 3))}end.` });

describe('AI6 pages', () => {
  it('makes reading pages of about 1,800 characters that never cross a chapter', () => {
    const doc = makeDoc([
      { type: 'heading', level: 1, text: 'One' },
      para(1, 900),
      para(2, 800),
      para(3, 900),
      para(4, 2500),
      { type: 'heading', level: 1, text: 'Two' },
      para(5, 300),
    ]);
    const pages = makePages(doc);
    expect(pages.map((p) => p.label)).toEqual(['1', '2', '3', '4']);
    expect(pages.map((p) => p.blockIds)).toEqual([['b0', 'b1', 'b2'], ['b3'], ['b4'], ['b5', 'b6']]);
    expect(pages.every((p) => p.blockIds.length === 1 || p.chars <= PAGE_CHARS)).toBe(true);
    expect(pages[3]?.chapterIndex).toBe(1);
    const index = new PageIndex(doc);
    expect(index.ofSentence('b4.s0')?.label).toBe('3');
    expect(index.inChapter(0)).toHaveLength(3);
  });

  it('uses a PDF’s own page numbers', () => {
    const doc = makeDoc([
      { type: 'heading', level: 1, text: 'One', page: 5 },
      { type: 'paragraph', text: 'On five.', page: 5 },
      { type: 'paragraph', text: 'On six.', page: 6 },
      { type: 'heading', level: 1, text: 'Two', page: 6 },
      { type: 'paragraph', text: 'Still six.', page: 6 },
    ]);
    expect(makePages(doc).map((p) => p.key)).toEqual(['c0p5', 'c0p6', 'c1p6']);
  });
});

describe('AI7 prompts and replies', () => {
  const doc = makeDoc([
    { type: 'heading', level: 1, text: 'The Start' },
    { type: 'paragraph', text: 'Anna met Ben. They talked.' },
    { type: 'heading', level: 1, text: 'The End' },
    { type: 'paragraph', text: 'Ben left the town.' },
  ]);
  const pages = new PageIndex(doc);

  it('sends sentence ids and page marks, with the same document part for every task', () => {
    const scope = chapterScope(doc, pages, 0);
    expect(scopeText(doc, scope)).toBe('Title: Doc\nPart: Chapter 1: The Start\n\n=== Page 1 ===\n[b0.s0] The Start\n[b1.s0] Anna met Ben. [b1.s1] They talked.');
    const a = buildRequest(doc, scope, 'summary');
    const b = buildRequest(doc, scope, 'answer', 'Who met?');
    expect(a.system).toBe(b.system);
    expect(a.document).toBe(b.document);
    expect(b.task).toMatch(/Question: Who met\?$/);
    expect(pageScope(doc, pages.pages[1]!).blocks.map((x) => x.id)).toEqual(['b2', 'b3']);
    expect(scopeIds(bookScope(doc, pages)).size).toBe(5);
  });

  it('keeps a chapter title that already names itself as it is', () => {
    const named = makeDoc([
      { type: 'heading', level: 1, text: 'Chapter 2: The Storm' },
      { type: 'paragraph', text: 'Rain fell.' },
      { type: 'heading', level: 1, text: 'Part Two' },
      { type: 'paragraph', text: 'It cleared.' },
    ]);
    const namedPages = new PageIndex(named);
    expect(chapterScope(named, namedPages, 0)).toMatchObject({ label: 'Chapter 2: The Storm', phrase: '"Chapter 2: The Storm"' });
    expect(chapterScope(named, namedPages, 1).label).toBe('Part Two');
    expect(chapterScope(doc, pages, 1)).toMatchObject({ label: 'Chapter 2: The End', phrase: 'chapter 2, "The End"' });
  });

  it('turns citations into links only for sentences that were sent', () => {
    const valid = (id: string) => id === 'b1.s0' || id === 'b1.s1';
    expect(splitCitations('They meet [b1.s0, b1.s1]. Later [b9.s9].', valid)).toEqual([{ text: 'They meet ' }, { cite: ['b1.s0', 'b1.s1'] }, { text: '. Later [b9.s9].' }]);
    expect(replaceCitations('They meet [b1.s0]. Done [b3.s0].', (ids) => (ids[0] === 'b1.s0' ? '(p. 1)' : ''))).toBe('They meet (p. 1). Done.');
    expect(speakable('- First point [b1.s0]\n- Second point.')).toBe('First point.\nSecond point.');
  });

  it('splits a page-by-page reply', () => {
    const reply = 'Here you go.\n**Page 1:**\n- Anna meets Ben [b1.s0]\nPage 2: Ben leaves.\n- More\nPage 7:\n- not asked';
    const out = splitPages(reply, ['1', '2']);
    expect(out.get('1')).toBe('- Anna meets Ben [b1.s0]');
    expect(out.get('2')).toBe('Ben leaves.\n- More');
    expect(out.has('7')).toBe(false);
  });

  it('reads mistakes, dropping unknown ids, repeats and fixes that change nothing', () => {
    const sentences = new Map([
      ['b1.s0', 'Anna met Ben.'],
      ['b1.s1', 'They talkd.'],
    ]);
    const reply = [
      '```json',
      '{"id": "b1.s1", "issue": "typo: talkd", "fix": "They talked."}',
      '{"id": "b1.s1", "issue": "again", "fix": "They talked!"}',
      '{"id": "b9.s9", "issue": "not sent", "fix": "x"}',
      '{"id": "b1.s0", "issue": "nothing", "fix": "Anna met Ben."}',
      'not json',
      '```',
    ].join('\n');
    expect(parseSuggestions(reply, sentences)).toEqual([{ sentenceId: 'b1.s1', issue: 'typo: talkd', fix: 'They talked.', state: 'new' }]);
    expect(parseSuggestions('NONE', sentences)).toEqual([]);
  });

  it('stores a page-by-page reply as the chapter result and one result per page', async () => {
    const big = makeDoc([{ type: 'heading', level: 1, text: 'One' }, para(1, 1500), para(2, 1500)]);
    const bigPages = new PageIndex(big);
    const stored: AiResult[] = [];
    const provider = new AnthropicProvider(fakeFetch(() => streamed(sse([{ type: 'content_block_delta', delta: { type: 'text_delta', text: 'Page 1:\n- a [b1.s0]\nPage 2:\n- b [b2.s0]' } }, { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: {} }]))).fetch);
    const results = await runAi({ provider, model: 'claude-opus-5-5', key: 'k', store: { putAiResult: async (r) => void stored.push(r) } }, 'doc-x', big, chapterScope(big, bigPages, 0), 'page-summaries');
    expect(results.map((r) => [r.kind, r.scope])).toEqual([
      ['page-summaries', 'c0'],
      ['page-summary', 'c0p1'],
      ['page-summary', 'c0p2'],
    ]);
    expect(results[2]?.text).toBe('- b [b2.s0]');
    expect(stored).toHaveLength(3);
    await expect(runAi({ provider, model: 'm', key: 'k', store: { putAiResult: async () => undefined } }, 'doc-x', big, bookScope(big, bigPages), 'answer', { question: '  ' })).rejects.toMatchObject({ kind: 'request' });
  });
});

describe('AI8 failures and freshness', () => {
  it('treats a stream that stops before the provider finished as a dropped connection', async () => {
    const half = sse([{ type: 'message_start', message: { usage: {} } }, { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Half a sum' } }]);
    await expect(new AnthropicProvider(fakeFetch(() => streamed(half)).fetch).complete(req, { key: 'k', model: 'claude-opus-5-5' })).rejects.toMatchObject({ kind: 'network' });
    const halfGpt = sse([{ choices: [{ delta: { content: 'Half' } }] }]);
    await expect(new OpenAiProvider(fakeFetch(() => streamed(halfGpt)).fetch).complete(req, { key: 'k', model: 'gpt-5' })).rejects.toMatchObject({ kind: 'network' });
    const halfGemini = sse([{ candidates: [{ content: { parts: [{ text: 'Half' }] } }] }]);
    await expect(new GeminiProvider(fakeFetch(() => streamed(halfGemini)).fetch).complete(req, { key: 'k', model: 'gemini-2.5-pro' })).rejects.toMatchObject({ kind: 'network' });
  });

  it('stops promptly when cancelled and stores nothing', async () => {
    const ac = new AbortController();
    // Like fetch: rejects at once if the signal is already aborted, otherwise when it is.
    const hang: FetchFn = (_url, init) =>
      new Promise((_resolve, reject) => {
        const abort = () => reject(new DOMException('Aborted', 'AbortError'));
        if (init.signal?.aborted) abort();
        else init.signal?.addEventListener('abort', abort);
      });
    const doc = makeDoc([{ type: 'paragraph', text: 'Some text.' }]);
    const stored: AiResult[] = [];
    const run = runAi({ provider: new OpenAiProvider(hang), model: 'gpt-5', key: 'k', store: { putAiResult: async (r) => void stored.push(r) } }, 'd', doc, bookScope(doc, new PageIndex(doc)), 'summary', { signal: ac.signal });
    ac.abort();
    await expect(run).rejects.toMatchObject({ name: 'AbortError' });
    expect(stored).toEqual([]);
  });

  it('explains a paragraph with its neighbours and fingerprints what it sent', async () => {
    const doc = makeDoc([
      { type: 'heading', level: 1, text: 'One' },
      { type: 'paragraph', text: 'Before it.' },
      { type: 'paragraph', text: 'The hard part.' },
      { type: 'paragraph', text: 'After it.' },
    ]);
    const pages = new PageIndex(doc);
    const scope = paragraphScope(doc, pages, 'b2')!;
    expect(scope.blocks.map((b) => b.id)).toEqual(['b1', 'b2', 'b3']);
    expect(buildRequest(doc, scope, 'explain').task).toContain('the paragraph that starts at [b2.s0]');
    const provider = new AnthropicProvider(fakeFetch(() => streamed(sse([{ type: 'content_block_delta', delta: { type: 'text_delta', text: 'It means [b2.s0].' } }, { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: {} }]))).fetch);
    const [r] = await runAi({ provider, model: 'claude-opus-5-5', key: 'k', store: { putAiResult: async () => undefined } }, 'd', doc, scope, 'explain');
    expect(r).toMatchObject({ kind: 'explanation', scope: 'b2', key: 'd|explanation|b2' });
    expect(r?.inputHash).toBe(await scopeHash(doc, scope));
    const edited = makeDoc([{ type: 'heading', level: 1, text: 'One' }, { type: 'paragraph', text: 'Before it.' }, { type: 'paragraph', text: 'The hard part, changed.' }, { type: 'paragraph', text: 'After it.' }]);
    expect(await scopeHash(edited, paragraphScope(edited, new PageIndex(edited), 'b2')!)).not.toBe(r?.inputHash);
    // A new document title or chapter label changes no sentence, so the result stays current.
    expect(await scopeHash({ ...doc, title: 'Renamed' }, { ...scope, label: 'Another label' })).toBe(r?.inputHash);
  });
});

describe('AI9 Copy for Claude (ADR-32)', () => {
  const doc = makeDoc([
    { type: 'heading', level: 1, text: 'The Start' },
    { type: 'paragraph', text: 'Anna met Ben. They talkd.' },
  ]);
  const scope = chapterScope(doc, new PageIndex(doc), 0);

  it('puts the instructions, the document with its sentence ids and then the task in one text', () => {
    const text = chatPrompt(doc, scope, 'summary');
    const req = buildRequest(doc, scope, 'summary');
    expect(text.startsWith(req.system)).toBe(true);
    expect(text).toContain(`<document>\n${req.document}\n</document>`);
    expect(text.endsWith(req.task)).toBe(true);
    expect(text).toContain('[b1.s1] They talkd.');
  });

  it('asks for mistakes as lines a person can read, and passes a question on', () => {
    const mistakes = chatPrompt(doc, scope, 'proofread');
    expect(mistakes).toContain(' → ');
    expect(mistakes).not.toContain('JSON');
    expect(chatPrompt(doc, scope, 'answer', 'Who met?')).toMatch(/Question: Who met\?$/);
  });

  it('tidies a pasted reply', () => {
    expect(cleanPastedReply('## Summary\r\n\r\n\r\n- Anna meets Ben [b1.s0]  \r\n')).toBe('Summary\n\n- Anna meets Ben [b1.s0]');
  });
});
