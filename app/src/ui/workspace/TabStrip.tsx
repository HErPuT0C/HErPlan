import { House, Plus, X } from 'lucide-react';
import type { KeyboardEvent } from 'react';
import { t } from '../../i18n';
import {
  HOME,
  MODULE_KINDS,
  tabNumber,
  type ModuleKind,
  type WorkspaceState,
  type WorkspaceTab,
} from '../../state/workspace';
import { Menu, useContextMenu } from '../components';
import { MODULES } from './modules';
import { useState } from 'react';

interface TabStripProps {
  state: WorkspaceState;
  onActivate: (id: string) => void;
  onOpen: (kind: ModuleKind) => void;
  onClose: (id: string) => void;
  onCloseOthers: (id: string) => void;
}

export function tabTitle(state: WorkspaceState, tab: WorkspaceTab): string {
  const n = tabNumber(state, tab);
  const base = t(MODULES[tab.kind].title);
  return n > 1 ? `${base} ${n}` : base;
}

/** Document tabs of the project (FR-PRJ-04): pinned home, editor tabs, "+" to open another editor. */
export function TabStrip({ state, onActivate, onOpen, onClose, onCloseOthers }: TabStripProps) {
  const [plusAt, setPlusAt] = useState<{ x: number; y: number } | null>(null);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const tabs = [...e.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]')];
    const index = tabs.indexOf(document.activeElement as HTMLElement);
    if (index < 0) return;
    e.preventDefault();
    tabs[(index + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length].focus();
  };

  return (
    <nav className="tabstrip" aria-label={t('tabs.label')} data-tour="tabs">
      <div role="tablist" aria-label={t('tabs.label')} className="tabstrip-tabs" onKeyDown={onKeyDown}>
        <button
          type="button"
          role="tab"
          aria-selected={state.active === HOME}
          tabIndex={state.active === HOME ? 0 : -1}
          className="doc-tab doc-tab-home"
          onClick={() => onActivate(HOME)}
        >
          <House size={16} aria-hidden="true" />
          <span>{t('tabs.home')}</span>
        </button>
        {state.tabs.map((tab) => (
          <DocTab
            key={tab.id}
            title={tabTitle(state, tab)}
            tab={tab}
            active={state.active === tab.id}
            onActivate={() => onActivate(tab.id)}
            onClose={() => onClose(tab.id)}
            onCloseOthers={() => onCloseOthers(tab.id)}
            onDuplicate={() => onOpen(tab.kind)}
          />
        ))}
      </div>
      <button
        type="button"
        className="tab-plus"
        aria-label={t('tabs.open')}
        title={t('tabs.open')}
        aria-haspopup="menu"
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          setPlusAt(plusAt ? null : { x: rect.left, y: rect.bottom + 4 });
        }}
      >
        <Plus size={16} />
      </button>
      {plusAt && (
        <Menu
          label={t('tabs.open')}
          x={plusAt.x}
          y={plusAt.y}
          onClose={() => setPlusAt(null)}
          entries={MODULE_KINDS.map((kind) => {
            const Icon = MODULES[kind].icon;
            return { id: kind, label: t(MODULES[kind].title), icon: <Icon size={16} />, onSelect: () => onOpen(kind) };
          })}
        />
      )}
    </nav>
  );
}

interface DocTabProps {
  title: string;
  tab: WorkspaceTab;
  active: boolean;
  onActivate: () => void;
  onClose: () => void;
  onCloseOthers: () => void;
  onDuplicate: () => void;
}

function DocTab({ title, tab, active, onActivate, onClose, onCloseOthers, onDuplicate }: DocTabProps) {
  const Icon = MODULES[tab.kind].icon;
  const { onContextMenu, menu } = useContextMenu(title, () => [
    { id: 'close', label: t('tabs.close'), shortcut: 'Ctrl+W', onSelect: onClose },
    { id: 'others', label: t('tabs.closeOthers'), onSelect: onCloseOthers },
    { id: 'sep', separator: true },
    { id: 'dup', label: t('tabs.duplicate'), onSelect: onDuplicate },
  ]);
  return (
    <div
      className={['doc-tab-wrap', active && 'doc-tab-active'].filter(Boolean).join(' ')}
      onContextMenu={onContextMenu}
    >
      <button
        type="button"
        role="tab"
        aria-selected={active}
        tabIndex={active ? 0 : -1}
        className="doc-tab"
        title={title}
        onClick={onActivate}
        onAuxClick={(e) => {
          if (e.button === 1) onClose();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Delete') onClose();
        }}
      >
        <Icon size={16} aria-hidden="true" />
        <span className="doc-tab-title">{title}</span>
      </button>
      <button
        type="button"
        className="doc-tab-close"
        aria-label={t('tabs.closeNamed', { name: title })}
        onClick={onClose}
        tabIndex={-1}
      >
        <X size={14} />
      </button>
      {menu}
    </div>
  );
}
