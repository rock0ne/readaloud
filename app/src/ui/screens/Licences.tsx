// Licences (ADR-38): ReadAloud's own licence and the texts of every part, from the licences/ folder
// the build puts into each download (licences.ts).
import { useEffect, useState } from 'preact/hooks';

const TEXTS: Array<[string, string]> = [
  ['licences/LICENSE.txt', 'ReadAloud: the GNU General Public License, version 3'],
  ['licences/web.txt', 'Licences of the packages in the app'],
  // Only the Android build has native code and Android libraries.
  ...(import.meta.env.MODE === 'android' ? [['licences/android.txt', 'Licences of the native code and Android libraries'] as [string, string]] : []),
];

/**
 * The file from this copy of the app, or null when it has none. A server that answers a missing
 * file with the app's own page (as vite preview does) is not a licence text.
 */
async function fetchText(path: string): Promise<string | null> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}${path}`);
    return res.ok && !res.headers.get('content-type')?.includes('text/html') ? await res.text() : null;
  } catch {
    return null;
  }
}

function LicenceText({ path, title }: { path: string; title: string }) {
  const [body, setBody] = useState<string | null | undefined>(undefined);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    void fetchText(path).then(setBody);
  }, [path]);
  if (body === null) return null;
  return (
    <details onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>{title}</summary>
      {open && (body === undefined ? <p>Loading…</p> : <pre class="licence-text">{body}</pre>)}
    </details>
  );
}

export function Licences() {
  // The notices as HTML; marked loads only here, as it does for .md files.
  const [notices, setNotices] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    void fetchText('licences/NOTICES.md').then(async (md) => {
      if (md === null) return setNotices(null);
      const { marked } = await import('marked');
      setNotices(marked.parse(md, { gfm: true, async: false }));
    });
  }, []);
  return (
    <main class="settings licences">
      <header class="bar">
        <a class="button" href="#/settings" aria-label="Back to settings">
          ←
        </a>
        <h1>Licences</h1>
      </header>
      <section>
        <p>
          ReadAloud {__APP_VERSION__} is free software: you may share and change it under the GNU General Public License, version 3 or later.
          Its source code is at github.com/rock0ne/readaloud. These texts come with this copy of the app.
        </p>
        {TEXTS.map(([path, title]) => (
          <LicenceText key={path} path={path} title={title} />
        ))}
      </section>
      <section>
        {notices === undefined ? (
          <p>Loading…</p>
        ) : notices === null ? (
          <p>The licence texts are in the built app only.</p>
        ) : (
          <div class="notices" dangerouslySetInnerHTML={{ __html: notices }} />
        )}
      </section>
    </main>
  );
}
