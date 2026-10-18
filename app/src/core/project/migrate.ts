// Format migrations (FR-SAV-07). A migration rewrites raw files from one formatVersion to the next,
// before the data is parsed, because the shape of the files may change between versions.
// The caller makes a labelled manual backup first, then writes the result (docs/format/project-v1.md).

import type { FileText, ProjectSnapshot } from '../../platform/types';
import { SINGLE_FILES } from './files';
import { FORMAT_VERSION } from './types';

export interface Migration {
  from: number;
  to: number;
  /** Rewrites the files; returns the new set (files left out are deleted). */
  run: (files: Map<string, string>) => Map<string, string>;
}

/** Format v1 is the first public format, so there is nothing to migrate yet. */
export const MIGRATIONS: readonly Migration[] = [];

/** formatVersion written in project.json, or null if it cannot be read. */
export function readFormatVersion(snapshot: ProjectSnapshot): number | null {
  const text = snapshot.files.find((f) => f.path === SINGLE_FILES.meta)?.text;
  if (!text) return null;
  try {
    const version = (JSON.parse(text) as { formatVersion?: unknown }).formatVersion;
    return typeof version === 'number' && Number.isInteger(version) ? version : null;
  } catch {
    return null;
  }
}

/** The chain of migrations from `from` to `to`, or null if a step is missing. */
export function planMigrations(
  from: number,
  to: number = FORMAT_VERSION,
  registry: readonly Migration[] = MIGRATIONS,
): Migration[] | null {
  const plan: Migration[] = [];
  let version = from;
  while (version < to) {
    const step = registry.find((m) => m.from === version);
    if (!step || step.to <= version) return null;
    plan.push(step);
    version = step.to;
  }
  return plan;
}

export interface MigrationResult {
  writes: FileText[];
  deletes: string[];
}

/** Runs the plan and lists what to write and delete; project.json gets the final formatVersion. */
export function applyMigrations(snapshot: ProjectSnapshot, plan: readonly Migration[]): MigrationResult {
  const before = new Map(snapshot.files.map((f) => [f.path, f.text]));
  let files = new Map(before);
  for (const step of plan) {
    files = step.run(files);
    const meta = files.get(SINGLE_FILES.meta);
    if (meta !== undefined) {
      const parsed = JSON.parse(meta) as Record<string, unknown>;
      parsed.formatVersion = step.to;
      files.set(SINGLE_FILES.meta, `${JSON.stringify(parsed, null, 2)}\n`);
    }
  }
  const writes = [...files].filter(([path, text]) => before.get(path) !== text).map(([path, text]) => ({ path, text }));
  const deletes = [...before.keys()].filter((path) => !files.has(path));
  return { writes, deletes };
}
