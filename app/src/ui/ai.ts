// The AI assistant as the UI sees it (ADR-30): which provider and model are in use, and the key
// only at the moment a request is sent.
import { useEffect, useState } from 'preact/hooks';
import type { AiProvider } from '../core/ai/provider';
import type { AiProviderId } from '../core/types';
import { useServices, useSettings, type Services } from './services';

export interface AiReady {
  provider: AiProvider;
  model: string;
  key: string;
}

/** Where a provider's key is kept: only in memory until the app closes, or on this device until a date. */
export type KeyState = { where: 'session' } | { where: 'device'; expiresAt: string } | null;

export async function keyState(s: Services, id: AiProviderId): Promise<KeyState> {
  if (s.sessionKeys.has(id)) return { where: 'session' };
  const rec = await s.repo.getKey(id);
  return rec ? { where: 'device', expiresAt: rec.expiresAt } : null;
}

/** Forgets the key here. It still works with the provider until it is deleted on their key page. */
export async function forgetKey(s: Services, id: AiProviderId): Promise<void> {
  s.sessionKeys.delete(id);
  await s.repo.deleteKey(id);
  await notifyAi(s);
}

/** Tells the reader and Settings that a key changed, so they look again. */
export function notifyAi(s: Services): Promise<unknown> {
  const ai = s.getSettings().ai;
  return s.updateSettings({ ai: { ...ai, models: { ...ai.models } } });
}

/** The provider, model and key to use now, or null when the assistant is off or has no key. */
export async function aiReady(s: Services): Promise<AiReady | null> {
  const { provider: id, models } = s.getSettings().ai;
  if (!id) return null;
  const model = models[id];
  const key = s.sessionKeys.get(id) ?? (await s.repo.getKey(id))?.key;
  if (!key || !model) return null;
  return { provider: s.ai[id], model, key };
}

export interface AiInfo {
  id: AiProviderId;
  label: string; // "Claude"
  company: string; // "Anthropic"
  model: string;
}

/** What the reader shows about the assistant; no key in it. undefined while loading. */
export function useAiInfo(): AiInfo | null | undefined {
  const s = useServices();
  const settings = useSettings();
  const [info, setInfo] = useState<AiInfo | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    void aiReady(s).then((r) => {
      if (alive) setInfo(r ? { id: r.provider.id, label: r.provider.label, company: r.provider.company, model: r.model } : null);
    });
    return () => {
      alive = false;
    };
  }, [s, settings.ai]);
  return info;
}

/** "claude-opus-5-5" -> "Claude Opus 5.5"; other ids are shown as they are. */
export function modelName(id: string): string {
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d+))?$/.exec(id);
  if (!m) return id;
  const family = (m[1] ?? '').charAt(0).toUpperCase() + (m[1] ?? '').slice(1);
  return `Claude ${family} ${m[2]}${m[3] ? `.${m[3]}` : ''}`;
}
