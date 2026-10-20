// Story text fields: a textarea over a mirror of its text, where marked fragments (Chekhov's gun, butterfly
// effect) and effects written in the text ("{x = 1}") are highlighted; and the context menu of story text,
// with the usual Cut, Copy, Paste and Select all plus the plot devices for the selected words.

import { ClipboardPaste, Copy, Scissors, TextSelect } from 'lucide-react';
import { useState, type KeyboardEvent, type MouseEvent, type TextareaHTMLAttributes } from 'react';
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

/** The text cut where highlights begin and end, each piece with the highlights over it. */
export function highlightPieces(text: string, highlights: readonly Highlight[]): { text: string; over: Highlight[] }[] {
  if (!highlights.length) return [{ text, over: [] }];
  const cuts = new Set([0, text.length]);
  for (const h of highlights) {
    cuts.add(Math.max(0, Math.min(text.length, h.start)));
    cuts.add(Math.max(0, Math.min(text.length, h.end)));
  }
  const points = [...cuts].sort((a, b) => a - b);
  const out: { text: string; over: Highlight[] }[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const [a, b] = [points[i], points[i + 1]];
    if (a === b) continue;
    out.push({ text: text.slice(a, b), over: highlights.filter((h) => h.start <= a && h.end >= b) });
  }
  return out;
}

interface MarkedTextAreaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value'> {
  value: string;
  highlights: readonly Highlight[];
  /** Option texts: Enter does not add a line. */
  singleLine?: boolean;
}

export function MarkedTextArea({ value, highlights, singleLine, className, onKeyDown, ...rest }: MarkedTextAreaProps) {
  return (
    <div className={['mtext', className].filter(Boolean).join(' ')}>
      <div className="mtext-mirror" aria-hidden="true">
        {highlightPieces(value, highlights).map((p, i) =>
          p.over.length ? (
            <mark key={i} className={p.over.map((h) => h.className).join(' ')}>
              {p.text}
            </mark>
          ) : (
            <span key={i}>{p.text}</span>
          ),
        )}{' '}
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
}: {
  readOnly: boolean;
  onDevice?: (device: PlotDevice, selection: { start: number; end: number }) => void;
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
    element = <Menu entries={entries} x={menu.x} y={menu.y} label={t('text.menu')} onClose={() => setMenu(null)} />;
  }
  return { onContextMenu, menu: element };
}
