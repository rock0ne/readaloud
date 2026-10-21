// A drawing pad for handwritten notes (ADR-30). A pen draws thicker when pressed harder and its
// eraser end erases; a mouse or a finger draws too. Light paper and dark ink in both themes.
import { useEffect, useRef } from 'preact/hooks';

const INK = '#1d2733';
const HEIGHT = 240;

interface Props {
  value?: string | undefined;
  onChange: (dataUrl: string | undefined) => void;
}

export function InkPad({ value, onChange }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawn = useRef(Boolean(value));
  const last = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.max(1, Math.round(c.clientWidth * dpr));
    c.height = Math.round(HEIGHT * dpr);
    if (!value) return;
    const img = new Image();
    img.onload = () => c.getContext('2d')?.drawImage(img, 0, 0, c.width, c.height);
    img.src = value;
    // Only on first show; later changes come from drawing here.
  }, []);

  const point = (e: PointerEvent) => {
    const c = ref.current!;
    const r = c.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * c.width, y: ((e.clientY - r.top) / r.height) * c.height };
  };

  const stroke = (e: PointerEvent) => {
    const c = ref.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx || !last.current) return;
    const dpr = window.devicePixelRatio || 1;
    const erasing = (e.buttons & 32) !== 0;
    ctx.globalCompositeOperation = erasing ? 'destination-out' : 'source-over';
    ctx.strokeStyle = INK;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = (erasing ? 18 : e.pointerType === 'pen' ? 1 + 3.5 * (e.pressure || 0.5) : 2.5) * dpr;
    const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
    for (const ev of events.length ? events : [e]) {
      const p = point(ev);
      ctx.beginPath();
      ctx.moveTo(last.current.x, last.current.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      last.current = p;
    }
    drawn.current = true;
  };

  const end = () => {
    if (!last.current) return;
    last.current = null;
    onChange(drawn.current ? ref.current?.toDataURL('image/png') : undefined);
  };

  const clear = () => {
    const c = ref.current;
    c?.getContext('2d')?.clearRect(0, 0, c.width, c.height);
    drawn.current = false;
    onChange(undefined);
  };

  return (
    <div class="ink-pad">
      <canvas
        ref={ref}
        style={{ height: `${HEIGHT}px` }}
        aria-label="Drawing pad: write or draw with a pen, a finger or the mouse"
        onPointerDown={(e) => {
          e.preventDefault();
          last.current = point(e);
          try {
            ref.current?.setPointerCapture(e.pointerId);
          } catch {
            // the pointer has already gone; the stroke still starts here
          }
          stroke(e);
        }}
        onPointerMove={(e) => {
          if (last.current) stroke(e);
        }}
        onPointerUp={end}
        onPointerCancel={end}
      />
      <div class="ink-actions">
        <span class="hint">Pen, finger or mouse. The pen’s eraser end erases.</span>
        <button onClick={clear}>Clear drawing</button>
      </div>
    </div>
  );
}
