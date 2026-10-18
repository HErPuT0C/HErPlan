import { useRef, type ReactNode } from 'react';

export interface TabItem<T extends string> {
  value: T;
  label: string;
  icon?: ReactNode;
}

interface TabsProps<T extends string> {
  items: readonly TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  /** Id prefix linking tabs to their panels (`<prefix>-panel-<value>`). */
  idPrefix: string;
}

/** Tabs inside a panel or dialog. Arrow keys move between tabs (roving focus, WAI-ARIA tabs pattern). */
export function Tabs<T extends string>({ items, value, onChange, label, idPrefix }: TabsProps<T>) {
  const list = useRef<HTMLDivElement>(null);
  const focusTab = (index: number) => {
    const tabs = list.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    if (!tabs?.length) return;
    const tab = tabs[(index + tabs.length) % tabs.length];
    tab.focus();
    tab.click();
  };
  const current = items.findIndex((i) => i.value === value);
  return (
    <div
      ref={list}
      role="tablist"
      aria-label={label}
      className="tabs"
      onKeyDown={(e) => {
        const moves: Record<string, number> = { ArrowRight: current + 1, ArrowLeft: current - 1, Home: 0, End: -1 };
        if (e.key in moves) {
          e.preventDefault();
          focusTab(moves[e.key]);
        }
      }}
    >
      {items.map((item) => (
        <button
          key={item.value}
          type="button"
          role="tab"
          id={`${idPrefix}-tab-${item.value}`}
          aria-selected={item.value === value}
          aria-controls={`${idPrefix}-panel-${item.value}`}
          tabIndex={item.value === value ? 0 : -1}
          className="tab"
          onClick={() => onChange(item.value)}
        >
          {item.icon}
          {item.label}
        </button>
      ))}
    </div>
  );
}

export function TabPanel({ idPrefix, value, children }: { idPrefix: string; value: string; children: ReactNode }) {
  return (
    <div
      role="tabpanel"
      id={`${idPrefix}-panel-${value}`}
      aria-labelledby={`${idPrefix}-tab-${value}`}
      className="tab-panel"
    >
      {children}
    </div>
  );
}
