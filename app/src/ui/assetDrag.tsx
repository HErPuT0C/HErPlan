// A file of the assets dragged across the application (0.7.3): onto a folder of the library, into a document,
// onto a card's picture, onto the project map. Held over a tab's head, the tab comes to the front, so a file
// goes from the assets into any other tab. Pointer events, as for every drag inside the window (HTML5 drag
// and drop belongs to the desktop window, for files from the explorer — see usePointerDrag).
//
// A place that takes files registers its element (useAssetDropTarget); while a file is dragged the innermost
// registered element under the pointer that accepts it is lit and gets the file when it is let go.

import { File as FileIcon, Folder } from 'lucide-react';
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { atom } from '../core/atom';
import { useAtom } from '../core/useStore';

export interface AssetDropTarget {
  /** Whether this place takes that file (or folder). */
  accepts: (path: string, folder: boolean) => boolean;
  /** The file is let go here, at a point of the window. */
  drop: (path: string, point: { x: number; y: number }) => void;
}

interface DragState {
  path: string;
  folder: boolean;
  x: number;
  y: number;
  /** The place that would take the file now. */
  over: Element | null;
}

export const assetDrag = atom<DragState | null>(null);

const targets = new Map<Element, { current: AssetDropTarget | null }>();

/** How far the pointer goes before a press becomes a drag. */
const THRESHOLD = 5;
/** How long the file is held over a tab's head before the tab opens. */
const TAB_DELAY = 500;

function targetAt(path: string, folder: boolean, x: number, y: number): Element | null {
  for (let el = document.elementFromPoint(x, y); el; el = el.parentElement) {
    const target = targets.get(el)?.current;
    if (target?.accepts(path, folder)) return el;
  }
  return null;
}

/** Starts dragging a file (or a folder) of the assets from a press on it; a press without moving is a click. */
export function startAssetDrag(path: string, folder: boolean, e: ReactPointerEvent): void {
  if (e.button !== 0) return;
  const x0 = e.clientX;
  const y0 = e.clientY;
  let dragging = false;
  let tab: { el: HTMLElement; timer: number } | null = null;
  const holdTab = (x: number, y: number) => {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-drag-opens]') ?? null;
    if (el === tab?.el) return;
    if (tab) clearTimeout(tab.timer);
    tab = el ? { el, timer: window.setTimeout(() => el.click(), TAB_DELAY) } : null;
  };
  const move = (m: PointerEvent) => {
    if (!dragging && Math.hypot(m.clientX - x0, m.clientY - y0) < THRESHOLD) return;
    if (!dragging) document.documentElement.dataset.dragging = '';
    dragging = true;
    m.preventDefault();
    holdTab(m.clientX, m.clientY);
    assetDrag.set({ path, folder, x: m.clientX, y: m.clientY, over: targetAt(path, folder, m.clientX, m.clientY) });
  };
  const finish = (drop: boolean, x = 0, y = 0) => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', cancel);
    window.removeEventListener('keydown', key, true);
    if (tab) clearTimeout(tab.timer);
    delete document.documentElement.dataset.dragging;
    assetDrag.set(null);
    if (!dragging) return;
    // The click that ends a drag is not a click on what lies under it.
    const swallow = (c: MouseEvent) => {
      c.stopPropagation();
      c.preventDefault();
    };
    window.addEventListener('click', swallow, { capture: true, once: true });
    setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
    if (!drop) return;
    const over = targetAt(path, folder, x, y);
    if (over) targets.get(over)?.current?.drop(path, { x, y });
  };
  const up = (u: PointerEvent) => finish(true, u.clientX, u.clientY);
  const cancel = () => finish(false);
  const key = (k: KeyboardEvent) => {
    if (k.key !== 'Escape' || !dragging) return;
    k.preventDefault();
    k.stopPropagation();
    finish(false);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', cancel);
  window.addEventListener('keydown', key, true);
}

/** Makes an element a place that takes dragged files; true while a file it takes is over it. */
export function useAssetDropTarget(ref: RefObject<HTMLElement | null>, target: AssetDropTarget | null): boolean {
  const latest = useRef(target);
  useEffect(() => {
    latest.current = target;
  });
  // Every render: the element may be a new one (a list redrawn), and registering is a map entry.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    targets.set(el, latest);
    return () => {
      if (targets.get(el) === latest) targets.delete(el);
    };
  });
  // Lit only when this element is the place under the pointer; a move elsewhere does not draw it again.
  const [over, setOver] = useState(false);
  useEffect(
    () =>
      assetDrag.subscribe(() => {
        const drag = assetDrag.get();
        setOver(!!drag && !!ref.current && drag.over === ref.current);
      }),
    [ref],
  );
  return over;
}

/** The dragged file following the pointer; mounted once for the whole window. */
export function AssetDragGhost() {
  const drag = useAtom(assetDrag);
  if (!drag) return null;
  const name = drag.path.slice(drag.path.lastIndexOf('/') + 1);
  return createPortal(
    <div
      className={['asset-drag-ghost', !drag.over && 'asset-drag-ghost-nowhere'].filter(Boolean).join(' ')}
      style={{ left: drag.x + 12, top: drag.y + 8 }}
      aria-hidden="true"
    >
      {drag.folder ? <Folder size={14} /> : <FileIcon size={14} />} {name}
    </div>,
    document.body,
  );
}
