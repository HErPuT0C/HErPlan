// Turns the files read from disk into project data and lists every problem found on the way.
// A damaged file is reported, never "fixed" silently: the interface offers a copy from backups/ (FR-SAV-03).

import type { DamageReason, ProjectSnapshot } from '../../platform/types';
import { COLLECTIONS, SINGLE_FILES } from './files';
import {
  DEFAULT_PROJECT_SETTINGS,
  FORMAT_VERSION,
  PROJECT_FORMAT,
  type JsonObject,
  type ProjectData,
  type ProjectMeta,
  type ProjectSettings,
} from './types';

export type IssueKind = DamageReason | 'invalid-json' | 'not-an-object';

export interface LoadIssue {
  path: string;
  kind: IssueKind;
  detail: string | null;
}

export type LoadResult =
  | {
      ok: true;
      data: ProjectData;
      issues: LoadIssue[];
      /** The project was made by a newer HErPlan: open without saving (docs/format/project-v1.md). */
      readOnly: boolean;
      /** formatVersion found on disk; lower than FORMAT_VERSION means a migration is needed (F1-14). */
      formatVersion: number;
    }
  | { ok: false; reason: 'project-json-damaged' | 'not-herplan'; issues: LoadIssue[] };

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parse(path: string, text: string, issues: LoadIssue[]): JsonObject | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (e) {
    issues.push({ path, kind: 'invalid-json', detail: e instanceof Error ? e.message : String(e) });
    return null;
  }
  if (!isObject(value)) {
    issues.push({ path, kind: 'not-an-object', detail: null });
    return null;
  }
  return value;
}

/** Fills settings that are missing in older or hand-edited files; unknown fields are kept. */
export function normalizeMeta(raw: JsonObject): ProjectMeta {
  const settings = isObject(raw.settings) ? raw.settings : {};
  const backups = isObject(settings.backups) ? settings.backups : {};
  const limits = isObject(settings.dialogueLimits) ? settings.dialogueLimits : {};
  const defaults = DEFAULT_PROJECT_SETTINGS;
  const keep = backups.keep === 'all' || isPositiveInt(backups.keep) ? backups.keep : defaults.backups.keep;
  const normalizedSettings: ProjectSettings = {
    ...settings,
    backups: {
      ...backups,
      keep,
      intervalMinutes: isPositiveInt(backups.intervalMinutes)
        ? backups.intervalMinutes
        : defaults.backups.intervalMinutes,
    },
    dialogueLimits: {
      ...limits,
      maxLines: isPositiveInt(limits.maxLines) ? limits.maxLines : defaults.dialogueLimits.maxLines,
      maxLineChars: isPositiveInt(limits.maxLineChars) ? limits.maxLineChars : defaults.dialogueLimits.maxLineChars,
    },
  };
  return {
    ...raw,
    format: PROJECT_FORMAT,
    formatVersion: typeof raw.formatVersion === 'number' ? raw.formatVersion : FORMAT_VERSION,
    id: typeof raw.id === 'string' ? raw.id : '',
    name: typeof raw.name === 'string' ? raw.name : '',
    description: typeof raw.description === 'string' ? raw.description : '',
    cover: typeof raw.cover === 'string' && raw.cover ? raw.cover : null,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : '',
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : '',
    createdWith: typeof raw.createdWith === 'string' ? raw.createdWith : '',
    settings: normalizedSettings,
  };
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

/**
 * A graph edited by hand may miss arrays or coordinates. Fill what the canvas needs; drop edges and
 * nodes without the parts that make them one (no id, no ends), since they cannot be drawn or linked.
 */
export function normalizeGraph(raw: JsonObject): JsonObject {
  const list = (v: unknown) => (Array.isArray(v) ? v.filter(isObject) : []);
  const nodes = list(raw.nodes)
    .filter((n) => typeof n.id === 'string')
    .map((n) => ({
      ...n,
      kind: typeof n.kind === 'string' ? n.kind : 'node',
      title: typeof n.title === 'string' ? n.title : '',
      x: num(n.x, 0),
      y: num(n.y, 0),
      w: num(n.w, 240),
      h: num(n.h, 120),
    }));
  const edges = list(raw.edges).filter(
    (e) =>
      typeof e.id === 'string' &&
      isObject(e.from) &&
      isObject(e.to) &&
      typeof e.from.node === 'string' &&
      typeof e.to.node === 'string',
  );
  const groups = list(raw.groups)
    .filter((g) => typeof g.id === 'string')
    .map((g) => ({
      ...g,
      title: typeof g.title === 'string' ? g.title : '',
      x: num(g.x, 0),
      y: num(g.y, 0),
      w: num(g.w, 400),
      h: num(g.h, 300),
      members: Array.isArray(g.members) ? g.members.filter((m): m is string => typeof m === 'string') : [],
    }));
  return { ...raw, nodes, edges, groups };
}

export function loadProject(snapshot: ProjectSnapshot): LoadResult {
  const issues: LoadIssue[] = snapshot.damaged.map((d) => ({ path: d.path, kind: d.reason, detail: d.detail }));
  const texts = new Map(snapshot.files.map((f) => [f.path, f.text]));

  const metaText = texts.get(SINGLE_FILES.meta);
  const rawMeta = metaText === undefined ? null : parse(SINGLE_FILES.meta, metaText, issues);
  if (!rawMeta) return { ok: false, reason: 'project-json-damaged', issues };
  if (rawMeta.format !== PROJECT_FORMAT) return { ok: false, reason: 'not-herplan', issues };
  const meta = normalizeMeta(rawMeta);

  const single = (path: string, fallback: JsonObject): JsonObject => {
    const text = texts.get(path);
    if (text === undefined) return fallback;
    return parse(path, text, issues) ?? fallback;
  };

  const collection = (dir: string, normalize: (o: JsonObject) => JsonObject = (o) => o): Record<string, JsonObject> => {
    const out: Record<string, JsonObject> = {};
    for (const [path, text] of texts) {
      if (!path.startsWith(`${dir}/`) || !path.endsWith('.json')) continue;
      const id = path.slice(dir.length + 1, -'.json'.length);
      if (id.includes('/')) continue;
      const object = parse(path, text, issues);
      if (object) out[id] = normalize(object);
    }
    return out;
  };

  const data: ProjectData = {
    meta,
    types: single(SINGLE_FILES.types, { types: [], propertySets: [] }),
    variables: single(SINGLE_FILES.variables, { variables: [], labels: [] }),
    assetMeta: single(SINGLE_FILES.assetMeta, { folders: {} }),
    entities: collection(COLLECTIONS.entities),
    graphs: collection(COLLECTIONS.graphs, normalizeGraph),
    boards: collection(COLLECTIONS.boards),
  };
  return {
    ok: true,
    data,
    issues,
    readOnly: meta.formatVersion > FORMAT_VERSION,
    formatVersion: meta.formatVersion,
  };
}
