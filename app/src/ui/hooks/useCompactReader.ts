import { useEffect, useState } from 'preact/hooks';

/** One transport in the DOM, including when a desktop window becomes phone-sized. */
export function useCompactReader(): boolean {
  const [compact, setCompact] = useState(() => typeof matchMedia === 'function' && matchMedia('(max-width: 720px)').matches);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const query = matchMedia('(max-width: 720px)');
    const changed = () => setCompact(query.matches);
    changed();
    query.addEventListener('change', changed);
    return () => query.removeEventListener('change', changed);
  }, []);
  return compact;
}
