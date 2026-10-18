import { describe, expect, it } from 'vitest';
import { buildReport, record, recentLog } from './log';

describe('bug report log', () => {
  it('keeps the last 500 lines and describes errors with their stack', () => {
    for (let i = 0; i < 520; i++) record('warn', [`line ${i}`]);
    record('error', [new Error('boom'), { code: 'io' }]);
    const log = recentLog();
    expect(log).toHaveLength(500);
    expect(log[0].text).toBe('line 21');
    expect(log.at(-1)?.text).toMatch(/^Error: boom[\s\S]*\{"code":"io"\}$/);
  });

  it('builds a readable report', () => {
    const text = buildReport({
      version: '0.1.0',
      system: { os: 'Windows 10', webview: 'WebView2 130' },
      settings: { locale: 'ru' },
      log: [{ at: '2026-10-18T10:00:00.000Z', level: 'error', text: 'disk full' }],
      description: 'Не сохраняется проект',
    });
    expect(text).toContain('## What happened\nНе сохраняется проект');
    expect(text).toContain('os: Windows 10');
    expect(text).toContain('2026-10-18T10:00:00.000Z ERROR disk full');
  });
});
