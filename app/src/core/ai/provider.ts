// The AI provider contract (spec 17.2, ADR-30) and the error handling the three providers share.
import type { AiProviderId } from '../types';

export interface AiModel {
  id: string;
  name: string;
}

/** Kept in three parts so the document can be cached apart from the task. */
export interface AiRequest {
  system: string;
  document: string;
  task: string;
}

export interface AiReply {
  text: string;
  truncated: boolean; // stopped at the length limit
  model: string; // the model that answered (a fallback may have)
  usage?: { input: number; output: number };
}

export interface CompleteOptions {
  key: string;
  model: string;
  signal?: AbortSignal;
  /** Called with the whole text so far each time more arrives. */
  onText?: (sofar: string) => void;
}

export interface AiProvider {
  readonly id: AiProviderId;
  /** What people call it: Claude, ChatGPT, Gemini. */
  readonly label: string;
  readonly company: string;
  /** Where to make a key. */
  readonly keyPage: string;
  listModels(key: string, signal?: AbortSignal): Promise<AiModel[]>;
  suggestModel(models: AiModel[]): string | undefined;
  complete(req: AiRequest, opts: CompleteOptions): Promise<AiReply>;
}

export type AiErrorKind = 'auth' | 'rate' | 'network' | 'refused' | 'request' | 'server';

export class AiError extends Error {
  readonly kind: AiErrorKind;
  readonly status: number | undefined;
  constructor(kind: AiErrorKind, message: string, status?: number) {
    super(message);
    this.name = 'AiError';
    this.kind = kind;
    this.status = status;
  }
}

export type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

export const browserFetch: FetchFn = (url, init) => fetch(url, init);

export function isAbort(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { name?: unknown }).name === 'AbortError';
}

interface ErrorBody {
  error?: { message?: unknown } | string;
  message?: unknown;
}

function messageOf(body: unknown): string {
  const b = (Array.isArray(body) ? body[0] : body) as ErrorBody | undefined;
  const m = typeof b?.error === 'string' ? b.error : (b?.error?.message ?? b?.message);
  return typeof m === 'string' ? m.trim().slice(0, 300) : '';
}

/** Turns a failed response into an AiError, with the provider's own words where it gives some. */
export async function httpError(res: Response, company: string): Promise<AiError> {
  let detail = '';
  try {
    detail = messageOf(await res.json());
  } catch {
    // no JSON body
  }
  const s = res.status;
  const more = detail ? ` (${detail})` : '';
  if (s === 401 || s === 403 || (s === 400 && /api[ _-]?key/i.test(detail))) {
    return new AiError('auth', `${company} refused the key. Check it in Settings.${more}`, s);
  }
  if (s === 402 || s === 429) return new AiError('rate', `${company} says too many requests, or the account has no credit left.${more}`, s);
  if (s >= 500) return new AiError('server', `${company} is busy or unavailable (error ${s}). Try again in a minute.`, s);
  return new AiError('request', `${company} could not do this: ${detail || `error ${s}`}`, s);
}

/** Sends a request; a network failure or an error status becomes an AiError. Aborts pass through. */
export async function send(fetchFn: FetchFn, url: string, init: RequestInit, company: string): Promise<Response> {
  let res: Response;
  try {
    res = await fetchFn(url, init);
  } catch (e) {
    if (isAbort(e)) throw e;
    throw new AiError('network', `Could not reach ${company}. Check the connection.`);
  }
  if (!res.ok) throw await httpError(res, company);
  return res;
}

export async function streamOf(res: Response, company: string): Promise<ReadableStream<Uint8Array>> {
  if (!res.body) throw new AiError('server', `${company} sent an empty reply.`);
  return res.body;
}

/** JSON.parse that gives undefined instead of throwing, for one streamed event. */
export function parseJson<T>(text: string): T | undefined {
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}

/** The first preferred id the account has, else the first model listed. */
export function preferred(models: AiModel[], order: readonly string[]): string | undefined {
  return order.find((id) => models.some((m) => m.id === id)) ?? models[0]?.id;
}
