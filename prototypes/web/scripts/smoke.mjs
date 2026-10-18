// Headless smoke run: autobench through the browser bridge, editor round-trip check, screenshots.
// Usage: node scripts/smoke.mjs <url> <outDir>
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const [url = 'http://localhost:4173/', out = 'bench-results'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

await page.goto(url);
await page.waitForTimeout(1200);
await page.screenshot({ path: `${out}/canvas-start.png` });
await page.mouse.move(800, 500);
for (let i = 0; i < 6; i++) await page.mouse.wheel(0, -300);
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/canvas-near.png` });

await page.click('[data-tab="editor"]');
await page.waitForTimeout(800);
await page.screenshot({ path: `${out}/editor.png` });
const md = await page.inputValue('[data-id="md"]');
const auto = await page.textContent('[data-id="auto"]');

const benchPage = await browser.newPage({ viewport: { width: 1600, height: 900 } });
benchPage.on('pageerror', (e) => errors.push(String(e)));
await benchPage.goto(url + '#autobench');
await benchPage.waitForFunction(() => window.__HERPLAN_REPORT__, null, { timeout: 300000 });
const report = await benchPage.evaluate(() => window.__HERPLAN_REPORT__);
writeFileSync(`${out}/autobench.json`, JSON.stringify(report, null, 2));
await browser.close();

console.log('editor round-trip:', auto);
console.log('markdown head:', md.split('\n').slice(0, 4).join(' / '));
for (const r of report.results) {
  console.log(`${r.renderer.padEnd(16)} overall ${r.overall.avgFps} fps, p95 frame ${r.overall.p95FrameMs} ms, p95 draw ${r.overall.p95DrawMs} ms`);
  for (const p of r.phases) console.log(`   ${p.name.padEnd(36)} ${p.avgFps} fps  p95 ${p.p95FrameMs} ms  draw p95 ${p.p95DrawMs} ms  visible ${p.maxVisibleNodes}`);
}
console.log('errors:', errors.length ? errors : 'none');
