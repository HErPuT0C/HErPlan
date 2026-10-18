import './styles.css';
import type { BenchResult } from './canvas/bench';
import { BENCH_ALL, createCanvasPage } from './canvas/page';
import { createReportPage } from './report';
import { detectShell } from './shell';
import { systemInfo } from './sysinfo';

async function main(): Promise<void> {
  const shell = await detectShell();
  const info = systemInfo(`${shell.name} (${shell.version})`);
  const results: BenchResult[] = [];

  const app = document.getElementById('app')!;
  app.innerHTML = `
    <header class="topbar">
      <strong>HErPlan</strong><span class="muted">прототипы фазы Ф0 · v0.0.2</span>
      <nav>
        <button data-tab="canvas" class="active">Холст</button>
        <button data-tab="editor">Текст</button>
        <button data-tab="report">Отчёт</button>
      </nav>
    </header>
    <main data-id="pages"></main>`;
  const pagesHost = app.querySelector<HTMLElement>('[data-id="pages"]')!;

  const report = createReportPage(info, () => results);
  const canvas = createCanvasPage((r) => {
    results.push(r);
    report.refresh();
  });
  const editorModule = await import('./editor/page');
  const editor = editorModule.createEditorPage((checks) => report.setEditorChecks(checks));

  const pages = { canvas: canvas.element, editor: editor.element, report: report.element };
  pagesHost.append(canvas.element, editor.element, report.element);

  function show(tab: keyof typeof pages): void {
    for (const [name, el] of Object.entries(pages)) el.hidden = name !== tab;
    app.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    if (tab === 'canvas') canvas.activate();
    if (tab === 'editor') editor.activate();
    if (tab === 'report') report.refresh();
  }
  app.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) =>
    b.addEventListener('click', () => show(b.dataset.tab as keyof typeof pages)),
  );
  show('canvas');

  // CI mode: run every renderer once, write a JSON report through the shell and exit.
  if (location.hash.includes('autobench')) {
    const startup = Math.round(performance.now());
    await new Promise((r) => setTimeout(r, 1500));
    const all = await canvas.benchAll(['dom', ...BENCH_ALL], 5000);
    await shell.report({ system: info, msToInteractive: startup, results: all });
    await shell.quit();
  }
}

void main();
