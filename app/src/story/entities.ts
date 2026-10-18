// The smallest world database the story needs (F3-01): characters, locations and items with a name, a
// picture and a description, stored as data/entities/<id>.json. Phase F4 grows this into the full database
// (types, fields, relations) on the same files, so nothing made now is lost.

import { newId } from '../core/ids';
import type { JsonObject, ProjectData } from '../core/project/types';
import { WORLD_KINDS, type WorldKind } from './model';

export interface WorldEntity {
  id: string;
  /** Built-in type id; F4 adds user types with their own ids. */
  type: WorldKind;
  name: string;
  description: string;
  /** Picture inside the project ("assets/world/…"), or null. */
  image: string | null;
  /** Manual order inside the type. */
  order: number;
  [extra: string]: unknown;
}

export function asEntity(raw: JsonObject | undefined): WorldEntity | null {
  if (!raw || typeof raw.id !== 'string') return null;
  return {
    ...raw,
    id: raw.id,
    type: WORLD_KINDS.includes(raw.type as WorldKind) ? (raw.type as WorldKind) : 'character',
    name: typeof raw.name === 'string' ? raw.name : '',
    description: typeof raw.description === 'string' ? raw.description : '',
    image: typeof raw.image === 'string' && raw.image ? raw.image : null,
    order: typeof raw.order === 'number' ? raw.order : 0,
  };
}

/** Entities of one type (or all), in manual order, then by name. */
export function listEntities(data: ProjectData, type?: WorldKind): WorldEntity[] {
  return Object.values(data.entities)
    .map(asEntity)
    .filter((e): e is WorldEntity => e !== null && (!type || e.type === type))
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

export function newEntity(data: ProjectData, type: WorldKind, name: string): WorldEntity {
  const last = listEntities(data, type).at(-1);
  return { id: newId(), type, name: name.trim(), description: '', image: null, order: (last?.order ?? 0) + 10 };
}

export function getEntity(data: ProjectData, id: string | null | undefined): WorldEntity | null {
  return id ? asEntity(data.entities[id]) : null;
}
