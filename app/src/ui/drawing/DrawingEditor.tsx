// The drawing window (0.9): a sheet to draw on, like Paint — a pen, a marker, an eraser, lines and arrows,
// boxes and ovals, texts, in colours and widths — over a white sheet or over a picture of the project. What is
// drawn stays shapes: picked with the arrow tool it moves or goes away, Ctrl+Z takes back a step. Saving gives
// the drawing to its owner (a document, a card of the map), which makes the picture and writes it.

import {
  ArrowUpRight,
  Circle,
  Eraser,
  Highlighter,
  MousePointer2,
  Pencil,
  Redo2,
  Slash,
  Square,
  Trash2,
  Type,
  Undo2,
} from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { atom } from '../../core/atom';
import { newId } from '../../core/ids';
import { t, type MessageKey } from '../../i18n';
import {
  itemAt,
  itemBounds,
  movedItem,
  PALETTE,
  simplify,
  snapAngle,
  WIDTHS,
  type DrawItem,
  type Drawing,
  type Tool,
} from '../../drawing/model';
import { renderDrawing, TEXT_FONT } from '../../drawing/render';
import { Button, Dialog, IconButton } from '../components';
import './drawing.css';

const TOOLS: { id: Tool; icon: typeof Pencil; label: MessageKey; key: string }[] = [
  { id: 'select', icon: MousePointer2, label: 'draw.tool.select', key: 'V' },
  { id: 'pen', icon: Pencil, label: 'draw.tool.pen', key: 'P' },
  { id: 'marker', icon: Highlighter, label: 'draw.tool.marker', key: 'M' },
  { id: 'eraser', icon: Eraser, label: 'draw.tool.eraser', key: 'E' },
  { id: 'line', icon: Slash, label: 'draw.tool.line', key: 'L' },
  { id: 'arrow', icon: ArrowUpRight, label: 'draw.tool.arrow', key: 'A' },
  { id: 'rect', icon: Square, label: 'draw.tool.rect', key: 'R' },
  { id: 'ellipse', icon: Circle, label: 'draw.tool.ellipse', key: 'O' },
  { id: 'text', icon: Type, label: 'draw.tool.text', key: 'T' },
];
/** Text sizes for the four widths. */
const TEXT_SIZES = [18, 28, 42, 64];
const HISTORY = 100;

// The habits of the last drawing: the tool, the colour, the width.
const remembered = atom<{ tool: Tool; color: string; width: number; fill: boolean }>({
  tool: 'pen',
  color: PALETTE[2],
  width: WIDTHS[1],
  fill: false,
});

export function DrawingEditor({
  title,
  drawing,
  background,
  onSave,
  onClose,
  hint,
}: {
  title: string;
  drawing: Drawing;
  /** The picture under the drawing (drawing on a picture), already loaded. */
  background: CanvasImageSource | null;
  /** Writes the drawing; the window closes when it is done. */
  onSave: (d: Drawing) => Promise<void>;
  onClose: () => void;
  /** What saving does, in words (a copy beside the picture…). */
  hint?: string;
}) {
  const [items, setItems] = useState<DrawItem[]>(drawing.items);
  const [undo, setUndo] = useState<DrawItem[][]>([]);
  const [redo, setRedo] = useState<DrawItem[][]>([]);
  const [tool, setToolState] = useState<Tool>(() => remembered.get().tool);
  const [color, setColorState] = useState(() => remembered.get().color);
  const [width, setWidthState] = useState(() => remembered.get().width);
  const [fill, setFillState] = useState(() => remembered.get().fill);
  const [selected, setSelected] = useState<string | null>(null);
  const [text, setText] = useState<{ x: number; y: number; value: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [asking, setAsking] = useState(false);
  const [scale, setScale] = useState(1);
  const canvas = useRef<HTMLCanvasElement>(null);
  const layer = useRef<HTMLCanvasElement | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  /** What is being drawn right now (not yet an item). */
  const draft = useRef<DrawItem | null>(null);
  /** A picked item being dragged: where it was taken, and how far it moved. */
  const moving = useRef<{ id: string; x: number; y: number; dx: number; dy: number } | null>(null);
  const dirty = undo.length > 0;
  const current: Drawing = { ...drawing, items };

  const setTool = (v: Tool) => {
    setToolState(v);
    remembered.set((r) => ({ ...r, tool: v }));
    setSelected(null);
  };
  const setColor = (v: string) => {
    setColorState(v);
    remembered.set((r) => ({ ...r, color: v }));
  };
  const setWidth = (v: number) => {
    setWidthState(v);
    remembered.set((r) => ({ ...r, width: v }));
  };
  const setFill = (v: boolean) => {
    setFillState(v);
    remembered.set((r) => ({ ...r, fill: v }));
  };

  /** One step that Ctrl+Z takes back. */
  const change = (next: DrawItem[]) => {
    setUndo((u) => [...u.slice(-HISTORY + 1), items]);
    setRedo([]);
    setItems(next);
  };
  const stepBack = () => {
    if (!undo.length) return;
    setRedo((r) => [...r, items]);
    setItems(undo[undo.length - 1]);
    setUndo((u) => u.slice(0, -1));
    setSelected(null);
  };
  const stepForward = () => {
    if (!redo.length) return;
    setUndo((u) => [...u, items]);
    setItems(redo[redo.length - 1]);
    setRedo((r) => r.slice(0, -1));
  };
  const remove = (id: string) => {
    change(items.filter((x) => x.id !== id));
    setSelected(null);
  };

  // The sheet as large as fits the window.
  useLayoutEffect(() => {
    const box = stage.current;
    if (!box) return;
    const fit = () => {
      // Small pictures are shown up to twice their size, so they are not drawn on with a needle.
      const k = Math.min(2, (box.clientWidth - 24) / drawing.w, (box.clientHeight - 24) / drawing.h);
      setScale(Math.max(0.05, k));
    };
    fit();
    const watch = new ResizeObserver(fit);
    watch.observe(box);
    return () => watch.disconnect();
  }, [drawing.w, drawing.h]);

  const paint = () => {
    const c = canvas.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const k = scale * dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    // A see-through sheet shows a checkerboard under it.
    if (!drawing.bg && !background) {
      ctx.fillStyle = '#e9ecef';
      ctx.fillRect(0, 0, c.width, c.height);
    }
    layer.current ??= document.createElement('canvas');
    const m = moving.current;
    const shown = m ? items.map((it) => (it.id === m.id ? movedItem(it, m.dx, m.dy) : it)) : items;
    renderDrawing(ctx, { ...drawing, items: shown }, background, k, draft.current, layer.current);
    const pick = shown.find((x) => x.id === selected);
    if (pick) {
      const b = itemBounds(pick);
      ctx.save();
      ctx.setTransform(k, 0, 0, k, 0, 0);
      ctx.strokeStyle = '#1c7ed6';
      ctx.lineWidth = 1.5 / k;
      ctx.setLineDash([6 / k, 4 / k]);
      ctx.strokeRect(b.x - 4 / scale, b.y - 4 / scale, b.w + 8 / scale, b.h + 8 / scale);
      ctx.restore();
    }
  };
  const paintRef = useRef(paint);
  useLayoutEffect(() => {
    paintRef.current = paint;
    paint();
  });

  /** A point of the drawing under the pointer. */
  const at = (e: { clientX: number; clientY: number }) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale };
  };

  /** The text being typed as an item (null when nothing is typed). */
  const typed = (): DrawItem | null => {
    const value = text?.value.replace(/\s+$/, '') ?? '';
    if (!text || !value) return null;
    return {
      kind: 'text',
      id: newId(),
      x: text.x,
      y: text.y,
      text: value,
      color,
      size: TEXT_SIZES[Math.max(0, WIDTHS.indexOf(width))] ?? 28,
    };
  };
  const commitText = () => {
    const item = typed();
    if (item) change([...items, item]);
    setText(null);
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0 || saving) return;
    const p = at(e);
    e.currentTarget.setPointerCapture(e.pointerId);
    if (text) {
      commitText();
      return;
    }
    switch (tool) {
      case 'select': {
        const hit = itemAt(current, p.x, p.y, 6 / scale);
        setSelected(hit?.id ?? null);
        if (hit) moving.current = { id: hit.id, x: p.x, y: p.y, dx: 0, dy: 0 };
        return;
      }
      case 'pen':
      case 'marker':
      case 'eraser':
        draft.current = {
          kind: 'stroke',
          id: newId(),
          mode: tool === 'eraser' ? 'erase' : tool,
          points: [p.x, p.y],
          color,
          width,
        };
        break;
      case 'line':
      case 'arrow':
        draft.current = {
          kind: 'line',
          id: newId(),
          x1: p.x,
          y1: p.y,
          x2: p.x,
          y2: p.y,
          color,
          width,
          ...(tool === 'arrow' ? { arrow: true } : {}),
        };
        break;
      case 'rect':
      case 'ellipse':
        draft.current = {
          kind: tool,
          id: newId(),
          x: p.x,
          y: p.y,
          w: 0,
          h: 0,
          color,
          width,
          ...(fill ? { fill: true } : {}),
        };
        break;
      case 'text':
        setText({ x: p.x, y: p.y, value: '' });
        return;
    }
    paintRef.current();
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    const p = at(e);
    const m = moving.current;
    if (m) {
      m.dx = p.x - m.x;
      m.dy = p.y - m.y;
      paintRef.current();
      return;
    }
    const d = draft.current;
    if (!d) return;
    if (d.kind === 'stroke') {
      const n = d.points.length;
      if (Math.hypot(p.x - d.points[n - 2], p.y - d.points[n - 1]) * scale < 1) return;
      d.points.push(p.x, p.y);
    } else if (d.kind === 'line') {
      const end = e.shiftKey ? snapAngle(d.x1, d.y1, p.x, p.y) : p;
      d.x2 = end.x;
      d.y2 = end.y;
    } else if (d.kind === 'rect' || d.kind === 'ellipse') {
      let w = p.x - d.x;
      let h = p.y - d.y;
      if (e.shiftKey) {
        const side = Math.max(Math.abs(w), Math.abs(h));
        w = Math.sign(w || 1) * side;
        h = Math.sign(h || 1) * side;
      }
      d.w = w;
      d.h = h;
    }
    paintRef.current();
  };

  const onPointerUp = () => {
    const m = moving.current;
    moving.current = null;
    if (m) {
      if (m.dx || m.dy) change(items.map((it) => (it.id === m.id ? movedItem(it, m.dx, m.dy) : it)));
      else paintRef.current();
      return;
    }
    const d = draft.current;
    draft.current = null;
    if (!d) return;
    if (d.kind === 'stroke') {
      change([...items, { ...d, points: simplify(d.points, 0.5 / scale) }]);
      return;
    }
    // A click without a drag draws nothing.
    if (d.kind === 'line' && Math.hypot(d.x2 - d.x1, d.y2 - d.y1) < 2) return paintRef.current();
    if ((d.kind === 'rect' || d.kind === 'ellipse') && (Math.abs(d.w) < 2 || Math.abs(d.h) < 2)) {
      return paintRef.current();
    }
    change([...items, d]);
  };

  // Keys of the window: tools by letter, Ctrl+Z / Ctrl+Y, Delete for the picked item.
  const keysRef = useRef<(e: KeyboardEvent) => void>(() => undefined);
  const keys = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement).closest('input, textarea')) return;
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.code === 'KeyZ' && !e.shiftKey) stepBack();
    else if (ctrl && (e.code === 'KeyY' || (e.code === 'KeyZ' && e.shiftKey))) stepForward();
    else if ((e.key === 'Delete' || e.key === 'Backspace') && selected) remove(selected);
    else if (!ctrl && !e.altKey) {
      const found = TOOLS.find((x) => `Key${x.key}` === e.code);
      if (!found) return;
      setTool(found.id);
    } else return;
    e.preventDefault();
  };
  useLayoutEffect(() => {
    keysRef.current = keys;
  });
  useEffect(() => {
    const key = (e: KeyboardEvent) => keysRef.current(e);
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);

  const save = async () => {
    // A text still being typed goes into the drawing too.
    const pending = typed();
    if (text) commitText();
    setSaving(true);
    try {
      await onSave({ ...drawing, items: pending ? [...items, pending] : items });
    } finally {
      setSaving(false);
    }
  };
  const close = () => {
    if (text) return setText(null);
    if (dirty && !asking) return setAsking(true);
    onClose();
  };

  const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
  const textSize = TEXT_SIZES[Math.max(0, WIDTHS.indexOf(width))] ?? 28;
  return (
    <Dialog open onClose={close} title={title} size="xl" className="drawing-dialog">
      <div className="draw-bar" role="toolbar" aria-label={t('draw.tools')}>
        <div className="draw-group">
          {TOOLS.map((x) => (
            <IconButton
              key={x.id}
              size="sm"
              label={`${t(x.label)} (${x.key})`}
              icon={<x.icon size={16} />}
              pressed={tool === x.id}
              onClick={() => setTool(x.id)}
            />
          ))}
        </div>
        <div className="draw-group" role="group" aria-label={t('draw.color')}>
          {PALETTE.map((c) => (
            <button
              key={c}
              type="button"
              className="draw-swatch"
              style={{ background: c }}
              aria-label={c}
              aria-pressed={color === c}
              onClick={() => setColor(c)}
            />
          ))}
          <label className="draw-swatch draw-swatch-any" title={t('draw.colorAny')}>
            <input
              type="color"
              value={color}
              aria-label={t('draw.colorAny')}
              onChange={(e) => setColor(e.target.value)}
            />
          </label>
        </div>
        <div className="draw-group" role="group" aria-label={t('draw.width')}>
          {WIDTHS.map((w) => (
            <button
              key={w}
              type="button"
              className="draw-width"
              aria-label={t('draw.widthN', { n: w })}
              aria-pressed={width === w}
              onClick={() => setWidth(w)}
            >
              <span style={{ width: Math.min(18, w + 2), height: Math.min(18, w + 2) }} />
            </button>
          ))}
        </div>
        <label className="draw-check">
          <input type="checkbox" checked={fill} onChange={(e) => setFill(e.target.checked)} />
          {t('draw.fill')}
        </label>
        <div className="draw-group draw-end">
          <IconButton
            size="sm"
            label={t('draw.undo')}
            icon={<Undo2 size={16} />}
            disabled={!undo.length}
            onClick={stepBack}
          />
          <IconButton
            size="sm"
            label={t('draw.redo')}
            icon={<Redo2 size={16} />}
            disabled={!redo.length}
            onClick={stepForward}
          />
          <IconButton
            size="sm"
            label={selected ? t('draw.deletePicked') : t('draw.clear')}
            icon={<Trash2 size={16} />}
            disabled={!items.length}
            onClick={() => (selected ? remove(selected) : change([]))}
          />
        </div>
      </div>
      <div ref={stage} className="draw-stage">
        <div className="draw-sheet" style={{ width: drawing.w * scale, height: drawing.h * scale }}>
          <canvas
            ref={canvas}
            className={`draw-canvas draw-canvas-${tool}`}
            width={Math.max(1, Math.round(drawing.w * scale * dpr))}
            height={Math.max(1, Math.round(drawing.h * scale * dpr))}
            style={{ width: drawing.w * scale, height: drawing.h * scale }}
            data-items={items.length}
            aria-label={t('draw.sheet')}
            role="img"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          />
          {text && (
            <textarea
              className="draw-text"
              autoFocus
              aria-label={t('draw.textField')}
              value={text.value}
              style={{
                left: text.x * scale,
                top: text.y * scale,
                color,
                font: `${textSize * scale}px ${TEXT_FONT}`,
                lineHeight: 1.25,
              }}
              rows={Math.max(1, text.value.split('\n').length)}
              onChange={(e) => setText({ ...text, value: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  commitText();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  e.stopPropagation();
                  setText(null);
                }
              }}
            />
          )}
        </div>
      </div>
      <div className="draw-foot">
        {asking ? (
          <>
            <span className="text-warning">{t('draw.unsaved')}</span>
            <Button size="sm" variant="ghost" onClick={() => setAsking(false)}>
              {t('draw.back')}
            </Button>
            <Button size="sm" variant="danger" onClick={onClose}>
              {t('draw.discard')}
            </Button>
          </>
        ) : (
          <>
            {hint && <span className="muted small draw-hint">{hint}</span>}
            <Button size="sm" variant="ghost" onClick={close}>
              {t('common.cancel')}
            </Button>
            <Button size="sm" variant="primary" busy={saving} onClick={() => void save()}>
              {t('draw.save')}
            </Button>
          </>
        )}
      </div>
    </Dialog>
  );
}
