import { describe, expect, it } from 'vitest';
import { en, ru, setLocale, t } from './index';

describe('i18n', () => {
  it('RU and EN define exactly the same keys', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(ru).sort());
  });

  it('substitutes parameters and switches locale', () => {
    setLocale('en');
    expect(t('app.status', { version: '1.2.3' })).toBe('Application skeleton · version 1.2.3');
    setLocale('ru');
    expect(t('app.status', { version: '1.2.3' })).toBe('Каркас приложения · версия 1.2.3');
  });
});
