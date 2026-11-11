// Story text fields: a textarea over a mirror of its text, where marked fragments (Chekhov's gun, butterfly
// effect) and effects written in the text ("{x = 1}") are highlighted; and the context menu of story text,
// with the usual Cut, Copy, Paste and Select all plus the plot devices for the selected words.

import { ClipboardPaste, Copy, Scissors, TextSelect } from 'lucide-react';
import {
  Fragment,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type TextareaHTMLAttributes,
} from 'react';
import { t } from '../../i18n';
import { marksOn, resolveRange } from '../../story/marks';
import type { MarkAnchor, PlotDevice, PlotMark, StoryNode } from '../../story/model';
import { textPieces } from '../../story/textEffects';
import { Menu, toast, type MenuEntry } from '../components';
import { ButterflyIcon, GunIcon } from '../canvas/kindIcons';

export interface Highlight {
  start: number;
  end: number;
  className: string;
  /** A plot mark (its fragment on a card is a handle to drag its link from). */
  mark?: PlotMark;
  /** How the words look in the game (0.8): their colour, shown in the field itself. */
  style?: CSSProperties;
}

/** Highlights of a text: marked fragments of an anchor, and effects or shown values written in it. */
export function textHighlights(
  text: string,
  node?: StoryNode,
  anchor?: MarkAnchor,
  known?: (name: string) => boolean,
): Highlight[] {
  const out: Highlight[] = [];
  if (node && anchor) {
    for (const m of marksOn(node, anchor)) {
      const r = resolveRange(text, m.range);
      if (r) out.push({ ...r, className: `hl-${m.device}`, mark: m });
    }
  }
  const pieces = textPieces(text, known);
  for (const e of pieces.effects) out.push({ start: e.start, end: e.end, className: 'hl-effect' });
  for (const s of pieces.shows) out.push({ start: s.start, end: s.end, className: 'hl-show' });
  return out;
}

export interface TextPiece {
  text: string;
  /** Where the piece starts in the whole text. */
  start: number;
  over: Highlight[];
}

/**
 * The text cut where highlights begin and end (and at `points`: cues between words), each piece with the
 * highlights over it.
 */
export function highlightPieces(
  text: string,
  highlights: readonly Highlight[],
  points: readonly number[] = [],
): TextPiece[] {
  if (!highlights.length && !points.length) return [{ text, start: 0, over: [] }];
  const cuts = new Set([0, text.length]);
  for (const h of highlights) {
    cuts.add(Math.max(0, Math.min(text.length, h.start)));
    cuts.add(Math.max(0, Math.min(text.length, h.end)));
  }
  for (const p of points) cuts.add(Math.max(0, Math.min(text.length, p)));
  const sorted = [...cuts].sort((a, b) => a - b);
  const out: TextPiece[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const [a, b] = [sorted[i], sorted[i + 1]];
    if (a === b) continue;
    out.push({ text: text.slice(a, b), start: a, over: highlights.filter((h) => h.start <= a && h.end >= b) });
  }
  return out;
}

/** The styles of the highlights over a piece, one over another. */
export const pieceStyle = (over: readonly Highlight[]): CSSProperties | undefined =>
  over.some((h) => h.style) ? Object.assign({}, ...over.map((h) => h.style ?? {})) : undefined;

interface MarkedTextAreaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value'> {
  value: string;
  highlights: readonly Highlight[];
  /** Option texts: Enter does not add a line. */
  singleLine?: boolean;
  /** Offsets of cues (0.8): a small tick between the words there. */
  ticks?: readonly number[];
  /**
   * The words are drawn by the mirror, in their colours, and the field over it keeps only the caret and the
   * selection (0.8): for lines whose words have a look in the game.
   */
  live?: boolean;
  /** The colour of the whole line in the game (its style), for the words the mirror draws. */
  mirrorStyle?: CSSProperties;
}

export function MarkedTextArea({
  value,
  highlights,
  singleLine,
  ticks = [],
  live,
  mirrorStyle,
  className,
  onKeyDown,
  ...rest
}: MarkedTextAreaProps) {
  const tick = (at: number) => (ticks.includes(at) ? <i className="mtext-tick" /> : null);
  return (
    <div className={['mtext', live && 'mtext-live', className].filter(Boolean).join(' ')}>
      <div className="mtext-mirror" aria-hidden="true" style={live ? mirrorStyle : undefined}>
        {highlightPieces(value, highlights, ticks).map((p, i) => (
          <Fragment key={i}>
            {tick(p.start)}
            {p.over.length ? (
              <mark className={p.over.map((h) => h.className).join(' ')} style={pieceStyle(p.over)}>
                {p.text}
              </mark>
            ) : (
              <span>{p.text}</span>
            )}
          </Fragment>
        ))}
        {tick(value.length)}{' '}
      </div>
      <textarea
        {...rest}
        className="input mtext-input"
        value={value}
        onKeyDown={(e: KeyboardEvent<HTMLTextAreaElement>) => {
          if (singleLine && e.key === 'Enter') e.preventDefault();
          onKeyDown?.(e);
        }}
      />
    </div>
  );
}

type TextInput = HTMLTextAreaElement | HTMLInputElement;

interface MenuState {
  x: number;
  y: number;
  el: TextInput;
  start: number;
  end: number;
}

/**
 * The context menu of a story text field. `onDevice` (when given) lays a plot device over the selected
 * words; the menu then offers Chekhov's gun and the butterfly effect next to the usual commands.
 */
export function useTextMenu({
  readOnly,
  onDevice,
  extra,
}: {
  readOnly: boolean;
  onDevice?: (device: PlotDevice, selection: { start: number; end: number }) => void;
  /** More commands for the selection (0.8: how words of a line look, cues at the caret). */
  extra?: (selection: { start: number; end: number; selected: boolean }) => MenuEntry[];
}) {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const onContextMenu = (e: MouseEvent<TextInput>) => {
    e.preventDefault();
    const el = e.currentTarget;
    setMenu({ x: e.clientX, y: e.clientY, el, start: el.selectionStart ?? 0, end: el.selectionEnd ?? 0 });
  };
  let element = null;
  if (menu) {
    const { el, start, end } = menu;
    const selected = end > start && el.value.slice(start, end).trim() !== '';
    // The menu took the focus: give it back with the same selection before a command.
    const restore = () => {
      el.focus();
      el.setSelectionRange(start, end);
    };
    const entries: MenuEntry[] = [
      {
        id: 'cut',
        label: t('text.cut'),
        icon: <Scissors size={16} />,
        shortcut: 'Ctrl+X',
        disabled: readOnly || end <= start,
        onSelect: () => {
          restore();
          document.execCommand('cut');
        },
      },
      {
        id: 'copy',
        label: t('text.copy'),
        icon: <Copy size={16} />,
        shortcut: 'Ctrl+C',
        disabled: end <= start,
        onSelect: () => {
          restore();
          document.execCommand('copy');
        },
      },
      {
        id: 'paste',
        label: t('text.paste'),
        icon: <ClipboardPaste size={16} />,
        shortcut: 'Ctrl+V',
        disabled: readOnly,
        onSelect: () => {
          void navigator.clipboard
            .readText()
            .then((text) => {
              restore();
              document.execCommand('insertText', false, text);
            })
            .catch(() => {
              restore();
              toast({ kind: 'info', text: t('text.pasteKeys') });
            });
        },
      },
      {
        id: 'all',
        label: t('text.selectAll'),
        icon: <TextSelect size={16} />,
        shortcut: 'Ctrl+A',
        onSelect: () => {
          el.focus();
          el.select();
        },
      },
    ];
    if (onDevice) {
      entries.push(
        { id: 'sep-plot', separator: true },
        {
          id: 'gun',
          label: t('plot.gun'),
          icon: <GunIcon size={16} />,
          disabled: readOnly || !selected,
          onSelect: () => onDevice('gun', { start, end }),
        },
        {
          id: 'butterfly',
          label: t('plot.butterfly'),
          icon: <ButterflyIcon size={16} />,
          disabled: readOnly || !selected,
          onSelect: () => onDevice('butterfly', { start, end }),
        },
      );
    }
    const more = extra?.({ start, end, selected }) ?? [];
    if (more.length) entries.push({ id: 'sep-extra', separator: true }, ...more);
    element = <Menu entries={entries} x={menu.x} y={menu.y} label={t('text.menu')} onClose={() => setMenu(null)} />;
  }
  return { onContextMenu, menu: element };
}
