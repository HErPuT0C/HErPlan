import { expect, test } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'node:fs';

interface BenchWindow {
  __herplanBench?: Promise<{ nodes: number; phases: unknown[]; total: { fps: number } }>;
}

// Canvas benchmark smoke run (F2-14). CI has no GPU: WebGL runs in software (SwiftShader), so the numbers
// only catch gross regressions; the real threshold (≥ 50 fps on 5 000 nodes) is checked on the owner's laptop.
test('canvas benchmark runs on 5 000 nodes', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('herplan.web.settings.v1', JSON.stringify({ locale: 'ru' })));
  await page.goto('/#/dev/canvas-bench?nodes=5000&auto=1');
  await page.reload();
  await page.waitForFunction(() => (window as BenchWindow).__herplanBench !== undefined, null, { timeout: 30_000 });
  const report = await page.evaluate(() => (window as BenchWindow).__herplanBench!);
  mkdirSync('test-results', { recursive: true });
  writeFileSync('test-results/canvas-bench.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  expect(errors).toEqual([]);
  expect(report.nodes).toBe(5000);
  expect(report.phases).toHaveLength(4);
  expect(report.total.fps).toBeGreaterThan(1);
});
