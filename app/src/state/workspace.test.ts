import { describe, expect, it } from 'vitest';
import {
  closeOtherTabs,
  closeTab,
  cycleTab,
  EMPTY_WORKSPACE,
  HOME,
  openTab,
  parseWorkspace,
  serializeWorkspace,
  tabNumber,
} from './workspace';

describe('workspace tabs', () => {
  it('opens several tabs of the same editor and numbers them', () => {
    let s = openTab(EMPTY_WORKSPACE, 'story');
    s = openTab(s, 'database');
    s = openTab(s, 'story');
    expect(s.tabs.map((t) => t.kind)).toEqual(['story', 'database', 'story']);
    expect(s.active).toBe(s.tabs[2].id);
    expect(s.tabs.map((t) => tabNumber(s, t))).toEqual([1, 1, 2]);
  });

  it('closing the active tab moves to the right neighbour, then left, then home', () => {
    let s = openTab(openTab(openTab(EMPTY_WORKSPACE, 'map'), 'story'), 'tasks');
    const [a, b, c] = s.tabs;
    s = { ...s, active: b.id };
    s = closeTab(s, b.id);
    expect(s.active).toBe(c.id);
    s = closeTab(s, c.id);
    expect(s.active).toBe(a.id);
    s = closeTab(s, a.id);
    expect(s).toEqual({ tabs: [], active: HOME });
  });

  it('cycles through home and tabs and closes the others', () => {
    let s = openTab(openTab(EMPTY_WORKSPACE, 'map'), 'story');
    s = cycleTab(s, 1);
    expect(s.active).toBe(HOME);
    s = cycleTab(s, -1);
    expect(s.active).toBe(s.tabs[1].id);
    expect(closeOtherTabs(s, s.tabs[0].id).tabs).toHaveLength(1);
  });

  it('restores from the cache file and ignores garbage', () => {
    const s = openTab(openTab(EMPTY_WORKSPACE, 'map'), 'documents');
    expect(parseWorkspace(serializeWorkspace(s))).toEqual(s);
    expect(parseWorkspace('not json')).toEqual(EMPTY_WORKSPACE);
    expect(parseWorkspace(JSON.stringify({ tabs: [{ id: 'x', kind: 'chess' }], active: 'x' }))).toEqual(
      EMPTY_WORKSPACE,
    );
  });
});
