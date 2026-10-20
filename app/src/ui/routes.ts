import { useEffect, useState } from 'preact/hooks';

export type Route = { name: 'library' } | { name: 'read'; docId: string } | { name: 'settings' };

export function parseHash(hash: string): Route {
  const h = hash.replace(/^#/, '');
  const read = /^\/read\/([^/?#]+)/.exec(h);
  if (read?.[1]) return { name: 'read', docId: decodeURIComponent(read[1]) };
  if (h.startsWith('/settings')) return { name: 'settings' };
  return { name: 'library' };
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseHash(location.hash));
    addEventListener('hashchange', onChange);
    return () => removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

export const readHref = (docId: string) => `#/read/${encodeURIComponent(docId)}`;
