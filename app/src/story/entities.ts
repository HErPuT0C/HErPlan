// World entities (F3-01, F4): characters, locations, items and the user's own types, stored as
// data/entities/<id>.json. 0.2 kept a name, a picture and a description; 0.3 adds field values by field id
// and relations, on the same files, so nothing made earlier is lost.

import { newId } from '../core/ids';
import type { JsonObject, ProjectData } from '../core/project/types';
import { isA, typesFile } from '../world/schema';

/** A relation stored at one side; the other side sees it with `inverseLabel` (жена ↔ муж). */
export interface Relation {
  id: string;
  to: { kind: 'entity'; id: string };
  /** How this entity calls the other one ("жена"). */
  label: string;
  /** How the other one calls this entity ("муж"). */
  inverseLabel: string;
  description: string;
  [extra: string]: unknown;
}

export interface WorldEntity {
  id: string;
  /** Type id: "character", "location", "item", or a type of the project's own (data/types.json). */
  type: string;
  name: string;
  description: string;
  /** Picture inside the project ("assets/world/…"), or null. */
  image: string | null;
  /** Manual order (cards and table sorted "by hand"). */
  order: number;
  /** Field values by field id. */
  values: Record<string, unknown>;
  relations: Relation[];
  [extra: string]: unknown;
}

const isObject = (v: unknown): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);

function asRelation(raw: unknown): Relation | null {
  if (!isObject(raw) || typeof raw.id !== 'string' || !isObject(raw.to) || typeof raw.to.id !== 'string') return null;
  return {
    ...raw,
    id: raw.id,
    to: { kind: 'entity', id: raw.to.id },
    label: typeof raw.label === 'string' ? raw.label : '',
    inverseLabel: typeof raw.inverseLabel === 'string' ? raw.inverseLabel : '',
    description: typeof raw.description === 'string' ? raw.description : '',
  };
}

export function asEntity(raw: JsonObject | undefined): WorldEntity | null {
  if (!raw || typeof raw.id !== 'string') return null;
  return {
    ...raw,
    id: raw.id,
    type: typeof raw.type === 'string' && raw.type ? raw.type : 'character',
    name: typeof raw.name === 'string' ? raw.name : '',
    description: typeof raw.description === 'string' ? raw.description : '',
    image: typeof raw.image === 'string' && raw.image ? raw.image : null,
    order: typeof raw.order === 'number' ? raw.order : 0,
    values: isObject(raw.values) ? raw.values : {},
    relations: Array.isArray(raw.relations)
      ? raw.relations.map(asRelation).filter((r): r is Relation => r !== null)
      : [],
  };
}

/**
 * Entities of a type and its subtypes (or all), in manual order, then by name. Without the schema
 * (`types`), only the exact type matches.
 */
export function listEntities(
  data: Pick<ProjectData, 'entities'> & Partial<Pick<ProjectData, 'types'>>,
  type?: string,
): WorldEntity[] {
  const schema = type && data.types ? typesFile({ types: data.types }) : null;
  return Object.values(data.entities)
    .map(asEntity)
    .filter((e): e is WorldEntity => e !== null && (!type || (schema ? isA(schema, e.type, type) : e.type === type)))
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

export function newEntity(data: Pick<ProjectData, 'entities'>, type: string, name: string): WorldEntity {
  const last = Object.values(data.entities)
    .map(asEntity)
    .reduce((max, e) => Math.max(max, e?.order ?? 0), 0);
  return {
    id: newId(),
    type,
    name: name.trim(),
    description: '',
    image: null,
    order: last + 10,
    values: {},
    relations: [],
  };
}

export function getEntity(data: ProjectData, id: string | null | undefined): WorldEntity | null {
  return id ? asEntity(data.entities[id]) : null;
}

export function entityLabel(data: Pick<ProjectData, 'entities'>, id: string | null | undefined): string | null {
  const e = id ? data.entities[id] : undefined;
  return e && typeof e.name === 'string' ? e.name : null;
}
