// Interface strings. Every visible text goes through t(); tests check that RU and EN have the same keys
// and that no key is unused. Strings support {name} parameters and plural forms:
//   "{count, plural, one {# копия} few {# копии} many {# копий} other {# копии}}"
// Plural categories come from Intl.PluralRules for the current locale; "other" is the fallback.

import { useSyncExternalStore } from 'react';
import { en } from './en';
import { ru, type MessageKey } from './ru';

export { en, ru, type MessageKey };

const dictionaries = { ru, en } as const;
export type Locale = keyof typeof dictionaries;
export const LOCALES: readonly Locale[] = ['ru', 'en'];

let current: Locale = 'ru';
const listeners = new Set<() => void>();

export function getLocale(): Locale {
  return current;
}

export function setLocale(locale: Locale): void {
  if (locale === current) return;
  current = locale;
  if (typeof document !== 'undefined') document.documentElement.lang = locale;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Re-renders the component when the interface language changes. */
export function useLocale(): Locale {
  return useSyncExternalStore(subscribe, getLocale);
}

/** First run: Russian if any preferred system language is Russian, otherwise English. */
export function detectLocale(languages: readonly string[]): Locale {
  return languages.some((l) => l.toLowerCase().startsWith('ru')) ? 'ru' : 'en';
}

export function isLocale(value: unknown): value is Locale {
  return value === 'ru' || value === 'en';
}

type Params = Record<string, string | number>;

export function t(key: MessageKey, params: Params = {}): string {
  return format(dictionaries[current][key] ?? key, params, current);
}

/** Locale-aware number and date formatting for the interface. */
export function formatDate(iso: string | number, withTime = true): string {
  const date = new Date(iso);
  return new Intl.DateTimeFormat(current, {
    dateStyle: 'medium',
    ...(withTime ? { timeStyle: 'short' } : {}),
  }).format(date);
}

export function formatBytes(bytes: number): string {
  const units = current === 'ru' ? ['Б', 'КБ', 'МБ', 'ГБ'] : ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  const digits = unit === 0 || value >= 10 ? 0 : 1;
  return `${new Intl.NumberFormat(current, { maximumFractionDigits: digits }).format(value)} ${units[unit]}`;
}

export function format(template: string, params: Params, locale: Locale): string {
  let out = '';
  let i = 0;
  while (i < template.length) {
    const open = template.indexOf('{', i);
    if (open < 0) {
      out += template.slice(i);
      break;
    }
    out += template.slice(i, open);
    const close = matchingBrace(template, open);
    if (close < 0) {
      out += template.slice(open);
      break;
    }
    out += expand(template.slice(open + 1, close), params, locale);
    i = close + 1;
  }
  return out;
}

function expand(body: string, params: Params, locale: Locale): string {
  const plural = /^\s*(\w+)\s*,\s*plural\s*,/.exec(body);
  if (!plural) {
    const name = body.trim();
    return name in params ? String(params[name]) : `{${body}}`;
  }
  const value = Number(params[plural[1]] ?? 0);
  const forms = parseForms(body.slice(plural[0].length));
  const category = new Intl.PluralRules(locale).select(value);
  const form = forms.get(`=${value}`) ?? forms.get(category) ?? forms.get('other') ?? '';
  return format(form, params, locale).replace(/#/g, new Intl.NumberFormat(locale).format(value));
}

function parseForms(text: string): Map<string, string> {
  const forms = new Map<string, string>();
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf('{', i);
    if (open < 0) break;
    const close = matchingBrace(text, open);
    if (close < 0) break;
    forms.set(text.slice(i, open).trim(), text.slice(open + 1, close));
    i = close + 1;
  }
  return forms;
}

function matchingBrace(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}' && --depth === 0) return i;
  }
  return -1;
}
