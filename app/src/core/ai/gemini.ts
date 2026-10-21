// Gemini through the Google Generative Language API, with the user's key (ADR-30).
import type { AiModel, AiProvider, AiReply, AiRequest, CompleteOptions, FetchFn } from './provider';
import { AiError, browserFetch, parseJson, send, streamOf } from './provider';
import { readSse } from './sse';

const API = 'https://generativelanguage.googleapis.com/v1beta';
const COMPANY = 'Google';
const NOT_TEXT = /embedding|aqa|imagen|tts|image|live|native-audio|veo/;
const PREFERRED = ['gemini-2.5-pro', 'gemini-2.5-flash'] as const;
const BLOCKED = new Set(['SAFETY', 'RECITATION', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII']);

interface ModelList {
  models?: Array<{ name?: unknown; displayName?: unknown; supportedGenerationMethods?: unknown }>;
}

interface Chunk {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> }; finishReason?: string }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  promptFeedback?: { blockReason?: string };
  error?: { message?: string };
}

export class GeminiProvider implements AiProvider {
  readonly id = 'gemini' as const;
  readonly label = 'Gemini';
  readonly company = COMPANY;
  readonly keyPage = 'https://aistudio.google.com/apikey';
  private readonly fetchFn: FetchFn;

  constructor(fetchFn: FetchFn = browserFetch) {
    this.fetchFn = fetchFn;
  }

  private headers(key: string): Record<string, string> {
    // The key goes in a header, never in the URL (spec 15).
    return { 'content-type': 'application/json', 'x-goog-api-key': key };
  }

  async listModels(key: string, signal?: AbortSignal): Promise<AiModel[]> {
    const res = await send(this.fetchFn, `${API}/models?pageSize=1000`, { headers: this.headers(key), ...(signal ? { signal } : {}) }, COMPANY);
    const body = (await res.json()) as ModelList;
    const out: AiModel[] = [];
    for (const m of body.models ?? []) {
      if (typeof m.name !== 'string') continue;
      const id = m.name.replace(/^models\//, '');
      const methods = Array.isArray(m.supportedGenerationMethods) ? m.supportedGenerationMethods : [];
      if (!id.startsWith('gemini') || NOT_TEXT.test(id) || !methods.includes('generateContent')) continue;
      out.push({ id, name: typeof m.displayName === 'string' ? m.displayName : id });
    }
    return out;
  }

  suggestModel(models: AiModel[]): string | undefined {
    return PREFERRED.find((id) => models.some((m) => m.id === id)) ?? models.find((m) => m.id.includes('pro'))?.id ?? models[0]?.id;
  }

  async complete(req: AiRequest, opts: CompleteOptions): Promise<AiReply> {
    const body = {
      systemInstruction: { parts: [{ text: req.system }] },
      contents: [{ role: 'user', parts: [{ text: req.document }, { text: req.task }] }],
    };
    const res = await send(
      this.fetchFn,
      `${API}/models/${encodeURIComponent(opts.model)}:streamGenerateContent?alt=sse`,
      { method: 'POST', headers: this.headers(opts.key), body: JSON.stringify(body), ...(opts.signal ? { signal: opts.signal } : {}) },
      COMPANY,
    );
    let text = '';
    let finish = '';
    let usage: AiReply['usage'];
    for await (const ev of readSse(await streamOf(res, COMPANY))) {
      const data = parseJson<Chunk>(ev.data);
      if (!data) continue;
      if (data.error) throw new AiError('server', `${COMPANY} stopped part way: ${data.error.message ?? 'unknown error'}`);
      if (data.promptFeedback?.blockReason) throw new AiError('refused', 'The model declined this request.');
      const cand = data.candidates?.[0];
      for (const part of cand?.content?.parts ?? []) {
        if (part.thought || !part.text) continue;
        text += part.text;
        opts.onText?.(text);
      }
      if (cand?.finishReason) finish = cand.finishReason;
      const u = data.usageMetadata;
      if (u) usage = { input: u.promptTokenCount ?? 0, output: u.candidatesTokenCount ?? 0 };
    }
    // A stream that ends without the provider's last word was cut off on the way: nothing is saved.
    if (!finish) throw new AiError('network', `The connection to ${COMPANY} dropped before the reply finished. Nothing was saved; try again.`);
    if (BLOCKED.has(finish)) throw new AiError('refused', 'The model declined this request.');
    return { text, truncated: finish === 'MAX_TOKENS', model: opts.model, ...(usage ? { usage } : {}) };
  }
}
