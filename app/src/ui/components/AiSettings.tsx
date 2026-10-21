// The AI study assistant in Settings (spec 17.3, ADR-30): the provider, the reader's own key and how
// long it is kept, and the model. The key is checked with the provider before it is kept.
import { useEffect, useState } from 'preact/hooks';
import { PROVIDER_IDS } from '../../core/ai/assistant';
import { DEFAULT_KEY_DAYS, KEY_LIFETIMES, dateBounds, expiryAfterDays, expiryOnDate, keyHint, keyRecord } from '../../core/ai/keys';
import { AiError, type AiModel } from '../../core/ai/provider';
import type { AiProviderId } from '../../core/types';
import { forgetKey, keyState, modelName, type KeyState } from '../ai';
import { toast, useServices, useSettings } from '../services';

const SESSION = 'session';
const DATE = 'date';
const SHARED_ORIGIN = typeof location !== 'undefined' && location.hostname.endsWith('.github.io');

const longDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });

export function AiSettings() {
  const services = useServices();
  const settings = useSettings();
  const id = settings.ai.provider;

  const choose = (next: AiProviderId | null) => void services.updateSettings({ ai: { ...settings.ai, provider: next } });

  return (
    <section>
      <h2>AI study assistant</h2>
      <p>
        Summaries page by page or chapter by chapter, explanations and answers about what you are reading, with your own key for Claude, ChatGPT
        or Gemini. It is off until you add a key. When you use it, only the part you choose (a paragraph, a page, a chapter or the whole
        document) is sent to that company, under its terms, and the cost goes on your account with them. Your notes are never sent.
      </p>
      <label class="field">
        Provider
        <select value={id ?? ''} onChange={(e) => choose((e.currentTarget.value || null) as AiProviderId | null)}>
          <option value="">Off</option>
          {PROVIDER_IDS.map((p) => (
            <option key={p} value={p}>
              {services.ai[p].label} ({services.ai[p].company})
            </option>
          ))}
        </select>
      </label>
      {id ? (
        <ProviderKey key={id} id={id} />
      ) : (
        <p class="hint">A key you saved earlier stays until its date. To remove it now, choose its provider and press Forget key.</p>
      )}
    </section>
  );
}

function ProviderKey({ id }: { id: AiProviderId }) {
  const services = useServices();
  const settings = useSettings();
  const provider = services.ai[id];
  const [state, setState] = useState<KeyState | undefined>(undefined);
  const [models, setModels] = useState<AiModel[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const model = settings.ai.models[id];

  useEffect(() => {
    let alive = true;
    void keyState(services, id).then((k) => alive && setState(k));
    return () => {
      alive = false;
    };
  }, [services, id, settings.ai]);

  const loadModels = async () => {
    setBusy(true);
    setError(null);
    try {
      const key = services.sessionKeys.get(id) ?? (await services.repo.getKey(id))?.key;
      if (!key) return setState(null);
      setModels(await provider.listModels(key));
    } catch (e) {
      setError(e instanceof AiError ? e.message : (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const setModel = (m: string) => void services.updateSettings({ ai: { ...settings.ai, models: { ...settings.ai.models, [id]: m } } });

  if (state === undefined) return <p class="hint">Checking…</p>;
  if (state === null) return <KeyForm id={id} />;

  return (
    <div class="ai-key">
      <p>
        {state.where === 'session'
          ? `A ${provider.label} key is in use until you close the app. It is not saved.`
          : `A ${provider.label} key is saved on this device until ${longDate(state.expiresAt)}. After that it is deleted and you add one again.`}
      </p>
      <div class="row-field">
        <span>
          Model: <strong>{model ? (id === 'anthropic' ? modelName(model) : model) : 'not chosen'}</strong>
        </span>
        {models ? (
          <select aria-label="Model" value={model ?? ''} onChange={(e) => setModel(e.currentTarget.value)}>
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        ) : (
          <button disabled={busy} onClick={() => void loadModels()}>
            {busy ? 'Loading…' : 'Change model'}
          </button>
        )}
      </div>
      {id === 'anthropic' && (
        <p class="hint">If Claude declines a request, Anthropic may have another Claude model answer it. Each reply shows which model wrote it.</p>
      )}
      {error && <p class="warn">{error}</p>}
      <div class="row-field">
        <button
          class="danger"
          onClick={() => {
            if (!confirm(`Forget the ${provider.label} key on this device?`)) return;
            void forgetKey(services, id).then(() => toast('Key forgotten on this device.'));
          }}
        >
          Forget key
        </button>
      </div>
      <p class="hint">
        Forgetting the key here does not cancel it. To cancel it, delete it on{' '}
        <a href={provider.keyPage} target="_blank" rel="noopener noreferrer">
          {provider.company}’s key page
        </a>
        .
      </p>
    </div>
  );
}

function KeyForm({ id }: { id: AiProviderId }) {
  const services = useServices();
  const settings = useSettings();
  const provider = services.ai[id];
  const [key, setKey] = useState('');
  const [keep, setKeep] = useState<string>(SHARED_ORIGIN ? SESSION : String(DEFAULT_KEY_DAYS));
  const [date, setDate] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bounds = dateBounds(new Date());
  const hint = key ? keyHint(id, key) : null;
  const dateOk = keep !== DATE || expiryOnDate(new Date(), date) !== null;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      // A wrong key is never kept: it must list the models first.
      const list = await provider.listModels(key.trim());
      if (list.length === 0) throw new AiError('request', `${provider.company} accepted the key but listed no models it can use.`);
      const current = settings.ai.models[id];
      const model = current && list.some((m) => m.id === current) ? current : provider.suggestModel(list);
      const now = new Date();
      let until = '';
      if (keep === SESSION) {
        services.sessionKeys.set(id, key.trim());
        await services.repo.deleteKey(id);
      } else {
        const expiresAt = keep === DATE ? expiryOnDate(now, date) : expiryAfterDays(now, Number(keep));
        if (!expiresAt) throw new AiError('request', 'Choose a date from tomorrow to a year from now.');
        services.sessionKeys.delete(id);
        await services.repo.putKey(keyRecord(id, key, expiresAt, now));
        until = ` until ${longDate(expiresAt)}`;
      }
      setKey('');
      // A new settings object also tells the reader and this screen to look at the key again.
      await services.updateSettings({ ai: { provider: id, models: { ...settings.ai.models, ...(model ? { [id]: model } : {}) } } });
      toast(keep === SESSION ? 'Key checked. It is kept until you close the app.' : `Key checked and saved${until}.`);
    } catch (e) {
      setError(e instanceof AiError ? e.message : (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      class="ai-key"
      onSubmit={(e) => {
        e.preventDefault();
        if (!busy && agreed && key.trim() && dateOk) void save();
      }}
    >
      <p>
        Make a key on{' '}
        <a href={provider.keyPage} target="_blank" rel="noopener noreferrer">
          {provider.company}’s key page
        </a>{' '}
        and paste it here. It is kept only in this browser on this device, never put in an export file, and sent only to {provider.company}.
      </p>
      {SHARED_ORIGIN && (
        <p class="warn">
          This copy of the app runs on github.io, where other sites under the same address share this browser’s storage. Keep the key only until
          you close the app, or use the installed Windows app or the phone app to save it.
        </p>
      )}
      <label class="field">
        {provider.label} API key
        <input
          type="password"
          autocomplete="off"
          spellcheck={false}
          value={key}
          onInput={(e) => setKey(e.currentTarget.value)}
          placeholder="Paste the key"
        />
      </label>
      {hint && <p class="hint">{hint}</p>}
      <label class="field">
        Keep the key
        <select value={keep} onChange={(e) => setKeep(e.currentTarget.value)}>
          <option value={SESSION}>Only until I close the app</option>
          {KEY_LIFETIMES.map((l) => (
            <option key={l.days} value={String(l.days)}>
              For {l.label}
            </option>
          ))}
          <option value={DATE}>Until a date I choose</option>
        </select>
      </label>
      {keep === DATE && (
        <label class="field">
          Until the end of
          <input type="date" min={bounds.min} max={bounds.max} value={date} onInput={(e) => setDate(e.currentTarget.value)} />
        </label>
      )}
      <label class="check">
        <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.currentTarget.checked)} />
        I understand that the text I choose to send goes to {provider.company}, under its terms, and is charged to my account.
      </label>
      {error && <p class="warn">{error}</p>}
      <div class="row-field">
        <button class="primary" type="submit" disabled={busy || !agreed || !key.trim() || !dateOk}>
          {busy ? 'Checking the key…' : 'Check and save key'}
        </button>
      </div>
    </form>
  );
}
