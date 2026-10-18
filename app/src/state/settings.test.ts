import { describe, expect, it } from 'vitest';
import {
  parseSettings,
  RECENT_LIMIT,
  serializeSettings,
  withoutRecent,
  withRecent,
  type RecentProject,
} from './settings';

const recent = (path: string, name = 'P'): RecentProject => ({
  path,
  name,
  id: '',
  cover: null,
  openedAt: '2026-10-18T10:00:00Z',
});

describe('application settings', () => {
  it('starts from defaults with the system language', () => {
    expect(parseSettings(null, ['ru-RU', 'en-US'])).toMatchObject({ locale: 'ru', accent: 'mint', uiScale: 100 });
    expect(parseSettings(null, ['de-DE', 'en-US']).locale).toBe('en');
  });

  it('survives damaged or partly wrong files and keeps unknown fields', () => {
    expect(parseSettings('{"locale": "ru", "acc', ['en'])).toMatchObject({ locale: 'en', accent: 'mint' });
    const parsed = parseSettings(
      JSON.stringify({ locale: 'fr', accent: 'indigo', uiScale: 133, autosaveSeconds: 0, future: true }),
      ['ru'],
    );
    expect(parsed).toMatchObject({ locale: 'ru', accent: 'indigo', uiScale: 100, autosaveSeconds: 5, future: true });
  });

  it('round-trips through the file', () => {
    const s = withRecent(parseSettings(null, ['ru']), recent('C:\\Проекты\\Мельница', 'Мельница'));
    expect(parseSettings(serializeSettings(s), ['en'])).toEqual(s);
  });

  it('keeps recent projects unique (case-insensitive paths), newest first, limited', () => {
    let s = parseSettings(null, ['ru']);
    s = withRecent(s, recent('C:\\A'));
    s = withRecent(s, recent('C:\\B'));
    s = withRecent(s, recent('c:/a/', 'again'));
    expect(s.recentProjects.map((r) => r.name)).toEqual(['again', 'P']);
    for (let i = 0; i < 30; i++) s = withRecent(s, recent(`C:\\P${i}`));
    expect(s.recentProjects).toHaveLength(RECENT_LIMIT);
    expect(withoutRecent(s, 'C:\\P29').recentProjects[0].path).toBe('C:\\P28');
  });
});
