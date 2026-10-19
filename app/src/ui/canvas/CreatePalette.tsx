import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import type { NodeKindDef } from '../../canvas/kinds';
import { searchKey } from '../../canvas/ops';
import { t, type MessageKey } from '../../i18n';
import { KindIcon } from './kindIcons';

const GROUPS: Record<NonNullable<NodeKindDef['menu']>['group'], MessageKey> = {
  basic: 'canvas.group.basic',
  flow: 'canvas.group.flow',
  logic: 'canvas.group.logic',
  plot: 'canvas.group.plot',
  world: 'canvas.group.world',
};

/**
 * "What to create?": node kinds in groups, with a filter field. Typing narrows the list, Enter takes the
 * first match, arrows move between kinds, Escape closes. Items are menu items for assistive technology.
 */
export function CreatePalette({
  x,
  y,
  kinds,
  onPick,
  onClose,
}: {
  x: number;
  y: number;
  kinds: NodeKindDef[];
  onPick: (kind: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [pos, setPos] = useState({ left: x, top: y, visible: false });
  const shown = useMemo(() => {
    const q = searchKey(query.trim());
    return q ? kinds.filter((k) => searchKey(t(k.label)).includes(q)) : kinds;
  }, [kinds, query]);
  const grouped = useMemo(() => {
    const out: { group: MessageKey; items: NodeKindDef[] }[] = [];
    for (const k of shown) {
      const group = GROUPS[k.menu?.group ?? 'basic'];
      const last = out[out.length - 1];
      if (last?.group === group) last.items.push(k);
      else out.push({ group, items: [k] });
    }
    return out;
  }, [shown]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setPos({
      left: Math.max(4, Math.min(x, window.innerWidth - width - 4)),
      top: Math.max(4, Math.min(y, window.innerHeight - height - 4)),
      visible: true,
    });
  }, [x, y]);

  useEffect(() => {
    const close = (e: Event) => {
      if (e.type === 'pointerdown' && ref.current?.contains(e.target as Node)) return;
      onClose();
    };
    window.addEventListener('pointerdown', close, true);
    window.addEventListener('blur', close);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('pointerdown', close, true);
      window.removeEventListener('blur', close);
      window.removeEventListener('resize', close);
    };
  }, [onClose]);

  const items = () => [...(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];

  const pick = (kind: string) => {
    onPick(kind);
    onClose();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }
    const list = items();
    const index = list.indexOf(document.activeElement as HTMLElement);
    const inField = (e.target as HTMLElement).tagName === 'INPUT';
    if (inField && e.key === 'Enter') {
      e.preventDefault();
      if (shown[0]) pick(shown[0].id);
      return;
    }
    const step: Record<string, number> = { ArrowDown: 2, ArrowUp: -2, ArrowRight: 1, ArrowLeft: -1 };
    if (!(e.key in step)) return;
    if (inField && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) return;
    e.preventDefault();
    if (inField) list[0]?.focus();
    else if (index + step[e.key] < 0) ref.current?.querySelector('input')?.focus();
    else list[Math.min(list.length - 1, index + step[e.key])]?.focus();
  };

  return createPortal(
    <div
      ref={ref}
      className="create-palette"
      role="menu"
      aria-label={t('canvas.createTitle')}
      style={{ left: pos.left, top: pos.top, visibility: pos.visible ? 'visible' : 'hidden' }}
      onKeyDown={onKeyDown}
    >
      <input
        className="input create-palette-search"
        value={query}
        placeholder={t('canvas.createSearch')}
        aria-label={t('canvas.createSearch')}
        autoFocus
        onChange={(e) => setQuery(e.target.value)}
      />
      {grouped.map(({ group, items: list }) => (
        <div key={group} className="create-palette-group" role="group" aria-label={t(group)}>
          <div className="create-palette-heading" aria-hidden="true">
            {t(group)}
          </div>
          <div className="create-palette-grid">
            {list.map((k) => (
              <button
                key={k.id}
                type="button"
                role="menuitem"
                className="create-palette-item"
                style={{ '--kind-color': k.color } as CSSProperties}
                onClick={() => pick(k.id)}
              >
                <span className="create-palette-icon">
                  <KindIcon kind={k.id} size={15} />
                </span>
                <span>{t(k.label)}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
      {shown.length === 0 && <div className="create-palette-empty muted small">{t('canvas.createNothing')}</div>}
    </div>,
    document.body,
  );
}
