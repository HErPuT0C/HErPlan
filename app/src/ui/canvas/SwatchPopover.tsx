import { Check, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { NODE_COLORS } from '../../canvas/model';
import { t, type MessageKey } from '../../i18n';
import { NODE_ICONS } from './icons';

export interface SwatchRequest {
  x: number;
  y: number;
  mode: 'color' | 'icon';
  current: string | null;
  onPick: (value: string | null) => void;
}

const COLOR_NAMES: Record<keyof typeof NODE_COLORS, MessageKey> = {
  slate: 'canvas.color.slate',
  red: 'canvas.color.red',
  orange: 'canvas.color.orange',
  amber: 'canvas.color.amber',
  green: 'canvas.color.green',
  teal: 'canvas.color.teal',
  blue: 'canvas.color.blue',
  violet: 'canvas.color.violet',
  pink: 'canvas.color.pink',
};

/** Colour or icon picker for nodes, edges and groups (FR-CNV-10). */
export function SwatchPopover({ request, onClose }: { request: SwatchRequest | null; onClose: () => void }) {
  return request ? <Swatches request={request} onClose={onClose} /> : null;
}

function Swatches({ request, onClose }: { request: SwatchRequest; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: request.x, top: request.y });

  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    setPos({
      left: Math.max(4, Math.min(request.x, window.innerWidth - r.width - 4)),
      top: Math.max(4, Math.min(request.y, window.innerHeight - r.height - 4)),
    });
    ref.current?.querySelector<HTMLElement>('button')?.focus();
  }, [request]);

  useEffect(() => {
    const close = (e: Event) => {
      if (e.type === 'pointerdown' && ref.current?.contains(e.target as Node)) return;
      if (e.type === 'keydown' && (e as KeyboardEvent).key !== 'Escape') return;
      onClose();
    };
    window.addEventListener('pointerdown', close, true);
    window.addEventListener('keydown', close);
    return () => {
      window.removeEventListener('pointerdown', close, true);
      window.removeEventListener('keydown', close);
    };
  }, [onClose]);

  const pick = (value: string | null) => {
    request.onPick(value);
    onClose();
  };

  return createPortal(
    <div
      ref={ref}
      className="swatches"
      style={pos}
      role="dialog"
      aria-label={request.mode === 'color' ? t('canvas.color') : t('canvas.icon')}
    >
      <button type="button" className="swatch swatch-none" onClick={() => pick(null)} title={t('canvas.noStyle')}>
        <X size={14} aria-hidden="true" />
      </button>
      {request.mode === 'color'
        ? Object.entries(NODE_COLORS).map(([id, hex]) => (
            <button
              key={id}
              type="button"
              className="swatch"
              style={{ background: hex }}
              title={t(COLOR_NAMES[id as keyof typeof NODE_COLORS])}
              aria-label={t(COLOR_NAMES[id as keyof typeof NODE_COLORS])}
              aria-pressed={request.current === id}
              onClick={() => pick(id)}
            >
              {request.current === id && <Check size={14} aria-hidden="true" />}
            </button>
          ))
        : Object.entries(NODE_ICONS).map(([id, Icon]) => (
            <button
              key={id}
              type="button"
              className="swatch swatch-icon"
              aria-label={id}
              aria-pressed={request.current === id}
              onClick={() => pick(id)}
            >
              <Icon size={16} aria-hidden="true" />
            </button>
          ))}
    </div>,
    document.body,
  );
}
