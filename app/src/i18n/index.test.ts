import { describe, expect, it } from 'vitest';
import { en, format, ru, setLocale, t } from './index';

// All application sources except tests and the dictionaries themselves.
const sources = import.meta.glob<string>(['../**/*.{ts,tsx}', '!../**/*.test.*', '!./**'], {
  query: '?raw',
  import: 'default',
  eager: true,
});

describe('i18n', () => {
  it('RU and EN define exactly the same keys', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(ru).sort());
  });

  it('every key is used somewhere in the code (no forgotten strings)', () => {
    const code = Object.values(sources).join('\n');
    expect(code).toContain('StartScreen');
    const unused = Object.keys(ru).filter((key) => !code.includes(`'${key}'`));
    expect(unused).toEqual([]);
  });

  it('keeps the same parameters in both languages', () => {
    const params = (s: string) => [...s.matchAll(/\{(\w+)[,}]/g)].map((m) => m[1]).sort();
    for (const key of Object.keys(ru) as (keyof typeof ru)[]) {
      expect(params(en[key]), key).toEqual(params(ru[key]));
    }
  });

  it('substitutes parameters and switches locale', () => {
    setLocale('en');
    expect(t('start.openedAt', { date: 'today' })).toBe('Opened today');
    setLocale('ru');
    expect(t('start.openedAt', { date: 'сегодня' })).toBe('Открыт сегодня');
  });

  it('picks Russian and English plural forms', () => {
    const ruForm = '{count, plural, one {# копия} few {# копии} many {# копий} other {# копии}}';
    expect([1, 2, 5, 11, 21, 22, 1.5].map((count) => format(ruForm, { count }, 'ru'))).toEqual([
      '1 копия',
      '2 копии',
      '5 копий',
      '11 копий',
      '21 копия',
      '22 копии',
      '1,5 копии',
    ]);
    const enForm = '{count, plural, one {# file} other {# files}}';
    expect(format(enForm, { count: 1 }, 'en')).toBe('1 file');
    expect(format(enForm, { count: 3 }, 'en')).toBe('3 files');
    expect(format('{a} and {missing}', { a: 'x' }, 'en')).toBe('x and {missing}');
  });
});
