// Keyboard shortcuts (FR-APP-03, FR-APP-04). One registry feeds both the handlers and the list in settings.
// Letters are matched by physical key (event.code), so Ctrl+Z also works with the Russian layout (Ctrl+Я).

import { useEffect, useRef } from 'react';
import type { MessageKey } from '../i18n';

export type HotkeyId = 'undo' | 'redo' | 'save' | 'search' | 'closeTab' | 'nextTab' | 'prevTab' | 'settings';

export interface HotkeyDef {
  id: HotkeyId;
  keys: string[];
  label: MessageKey;
  /** Works while typing in a text field. Undo/redo do not: text fields have their own. */
  whileTyping: boolean;
}

export const HOTKEYS: readonly HotkeyDef[] = [
  { id: 'undo', keys: ['Ctrl+Z'], label: 'hotkey.undo', whileTyping: false },
  { id: 'redo', keys: ['Ctrl+Y', 'Ctrl+Shift+Z'], label: 'hotkey.redo', whileTyping: false },
  { id: 'save', keys: ['Ctrl+S'], label: 'hotkey.save', whileTyping: true },
  { id: 'search', keys: ['Ctrl+K'], label: 'hotkey.search', whileTyping: true },
  { id: 'closeTab', keys: ['Ctrl+W'], label: 'hotkey.closeTab', whileTyping: true },
  { id: 'nextTab', keys: ['Ctrl+Tab'], label: 'hotkey.nextTab', whileTyping: true },
  { id: 'prevTab', keys: ['Ctrl+Shift+Tab'], label: 'hotkey.prevTab', whileTyping: true },
  { id: 'settings', keys: ['Ctrl+,'], label: 'hotkey.settings', whileTyping: true },
];

const CODE_NAMES: Record<string, string> = { Comma: ',', Period: '.', Slash: '/', Minus: '-', Equal: '=' };

/** "Ctrl+Shift+Z" for a key event, independent of keyboard layout. */
export function keyString(
  e: Pick<KeyboardEvent, 'code' | 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>,
): string {
  let key = e.key;
  if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3);
  else if (/^Digit\d$/.test(e.code)) key = e.code.slice(5);
  else if (e.code in CODE_NAMES) key = CODE_NAMES[e.code];
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  parts.push(key.length === 1 ? key.toUpperCase() : key);
  return parts.join('+');
}

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  return (
    target instanceof HTMLInputElement && !['checkbox', 'radio', 'button', 'submit', 'range'].includes(target.type)
  );
}

export function matchHotkey(e: KeyboardEvent): HotkeyDef | null {
  const pressed = keyString(e);
  const def = HOTKEYS.find((h) => h.keys.includes(pressed));
  if (!def) return null;
  if (!def.whileTyping && isTypingTarget(e.target)) return null;
  return def;
}

/** Runs handlers for registered shortcuts while the component is mounted. */
export function useHotkeys(handlers: Partial<Record<HotkeyId, () => void>>): void {
  const latest = useRef(handlers);
  useEffect(() => {
    latest.current = handlers;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const def = matchHotkey(e);
      const handler = def && latest.current[def.id];
      if (!handler) return;
      e.preventDefault();
      handler();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
