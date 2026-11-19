// The drawing window (0.9): a sheet to draw on, like Paint — a pen, a marker, an eraser, lines and arrows,
// boxes and ovals, texts, in colours and widths — over a white sheet or over a picture of the project. What is
// drawn stays shapes: picked with the arrow tool it moves or goes away, Ctrl+Z takes back a step. Saving gives
// the drawing to its owner (a document, a card of the map), which makes the picture and writes it.

import {
  ArrowUpRight,
  Bold,
  Circle,
  Eraser,
  Highlighter,
  Italic,
  MousePointer2,
  Pencil,
  Redo2,
  Slash,
  Square,
  Trash2,
  Type,
  Undo2,
} from 'lucide-react';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
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
  TEXT_FONTS,
  WIDTHS,
  type DrawItem,
  type Drawing,
  type TextFont,
  type TextItem,
  type TextLook,
  type TextRun,
  type Tool,
} from '../../drawing/model';
import { renderDrawing } from '../../drawing/render';
import {
  canvasMeasure,
  defaultLook,
  FONT_STACKS,
  layoutText,
  LINE_HEIGHT,
  mapRange,
  retype,
  runsOf,
  runsText,
  setTextMeasure,
  styleOf,
  withRuns,
} from '../../drawing/text';
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
/** Sizes of text offered (pixels of the drawing). */
const TEXT_SIZES = [12, 14, 16, 18, 20, 24, 28, 32, 40, 48, 56, 64, 72, 96, 128];
const HISTORY = 100;

const FONT_NAMES: Record<TextFont, MessageKey> = {
  sans: 'draw.font.sans',
  serif: 'draw.font.serif',
  mono: 'draw.font.mono',
  hand: 'draw.font.hand',
};

/** What can go around letters, as the buttons of the text bar offer it. */
type LookChoice = 'none' | 'outline' | 'thick' | 'shadow' | 'glow' | 'plate';
const LOOK_CHOICES: { id: LookChoice; label: MessageKey }[] = [
  { id: 'none', label: 'draw.look.none' },
  { id: 'outline', label: 'draw.look.outline' },
  { id: 'thick', label: 'draw.look.thick' },
  { id: 'shadow', label: 'draw.look.shadow' },
  { id: 'glow', label: 'draw.look.glow' },
  { id: 'plate', label: 'draw.look.plate' },
];
const choiceOf = (look?: TextLook): LookChoice =>
  !look ? 'none' : look.kind === 'outline' && look.thick ? 'thick' : look.kind;

/** Settings of text: the font of a new text, and the colours picked for each look. */
interface TextHabits {
  font: TextFont;
  size: number;
  bold: boolean;
  italic: boolean;
  lookColors: Partial<Record<TextLook['kind'], string>>;
}

// The habits of the last drawing: the tool, the colour, the width, the text.
const remembered = atom<{ tool: Tool; color: string; width: number; fill: boolean; text: TextHabits }>({
  tool: 'pen',
  color: PALETTE[2],
  width: WIDTHS[1],
  fill: false,
  text: { font: 'sans', size: 28, bold: false, italic: false, lookColors: {} },
});

/** A text being typed or changed in the window. */
interface TextEdit {
  /** The text being changed; null: a new one. */
  id: string | null;
  x: number;
  y: number;
  runs: TextRun[];
  font: TextFont;
  size: number;
  bold: boolean;
  italic: boolean;
  /** The style the first letters of an empty text take. */
  style: Omit<TextRun, 'text'>;
}

/** The text as an item of the drawing; null while it is empty. */
function editedItem(e: TextEdit): TextItem | null {
  const base: TextItem = {
    kind: 'text',
    id: e.id ?? '',
    x: e.x,
    y: e.y,
    text: '',
    color: e.style.color,
    size: e.size,
  };
  if (e.font !== 'sans') base.font = e.font;
  if (e.bold) base.bold = true;
  if (e.italic) base.italic = true;
  const item = withRuns(base, e.runs.length ? e.runs : []);
  // A text of spaces and empty lines is no text.
  return item.text.trim() ? item : null;
}

/** The items with the text put in (a new one at the end, a changed one in its place, an emptied one gone). */
function withEdit(items: DrawItem[], e: TextEdit): DrawItem[] {
  const item = editedItem(e);
  if (!e.id) return item ? [...items, { ...item, id: newId() }] : items;
  return item ? items.map((x) => (x.id === e.id ? item : x)) : items.filter((x) => x.id !== e.id);
}

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
  const [habits, setHabits] = useState<TextHabits>(() => remembered.get().text);
  /** The look the next text gets (picked in the bar before typing). */
  const [nextLook, setNextLook] = useState<TextLook | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [edit, setEdit] = useState<TextEdit | null>(null);
  /** The text field over the sheet while a text is typed, and what was selected in it last. */
  const field = useRef<HTMLTextAreaElement>(null);
  /** The selection in the text field: the bar shows the style of what is selected. */
  const [picked, setPicked] = useState({ start: 0, end: 0 });
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
    // The text being typed (its selected words) or the picked item takes the colour too.
    if (edit) styleText({ color: v });
    else if (selectedItem && selectedItem.kind !== 'stroke') recolor(selectedItem, v);
    else if (selectedItem?.kind === 'stroke' && selectedItem.mode !== 'erase') recolor(selectedItem, v);
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
  const selectedItem = items.find((x) => x.id === selected);

  /** A picked item in another colour: all of a text, its looks kept. */
  const recolor = (it: DrawItem, c: string) => {
    if (it.kind === 'text') return restyleItem(it, (r) => ({ ...r, color: c }));
    change(items.map((x) => (x.id === it.id ? { ...x, color: c } : x)));
  };
  const restyleItem = (it: TextItem, fn: (r: TextRun) => TextRun) => {
    const runs = runsOf(it);
    const next = withRuns(it, mapRange(runs, 0, runsText(runs).length, fn));
    if (JSON.stringify(next) !== JSON.stringify(it)) change(items.map((x) => (x.id === it.id ? next : x)));
  };
  const setItemFont = (it: TextItem, props: Partial<Pick<TextItem, 'font' | 'size' | 'bold' | 'italic'>>) => {
    const next: TextItem = { ...it, ...props };
    if (next.font === 'sans') delete next.font;
    if (!next.bold) delete next.bold;
    if (!next.italic) delete next.italic;
    change(items.map((x) => (x.id === it.id ? next : x)));
  };

  // ---------- text ----------

  /**
   * Where the text field's selection is: what a colour or a look applies to (all of the text when nothing is
   * selected). Read from the field itself in handlers, from the last selection seen while drawing the bar.
   */
  const textRange = (e: TextEdit, sel: { start: number; end: number }) => {
    const { start, end } = sel;
    return (start < end ? [start, end, true] : [0, runsText(e.runs).length, false]) as [number, number, boolean];
  };
  const liveRange = (e: TextEdit) => {
    const f = field.current;
    return textRange(e, f ? { start: f.selectionStart, end: f.selectionEnd } : picked);
  };

  /** The style shown in the bar: of the selected letters, the letter before the caret, or the new text. */
  const textStyle = (): Omit<TextRun, 'text'> => {
    if (edit) {
      const some = picked.start < picked.end;
      return (some ? styleOf(edit.runs, picked.start) : styleOf(edit.runs, picked.end - 1)) ?? edit.style;
    }
    if (selectedItem?.kind === 'text') return styleOf(runsOf(selectedItem), 0) ?? { color: selectedItem.color };
    return nextLook ? { color, look: nextLook } : { color };
  };

  /** Gives the selected letters (or all of the text) a colour and/or a look. */
  const styleText = (patch: { color?: string; look?: TextLook | null }, keepLookKind = false) => {
    if (!edit) return;
    const [start, end, some] = liveRange(edit);
    const apply = (r: Omit<TextRun, 'text'>): Omit<TextRun, 'text'> => {
      const color = patch.color ?? r.color;
      let look = patch.look === undefined ? r.look : (patch.look ?? undefined);
      // A colour of a look keeps each part's own kind of look.
      if (keepLookKind && patch.look) look = r.look ? { ...r.look, color: patch.look.color } : undefined;
      return look ? { color, look } : { color };
    };
    const runs = mapRange(edit.runs, start, end, (r) => ({ text: r.text, ...apply(r) }));
    // The field keeps its focus and selection (the bar's buttons do not take them), to go on colouring.
    setEdit({ ...edit, runs, style: some ? edit.style : apply(edit.style) });
  };

  /** Starts typing a new text at a point, or changing a text of the drawing. */
  const startText = (p: { x: number; y: number }, it?: TextItem) => {
    if (it) {
      setSelected(null);
      setEdit({
        id: it.id,
        x: it.x,
        y: it.y,
        runs: runsOf(it),
        font: it.font ?? 'sans',
        size: it.size,
        bold: !!it.bold,
        italic: !!it.italic,
        style: it.look ? { color: it.color, look: it.look } : { color: it.color },
      });
      return;
    }
    setEdit({
      id: null,
      x: p.x,
      y: p.y,
      runs: [],
      font: habits.font,
      size: habits.size,
      bold: habits.bold,
      italic: habits.italic,
      style: nextLook ? { color, look: nextLook } : { color },
    });
  };
  const finishText = () => {
    if (!edit) return;
    const next = withEdit(items, edit);
    if (JSON.stringify(next) !== JSON.stringify(items)) change(next);
    setEdit(null);
  };

  /** A look from the bar: on the selected letters while typing, on a picked text, or for the texts to come. */
  const pickLook = (choice: LookChoice) => {
    const base = textStyle();
    const kind: TextLook['kind'] | null = choice === 'none' ? null : choice === 'thick' ? 'outline' : choice;
    const look: TextLook | null = kind
      ? {
          kind,
          color: habits.lookColors[kind] ?? defaultLook(kind, base.color).color,
          ...(choice === 'thick' ? { thick: true } : {}),
        }
      : null;
    if (edit) styleText({ look });
    else if (selectedItem?.kind === 'text') {
      restyleItem(selectedItem, (r) => (look ? { ...r, look } : { text: r.text, color: r.color }));
    } else setNextLook(look);
  };
  /** The colour of the look of the selected letters (each keeps its own kind of look). */
  const pickLookColor = (c: string) => {
    const base = textStyle();
    if (base.look) rememberHabits({ lookColors: { ...habits.lookColors, [base.look.kind]: c } });
    if (edit) styleText({ look: { kind: 'outline', color: c } }, true);
    else if (selectedItem?.kind === 'text') {
      restyleItem(selectedItem, (r) => (r.look ? { ...r, look: { ...r.look, color: c } } : r));
    } else if (nextLook) setNextLook({ ...nextLook, color: c });
  };

  const rememberHabits = (patch: Partial<TextHabits>) => {
    const next = { ...habits, ...patch };
    setHabits(next);
    remembered.set((r) => ({ ...r, text: next }));
  };
  /** Font, size, bold, italic: of the text being typed, of a picked text, or of the texts to come. */
  const setTextFont = (props: Partial<Pick<TextHabits, 'font' | 'size' | 'bold' | 'italic'>>) => {
    rememberHabits(props);
    if (edit) {
      setEdit({ ...edit, ...props });
      // Back to typing after a list of the bar (the field remembers its selection).
      field.current?.focus();
    } else if (selectedItem?.kind === 'text') setItemFont(selectedItem, props);
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
    let shown = m ? items.map((it) => (it.id === m.id ? movedItem(it, m.dx, m.dy) : it)) : items;
    // A text being typed is drawn as it will be, in its place (under the see-through text field).
    if (edit) {
      const typing = editedItem(edit);
      shown = edit.id ? shown.flatMap((it) => (it.id !== edit.id ? [it] : typing ? [typing] : [])) : shown;
      if (!edit.id && typing) shown = [...shown, typing];
    }
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

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0 || saving) return;
    // No mouse events after this one: their default would take the focus from a text field just opened.
    e.preventDefault();
    const p = at(e);
    e.currentTarget.setPointerCapture(e.pointerId);
    if (edit) {
      finishText();
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
      case 'text': {
        // On a text: change it; elsewhere: a new one.
        const hit = itemAt(current, p.x, p.y, 4 / scale);
        startText(p, hit?.kind === 'text' ? hit : undefined);
        return;
      }
    }
    paintRef.current();
  };

  /** A double click on a text with the arrow changes it. */
  const onDoubleClick = (e: { clientX: number; clientY: number }) => {
    if (tool !== 'select' || edit) return;
    const p = at(e);
    const hit = itemAt(current, p.x, p.y, 4 / scale);
    if (hit?.kind === 'text') startText(p, hit);
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
    if ((e.target as HTMLElement).closest('input, textarea, select')) return;
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

  // Texts are measured in the window's fonts: their frames and picking follow the real letters.
  useEffect(() => {
    const ctx = document.createElement('canvas').getContext('2d');
    if (ctx) setTextMeasure(canvasMeasure(ctx));
  }, []);
  // A text opened for changing starts with the caret at its end.
  useEffect(() => {
    const f = field.current;
    if (!f || !edit) return;
    f.focus();
    f.setSelectionRange(f.value.length, f.value.length);
    // Only when a text is opened, not on every letter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edit?.id, edit?.x, edit?.y, !!edit]);

  const save = async () => {
    // A text still being typed goes into the drawing too.
    const next = edit ? withEdit(items, edit) : items;
    if (edit) finishText();
    setSaving(true);
    try {
      await onSave({ ...drawing, items: next });
    } finally {
      setSaving(false);
    }
  };
  const close = () => {
    if (edit) return finishText();
    if (dirty && !asking) return setAsking(true);
    onClose();
  };

  const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
  const typing = edit ? editedItem(edit) : null;
  const typingLayout = edit
    ? layoutText(typing ?? { kind: 'text', id: '', x: edit.x, y: edit.y, text: ' ', color: '#000', size: edit.size })
    : null;
  const textBar = tool === 'text' || !!edit || selectedItem?.kind === 'text';
  const fontOf: Pick<TextItem, 'font' | 'size' | 'bold' | 'italic'> = edit
    ? edit
    : selectedItem?.kind === 'text'
      ? selectedItem
      : habits;
  const shownStyle = textBar ? textStyle() : null;
  const shownColor = (edit || selectedItem?.kind === 'text') && shownStyle ? shownStyle.color : color;
  /** Buttons of the bar keep the focus in the text field, so its selection stays. */
  const keep = (e: { preventDefault: () => void }) => {
    if (edit) e.preventDefault();
  };
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
              aria-pressed={shownColor === c}
              onMouseDown={keep}
              onClick={() => setColor(c)}
            />
          ))}
          <label className="draw-swatch draw-swatch-any" title={t('draw.colorAny')}>
            <input
              type="color"
              value={shownColor}
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
      {textBar && shownStyle && (
        <div className="draw-bar draw-textbar" role="toolbar" aria-label={t('draw.textTools')}>
          <select
            className="input draw-font"
            aria-label={t('draw.font')}
            value={fontOf.font ?? 'sans'}
            onChange={(e) => setTextFont({ font: e.target.value as TextFont })}
          >
            {TEXT_FONTS.map((f) => (
              <option key={f} value={f} style={{ fontFamily: FONT_STACKS[f] }}>
                {t(FONT_NAMES[f])}
              </option>
            ))}
          </select>
          <select
            className="input draw-size"
            aria-label={t('draw.size')}
            value={fontOf.size}
            onChange={(e) => setTextFont({ size: Number(e.target.value) })}
          >
            {[...new Set([...TEXT_SIZES, fontOf.size])]
              .sort((a, b) => a - b)
              .map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
          </select>
          <div className="draw-group">
            <IconButton
              size="sm"
              label={t('draw.bold')}
              icon={<Bold size={16} />}
              pressed={!!fontOf.bold}
              onMouseDown={keep}
              onClick={() => setTextFont({ bold: !fontOf.bold })}
            />
            <IconButton
              size="sm"
              label={t('draw.italic')}
              icon={<Italic size={16} />}
              pressed={!!fontOf.italic}
              onMouseDown={keep}
              onClick={() => setTextFont({ italic: !fontOf.italic })}
            />
          </div>
          <div className="draw-group" role="group" aria-label={t('draw.look')}>
            {LOOK_CHOICES.map((x) => (
              <button
                key={x.id}
                type="button"
                className={`draw-look draw-look-${x.id}`}
                aria-label={t(x.label)}
                title={t(x.label)}
                aria-pressed={choiceOf(shownStyle.look) === x.id}
                onMouseDown={keep}
                onClick={() => pickLook(x.id)}
              >
                <span aria-hidden="true" />
              </button>
            ))}
          </div>
          {shownStyle.look && (
            <div className="draw-group" role="group" aria-label={t('draw.lookColor')}>
              <span className="muted small">{t('draw.lookColor')}</span>
              {PALETTE.map((c) => (
                <button
                  key={c}
                  type="button"
                  className="draw-swatch draw-swatch-small"
                  style={{ background: c }}
                  aria-label={c}
                  aria-pressed={shownStyle.look?.color === c}
                  onMouseDown={keep}
                  onClick={() => pickLookColor(c)}
                />
              ))}
              <label className="draw-swatch draw-swatch-small draw-swatch-any" title={t('draw.colorAny')}>
                <input
                  type="color"
                  value={shownStyle.look.color}
                  aria-label={t('draw.lookColorAny')}
                  onChange={(e) => pickLookColor(e.target.value)}
                />
              </label>
            </div>
          )}
          <span className="muted small draw-texthint">{t(edit ? 'draw.textHintTyping' : 'draw.textHint')}</span>
        </div>
      )}
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
            onDoubleClick={onDoubleClick}
          />
          {edit && typingLayout && (
            // The letters are drawn on the sheet; the field over them is see-through: its caret and selection show.
            <textarea
              ref={field}
              className="draw-text"
              autoFocus
              spellCheck={false}
              wrap="off"
              aria-label={t('draw.textField')}
              value={runsText(edit.runs)}
              style={
                {
                  left: edit.x * scale,
                  top: edit.y * scale,
                  width: (typingLayout.w + edit.size) * scale,
                  height: typingLayout.h * scale,
                  fontFamily: FONT_STACKS[edit.font],
                  fontSize: edit.size * scale,
                  fontWeight: edit.bold ? 'bold' : 'normal',
                  fontStyle: edit.italic ? 'italic' : 'normal',
                  lineHeight: `${edit.size * LINE_HEIGHT * scale}px`,
                } as CSSProperties
              }
              onChange={(e) => setEdit({ ...edit, runs: retype(edit.runs, e.target.value, edit.style) })}
              onSelect={(e) => setPicked({ start: e.currentTarget.selectionStart, end: e.currentTarget.selectionEnd })}
              onKeyDown={(e) => {
                const ctrl = e.ctrlKey || e.metaKey;
                if (e.key === 'Escape' || (ctrl && e.key === 'Enter')) {
                  // Escape keeps what was typed: the text is done.
                  e.preventDefault();
                  e.stopPropagation();
                  finishText();
                } else if (ctrl && e.code === 'KeyB') {
                  e.preventDefault();
                  setTextFont({ bold: !edit.bold });
                } else if (ctrl && e.code === 'KeyI') {
                  e.preventDefault();
                  setTextFont({ italic: !edit.italic });
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
