// How long an AI key is kept (spec 17.3): the user's choice, at most a year.
import type { AiKeyRecord, AiProviderId } from '../types';

export const KEY_MAX_DAYS = 365;
export const DEFAULT_KEY_DAYS = 30;
export const KEY_LIFETIMES: ReadonlyArray<{ days: number; label: string }> = [
  { days: 1, label: '1 day' },
  { days: 7, label: '1 week' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
  { days: 365, label: '1 year' },
];

const DAY_MS = 86_400_000;

export function expiryAfterDays(now: Date, days: number): string {
  const d = Math.min(KEY_MAX_DAYS, Math.max(1, Math.round(days)));
  return new Date(now.getTime() + d * DAY_MS).toISOString();
}

/** The end of a chosen day ('YYYY-MM-DD', local time), at most a year ahead; null if it has passed. */
export function expiryOnDate(now: Date, ymd: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return null;
  const end = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59, 999);
  if (Number.isNaN(end.getTime()) || end.getTime() <= now.getTime()) return null;
  return new Date(Math.min(end.getTime(), now.getTime() + KEY_MAX_DAYS * DAY_MS)).toISOString();
}

function ymd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Bounds for the date picker: tomorrow to a year from now. */
export function dateBounds(now: Date): { min: string; max: string } {
  return { min: ymd(new Date(now.getTime() + DAY_MS)), max: ymd(new Date(now.getTime() + KEY_MAX_DAYS * DAY_MS)) };
}

export function isExpired(rec: AiKeyRecord, now: Date): boolean {
  return !(Date.parse(rec.expiresAt) > now.getTime());
}

export function keyRecord(provider: AiProviderId, key: string, expiresAt: string, now: Date): AiKeyRecord {
  return { provider, key: key.trim(), savedAt: now.toISOString(), expiresAt };
}

const KEY_START: Record<AiProviderId, string> = { anthropic: 'sk-ant-', openai: 'sk-', gemini: 'AIza' };

/** A hint when the key does not look like that provider's; the provider still decides. */
export function keyHint(provider: AiProviderId, key: string): string | null {
  const k = key.trim();
  if (!k) return 'Paste the key first.';
  if (/\s/.test(k)) return 'The key has a space in it. Copy it again.';
  if (!k.startsWith(KEY_START[provider])) return `Keys for this provider usually start with ${KEY_START[provider]}. Check that this is the right key.`;
  return null;
}
