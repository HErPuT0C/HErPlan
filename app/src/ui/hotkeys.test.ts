import { describe, expect, it } from 'vitest';
import { isTypingTarget, keyString, matchHotkey } from './hotkeys';

const key = (init: KeyboardEventInit, target?: EventTarget) => {
  const e = new KeyboardEvent('keydown', init);
  if (target) Object.defineProperty(e, 'target', { value: target });
  return e;
};

describe('hotkeys', () => {
  it('names keys by physical position, so the Russian layout works', () => {
    expect(keyString(key({ code: 'KeyZ', key: 'я', ctrlKey: true }))).toBe('Ctrl+Z');
    expect(keyString(key({ code: 'KeyZ', key: 'Я', ctrlKey: true, shiftKey: true }))).toBe('Ctrl+Shift+Z');
    expect(keyString(key({ code: 'Comma', key: 'б', ctrlKey: true }))).toBe('Ctrl+,');
    expect(keyString(key({ code: 'Tab', key: 'Tab', ctrlKey: true }))).toBe('Ctrl+Tab');
  });

  it('leaves undo to text fields while typing, but saves everywhere', () => {
    const input = document.createElement('input');
    expect(isTypingTarget(input)).toBe(true);
    expect(matchHotkey(key({ code: 'KeyZ', key: 'z', ctrlKey: true }, input))).toBeNull();
    expect(matchHotkey(key({ code: 'KeyZ', key: 'z', ctrlKey: true }, document.body))?.id).toBe('undo');
    expect(matchHotkey(key({ code: 'KeyS', key: 's', ctrlKey: true }, input))?.id).toBe('save');
    expect(matchHotkey(key({ code: 'KeyQ', key: 'q', ctrlKey: true }, document.body))).toBeNull();
  });
});
