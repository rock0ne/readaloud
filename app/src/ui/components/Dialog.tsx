import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';

interface Props {
  title: string;
  onClose: () => void;
  children: ComponentChildren;
  actions?: ComponentChildren;
}

export function Dialog({ title, onClose, children, actions }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal?.();
    return () => d?.close?.();
  }, []);
  return (
    <dialog ref={ref} class="dialog" onCancel={(e) => (e.preventDefault(), onClose())} aria-label={title}>
      <h2>{title}</h2>
      <div class="dialog-body">{children}</div>
      <div class="dialog-actions">{actions ?? <button onClick={onClose}>Close</button>}</div>
    </dialog>
  );
}
