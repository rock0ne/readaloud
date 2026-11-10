import { useEffect, useRef } from 'preact/hooks';

export type KeyMap = Record<string, (e: KeyboardEvent) => void>;

function isTyping(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName);
}

/** Global shortcuts (spec 11.3). Ignored while typing, except Escape. Keys: e.key values, letters lower-case. */
export function useKeys(map: KeyMap): void {
  const ref = useRef(map);
  ref.current = map;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      // Native controls own their keyboard interaction. In particular, Space on a tool
      // button must activate that button, not also start narration behind the panel.
      const toolbarPageTurn = (key === 'PageDown' || key === 'PageUp') && e.target instanceof Element && !!e.target.closest('.reader-topbar');
      if (key !== 'Escape' && !toolbarPageTurn && e.target instanceof Element && e.target.closest('button, a[href], summary, [role="button"]')) return;
      if (isTyping(e.target) && key !== 'Escape') return;
      if (isTyping(e.target) && key === 'Escape') {
        (e.target as HTMLElement).blur();
      }
      if (document.querySelector('dialog[open]') && key !== 'Escape') return;
      const fn = ref.current[key === ' ' ? 'Space' : key];
      if (fn) {
        e.preventDefault();
        fn(e);
      }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);
}
