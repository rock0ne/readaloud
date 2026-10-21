// Wires core services together once per app start.
import { createContext } from 'preact';
import { useContext, useEffect, useState } from 'preact/hooks';
import { makeProviders } from '../core/ai/assistant';
import type { AiProvider } from '../core/ai/provider';
import { KokoroEngine } from '../core/engines/kokoro';
import { EngineRegistry } from '../core/engines/registry';
import { WebSpeechEngine } from '../core/engines/webspeech';
import { Player } from '../core/player/player';
import { Repo } from '../core/store/repo';
import type { AiProviderId, EngineId, Settings } from '../core/types';
import { PhoneKokoro } from './android/phone-kokoro';
import { IN_ANDROID_APP, readAloudTts, readAppFile } from './android/plugin';
import { HtmlAudioOutput } from './audio';
import { KokoroClient, type KokoroService, type KokoroStatus } from './kokoro/client';

export interface Services {
  repo: Repo;
  registry: EngineRegistry;
  player: Player;
  kokoro: KokoroService;
  audio: HtmlAudioOutput;
  ai: Record<AiProviderId, AiProvider>;
  /** AI keys kept only until the app closes: in memory, never stored (ADR-30). */
  sessionKeys: Map<AiProviderId, string>;
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
  // In the Android app sherpa-onnx makes the voice from the Kokoro engine app's files; in a browser
  // the model is downloaded (ADR-27).
  const kokoro: KokoroService = IN_ANDROID_APP ? new PhoneKokoro(readAloudTts, readAppFile) : new KokoroClient();
  const audio = new HtmlAudioOutput();
  // Kokoro is the main voice (ADR-22); browser voices stay as the fallback until it is downloaded.
  const registry = new EngineRegistry([new KokoroEngine(kokoro), new WebSpeechEngine()]);
  let kokoroInstalled = false;
  kokoro.subscribe((s) => {
    // The registry remembers "not available", so look again once the model is stored.
    if (s.installed !== kokoroInstalled) registry.invalidate();
    kokoroInstalled = s.installed;
  });
  void kokoro.installed();

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

  const player = new Player({ positions: repo, registry, settings: () => settings, saveVoiceChoice, audio, audioCache: repo });
  player.setRate(settings.rate);
  if (IN_ANDROID_APP) keepScreenOnWhileReading(player);

  try {
    await navigator.storage?.persist?.();
  } catch {
    // persistence is best effort
  }

  return {
    repo,
    registry,
    player,
    kokoro,
    audio,
    ai: makeProviders(),
    sessionKeys: new Map(),
    isTouch,
    getSettings: () => settings,
    updateSettings,
    subscribeSettings: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

/** The phone's screen stays on while it reads; it may turn off when paused or stopped (ADR-27). */
function keepScreenOnWhileReading(player: Player): void {
  let on = false;
  player.subscribe((e) => {
    if (e.type !== 'state') return;
    const reading = e.state.status === 'playing' || e.state.status === 'buffering';
    if (reading === on) return;
    on = reading;
    void readAloudTts.keepScreenOn({ on }).catch(() => undefined);
  });
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

export function useKokoro(): KokoroStatus {
  const { kokoro } = useServices();
  const [s, setS] = useState(kokoro.status);
  useEffect(() => kokoro.subscribe(setS), [kokoro]);
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
