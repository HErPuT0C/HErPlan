import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

const SHOW_DELAY_MS = 500;
const GAP = 6;

/**
 * Short hint below (or above, if there is no room) the wrapped element: after a pause on hover,
 * at once on keyboard focus. The wrapper uses `display: contents`, so it does not affect layout.
 */
export function Tooltip({ text, children }: { text: string; children: ReactNode }) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  };
  const show = (el: Element | null, delay: number) => {
    clear();
    if (!el) return;
    timer.current = setTimeout(() => setAnchor(el.getBoundingClientRect()), delay);
  };
  const hide = () => {
    clear();
    setAnchor(null);
  };

  return (
    <span
      className="tooltip-anchor"
      onPointerEnter={(e) => show(e.currentTarget.firstElementChild, SHOW_DELAY_MS)}
      onPointerLeave={hide}
      onPointerDown={hide}
      onFocus={(e) => {
        if (e.target instanceof HTMLElement && e.target.matches(':focus-visible')) show(e.target, 0);
      }}
      onBlur={hide}
      onKeyDown={(e) => e.key === 'Escape' && hide()}
    >
      {children}
      {anchor && createPortal(<TooltipBubble text={text} anchor={anchor} />, document.body)}
    </span>
  );
}

function TooltipBubble({ text, anchor }: { text: string; anchor: DOMRect }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: anchor.left, top: anchor.bottom + GAP, visible: false });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const left = Math.min(Math.max(GAP, anchor.left + anchor.width / 2 - width / 2), window.innerWidth - width - GAP);
    const below = anchor.bottom + GAP;
    const top = below + height > window.innerHeight - GAP ? anchor.top - height - GAP : below;
    setPos({ left, top, visible: true });
  }, [anchor]);

  return (
    <div
      ref={ref}
      role="tooltip"
      className="tooltip"
      style={{ left: pos.left, top: pos.top, visibility: pos.visible ? 'visible' : 'hidden' }}
    >
      {text}
    </div>
  );
}
