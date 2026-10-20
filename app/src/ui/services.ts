// Wires core services together once per app start.
import { createContext } from 'preact';
import { useContext, useEffect, useState } from 'preact/hooks';
import { EngineRegistry } from '../core/engines/registry';
import { WebSpeechEngine } from '../core/engines/webspeech';
import { Player } from '../core/player/player';
import { Repo } from '../core/store/repo';
import type { EngineId, Settings } from '../core/types';

export interface Services {
  repo: Repo;
  registry: EngineRegistry;
  player: Player;
  getSettings(): Settings;
  updateSettings(patch: Partial<Settings>): Promise<Settings>;
  subscribeSettings(fn: (s: Settings) => void): () => void;
  isTouch: boolean;
}

export async function createServices(): Promise<Services> {
  const isTouch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const repo = await Repo.open(undefined, isTouch);
  let settings = await repo.getSettings();
  const listeners = new Set<(s: Settings) => void>();
  const registry = new EngineRegistry([new WebSpeechEngine()]);

  const updateSettings = async (patch: Partial<Settings>) => {
    settings = { ...settings, ...patch };
    await repo.saveSettings(settings);
    for (const fn of listeners) fn(settings);
    return settings;
  };

  const saveVoiceChoice = async (engineId: EngineId, voiceId: string) => {
    const pref = [engineId, ...settings.enginePreference.filter((e) => e !== engineId)];
    await updateSettings({ voiceByEngine: { ...settings.voiceByEngine, [engineId]: voiceId }, enginePreference: pref });
  };

  const player = new Player({ positions: repo, registry, settings: () => settings, saveVoiceChoice });
  player.setRate(settings.rate);

  try {
    await navigator.storage?.persist?.();
  } catch {
    // persistence is best effort
  }

  return {
    repo,
    registry,
    player,
    isTouch,
    getSettings: () => settings,
    updateSettings,
    subscribeSettings: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

export const ServicesContext = createContext<Services | null>(null);

export function useServices(): Services {
  const s = useContext(ServicesContext);
  if (!s) throw new Error('Services not ready');
  return s;
}

export function useSettings(): Settings {
  const services = useServices();
  const [s, setS] = useState(services.getSettings());
  useEffect(() => services.subscribeSettings(setS), [services]);
  return s;
}

// ----- toasts -----

export type ToastKind = 'info' | 'error';
export interface ToastMessage {
  id: number;
  text: string;
  kind: ToastKind;
}
const toastListeners = new Set<(t: ToastMessage) => void>();
let toastId = 0;

export function toast(text: string, kind: ToastKind = 'info'): void {
  const t = { id: ++toastId, text, kind };
  for (const fn of toastListeners) fn(t);
}

export function onToast(fn: (t: ToastMessage) => void): () => void {
  toastListeners.add(fn);
  return () => toastListeners.delete(fn);
}

// ----- downloads -----

export function downloadText(name: string, text: string, mime = 'text/plain'): void {
  const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function navigate(hash: string): void {
  location.hash = hash;
}
