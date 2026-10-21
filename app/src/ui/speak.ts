// Reads a piece of text that is not the document (an AI summary or answer) with the current voice.
import { chunk, toSpeakText } from '../core/text/normalize';
import { segmentSentences } from '../core/text/segment';
import type { Services } from './services';

/** Resolves when the text has been read or `signal` aborts. The document's reading pauses first. */
export async function speakAloud(s: Services, text: string, signal: AbortSignal): Promise<void> {
  s.player.pause();
  const settings = s.getSettings();
  const voice = s.player.currentVoice ?? (await s.registry.pick(settings))?.voice;
  const engine = voice ? s.registry.get(voice.engineId) : undefined;
  if (!voice || !engine) throw new Error('No voice is available on this device.');
  const rate = s.player.state.rate;
  const pieces = text
    .split('\n')
    .flatMap((line) => segmentSentences(line, settings.locale).map((seg) => toSpeakText(seg.text, 'paragraph')))
    .filter((t) => t.trim())
    .flatMap((t) => chunk(t));

  if (engine.speak) {
    for (const piece of pieces) {
      if (signal.aborted) return;
      await engine.speak(piece, { voice, rate: Math.min(rate, engine.maxEngineRate) }, signal);
    }
    return;
  }
  if (!engine.synthesize) return;
  const make = (i: number) => {
    const p = engine.synthesize!(pieces[i]!, { voice, rate: 1 }, signal);
    p.catch(() => undefined);
    return p;
  };
  // One clip is made ahead while the one before it plays.
  let next = pieces.length ? make(0) : null;
  for (let i = 0; i < pieces.length && next; i++) {
    const clip = await next;
    next = i + 1 < pieces.length ? make(i + 1) : null;
    if (signal.aborted) return;
    await s.audio.play(clip, rate, signal);
  }
}
