import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';
import { Button, type ButtonVariant } from './Button';

export type MenuEntry =
  | {
      id: string;
      label: string;
      icon?: ReactNode;
      shortcut?: string;
      danger?: boolean;
      disabled?: boolean;
      onSelect: () => void;
    }
  | { id: string; separator: true };

type ActionEntry = Exclude<MenuEntry, { separator: true }>;

const isAction = (e: MenuEntry): e is ActionEntry => !('separator' in e);

interface MenuProps {
  entries: MenuEntry[];
  x: number;
  y: number;
  label: string;
  onClose: () => void;
  /** Element that opened the menu; clicks on it toggle the menu instead of closing and reopening it. */
  anchor?: HTMLElement | null;
}

/** Popup menu at a screen point: arrow keys, Home/End, Enter, Escape; closes on any outside click. */
export function Menu({ entries, x, y, label, onClose, anchor }: MenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y, visible: false });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setPos({
      left: Math.max(4, Math.min(x, window.innerWidth - width - 4)),
      top: Math.max(4, y + height > window.innerHeight - 4 ? y - height : y),
      visible: true,
    });
    // After the current event: a right mouse button press moves focus to the clicked element afterwards.
    const frame = requestAnimationFrame(() =>
      el.querySelector<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])')?.focus(),
    );
    return () => cancelAnimationFrame(frame);
  }, [x, y]);

  useEffect(() => {
    const close = (e: Event) => {
      if (e.type === 'pointerdown') {
        const target = e.target as Node;
        if (ref.current?.contains(target) || anchor?.contains(target)) return;
      }
      onClose();
    };
    window.addEventListener('pointerdown', close, true);
    window.addEventListener('blur', close);
    window.addEventListener('resize', close);
    window.addEventListener('wheel', close, { passive: true });
    return () => {
      window.removeEventListener('pointerdown', close, true);
      window.removeEventListener('blur', close);
      window.removeEventListener('resize', close);
      window.removeEventListener('wheel', close);
    };
  }, [onClose, anchor]);

  const move = (delta: number | 'first' | 'last') => {
    const items = [
      ...(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])') ?? []),
    ];
    if (items.length === 0) return;
    const index = items.indexOf(document.activeElement as HTMLElement);
    const next =
      delta === 'first' ? 0 : delta === 'last' ? items.length - 1 : (index + delta + items.length) % items.length;
    items[next].focus();
  };

  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      className="menu"
      style={{ left: pos.left, top: pos.top, visibility: pos.visible ? 'visible' : 'hidden' }}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        const keys: Record<string, () => void> = {
          ArrowDown: () => move(1),
          ArrowUp: () => move(-1),
          Home: () => move('first'),
          End: () => move('last'),
          Escape: onClose,
          Tab: onClose,
        };
        const action = keys[e.key];
        if (action) {
          e.preventDefault();
          action();
        }
      }}
    >
      {entries.map((entry) =>
        isAction(entry) ? (
          <div
            key={entry.id}
            role="menuitem"
            tabIndex={-1}
            aria-disabled={entry.disabled || undefined}
            className={['menu-item', entry.danger && 'menu-item-danger'].filter(Boolean).join(' ')}
            onClick={() => {
              if (entry.disabled) return;
              onClose();
              entry.onSelect();
            }}
            onKeyDown={(e) => {
              if ((e.key === 'Enter' || e.key === ' ') && !entry.disabled) {
                e.preventDefault();
                onClose();
                entry.onSelect();
              }
            }}
          >
            <span className="menu-icon">{entry.icon}</span>
            <span className="menu-label">{entry.label}</span>
            {entry.shortcut && <kbd className="menu-shortcut">{entry.shortcut}</kbd>}
          </div>
        ) : (
          <div key={entry.id} role="separator" className="menu-separator" />
        ),
      )}
    </div>,
    document.body,
  );
}

/** Context menu for any element: spread `onContextMenu` on it and render `menu`. */
export function useContextMenu(label: string, getEntries: () => MenuEntry[]) {
  const [state, setState] = useState<{ x: number; y: number; entries: MenuEntry[] } | null>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);

  const onContextMenu = (e: ReactMouseEvent<HTMLElement>) => {
    e.preventDefault();
    e.stopPropagation();
    restoreFocus.current = e.currentTarget;
    // The keyboard menu key reports no coordinates; open the menu at the element instead.
    let { clientX: x, clientY: y } = e;
    if (x === 0 && y === 0) {
      const rect = e.currentTarget.getBoundingClientRect();
      x = rect.left + 8;
      y = rect.bottom;
    }
    setState({ x, y, entries: getEntries() });
  };

  const close = () => {
    setState(null);
    restoreFocus.current?.focus();
  };

  const menu = state && <Menu entries={state.entries} x={state.x} y={state.y} label={label} onClose={close} />;
  return { onContextMenu, menu };
}

interface MenuButtonProps {
  label: string;
  icon?: ReactNode;
  variant?: ButtonVariant;
  size?: 'md' | 'sm';
  entries: MenuEntry[];
}

/** A button that opens a menu below itself. */
export function MenuButton({ label, icon, variant = 'secondary', size = 'md', entries }: MenuButtonProps) {
  const [open, setOpen] = useState<{ x: number; y: number; anchor: HTMLElement } | null>(null);
  return (
    <span className="menu-button">
      <Button
        variant={variant}
        size={size}
        icon={icon}
        aria-haspopup="menu"
        aria-expanded={open !== null}
        trailing={<ChevronDown size={14} aria-hidden="true" className="menu-button-chevron" />}
        onClick={(e) => {
          const anchor = e.currentTarget;
          const rect = anchor.getBoundingClientRect();
          setOpen(open ? null : { x: rect.left, y: rect.bottom + 4, anchor });
        }}
      >
        {label}
      </Button>
      {open && (
        <Menu
          entries={entries}
          x={open.x}
          y={open.y}
          label={label}
          anchor={open.anchor}
          onClose={() => {
            setOpen(null);
            open.anchor.focus();
          }}
        />
      )}
    </span>
  );
}
