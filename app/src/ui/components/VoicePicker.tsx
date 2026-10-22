import type { EngineId, Voice } from '../../core/types';

interface Props {
  voices: Voice[];
  value: { engineId: EngineId; voiceId: string } | null;
  onPick: (engineId: EngineId, voiceId: string) => void;
  locale: string;
}

const engineName: Record<EngineId, string> = { kokoro: 'Kokoro', webspeech: 'Browser', azure: 'Azure' };

export function shortVoiceName(v: Voice): string {
  // "Microsoft Sonia Online (Natural) - English (United Kingdom)" -> "Sonia (United Kingdom)"
  const m = /^Microsoft\s+(\w+).*?-\s*[^(]*\(([^)]+)\)/.exec(v.name);
  return m ? `${m[1]} (${m[2]})` : v.name;
}

/** The picker's name for a voice: one that is not made on this device says so, as it sends the text away. */
export function pickerLabel(v: Voice): string {
  return v.engineId !== 'kokoro' && !v.offline ? `${shortVoiceName(v)} · online` : shortVoiceName(v);
}

export function VoicePicker({ voices, value, onPick, locale }: Props) {
  const lang = locale.split('-')[0] ?? 'en';
  const relevant = voices.filter((v) => v.lang.toLowerCase().startsWith(lang));
  const others = voices.filter((v) => !v.lang.toLowerCase().startsWith(lang));
  const groups: Array<[string, Voice[]]> = [];
  for (const engine of ['kokoro', 'webspeech', 'azure'] as EngineId[]) {
    const n = relevant.filter((v) => v.engineId === engine && v.quality === 'neural');
    const b = relevant.filter((v) => v.engineId === engine && v.quality !== 'neural');
    if (n.length) groups.push([`${engineName[engine]} · Natural`, n]);
    if (b.length) groups.push([`${engineName[engine]} · Basic`, b]);
  }
  if (others.length) groups.push(['Other languages', others]);
  const current = value ? `${value.engineId}|${value.voiceId}` : '';
  return (
    <select
      class="voice-picker"
      aria-label="Voice"
      value={current}
      onChange={(e) => {
        const [engineId, ...rest] = e.currentTarget.value.split('|');
        if (engineId && rest.length) onPick(engineId as EngineId, rest.join('|'));
      }}
    >
      {!value && <option value="">Best natural voice</option>}
      {groups.map(([label, vs]) => (
        <optgroup key={label} label={label}>
          {vs.map((v) => (
            <option key={v.id} value={`${v.engineId}|${v.id}`}>
              {pickerLabel(v)}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}
