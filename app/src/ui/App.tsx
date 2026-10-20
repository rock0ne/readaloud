import { useEffect, useState } from 'preact/hooks';
import { createServices, ServicesContext, useSettings, type Services } from './services';
import { useRoute } from './routes';
import { Library } from './screens/Library';
import { Reader } from './screens/Reader';
import { SettingsScreen } from './screens/Settings';
import { Toasts } from './components/Toast';

function Theme() {
  const s = useSettings();
  useEffect(() => {
    const root = document.documentElement;
    if (s.theme === 'auto') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', s.theme);
    root.style.setProperty('--reader-font', `${s.fontSizePx}px`);
  }, [s.theme, s.fontSizePx]);
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
      {route.name === 'read' ? (
        <Reader key={route.docId} docId={route.docId} />
      ) : route.name === 'settings' ? (
        <SettingsScreen />
      ) : (
        <Library />
      )}
      <Toasts />
    </ServicesContext.Provider>
  );
}
