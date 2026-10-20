import { useEffect, useState } from 'preact/hooks';
import { onToast, type ToastMessage } from '../services';

export function Toasts() {
  const [items, setItems] = useState<ToastMessage[]>([]);
  useEffect(
    () =>
      onToast((t) => {
        setItems((xs) => [...xs, t]);
        setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== t.id)), t.kind === 'error' ? 8000 : 4000);
      }),
    [],
  );
  return (
    <div class="toasts" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} class={`toast toast-${t.kind}`} onClick={() => setItems((xs) => xs.filter((x) => x.id !== t.id))}>
          {t.text}
        </div>
      ))}
    </div>
  );
}
