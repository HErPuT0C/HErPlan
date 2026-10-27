import { describe, expect, it } from 'vitest';
import { clickPick, framePick, keepShown, keyPick, NONE, pickAll } from './selection';

const order = ['a', 'b', 'c', 'd', 'e', 'f'];
const plain = { ctrl: false, shift: false };

describe('several assets picked at once (0.7.5)', () => {
  it('clicks: one, Ctrl adds or takes away, Shift picks a run from the anchor', () => {
    let s = clickPick(order, NONE, 'b', plain);
    expect(s.paths).toEqual(['b']);
    s = clickPick(order, s, 'e', { ctrl: true, shift: false });
    expect(s.paths).toEqual(['b', 'e']);
    s = clickPick(order, s, 'b', { ctrl: true, shift: false });
    expect(s.paths).toEqual(['e']);
    s = clickPick(order, clickPick(order, NONE, 'b', plain), 'd', { ctrl: false, shift: true });
    expect(s.paths).toEqual(['b', 'c', 'd']);
    // Shift again from the same anchor, the other way.
    expect(clickPick(order, s, 'a', { ctrl: false, shift: true }).paths).toEqual(['a', 'b']);
    // Ctrl+Shift adds the run to what was picked.
    const both = clickPick(order, clickPick(order, NONE, 'f', plain), 'f', { ctrl: false, shift: false });
    const withRun = clickPick(order, { ...both, anchor: 'a' }, 'b', { ctrl: true, shift: true });
    expect(withRun.paths).toEqual(['a', 'b', 'f']);
  });

  it('keys: arrows move, Shift or Ctrl with them stretch the run; the edges hold', () => {
    let s = keyPick(order, NONE, 1, false);
    expect(s.paths).toEqual(['a']);
    s = keyPick(order, s, 1, true);
    s = keyPick(order, s, 1, true);
    expect(s.paths).toEqual(['a', 'b', 'c']);
    // Down a row of three.
    s = keyPick(order, s, 3, true);
    expect(s.paths).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    s = keyPick(order, s, 3, false);
    expect(s.paths).toEqual(['f']);
    expect(keyPick(order, s, -10, true).paths).toEqual(order);
    expect(keyPick([], s, 1, false)).toEqual(NONE);
  });

  it('a frame, everything, and what was picked when the list changes', () => {
    expect(pickAll(order).paths).toEqual(order);
    const before = clickPick(order, NONE, 'a', plain);
    expect(framePick(order, before, ['d', 'c'], false).paths).toEqual(['c', 'd']);
    expect(framePick(order, before, ['d', 'c'], true).paths).toEqual(['a', 'c', 'd']);
    const s = { paths: ['a', 'x'], anchor: 'x', focus: 'a' };
    expect(keepShown(order, s)).toEqual({ paths: ['a'], anchor: null, focus: 'a' });
  });
});
