// Changes of world entities inside Store recipes (F4-04, F4-06, F4-08): relations seen from both sides,
// duplicating, copying values, deleting without leaving relations behind; and "where used" (F4-09).

import { current, isDraft } from 'immer';
import { newId } from '../core/ids';
import type { JsonObject, ProjectData } from '../core/project/types';
import { asEntity, type Relation, type WorldEntity } from '../story/entities';
import { allGraphs, asStory } from '../story/model';
import { documentsLinkingTo } from '../documents/links';
import { docName } from '../documents/model';
import { listVariables } from '../story/variables';
import { tasksLinkingTo } from '../tasks/model';
import { cardFields, typesFile } from './schema';

/** A relation as one entity sees it: its own (outgoing) or one another entity keeps about it. */
export interface RelationView {
  /** The entity whose file keeps the relation. */
  owner: string;
  relation: Relation;
  /** The entity at the other end, as seen from the viewer. */
  other: string;
  /** How the viewer calls the other one. */
  label: string;
  /** How the other one calls the viewer. */
  inverse: string;
  outgoing: boolean;
}

export function relationsOf(data: Pick<ProjectData, 'entities'>, id: string): RelationView[] {
  const out: RelationView[] = [];
  const me = asEntity(data.entities[id]);
  for (const r of me?.relations ?? []) {
    out.push({ owner: id, relation: r, other: r.to.id, label: r.label, inverse: r.inverseLabel, outgoing: true });
  }
  for (const raw of Object.values(data.entities)) {
    if (raw.id === id) continue;
    const e = asEntity(raw);
    for (const r of e?.relations ?? []) {
      if (r.to.id === id) {
        out.push({ owner: e!.id, relation: r, other: e!.id, label: r.inverseLabel, inverse: r.label, outgoing: false });
      }
    }
  }
  return out;
}

const entityFile = (d: ProjectData, id: string): JsonObject | undefined => d.entities[id];

/** An entity file as plain data: inside a recipe the file is a draft, which cannot be cloned. */
const plain = (raw: JsonObject | undefined): JsonObject | undefined => (raw && isDraft(raw) ? current(raw) : raw);

export function addRelation(
  d: ProjectData,
  from: string,
  to: string,
  label: string,
  inverse: string,
  description = '',
): string | null {
  const e = entityFile(d, from);
  if (!e || !d.entities[to] || from === to) return null;
  const relation: Relation = {
    id: newId(),
    to: { kind: 'entity', id: to },
    label: label.trim(),
    inverseLabel: inverse.trim(),
    description,
  };
  if (!Array.isArray(e.relations)) e.relations = [];
  (e.relations as unknown as Relation[]).push(relation);
  return relation.id;
}

/** Edits a relation from the viewer's side: its "label" is the stored inverse when the other side keeps it. */
export function editRelation(
  d: ProjectData,
  view: Pick<RelationView, 'owner' | 'outgoing'> & { id: string },
  patch: { label?: string; inverse?: string; description?: string },
): void {
  const list = entityFile(d, view.owner)?.relations as unknown as Relation[] | undefined;
  const r = list?.find((x) => x.id === view.id);
  if (!r) return;
  if (patch.label !== undefined) r[view.outgoing ? 'label' : 'inverseLabel'] = patch.label;
  if (patch.inverse !== undefined) r[view.outgoing ? 'inverseLabel' : 'label'] = patch.inverse;
  if (patch.description !== undefined) r.description = patch.description;
}

export function removeRelation(d: ProjectData, owner: string, id: string): void {
  const e = entityFile(d, owner);
  if (e && Array.isArray(e.relations)) {
    e.relations = (e.relations as unknown as Relation[]).filter((r) => r.id !== id) as unknown as JsonObject[];
  }
}

/** Deletes an entity and the relations other entities keep about it. */
export function deleteEntity(d: ProjectData, id: string): void {
  delete d.entities[id];
  for (const e of Object.values(d.entities)) {
    if (!Array.isArray(e.relations)) continue;
    const kept = (e.relations as unknown as Relation[]).filter((r) => r.to?.id !== id);
    if (kept.length !== e.relations.length) e.relations = kept as unknown as JsonObject[];
  }
}

/** A copy right after the original: values and own relations copied, a new name. */
export function duplicateEntity(d: ProjectData, id: string, name: string): string | null {
  const e = asEntity(plain(d.entities[id]));
  if (!e) return null;
  const copy: WorldEntity = {
    ...structuredClone(e),
    id: newId(),
    name,
    order: e.order + 1,
    relations: e.relations.map((r) => ({ ...structuredClone(r), id: newId() })),
  };
  // Make room: entities after the original move one step down.
  for (const raw of Object.values(d.entities)) {
    if (typeof raw.order === 'number' && raw.order > e.order) raw.order += 1;
  }
  d.entities[copy.id] = copy as unknown as JsonObject;
  return copy.id;
}

/** Copies the values of the fields both entities have (by field id) from one entity to another. */
export function copyValues(d: ProjectData, from: string, to: string): number {
  const source = asEntity(plain(d.entities[from]));
  const target = d.entities[to];
  if (!source || !target) return 0;
  const schema = typesFile(d);
  const into = asEntity(plain(target));
  const mine = new Set(into ? cardFields(schema, into).map((f) => f.field.id) : []);
  const shared = cardFields(schema, source).filter((f) => mine.has(f.field.id));
  const values = { ...(asEntity(plain(target))?.values ?? {}) };
  let copied = 0;
  for (const { field } of shared) {
    if (!(field.id in source.values)) continue;
    values[field.id] = structuredClone(source.values[field.id]);
    copied++;
  }
  target.values = values as JsonObject;
  if (source.image && !target.image) target.image = source.image;
  return copied;
}

/** Puts entities in the given order (manual sorting): their `order` follows the list. */
export function reorderEntities(d: ProjectData, ids: readonly string[]): void {
  ids.forEach((id, i) => {
    const e = d.entities[id];
    if (e) e.order = (i + 1) * 10;
  });
}

// ---------- where used ----------

export type EntityUse =
  | { kind: 'node'; graph: string; node: string; title: string }
  | { kind: 'speaker'; graph: string; node: string; title: string; count: number }
  | { kind: 'variable'; variable: string; name: string }
  | { kind: 'value'; variable: string; name: string }
  | { kind: 'field'; entity: string; name: string; field: string }
  | { kind: 'doc'; doc: string; name: string; count: number }
  | { kind: 'task'; task: string; name: string; board: string };

/**
 * Every place that refers to an entity: story nodes, dialogue speakers, variables, other entities' fields,
 * documents, tasks.
 */
export function entityUses(data: ProjectData, id: string): EntityUse[] {
  const out: EntityUse[] = [];
  for (const g of allGraphs(data)) {
    for (const raw of g.nodes) {
      const n = asStory(raw);
      if (n.ref === id) out.push({ kind: 'node', graph: g.id, node: n.id, title: n.title });
      const count = (n.lines ?? []).filter((l) => l.speaker === id).length;
      if (count) out.push({ kind: 'speaker', graph: g.id, node: n.id, title: n.title, count });
    }
  }
  for (const v of listVariables(data)) {
    if (v.owner?.id === id) out.push({ kind: 'variable', variable: v.id, name: v.name });
    if (v.type === 'entity' && v.initial === id) out.push({ kind: 'value', variable: v.id, name: v.name });
  }
  const schema = typesFile(data);
  for (const raw of Object.values(data.entities)) {
    const e = asEntity(raw);
    if (!e || e.id === id) continue;
    for (const { field } of cardFields(schema, e)) {
      const v = e.values[field.id];
      const hit =
        (field.type === 'ref' && v === id) || (field.type === 'refList' && Array.isArray(v) && v.includes(id));
      if (hit) out.push({ kind: 'field', entity: e.id, name: e.name, field: field.label });
    }
  }
  for (const { doc, count } of documentsLinkingTo(data, 'ent', id)) {
    out.push({ kind: 'doc', doc: doc.id, name: docName(doc.path), count });
  }
  for (const { board, task } of tasksLinkingTo(data, 'entity', id)) {
    out.push({ kind: 'task', task: task.id, name: task.title, board: board.name });
  }
  return out;
}
