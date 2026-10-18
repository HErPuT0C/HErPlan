// In-memory log of recent warnings and errors for bug reports (FR-APP-07). Nothing leaves the computer:
// the user saves the report to a file and decides what to send.

const LIMIT = 500;

export interface LogLine {
  at: string;
  level: 'warn' | 'error';
  text: string;
}

const lines: LogLine[] = [];

function describe(value: unknown): string {
  if (value instanceof Error) return value.stack ?? `${value.name}: ${value.message}`;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function record(level: LogLine['level'], parts: unknown[]): void {
  lines.push({ at: new Date().toISOString(), level, text: parts.map(describe).join(' ') });
  if (lines.length > LIMIT) lines.splice(0, lines.length - LIMIT);
}

export function recentLog(): readonly LogLine[] {
  return lines;
}

/** Mirrors console warnings and errors and uncaught failures into the log. Call once at startup. */
export function captureConsole(): void {
  for (const level of ['warn', 'error'] as const) {
    const original = console[level].bind(console);
    console[level] = (...parts: unknown[]) => {
      record(level, parts);
      original(...parts);
    };
  }
  window.addEventListener('error', (e) => record('error', [e.error ?? e.message]));
  window.addEventListener('unhandledrejection', (e) => record('error', ['unhandled rejection:', e.reason]));
}

export interface ReportInput {
  version: string;
  system: Record<string, string>;
  settings: Record<string, unknown>;
  log: readonly LogLine[];
  description: string;
}

/** Plain-text report: what happened (user's words), versions, system, settings, recent log. */
export function buildReport({ version, system, settings, log, description }: ReportInput): string {
  const out = [`HErPlan ${version} — bug report`, `Created: ${new Date().toISOString()}`, ''];
  if (description.trim()) out.push('## What happened', description.trim(), '');
  out.push('## System');
  for (const [key, value] of Object.entries(system)) out.push(`${key}: ${value}`);
  out.push('', '## Settings', JSON.stringify(settings, null, 2), '', `## Log (last ${log.length} lines)`);
  for (const line of log) out.push(`${line.at} ${line.level.toUpperCase()} ${line.text}`);
  return `${out.join('\n')}\n`;
}
