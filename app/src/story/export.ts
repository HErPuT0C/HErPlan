// JSON export for game engines (FR-EXP-01), schema v1 (0.3 adds the world database without changing the
// version: new fields only): docs/format/export-v1.md and export-v1.schema.json.
// Expressions go out both as source text and as a parse tree, so a player in Unity or GameMaker only has to
// walk a small tree (ADR-005). Everything else is plain data with ids.

import type { GraphDoc } from '../canvas/model';
import type { ProjectData } from '../core/project/types';
import { listEntities } from './entities';
import { parseCondition, parseEffects, stripPositions, type BinaryOp, type EffectOp, type Expr } from './expr';
import { graphTitle, parentChapter, startOf } from './flow';
import { anchorText, resolveRange, rolesOf } from './marks';
import { allGraphs, asStory, storyRoot, type NodeRef } from './model';
import { joinedEffects, textPieces } from './textEffects';
import { knownNames } from './usage';
import { fullName, listVariables } from './variables';
import {
  cardFields,
  effectiveFields,
  hiddenFields,
  isBuiltIn,
  ownFields,
  typesFile,
  type FieldDef,
} from '../world/schema';
import { coerceValue } from '../world/values';

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

export interface ExportField {
  id: string;
  label: string;
  type: string;
  options?: string[];
  target?: string | null;
  columns?: string[];
  /** Since 0.4, "tags" fields: the catalog their tags come from. */
  catalog?: string | null;
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
  entities: {
    id: string;
    type: string;
    name: string;
    description: string;
    image: string | null;
    /**
     * Since 0.3: values by field id (the fields of the entity's type, see `schema`); since 0.5 without the
     * type's fields this card hides (`hiddenFields`) and with its own fields (`fields`).
     */
    values: Record<string, unknown>;
    /** Since 0.3: relations kept at this entity; the other side sees them with `inverseLabel`. */
    relations: { id: string; to: string; label: string; inverseLabel: string; description: string }[];
    /** Since 0.5: fields of this card only, when it has any. */
    fields?: ExportField[];
    /** Since 0.5: ids of the type's fields this card does not have, when there are any. */
    hiddenFields?: string[];
  }[];
  /** Since 0.3: entity types (with every field an entity of the type has) and property sets. */
  schema: {
    types: {
      id: string;
      name: string;
      builtIn: boolean;
      parent: string | null;
      fields: ExportField[];
    }[];
    propertySets: { id: string; name: string; fields: ExportField[] }[];
    /** Since 0.4: catalogs of tags; "tags" fields hold tag ids from the field's `catalog`. */
    catalogs: {
      id: string;
      name: string;
      tags: { id: string; name: string; description: string; color: string | null }[];
    }[];
  };
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

function exportNode(raw: GraphDoc['nodes'][number], known: (name: string) => boolean): ExportNode {
  const n = asStory(raw);
  const out: ExportNode = { id: n.id, kind: n.kind, title: n.title, text: n.text ?? '', x: n.x, y: n.y };
  if (n.comment) out.comment = n.comment;
  const roles = rolesOf(n);
  // plotRole for readers of 0.2 exports (the first role); plotRoles has them all.
  if (roles.length) {
    out.plotRole = roles[0];
    out.plotRoles = roles;
  }
  // Effects written in the text, applied when the node is shown (textEffects.ts); parsed for engines.
  const written = [
    joinedEffects(textPieces(n.text, known)),
    joinedEffects(textPieces(n.comment, known)),
    ...(n.lines ?? []).map((l) => joinedEffects(textPieces(l.text))),
  ]
    .filter(Boolean)
    .join('; ');
  if (written) out.textEffects = effects(written);
  const marks = (n.marks ?? []).filter((m) => anchorText(n, m.anchor) !== undefined);
  if (marks.length) {
    out.marks = marks.map((m) => {
      const r = resolveRange(anchorText(n, m.anchor) ?? '', m.range);
      return {
        id: m.id,
        device: m.device,
        anchor: m.anchor,
        range: r && m.range ? { start: r.start, end: r.end, quote: m.range.quote } : null,
        links: m.links,
        note: m.note,
        variables: m.variables,
      };
    });
  }
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
        note: o.note ?? '',
        textEffects: effects(
          [joinedEffects(textPieces(o.text)), joinedEffects(textPieces(o.note, known))].filter(Boolean).join('; '),
        ),
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
function exportField(f: FieldDef): ExportField {
  return {
    id: f.id,
    label: f.label,
    type: f.type,
    ...(f.type === 'enum' ? { options: f.options ?? [] } : {}),
    ...(f.type === 'ref' || f.type === 'refList' ? { target: f.target ?? null } : {}),
    ...(f.type === 'table' ? { columns: f.columns ?? [] } : {}),
    ...(f.type === 'tags' ? { catalog: f.catalog ?? null } : {}),
  };
}

export function exportStory(data: ProjectData, appVersion: string, now = new Date()): StoryExport {
  const graphs = allGraphs(data).filter((g) => g.kind === 'story' || g.kind === 'chapter');
  const schema = typesFile(data);
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
      values: Object.fromEntries(
        cardFields(schema, e).map(({ field }) => [field.id, coerceValue(field, e.values[field.id])]),
      ),
      relations: e.relations.map((r) => ({
        id: r.id,
        to: r.to.id,
        label: r.label,
        inverseLabel: r.inverseLabel,
        description: r.description,
      })),
      ...(ownFields(e).length ? { fields: ownFields(e).map(exportField) } : {}),
      ...(hiddenFields(e).length ? { hiddenFields: hiddenFields(e) } : {}),
    })),
    schema: {
      types: schema.types.map((x) => ({
        id: x.id,
        name: x.name,
        builtIn: isBuiltIn(x.id),
        parent: x.parent,
        fields: effectiveFields(schema, x.id).map(({ field }) => exportField(field)),
      })),
      propertySets: schema.propertySets.map((x) => ({ id: x.id, name: x.name, fields: x.fields.map(exportField) })),
      catalogs: schema.catalogs.map((c) => ({
        id: c.id,
        name: c.name,
        tags: c.tags.map((x) => ({ id: x.id, name: x.name, description: x.description, color: x.color })),
      })),
    },
    story: {
      root: storyRoot(data)?.id ?? null,
      graphs: graphs.map((g) => {
        const known = knownNames(data, g.id);
        return {
          id: g.id,
          kind: g.kind as 'story' | 'chapter',
          name: g.kind === 'chapter' ? graphTitle(data, g.id) : g.name,
          parent: parentChapter(data, g.id),
          start: startOf(g)?.id ?? null,
          nodes: g.nodes.filter((n) => n.kind !== 'sticker').map((n) => exportNode(n, known)),
          edges: g.edges.map((e) => ({
            id: e.id,
            from: e.from.node,
            fromPort: e.from.port,
            to: e.to.node,
            label: e.label || null,
            condition: condition(e.condition),
          })),
        };
      }),
    },
  };
}

export function exportJson(data: ProjectData, appVersion: string, now?: Date): string {
  return `${JSON.stringify(exportStory(data, appVersion, now), null, 2)}\n`;
}
