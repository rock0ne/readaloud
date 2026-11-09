import { useState } from 'preact/hooks';
import { parsePronunciations, pronunciationText } from '../../core/text/pronunciation';
import { useServices, useSettings } from '../services';

export function PronunciationEditor({ listen, disabled, canListen }: { listen: (text: string) => void; disabled: boolean; canListen: boolean }) {
  const s = useSettings();
  const services = useServices();
  const [list, setList] = useState(s.pronunciation.list);
  const [enabled, setEnabled] = useState(s.pronunciation.enabled);
  const [sample, setSample] = useState('Leave the live systems alone. I live in London. Go live with OT.');
  const [notice, setNotice] = useState('');
  let error = '';
  try { parsePronunciations(list); } catch (e) { error = (e as Error).message; }
  const dirty = list !== s.pronunciation.list || enabled !== s.pronunciation.enabled;
  const preview = error ? '' : pronunciationText(sample, { enabled, list }, s.locale);
  return <section aria-label="Pronunciation">
    <h2>Pronunciation</h2>
    <p>English speech hints only: the book, search, notes and highlights keep their original words. Rules use cautious context clues, not full language understanding. Ambiguous words can still sound wrong.</p>
    <label class="field"><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.currentTarget.checked)} /> Use built-in English context rules</label>
    <label class="field">Personal pronunciation list
      <textarea rows={7} value={list} maxLength={20000} placeholder={'OT = O. T.\nTunde = TOON-day'} onInput={(e) => setList(e.currentTarget.value)} />
    </label>
    <p>One <code>word = spoken spelling</code> per line. Case-sensitive whole words or phrases; longest phrase wins. Your entries override built-ins. No regex, SSML or IPA. These hints work offline but the voice decides the final sound. They apply to all English books on this device. Use a phrase, such as <code>live systems = lyve systems</code>, for words with two meanings.</p>
    {error && <p role="alert">{error}</p>}
    <button disabled={!!error || !dirty || disabled} onClick={() => {
      void services.updateSettings({ pronunciation: { enabled, list } }).then(() => setNotice('Pronunciation saved. Re-prepare changed passages before offline listening.')).catch((e: unknown) => setNotice(String(e)));
    }}>Save pronunciation</button>
    <p role="status">{notice}</p>
    <label class="field">Try a sentence
      <textarea rows={3} value={sample} maxLength={2000} onInput={(e) => setSample(e.currentTarget.value)} />
    </label>
    <p>Sent to voice: <output>{preview}</output></p>
    <button disabled={!!error || dirty || disabled || !canListen || !sample.trim()} onClick={() => listen(sample)}>Listen to saved pronunciation</button>
    {dirty && <p>Save your changes before listening to the test sentence.</p>}
    <p>Changes stop current playback. Existing audio files are not rewritten: re-prepare the book and re-export affected chapters. Transfer files include these pronunciation settings; WAV files contain only audio. Disable built-ins and clear the list for the original voice behaviour.</p>
  </section>;
}
