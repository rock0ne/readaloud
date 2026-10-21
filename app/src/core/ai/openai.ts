// ChatGPT through the OpenAI Chat Completions API, with the user's key (ADR-30).
import type { AiModel, AiProvider, AiReply, AiRequest, CompleteOptions, FetchFn } from './provider';
import { AiError, browserFetch, parseJson, preferred, send, streamOf } from './provider';
import { readSse } from './sse';

const API = 'https://api.openai.com/v1';
const COMPANY = 'OpenAI';
const CHAT = /^(gpt-|chatgpt-|o\d)/;
const NOT_CHAT = /audio|realtime|tts|transcribe|image|search|embedding|instruct|moderation|dall-e|whisper|codex|computer-use|deep-research/;
const PREFERRED = ['gpt-5.1', 'gpt-5', 'gpt-4.1', 'gpt-4o'] as const;

interface ModelList {
  data?: Array<{ id?: unknown; created?: unknown }>;
}

interface Chunk {
  choices?: Array<{ delta?: { content?: string | null; refusal?: string | null }; finish_reason?: string | null }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
  error?: { message?: string };
}

export class OpenAiProvider implements AiProvider {
  readonly id = 'openai' as const;
  readonly label = 'ChatGPT';
  readonly company = COMPANY;
  readonly keyPage = 'https://platform.openai.com/api-keys';
  private readonly fetchFn: FetchFn;

  constructor(fetchFn: FetchFn = browserFetch) {
    this.fetchFn = fetchFn;
  }

  private headers(key: string): Record<string, string> {
    return { 'content-type': 'application/json', authorization: `Bearer ${key}` };
  }

  async listModels(key: string, signal?: AbortSignal): Promise<AiModel[]> {
    const res = await send(this.fetchFn, `${API}/models`, { headers: this.headers(key), ...(signal ? { signal } : {}) }, COMPANY);
    const body = (await res.json()) as ModelList;
    return (body.data ?? [])
      .filter((m): m is { id: string; created?: unknown } => typeof m.id === 'string' && CHAT.test(m.id) && !NOT_CHAT.test(m.id))
      .sort((a, b) => (typeof b.created === 'number' ? b.created : 0) - (typeof a.created === 'number' ? a.created : 0))
      .map((m) => ({ id: m.id, name: m.id }));
  }

  suggestModel(models: AiModel[]): string | undefined {
    return preferred(models, PREFERRED);
  }

  async complete(req: AiRequest, opts: CompleteOptions): Promise<AiReply> {
    const body = {
      model: opts.model,
      stream: true,
      stream_options: { include_usage: true },
      messages: [
        { role: 'system', content: req.system },
        // OpenAI caches a repeated start of a prompt by itself, so the document goes first.
        { role: 'user', content: `${req.document}\n\n${req.task}` },
      ],
    };
    const res = await send(
      this.fetchFn,
      `${API}/chat/completions`,
      { method: 'POST', headers: this.headers(opts.key), body: JSON.stringify(body), ...(opts.signal ? { signal: opts.signal } : {}) },
      COMPANY,
    );
    let text = '';
    let finish = '';
    let usage: AiReply['usage'];
    for await (const ev of readSse(await streamOf(res, COMPANY))) {
      if (ev.data === '[DONE]') break;
      const data = parseJson<Chunk>(ev.data);
      if (!data) continue;
      if (data.error) throw new AiError('server', `${COMPANY} stopped part way: ${data.error.message ?? 'unknown error'}`);
      const choice = data.choices?.[0];
      if (choice?.delta?.refusal) throw new AiError('refused', 'The model declined this request.');
      if (choice?.delta?.content) {
        text += choice.delta.content;
        opts.onText?.(text);
      }
      if (choice?.finish_reason) finish = choice.finish_reason;
      if (data.usage) usage = { input: data.usage.prompt_tokens ?? 0, output: data.usage.completion_tokens ?? 0 };
    }
    // A stream that ends without the provider's last word was cut off on the way: nothing is saved.
    if (!finish) throw new AiError('network', `The connection to ${COMPANY} dropped before the reply finished. Nothing was saved; try again.`);
    if (finish === 'content_filter') throw new AiError('refused', 'The model declined this request.');
    return { text, truncated: finish === 'length', model: opts.model, ...(usage ? { usage } : {}) };
  }
}
