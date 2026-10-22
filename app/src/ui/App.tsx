import { useEffect, useState } from 'preact/hooks';
import { createServices, ServicesContext, toast, useServices, useSettings, type Services } from './services';
import { reloadOnUpdate, STARTED_CONTROLLED } from './update';
import { useRoute } from './routes';
import { Library } from './screens/Library';
import { Reader } from './screens/Reader';
import { SettingsScreen } from './screens/Settings';
import { Licences } from './screens/Licences';
import { Toasts } from './components/Toast';
import { READER_FONTS } from './components/TextControls';

function Theme() {
  const s = useSettings();
  useEffect(() => {
    const root = document.documentElement;
    if (s.theme === 'auto') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', s.theme);
    root.style.setProperty('--reader-font', `${s.fontSizePx}px`);
    root.style.setProperty('--reader-family', (READER_FONTS[s.readerFont] ?? READER_FONTS.serif).stack);
    root.style.setProperty('--reader-line', String(s.lineSpacing));
  }, [s.theme, s.fontSizePx, s.readerFont, s.lineSpacing]);
  return null;
}

function ReloadOnUpdate() {
  const { player } = useServices();
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    return reloadOnUpdate(navigator.serviceWorker, STARTED_CONTROLLED, player, () => location.reload(), toast);
  }, [player]);
  return null;
}

export function App() {
  const [services, setServices] = useState<Services | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const route = useRoute();

  useEffect(() => {
    createServices()
      .then(setServices)
      .catch((e: unknown) => setFailed(e instanceof Error ? e.message : String(e)));
  }, []);

  if (failed) {
    return (
      <main class="boot">
        <h1>ReadAloud could not start</h1>
        <p>{failed}</p>
        <p>Storage may be blocked in this browser window. Try a normal (not private) Edge window.</p>
      </main>
    );
  }
  if (!services) return <main class="boot" aria-busy="true">Loading…</main>;

  return (
    <ServicesContext.Provider value={services}>
      <Theme />
      <ReloadOnUpdate />
      {route.name === 'read' ? (
        <Reader key={route.docId} docId={route.docId} />
      ) : route.name === 'settings' ? (
        <SettingsScreen />
      ) : route.name === 'licences' ? (
        <Licences />
      ) : (
        <Library />
      )}
      <Toasts />
    </ServicesContext.Provider>
  );
}
