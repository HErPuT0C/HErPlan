// Open tabs of a project (FR-PRJ-04). Kept in .herplan/workspace.json: a cache, safe to delete,
// so a broken file simply means "start with the home tab".

import { newId } from '../core/ids';

export type ModuleKind = 'map' | 'story' | 'database' | 'documents' | 'tasks' | 'assets';
export const MODULE_KINDS: readonly ModuleKind[] = ['map', 'story', 'database', 'documents', 'tasks', 'assets'];

export const HOME = 'home';
export const WORKSPACE_FILE = '.herplan/workspace.json';

export interface WorkspaceTab {
  id: string;
  kind: ModuleKind;
}

export interface WorkspaceState {
  tabs: WorkspaceTab[];
  /** HOME or the id of an open tab. */
  active: string;
}

export const EMPTY_WORKSPACE: WorkspaceState = { tabs: [], active: HOME };

export function parseWorkspace(text: string | null): WorkspaceState {
  try {
    const raw = JSON.parse(text ?? '') as Partial<WorkspaceState>;
    const tabs = Array.isArray(raw.tabs)
      ? raw.tabs.filter(
          (tab): tab is WorkspaceTab => typeof tab?.id === 'string' && MODULE_KINDS.includes(tab.kind as ModuleKind),
        )
      : [];
    const active = tabs.some((tab) => tab.id === raw.active) ? (raw.active as string) : HOME;
    return { tabs: tabs.map(({ id, kind }) => ({ id, kind })), active };
  } catch {
    return EMPTY_WORKSPACE;
  }
}

export function serializeWorkspace(state: WorkspaceState): string {
  return `${JSON.stringify(state, null, 2)}\n`;
}

export function openTab(state: WorkspaceState, kind: ModuleKind): WorkspaceState {
  const tab = { id: newId(), kind };
  return { tabs: [...state.tabs, tab], active: tab.id };
}

/** Closing the active tab activates its right neighbour, else the left one, else home. */
export function closeTab(state: WorkspaceState, id: string): WorkspaceState {
  const index = state.tabs.findIndex((tab) => tab.id === id);
  if (index < 0) return state;
  const tabs = state.tabs.filter((tab) => tab.id !== id);
  if (state.active !== id) return { ...state, tabs };
  const neighbour = tabs[index] ?? tabs[index - 1];
  return { tabs, active: neighbour?.id ?? HOME };
}

export function closeOtherTabs(state: WorkspaceState, id: string): WorkspaceState {
  return { tabs: state.tabs.filter((tab) => tab.id === id), active: id };
}

/** Next or previous tab, home included, wrapping around. */
export function cycleTab(state: WorkspaceState, step: 1 | -1): WorkspaceState {
  const order = [HOME, ...state.tabs.map((tab) => tab.id)];
  const index = order.indexOf(state.active);
  return { ...state, active: order[(index + step + order.length) % order.length] };
}

/** "Story", "Story 2", …: the number tells several tabs of one editor apart. */
export function tabNumber(state: WorkspaceState, tab: WorkspaceTab): number {
  return state.tabs.filter((t) => t.kind === tab.kind).indexOf(tab) + 1;
}
