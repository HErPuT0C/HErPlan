// The text of a line "as in the game" (0.8.3, "Редактор реплик" 5): an ordinary textarea, unseen, holds the
// text, the caret and the selection — typing, deleting, the clipboard, the keys of the editor all are its own
// — and a canvas over it draws the letters in the game's font, each in its colour, weight and size, laid out
// in rows of the bubble's width, so the line breaks where the game breaks it. The layout of the letters gives
// every sign its box: a click puts the caret there, a drag selects, ↑ ↓ go by the rows of the game. Effects
// move in the field (or, switched off, underline the words). Cues stand as small icons between the letters:
// hover says what it is, a click changes it, dragging moves it. Over a selection floats a toolbar (given by
// the line's editor). Braced effects ("{x = 1}") are drawn grey: the player never sees them.

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react';
import { letterMove } from '../../story/gameFx';
import { layoutText } from '../../story/gameLayout';
import type { GameLine, Letter } from '../../story/gameLine';
import type { CueProps, PlotDevice } from '../../story/model';
import type { PalettePreview } from '../../story/palette';
import { advance, drawGlyph, type GameFont } from './gameAssets';
import { CUE_ICONS, cueKind } from './lineLook';

/** Screen pixels between rows: room for the icons of cues over the letters. */
const GAP = 16;
/** Margins in pixels of the game. */
const PAD_X = 4;
const PAD_Y = 2;
const BRACED = '#7c7a86';
const BACK = '#100e14';
const SELECTION = 'rgba(52, 201, 165, 0.38)';
const CARET = '#e8e6de';
const PLOT: Record<PlotDevice, string> = { gun: '#e0a43c', butterfly: '#b58cf0' };

export interface FieldCue {
  id: string;
  at: number;
  props: CueProps;
  /** What it is, in words (for the hover). */
  label: string;
}

export interface Selection {
  start: number;
  end: number;
}

type TextareaProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'children' | 'style'>;

export function GameTextField({
  text,
  line,
  font,
  preview,
  scale,
  moving,
  plot,
  cues,
  readOnly,
  textarea,
  onMenu,
  onCue,
  onMoveCue,
  toolbar,
}: {
  text: string;
  /** The line worked out by the game's rules (looks of the words, from the marks). */
  line: GameLine;
  font: GameFont;
  preview: PalettePreview;
  scale: number;
  /** Effects move in the field; off — they underline their words. */
  moving: boolean;
  /** Words with a plot device over them: underlined in its colour. */
  plot: readonly { start: number; end: number; device: PlotDevice }[];
  cues: readonly FieldCue[];
  readOnly: boolean;
  /** The textarea's own props: its label, keys, changes. */
  textarea: TextareaProps;
  /** The right button: the menu of the text, for the textarea with its selection. */
  onMenu: (el: HTMLTextAreaElement, x: number, y: number) => void;
  /** A click on a cue: change it (x, y — where on the screen). */
  onCue: (id: string, x: number, y: number) => void;
  onMoveCue: (id: string, at: number) => void;
  /** What floats over a selection, placed there by the field. */
  toolbar?: (sel: Selection) => ReactNode;
}) {
  const ta = useRef<HTMLTextAreaElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [sel, setSel] = useState<Selection & { focused: boolean }>({ start: 0, end: 0, focused: false });
  const [drag, setDrag] = useState<{ id: string; to: number } | null>(null);
  const width = preview.text.width;
  const adv = (l: Letter) => advance(font, l.ch, l.props.size, l.props.bold);

  // Every sign of the text, the braced ones too (grey, in plain letters): the author edits them as well.
  const geo = useMemo(() => {
    const letters = line.letters.map((l) =>
      l.i >= 0 ? l : { ...l, i: 0, props: { ...l.props, col: BRACED, fx: [], bold: false, size: 1 as const } },
    );
    const lay = layoutText(letters, (ch, size, bold) => advance(font, ch, size, bold), font.font, width);
    const rows = lay.rows.length ? lay.rows : [{ top: 0, height: font.font.line_h, width: 0 }];
    // A line break at the very end opens a row of its own.
    const last = lay.placed[lay.placed.length - 1];
    if (last?.letter.ch === '\n') rows.push({ top: lay.height, height: font.font.line_h, width: 0 });
    const top = (row: number) => PAD_Y * scale + (rows[row]?.top ?? 0) * scale + (row + 1) * GAP;
    const height = top(rows.length - 1) + (rows[rows.length - 1].height + PAD_Y) * scale + 4;
    return { placed: lay.placed, rows, top, height, letters };
  }, [line, font, width, scale]);
  const W = (width + 2 * PAD_X) * scale;

  /** Where the caret stands before the sign at `o` (screen pixels from the field's top-left). */
  const caretAt = (o: number): { x: number; y: number; row: number } => {
    const p = geo.placed.find((q) => q.letter.at === o);
    if (p) {
      const x = p.skip && p.letter.ch !== '\n' ? 0 : p.x;
      return { x: (PAD_X + x) * scale, y: geo.top(p.row), row: p.row };
    }
    const last = geo.placed[geo.placed.length - 1];
    if (!last) return { x: PAD_X * scale, y: geo.top(0), row: 0 };
    if (last.letter.ch === '\n') return { x: PAD_X * scale, y: geo.top(last.row + 1), row: last.row + 1 };
    return { x: (PAD_X + last.x + (last.skip ? 0 : adv(last.letter))) * scale, y: geo.top(last.row), row: last.row };
  };
  /** The place in the text nearest to a point (screen pixels from the field's top-left). */
  const hit = (x: number, y: number): number => {
    let row = geo.rows.length - 1;
    for (let r = 0; r < geo.rows.length; r++) {
      if (y < geo.top(r) + geo.rows[r].height * scale) {
        row = r;
        break;
      }
    }
    const inRow = geo.placed.filter((p) => p.row === row);
    const gx = x / scale - PAD_X;
    for (const p of inRow) {
      if (p.letter.ch === '\n') return p.letter.at;
      if (p.skip) continue;
      if (gx < p.x + adv(p.letter) / 2) return p.letter.at;
    }
    const after = inRow[inRow.length - 1];
    if (!after) {
      // An empty row after a line break.
      const prev = geo.placed[geo.placed.length - 1];
      return prev ? prev.letter.at + prev.letter.ch.length : 0;
    }
    return after.letter.at + after.letter.ch.length;
  };

  // The selection follows the textarea, whatever moved it.
  const sync = () => {
    const el = ta.current;
    if (!el) return;
    setSel({ start: el.selectionStart, end: el.selectionEnd, focused: document.activeElement === el });
  };
  useEffect(() => {
    const on = () => {
      if (document.activeElement === ta.current) sync();
    };
    document.addEventListener('selectionchange', on);
    return () => document.removeEventListener('selectionchange', on);
  }, []);
  useEffect(sync, [text]);

  const select = (anchor: number, focus: number) => {
    const el = ta.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    if (focus < anchor) el.setSelectionRange(focus, anchor, 'backward');
    else el.setSelectionRange(anchor, focus, 'forward');
    sync();
  };
  const local = (e: { clientX: number; clientY: number }) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const anchorRef = useRef(0);

  // Drawing: every frame while effects move, else when something changed.
  const draw = (t: number) => {
    const c = canvas.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = BACK;
    ctx.fillRect(0, 0, c.width, c.height);
    const lo = Math.min(sel.start, sel.end);
    const hi = Math.max(sel.start, sel.end);
    for (const p of geo.placed) {
      const l = p.letter;
      if (p.skip || l.ch === '\n') continue;
      const x = (PAD_X + p.x) * scale;
      const rowTop = geo.top(p.row);
      const y = rowTop + (p.y - geo.rows[p.row].top) * scale;
      const w = adv(l) * scale;
      if (l.at >= lo && l.at < hi) {
        ctx.fillStyle = SELECTION;
        ctx.fillRect(x, rowTop - 2, w, geo.rows[p.row].height * scale + 4);
      }
      const plotted = plot.find((m) => m.start <= l.at && l.at < m.end);
      if (plotted) {
        ctx.fillStyle = PLOT[plotted.device];
        ctx.fillRect(x, rowTop + geo.rows[p.row].height * scale + 1, w, Math.max(2, scale - 1));
      }
      if (/\s/.test(l.ch)) continue;
      const move = moving && l.props.fx.length ? letterMove(l.props.fx, preview.effects, l.i, t, 10) : null;
      drawGlyph(
        ctx,
        font,
        l.ch,
        move?.col ?? l.props.col,
        l.props.size,
        l.props.bold,
        (x + (move?.dx ?? 0) * scale) / scale,
        (y + (move?.dy ?? 0) * scale) / scale,
        scale,
      );
      if (!moving && l.props.fx.length) {
        // Effects still: the words that have one are underlined in their colour.
        ctx.fillStyle = l.props.col;
        ctx.fillRect(x, rowTop + geo.rows[p.row].height * scale - 1, w, Math.max(1, scale - 1));
      }
    }
    if (sel.focused && sel.start === sel.end && !readOnly && Math.floor(t * 1.6) % 2 === 0) {
      const at = caretAt(sel.start);
      ctx.fillStyle = CARET;
      ctx.fillRect(at.x, at.y - 1, Math.max(1, Math.round(scale / 2)), (geo.rows[at.row]?.height ?? 11) * scale + 2);
    }
    if (drag) {
      const at = caretAt(drag.to);
      ctx.fillStyle = '#34c9a5';
      ctx.fillRect(at.x - 1, at.y - 2, 3, (geo.rows[at.row]?.height ?? 11) * scale + 4);
    }
  };
  const drawRef = useRef(draw);
  useLayoutEffect(() => {
    drawRef.current = draw;
    draw(performance.now() / 1000);
  });
  // The caret blinks and the effects move: a frame now and then (every frame only while effects move).
  useEffect(() => {
    let frame = 0;
    let last = 0;
    const tick = (now: number) => {
      if (moving || now - last > 300) {
        last = now;
        drawRef.current(now / 1000);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [moving]);

  const lo = Math.min(sel.start, sel.end);
  const hi = Math.max(sel.start, sel.end);
  const selected = sel.focused && hi > lo && text.slice(lo, hi).trim() !== '';
  const barAt = selected ? caretAt(lo) : null;

  return (
    <div className="gfield" style={{ width: W }}>
      <canvas
        ref={canvas}
        className="gfield-canvas"
        width={W}
        height={geo.height}
        style={{ width: W, height: geo.height }}
        data-rows={geo.rows.length}
        data-selection={hi > lo ? `${lo}-${hi}` : undefined}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          const o = hit(local(e).x, local(e).y);
          if (e.shiftKey && document.activeElement === ta.current) {
            const el = ta.current!;
            anchorRef.current = el.selectionDirection === 'backward' ? el.selectionEnd : el.selectionStart;
          } else anchorRef.current = o;
          select(anchorRef.current, o);
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onDoubleClick={(e) => {
          // A double click: the word.
          const o = hit(local(e).x, local(e).y);
          let a = o;
          let b = o;
          while (a > 0 && /[\p{L}\p{N}]/u.test(text[a - 1])) a--;
          while (b < text.length && /[\p{L}\p{N}]/u.test(text[b])) b++;
          anchorRef.current = a;
          select(a, b);
        }}
        onPointerMove={(e) => {
          if (!(e.buttons & 1) || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
          select(anchorRef.current, hit(local(e).x, local(e).y));
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          const el = ta.current;
          if (!el) return;
          // A right click outside the selection puts the caret there first.
          const o = hit(local(e).x, local(e).y);
          if (o < el.selectionStart || o > el.selectionEnd || el.selectionStart === el.selectionEnd) select(o, o);
          onMenu(el, e.clientX, e.clientY);
        }}
      />
      <textarea
        {...textarea}
        ref={ta}
        className="gfield-input"
        value={text}
        readOnly={readOnly}
        spellCheck={false}
        onFocus={(e) => {
          sync();
          textarea.onFocus?.(e);
        }}
        onBlur={(e) => {
          sync();
          textarea.onBlur?.(e);
        }}
        onKeyDown={(e) => {
          // ↑ ↓, Home and End go by the rows of the game, not by the hidden field's own.
          const el = e.currentTarget;
          const keys = ['ArrowUp', 'ArrowDown', 'Home', 'End'];
          if (keys.includes(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
            const focus = el.selectionDirection === 'backward' ? el.selectionStart : el.selectionEnd;
            const other = el.selectionDirection === 'backward' ? el.selectionEnd : el.selectionStart;
            const c = caretAt(focus);
            const to =
              e.key === 'ArrowUp'
                ? c.row === 0
                  ? 0
                  : hit(c.x, geo.top(c.row - 1) + 1)
                : e.key === 'ArrowDown'
                  ? c.row >= geo.rows.length - 1
                    ? text.length
                    : hit(c.x, geo.top(c.row + 1) + 1)
                  : hit(e.key === 'Home' ? 0 : W, c.y + 1);
            e.preventDefault();
            select(e.shiftKey ? other : to, to);
            return;
          }
          textarea.onKeyDown?.(e);
        }}
      />
      {cues.map((c) => {
        const at = caretAt(c.at);
        const kind = cueKind(c.props);
        const Icon = CUE_ICONS[kind];
        return (
          <button
            key={c.id}
            type="button"
            className={`gfield-cue gfield-cue-${kind}`}
            style={{ left: at.x - 8, top: at.y - GAP + 1 }}
            title={c.label}
            aria-label={c.label}
            data-at={c.at}
            disabled={readOnly}
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              e.currentTarget.setPointerCapture(e.pointerId);
              setDrag(null);
            }}
            onPointerMove={(e) => {
              if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
              const p = local(e);
              const to = hit(p.x, p.y);
              if (to !== c.at || drag) setDrag({ id: c.id, to });
            }}
            onPointerUp={(e) => {
              const moved = drag?.id === c.id && drag.to !== c.at;
              setDrag(null);
              if (moved) onMoveCue(c.id, drag.to);
              else onCue(c.id, e.clientX, e.clientY);
            }}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' && e.key !== ' ') return;
              e.preventDefault();
              const r = e.currentTarget.getBoundingClientRect();
              onCue(c.id, r.left, r.bottom + 2);
            }}
          >
            <Icon size={12} aria-hidden="true" />
            {kind === 'pause' && typeof c.props.pause === 'number' && <span>{c.props.pause}</span>}
          </button>
        );
      })}
      {selected && barAt && toolbar && (
        <div
          className="gfield-bar"
          style={{ left: Math.max(0, Math.min(barAt.x - 8, W - 360)), top: barAt.y - GAP - 34 }}
          // The toolbar keeps the selection: pressing it does not take the focus from the text.
          onPointerDown={(e) => {
            if ((e.target as HTMLElement).closest('input')) return;
            e.preventDefault();
          }}
        >
          {toolbar({ start: lo, end: hi })}
        </div>
      )}
    </div>
  );
}
