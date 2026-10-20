// Path helpers for resolving EPUB hrefs inside the zip (spec 5.5).

export function dirname(path: string): string {
  const i = path.lastIndexOf('/');
  return i === -1 ? '' : path.slice(0, i);
}

export function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** Resolves `href` relative to `baseDir`. Returns the zip path and the fragment (without '#'). */
export function resolveHref(baseDir: string, href: string): { path: string; fragment: string } {
  const hashAt = href.indexOf('#');
  const fragment = hashAt === -1 ? '' : safeDecode(href.slice(hashAt + 1));
  let rel = hashAt === -1 ? href : href.slice(0, hashAt);
  const q = rel.indexOf('?');
  if (q !== -1) rel = rel.slice(0, q);
  rel = safeDecode(rel);
  if (rel === '') return { path: '', fragment };
  const parts = (rel.startsWith('/') ? rel.slice(1) : baseDir ? `${baseDir}/${rel}` : rel).split('/');
  const out: string[] = [];
  for (const p of parts) {
    if (p === '' || p === '.') continue;
    if (p === '..') out.pop();
    else out.push(p);
  }
  return { path: out.join('/'), fragment };
}
