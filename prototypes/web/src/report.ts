import type { BenchResult } from './canvas/bench';
import type { SystemInfo } from './sysinfo';

export interface EditorCheck {
  name: string;
  ok: boolean | null;
  note: string;
}

export interface ReportPage {
  element: HTMLElement;
  refresh(): void;
  setEditorChecks(checks: EditorCheck[]): void;
}

export function buildReportText(info: SystemInfo, results: BenchResult[], checks: EditorCheck[]): string {
  const lines: string[] = [];
  lines.push('### HErPlan — отчёт прототипа v0.0.1');
  lines.push(`- оболочка: ${info.shell}`);
  lines.push(`- видеокарта: ${info.gpu}`);
  lines.push(`- потоков процессора: ${info.cpuThreads}; память (оценка браузера): ${info.memoryGb ?? '?'} ГБ`);
  lines.push(`- экран: ${info.screen}, масштаб Windows: ${Math.round(info.dpr * 100)} %`);
  lines.push('');
  if (results.length) {
    lines.push('| отрисовка | узлов | фаза | кадров/с | p95 кадра, мс | макс. кадр, мс | отрисовка p95, мс |');
    lines.push('| --- | --- | --- | --- | --- | --- | --- |');
    for (const r of results)
      for (const p of [...r.phases, r.overall])
        lines.push(`| ${r.renderer} | ${r.nodes} | ${p.name} | ${p.avgFps} | ${p.p95FrameMs} | ${p.maxFrameMs} | ${p.p95DrawMs} |`);
  } else {
    lines.push('Замеры холста не запускались.');
  }
  if (checks.length) {
    lines.push('');
    lines.push('Проверки редактора:');
    for (const c of checks) lines.push(`- ${c.ok === null ? '⬜' : c.ok ? '✅' : '❌'} ${c.name}${c.note ? ` — ${c.note}` : ''}`);
  }
  return lines.join('\n');
}

export function createReportPage(info: SystemInfo, getResults: () => BenchResult[]): ReportPage {
  const element = document.createElement('section');
  element.className = 'page report-page';
  element.innerHTML = `
    <div class="report-head">
      <p>Здесь собираются результаты. Запустите замер на вкладке «Холст» (лучше для всех трёх вариантов отрисовки), пройдите проверки на вкладке «Текст», затем нажмите «Скопировать отчёт» и вставьте его в чат.</p>
      <button data-id="copy" class="primary">Скопировать отчёт</button>
      <span data-id="copied" class="muted"></span>
    </div>
    <pre data-id="text"></pre>`;
  const pre = element.querySelector<HTMLPreElement>('[data-id="text"]')!;
  const copied = element.querySelector<HTMLSpanElement>('[data-id="copied"]')!;
  let checks: EditorCheck[] = [];

  const refresh = () => {
    pre.textContent = buildReportText(info, getResults(), checks);
  };
  element.querySelector('[data-id="copy"]')!.addEventListener('click', async () => {
    refresh();
    try {
      await navigator.clipboard.writeText(pre.textContent ?? '');
      copied.textContent = 'Скопировано';
    } catch {
      const range = document.createRange();
      range.selectNodeContents(pre);
      getSelection()?.removeAllRanges();
      getSelection()?.addRange(range);
      copied.textContent = 'Текст выделен — нажмите Ctrl+C';
    }
  });
  refresh();
  return {
    element,
    refresh,
    setEditorChecks(next) {
      checks = next;
      refresh();
    },
  };
}
