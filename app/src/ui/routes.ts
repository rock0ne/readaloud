import { useEffect, useState } from 'preact/hooks';

let navigationGuard: (() => boolean) | null = null;
/** Only the mounted editor can guard a route change; no imported content supplies this. */
export function guardNavigation(guard: () => boolean): () => void {
  navigationGuard = guard;
  return () => { if (navigationGuard === guard) navigationGuard = null; };
}

export type Route = { name: 'library' } | { name: 'read'; docId: string } | { name: 'settings' } | { name: 'licences' };

export function parseHash(hash: string): Route {
  const h = hash.replace(/^#/, '');
  const read = /^\/read\/([^/?#]+)/.exec(h);
  if (read?.[1]) return { name: 'read', docId: decodeURIComponent(read[1]) };
  if (h.startsWith('/settings')) return { name: 'settings' };
  if (h.startsWith('/licences')) return { name: 'licences' };
  return { name: 'library' };
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(location.hash));
  useEffect(() => {
    let lastHash = location.hash;
    const onChange = () => {
      if (navigationGuard && !navigationGuard()) { history.replaceState(null, '', lastHash || '#/'); return; }
      lastHash = location.hash;
      setRoute(parseHash(location.hash));
    };
    addEventListener('hashchange', onChange);
    return () => removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

export const readHref = (docId: string) => `#/read/${encodeURIComponent(docId)}`;
