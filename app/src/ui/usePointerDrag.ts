// Dragging inside the page with pointer events instead of HTML5 drag and drop. The desktop window takes
// files dropped from the explorer natively (paths, whole folders), and on Windows that switches the page's
// own HTML5 drag and drop off; pointer events work in both builds.
//
// Elements that accept a drop carry the attribute `attr` with their id; the hook reports the one under the
// pointer while dragging and calls `onDrop` on release.

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

const THRESHOLD = 5;

export function usePointerDrag(attr: string, onDrop: (dragged: string, target: string) => void) {
  const [state, setState] = useState<{ dragged: string; over: string | null } | null>(null);
  const latest = useRef(onDrop);
  const stop = useRef<(() => void) | null>(null);
  useEffect(() => {
    latest.current = onDrop;
  });
  useEffect(() => () => stop.current?.(), []);

  const targetAt = (x: number, y: number) =>
    document.elementFromPoint(x, y)?.closest(`[${attr}]`)?.getAttribute(attr) ?? null;

  const start = (id: string) => (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    const x0 = e.clientX;
    const y0 = e.clientY;
    let dragging = false;
    const move = (m: PointerEvent) => {
      if (!dragging && Math.hypot(m.clientX - x0, m.clientY - y0) < THRESHOLD) return;
      if (!dragging) document.documentElement.dataset.dragging = '';
      dragging = true;
      m.preventDefault();
      setState({ dragged: id, over: targetAt(m.clientX, m.clientY) });
    };
    const end = (u: PointerEvent) => {
      cleanup();
      setState(null);
      if (!dragging) return;
      // The click that ends a drag is not a click on what lies under it.
      const swallow = (c: MouseEvent) => {
        c.stopPropagation();
        c.preventDefault();
      };
      window.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
      const target = u.type === 'pointerup' ? targetAt(u.clientX, u.clientY) : null;
      if (target && target !== id) latest.current(id, target);
    };
    const cleanup = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      delete document.documentElement.dataset.dragging;
      stop.current = null;
    };
    stop.current?.();
    stop.current = cleanup;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  };

  return {
    /** The item being dragged and the drop target under the pointer. */
    dragged: state?.dragged ?? null,
    over: state?.over ?? null,
    /** Spread on an item that can be dragged. */
    handle: (id: string) => ({ onPointerDown: start(id) }),
  };
}
