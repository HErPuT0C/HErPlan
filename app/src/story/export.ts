// JSON export for game engines (FR-EXP-01), schema v1: docs/format/export-v1.md and export-v1.schema.json.
// Expressions go out both as source text and as a parse tree, so a player in Unity or GameMaker only has to
// walk a small tree (ADR-005). Everything else is plain data with ids.

import type { GraphDoc } from '../canvas/model';
import type { ProjectData } from '../core/project/types';
import { listEntities } from './entities';
import { parseCondition, parseEffects, stripPositions, type BinaryOp, type EffectOp, type Expr } from './expr';
import { graphTitle, parentChapter, startOf } from './flow';
import { allGraphs, asStory, storyRoot, type NodeRef } from './model';
import { fullName, listVariables } from './variables';

export const EXPORT_FORMAT = 'herplan-export';
export const EXPORT_VERSION = 1;

/** A parse tree without positions. */
export type ExportExpr =
  | { kind: 'literal'; value: boolean | number | string }
  | { kind: 'var'; name: string }
  | { kind: 'unary'; op: 'not' | 'neg'; arg: ExportExpr }
  | { kind: 'binary'; op: BinaryOp; left: ExportExpr; right: ExportExpr };

export interface ExportCondition {
  source: string;
  /** Null when the source does not parse; the editor's checks report that. */
  ast: ExportExpr | null;
}

export interface ExportEffects {
  source: string;
  effects: { target: string; op: EffectOp; value: ExportExpr }[] | null;
}

export interface ExportNode {
  id: string;
  kind: string;
  title: string;
  text: string;
  x: number;
  y: number;
  [field: string]: unknown;
}

export interface ExportEdge {
  id: string;
  from: string;
  /** "out" and the side anchors for ordinary nodes, an option id for a choice, "yes"/"no" for a condition. */
  fromPort: string;
  to: string;
  label: string | null;
  condition: ExportCondition | null;
}

export interface ExportGraph {
  id: string;
  kind: 'story' | 'chapter';
  name: string;
  /** The chapter node (and its graph) this graph belongs to; null for the story overview. */
  parent: NodeRef | null;
  start: string | null;
  nodes: ExportNode[];
  edges: ExportEdge[];
}

export interface StoryExport {
  format: typeof EXPORT_FORMAT;
  version: typeof EXPORT_VERSION;
  exportedWith: string;
  exportedAt: string;
  project: { id: string; name: string };
  variables: {
    id: string;
    name: string;
    /** As written in expressions: "Мира.доверие" for a variable that belongs to an entity. */
    fullName: string;
    type: string;
    initial: boolean | number | string | null;
    scope: 'project' | { graph: string };
    owner: string | null;
    values: string[] | null;
    description: string;
  }[];
  entities: { id: string; type: string; name: string; description: string; image: string | null }[];
  story: { root: string | null; graphs: ExportGraph[] };
}

function condition(source: string | undefined): ExportCondition | null {
  if (!source?.trim()) return null;
  try {
    return { source, ast: stripPositions(parseCondition(source)) as ExportExpr };
  } catch {
    return { source, ast: null };
  }
}

function effects(source: string | undefined): ExportEffects | null {
  if (!source?.trim()) return null;
  try {
    return {
      source,
      effects: parseEffects(source).map((e) => ({
        target: e.target,
        op: e.op,
        value: stripPositions(e.value as Expr) as ExportExpr,
      })),
    };
  } catch {
    return { source, effects: null };
  }
}

function exportNode(raw: GraphDoc['nodes'][number]): ExportNode {
  const n = asStory(raw);
  const out: ExportNode = { id: n.id, kind: n.kind, title: n.title, text: n.text ?? '', x: n.x, y: n.y };
  if (n.comment) out.comment = n.comment;
  if (n.plotRole) out.plotRole = n.plotRole;
  switch (n.kind) {
    case 'dialogue':
      out.lines = (n.lines ?? []).map((l) => ({ id: l.id, speaker: l.speaker, text: l.text }));
      break;
    case 'choice':
      out.options = (n.options ?? []).map((o) => ({
        id: o.id,
        text: o.text,
        condition: condition(o.condition),
        effects: effects(o.effects),
      }));
      break;
    case 'condition':
      out.condition = condition(n.expr);
      break;
    case 'effect':
      out.effects = effects(n.effects);
      break;
    case 'butterfly':
      out.effects = effects(n.effects);
      out.consequences = n.links ?? [];
      break;
    case 'gun':
      out.payoffs = n.links ?? [];
      break;
    case 'jump':
      out.target = n.target ?? null;
      break;
    case 'chapter':
      out.graph = n.graph ?? null;
      out.image = n.image ?? null;
      break;
    case 'character':
    case 'location':
    case 'item':
      out.entity = n.ref ?? null;
      break;
  }
  return out;
}

/** The story, its variables and the world entities, ready for JSON.stringify. */
export function exportStory(data: ProjectData, appVersion: string, now = new Date()): StoryExport {
  const graphs = allGraphs(data).filter((g) => g.kind === 'story' || g.kind === 'chapter');
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedWith: appVersion,
    exportedAt: now.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    project: { id: data.meta.id, name: data.meta.name },
    variables: listVariables(data).map((v) => ({
      id: v.id,
      name: v.name,
      fullName: fullName(v, data),
      type: v.type,
      initial: v.initial,
      scope: v.scope === 'project' ? 'project' : { graph: v.scope.id },
      owner: v.owner?.id ?? null,
      values: v.type === 'enum' ? (v.values ?? []) : null,
      description: v.description,
    })),
    entities: listEntities(data).map((e) => ({
      id: e.id,
      type: e.type,
      name: e.name,
      description: e.description,
      image: e.image,
    })),
    story: {
      root: storyRoot(data)?.id ?? null,
      graphs: graphs.map((g) => ({
        id: g.id,
        kind: g.kind as 'story' | 'chapter',
        name: g.kind === 'chapter' ? graphTitle(data, g.id) : g.name,
        parent: parentChapter(data, g.id),
        start: startOf(g)?.id ?? null,
        nodes: g.nodes.filter((n) => n.kind !== 'sticker').map(exportNode),
        edges: g.edges.map((e) => ({
          id: e.id,
          from: e.from.node,
          fromPort: e.from.port,
          to: e.to.node,
          label: e.label || null,
          condition: condition(e.condition),
        })),
      })),
    },
  };
}

export function exportJson(data: ProjectData, appVersion: string, now?: Date): string {
  return `${JSON.stringify(exportStory(data, appVersion, now), null, 2)}\n`;
}
