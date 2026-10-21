// Claude through the Anthropic Messages API, called from the browser with the user's key (ADR-30).
import type { AiModel, AiProvider, AiReply, AiRequest, CompleteOptions, FetchFn } from './provider';
import { AiError, browserFetch, parseJson, preferred, send, streamOf } from './provider';
import { readSse } from './sse';

const API = 'https://api.anthropic.com/v1';
const COMPANY = 'Anthropic';

/** Claude 5 models take an effort level and up to 128K output tokens. */
const CLAUDE_5 = /^claude-(opus|sonnet|haiku|fable|mythos)-5/;
/** Models that accept `fallbacks: "default"` on the Claude API; Haiku 5.5 has none. */
const FALLBACK_MODELS: ReadonlySet<string> = new Set(['claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5', 'claude-fable-5-1']);
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
const PREFERRED = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-fable-5-1', 'claude-haiku-5-5'] as const;

interface ModelList {
  data?: Array<{ id?: unknown; display_name?: unknown }>;
}

interface Usage {
  input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  output_tokens?: number;
}

interface StreamEvent {
  type?: string;
  message?: { model?: string; usage?: Usage };
  delta?: { type?: string; text?: string; stop_reason?: string };
  usage?: Usage;
  error?: { message?: string };
}

export class AnthropicProvider implements AiProvider {
  readonly id = 'anthropic' as const;
  readonly label = 'Claude';
  readonly company = COMPANY;
  readonly keyPage = 'https://console.anthropic.com/settings/keys';
  private readonly fetchFn: FetchFn;

  constructor(fetchFn: FetchFn = browserFetch) {
    this.fetchFn = fetchFn;
  }

  private headers(key: string, beta?: string): Record<string, string> {
    return {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      // Anthropic asks browser callers to say so; the key is the reader's own (ADR-30).
      'anthropic-dangerous-direct-browser-access': 'true',
      ...(beta ? { 'anthropic-beta': beta } : {}),
    };
  }

  async listModels(key: string, signal?: AbortSignal): Promise<AiModel[]> {
    const res = await send(this.fetchFn, `${API}/models?limit=100`, { headers: this.headers(key), ...(signal ? { signal } : {}) }, COMPANY);
    const body = (await res.json()) as ModelList;
    return (body.data ?? [])
      .filter((m): m is { id: string; display_name?: unknown } => typeof m.id === 'string' && m.id.startsWith('claude-'))
      .map((m) => ({ id: m.id, name: typeof m.display_name === 'string' ? m.display_name : m.id }));
  }

  suggestModel(models: AiModel[]): string | undefined {
    return preferred(models, PREFERRED);
  }

  async complete(req: AiRequest, opts: CompleteOptions): Promise<AiReply> {
    const fallbacks = FALLBACK_MODELS.has(opts.model);
    try {
      return await this.run(req, opts, fallbacks);
    } catch (e) {
      // An account or model that does not take the fallback option gets the request without it.
      if (fallbacks && e instanceof AiError && e.kind === 'request' && /fallback/i.test(e.message)) return this.run(req, opts, false);
      throw e;
    }
  }

  private async run(req: AiRequest, opts: CompleteOptions, fallbacks: boolean): Promise<AiReply> {
    const claude5 = CLAUDE_5.test(opts.model);
    const body = {
      model: opts.model,
      max_tokens: claude5 ? 64000 : 8192,
      stream: true,
      system: req.system,
      messages: [
        {
          role: 'user',
          content: [
            // The document comes first and is cached, so a second question about it costs less.
            { type: 'text', text: req.document, cache_control: { type: 'ephemeral' } },
            { type: 'text', text: req.task },
          ],
        },
      ],
      ...(claude5 ? { output_config: { effort: 'medium' } } : {}),
      ...(fallbacks ? { fallbacks: 'default' } : {}),
    };
    const res = await send(
      this.fetchFn,
      `${API}/messages`,
      { method: 'POST', headers: this.headers(opts.key, fallbacks ? FALLBACK_BETA : undefined), body: JSON.stringify(body), ...(opts.signal ? { signal: opts.signal } : {}) },
      COMPANY,
    );
    let text = '';
    let stop = '';
    let model = opts.model;
    let input = 0;
    let output = 0;
    for await (const ev of readSse(await streamOf(res, COMPANY))) {
      const data = parseJson<StreamEvent>(ev.data);
      if (!data) continue;
      if (data.type === 'message_start') {
        model = data.message?.model ?? model;
        const u = data.message?.usage;
        input = (u?.input_tokens ?? 0) + (u?.cache_creation_input_tokens ?? 0) + (u?.cache_read_input_tokens ?? 0);
      } else if (data.type === 'content_block_delta' && data.delta?.type === 'text_delta' && data.delta.text) {
        text += data.delta.text;
        opts.onText?.(text);
      } else if (data.type === 'message_delta') {
        stop = data.delta?.stop_reason ?? stop;
        output = data.usage?.output_tokens ?? output;
      } else if (data.type === 'error') {
        throw new AiError('server', `${COMPANY} stopped part way: ${data.error?.message ?? 'unknown error'}`);
      }
    }
    // A stream that ends without the provider's last word was cut off on the way: nothing is saved.
    if (!stop) throw new AiError('network', `The connection to ${COMPANY} dropped before the reply finished. Nothing was saved; try again.`);
    if (stop === 'refusal') throw new AiError('refused', 'The model declined this request.');
    return { text, truncated: stop === 'max_tokens', model, usage: { input, output } };
  }
}
