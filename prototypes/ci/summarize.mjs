// Turns measure.ps1 outputs into a Markdown table for the job summary and release notes.
// Usage: node summarize.mjs results/tauri.json results/electron.json > summary.md
import { readFileSync } from 'node:fs';

const rows = process.argv.slice(2).map((f) => JSON.parse(readFileSync(f, 'utf8').replace(/^﻿/, '')));
const fps = (r, name) => (Array.isArray(r.autobench) ? r.autobench.find((b) => b.renderer === name)?.avgFps ?? '—' : r.autobench);
const lines = [
  '| оболочка | установщик, МБ | на диске, МБ | окно, мс | процессов | память (рабочий набор), МБ | частная память, МБ | Canvas 2D, к/с | DOM, к/с | DOM + отсечение, к/с | удаление чистое |',
  '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ...rows.map((r) =>
    `| ${r.name} | ${r.installerMB} | ${r.installedMB} | ${r.windowMs} | ${r.processes} | ${r.idleWorkingSetMB} | ${r.idlePrivateMB} | ${fps(r, 'Canvas 2D')} | ${fps(r, 'DOM')} | ${fps(r, 'DOM + отсечение')} | ${r.uninstallRemovedExe && r.uninstallEntryRemoved ? 'да' : 'нет'} |`,
  ),
  '',
  'Замер на раннере GitHub Actions `windows-latest` без видеокарты: кадры в секунду отражают программную отрисовку и годятся только для сравнения оболочек между собой.',
];
console.log(lines.join('\n'));
