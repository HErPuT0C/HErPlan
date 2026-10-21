// The world database's schema (F4-01…F4-05), stored in data/types.json: entity types with subtypes that
// inherit fields, typed fields, property sets shared by many types, and the dictionary of relation label
// pairs. Values live in the entity files by field id, so renaming or moving a field never touches them.
// Since 0.4: catalogs of tags with descriptions ("Traits": agile, independent…) shared by many types, and
// the blocks of a card each type shows. Since 0.5 a card can have fields of its own, hide fields of its
// type and show or hide blocks unlike its type.

import { newId } from '../core/ids';
import type { JsonObject, ProjectData } from '../core/project/types';
import { WORLD_KINDS, type WorldKind } from '../story/model';

export type FieldKind =
  | 'text'
  | 'richtext'
  | 'number'
  | 'percent'
  | 'bool'
  | 'enum'
  | 'ref'
  | 'refList'
  | 'tags'
  | 'image'
  | 'color'
  | 'table';

export const FIELD_KINDS: readonly FieldKind[] = [
  'text',
  'richtext',
  'number',
  'percent',
  'bool',
  'enum',
  'ref',
  'refList',
  'tags',
  'image',
  'color',
  'table',
];

export interface FieldDef {
  id: string;
  label: string;
  type: FieldKind;
  /** enum: the allowed values. */
  options?: string[];
  /** ref, refList: entities of this type (and its subtypes) only; null — any entity. */
  target?: string | null;
  /** table: column titles. */
  columns?: string[];
  /** tags: the catalog the tags come from; null — not chosen yet. */
  catalog?: string | null;
  [extra: string]: unknown;
}

/** Blocks of an entity card besides its fields; a type can hide any of them. */
export type CardSection = 'picture' | 'description' | 'relations' | 'variables' | 'uses';
export const CARD_SECTIONS: readonly CardSection[] = ['picture', 'description', 'relations', 'variables', 'uses'];

export interface EntityType {
  id: string;
  /** Empty for a built-in type that keeps its name in the interface language. */
  name: string;
  /** The type this one is a subtype of: it inherits that type's fields and property sets. */
  parent: string | null;
  icon: string | null;
  color: string | null;
  propertySets: string[];
  fields: FieldDef[];
  /** Blocks this type shows (true) or hides (false); unset — as the type above it, shown at the top. */
  card?: Partial<Record<CardSection, boolean>>;
  [extra: string]: unknown;
}

export interface PropertySet {
  id: string;
  name: string;
  fields: FieldDef[];
  [extra: string]: unknown;
}

/** "жена" on one side means "муж" on the other: offered when a relation is made, can be corrected. */
export interface LabelPair {
  label: string;
  inverse: string;
}

/** One tag of a catalog: "agile — dodges the first attack". */
export interface CatalogTag {
  id: string;
  name: string;
  description: string;
  color: string | null;
}

/** A list of tags made once and put on entities by "Tags" fields (traits, abilities, passives…). */
export interface Catalog {
  id: string;
  name: string;
  tags: CatalogTag[];
  [extra: string]: unknown;
}

export interface TypesFile {
  types: EntityType[];
  propertySets: PropertySet[];
  relationLabels: LabelPair[];
  catalogs: Catalog[];
  [extra: string]: unknown;
}

const isObject = (v: unknown): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

export const isBuiltIn = (id: string): id is WorldKind => (WORLD_KINDS as readonly string[]).includes(id);

function normalizeField(raw: unknown): FieldDef | null {
  if (!isObject(raw) || typeof raw.id !== 'string') return null;
  const type = FIELD_KINDS.includes(raw.type as FieldKind) ? (raw.type as FieldKind) : 'text';
  return {
    ...raw,
    id: raw.id,
    label: str(raw.label),
    type,
    ...(type === 'enum' ? { options: strings(raw.options) } : {}),
    ...(type === 'ref' || type === 'refList' ? { target: typeof raw.target === 'string' ? raw.target : null } : {}),
    ...(type === 'table' ? { columns: strings(raw.columns) } : {}),
    ...(type === 'tags' ? { catalog: typeof raw.catalog === 'string' ? raw.catalog : null } : {}),
  };
}

function normalizeCard(raw: unknown): EntityType['card'] {
  if (!isObject(raw)) return undefined;
  const out: Partial<Record<CardSection, boolean>> = {};
  for (const k of CARD_SECTIONS) if (typeof raw[k] === 'boolean') out[k] = raw[k];
  return Object.keys(out).length ? out : undefined;
}

function normalizeCatalog(raw: unknown): Catalog | null {
  if (!isObject(raw) || typeof raw.id !== 'string') return null;
  const tags = Array.isArray(raw.tags)
    ? raw.tags
        .filter((x): x is JsonObject => isObject(x) && typeof x.id === 'string')
        .map((x) => ({
          id: x.id as string,
          name: str(x.name),
          description: str(x.description),
          color: typeof x.color === 'string' ? x.color : null,
        }))
    : [];
  return { ...raw, id: raw.id, name: str(raw.name), tags };
}

const fieldsOf = (raw: unknown): FieldDef[] =>
  Array.isArray(raw) ? raw.map(normalizeField).filter((f): f is FieldDef => f !== null) : [];

function normalizeType(raw: unknown): EntityType | null {
  if (!isObject(raw) || typeof raw.id !== 'string') return null;
  return {
    ...raw,
    id: raw.id,
    name: str(raw.name),
    parent: typeof raw.parent === 'string' && raw.parent !== raw.id ? raw.parent : null,
    icon: typeof raw.icon === 'string' ? raw.icon : null,
    color: typeof raw.color === 'string' ? raw.color : null,
    propertySets: strings(raw.propertySets),
    fields: fieldsOf(raw.fields),
    card: normalizeCard(raw.card),
  };
}

function normalizeSet(raw: unknown): PropertySet | null {
  if (!isObject(raw) || typeof raw.id !== 'string') return null;
  return { ...raw, id: raw.id, name: str(raw.name), fields: fieldsOf(raw.fields) };
}

export function builtInType(id: WorldKind): EntityType {
  return { id, name: '', parent: null, icon: null, color: null, propertySets: [], fields: [] };
}

/**
 * The schema of a project, repaired where a hand edit broke it: built-in types always exist (first, in
 * their order), unknown parents become top-level, unknown fields stay.
 */
export function typesFile(data: Pick<ProjectData, 'types'>): TypesFile {
  const raw = isObject(data.types) ? data.types : {};
  const types = Array.isArray(raw.types) ? raw.types.map(normalizeType).filter((x): x is EntityType => x !== null) : [];
  const byId = new Map(types.map((x) => [x.id, x]));
  const builtIns = WORLD_KINDS.map((id) => byId.get(id) ?? builtInType(id));
  const custom = types.filter((x) => !isBuiltIn(x.id));
  const all = [...builtIns, ...custom].map((x) => ({ ...x, parent: isBuiltIn(x.id) ? null : x.parent }));
  const ids = new Set(all.map((x) => x.id));
  for (const x of all) if (x.parent && !ids.has(x.parent)) x.parent = null;
  // A loop of parents (hand edit) is cut where it closes.
  for (const x of all) {
    const seen = new Set<string>([x.id]);
    let p = x.parent;
    while (p) {
      if (seen.has(p)) {
        x.parent = null;
        break;
      }
      seen.add(p);
      p = all.find((y) => y.id === p)?.parent ?? null;
    }
  }
  return {
    ...raw,
    types: all,
    propertySets: Array.isArray(raw.propertySets)
      ? raw.propertySets.map(normalizeSet).filter((x): x is PropertySet => x !== null)
      : [],
    relationLabels: Array.isArray(raw.relationLabels)
      ? raw.relationLabels
          .filter(isObject)
          .map((p) => ({ label: str(p.label).trim(), inverse: str(p.inverse).trim() }))
          .filter((p) => p.label && p.inverse)
      : [],
    catalogs: Array.isArray(raw.catalogs)
      ? raw.catalogs.map(normalizeCatalog).filter((x): x is Catalog => x !== null)
      : [],
  };
}

/** The schema as a draft can change it: built-ins put in place, so recipes can edit any type. */
export function editableTypes(d: ProjectData): TypesFile {
  const fixed = typesFile(d);
  if (!isObject(d.types)) d.types = {};
  const t = d.types as unknown as TypesFile;
  const current = Array.isArray(t.types) ? t.types : [];
  if (current.length !== fixed.types.length || current.some((x, i) => x?.id !== fixed.types[i].id)) {
    t.types = fixed.types;
  }
  t.propertySets ??= [];
  t.relationLabels ??= [];
  t.catalogs ??= [];
  return t;
}

export function findType(file: TypesFile, id: string | null | undefined): EntityType | undefined {
  return id ? file.types.find((x) => x.id === id) : undefined;
}

/** The type and the types above it, nearest first. */
export function typeChain(file: TypesFile, id: string): EntityType[] {
  const chain: EntityType[] = [];
  const seen = new Set<string>();
  let current = findType(file, id);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    chain.push(current);
    current = findType(file, current.parent);
  }
  return chain;
}

/** Is `typeId` the type `base` or a subtype of it (at any depth). */
export function isA(file: TypesFile, typeId: string, base: string): boolean {
  return typeChain(file, typeId).some((x) => x.id === base);
}

/** The built-in kind at the top of a type's chain (a subtype of "Character" is a character). */
export function rootKind(file: TypesFile, typeId: string): WorldKind | null {
  const top = typeChain(file, typeId).at(-1);
  return top && isBuiltIn(top.id) ? top.id : null;
}

export function subtypes(file: TypesFile, id: string | null): EntityType[] {
  return file.types.filter((x) => x.parent === id);
}

/** All types in tree order (each type followed by its subtypes), with their depth. */
export function typeTree(file: TypesFile): { type: EntityType; depth: number }[] {
  const out: { type: EntityType; depth: number }[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const x of subtypes(file, parent)) {
      out.push({ type: x, depth });
      walk(x.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

/** Where a field of an entity comes from: its own type, a type above it, a property set, or the card itself. */
export interface FieldSource {
  kind: 'type' | 'set' | 'entity';
  id: string;
}

export interface EffectiveField {
  field: FieldDef;
  from: FieldSource;
}

/**
 * Every field an entity of this type has: those of the top type first, then each subtype's; for each type,
 * its property sets' fields, then its own. A field reached twice (a set attached at two levels) counts once.
 */
export function effectiveFields(file: TypesFile, typeId: string): EffectiveField[] {
  const out: EffectiveField[] = [];
  const seen = new Set<string>();
  const add = (f: FieldDef, from: FieldSource) => {
    if (seen.has(f.id)) return;
    seen.add(f.id);
    out.push({ field: f, from });
  };
  for (const x of [...typeChain(file, typeId)].reverse()) {
    for (const setId of x.propertySets) {
      const set = file.propertySets.find((s) => s.id === setId);
      for (const f of set?.fields ?? []) add(f, { kind: 'set', id: setId });
    }
    for (const f of x.fields) add(f, { kind: 'type', id: x.id });
  }
  return out;
}

/** Does a card of this type show the block: the nearest type that says so decides; shown by default. */
export function showsSection(file: TypesFile, typeId: string, section: CardSection): boolean {
  for (const x of typeChain(file, typeId)) {
    const v = x.card?.[section];
    if (typeof v === 'boolean') return v;
  }
  return true;
}

/**
 * What a card keeps about its own fields and blocks (0.5), next to its values: `fields` of this card only,
 * `hiddenFields` (ids of its type's fields it does not have), `card` (blocks it shows or hides unlike its type).
 */
export interface CardOwnership {
  id: string;
  type: string;
  [key: string]: unknown;
}

/** Fields of this card only. */
export function ownFields(e: Readonly<Record<string, unknown>>): FieldDef[] {
  return fieldsOf(e.fields);
}

/** Ids of the type's fields this card does not have. */
export function hiddenFields(e: Readonly<Record<string, unknown>>): string[] {
  return strings(e.hiddenFields);
}

/** Every field of one card: its type's (without those it hides), then its own. */
export function cardFields(file: TypesFile, e: CardOwnership): EffectiveField[] {
  const hidden = new Set(hiddenFields(e));
  return [
    ...effectiveFields(file, e.type).filter((f) => !hidden.has(f.field.id)),
    ...ownFields(e)
      .filter((f) => !hidden.has(f.id))
      .map((field) => ({ field, from: { kind: 'entity' as const, id: e.id } })),
  ];
}

/** Does this card show the block: the card's own choice, else its type's. */
export function cardShows(file: TypesFile, e: CardOwnership, section: CardSection): boolean {
  const own = normalizeCard(e.card)?.[section];
  return typeof own === 'boolean' ? own : showsSection(file, e.type, section);
}

/** Types that use a property set, directly. */
export function typesUsingSet(file: TypesFile, setId: string): EntityType[] {
  return file.types.filter((x) => x.propertySets.includes(setId));
}

// ---------- changes (inside a Store recipe) ----------

export function addType(d: ProjectData, name: string, parent: string | null): string {
  const t = editableTypes(d);
  const id = newId();
  t.types.push({ id, name: name.trim(), parent, icon: null, color: null, propertySets: [], fields: [] });
  return id;
}

/** A subtype cannot go under itself or under one of its own subtypes. */
export function canSetParent(file: TypesFile, id: string, parent: string | null): boolean {
  if (isBuiltIn(id)) return parent === null;
  return parent === null || (parent !== id && !isA(file, parent, id));
}

export function updateType(
  d: ProjectData,
  id: string,
  patch: Partial<Pick<EntityType, 'name' | 'parent' | 'color' | 'icon'>>,
): void {
  const t = editableTypes(d);
  const x = t.types.find((y) => y.id === id);
  if (!x) return;
  if (patch.parent !== undefined && !canSetParent(typesFile(d), id, patch.parent)) delete patch.parent;
  Object.assign(x, patch);
}

/** Shows or hides a block on the cards of a type (and of its subtypes that do not say otherwise). */
export function setSection(d: ProjectData, id: string, section: CardSection, shown: boolean): void {
  const x = editableTypes(d).types.find((y) => y.id === id);
  if (!x) return;
  x.card = { ...(x.card ?? {}), [section]: shown };
}

/**
 * Deletes a type of the user's own: its subtypes and entities move up to its parent (or, for a top-level
 * type, to "Item"), and so do link fields aimed at it, so nothing is lost; values of fields that no longer
 * apply stay in the files.
 */
export function deleteType(d: ProjectData, id: string): void {
  if (isBuiltIn(id)) return;
  const t = editableTypes(d);
  const x = t.types.find((y) => y.id === id);
  if (!x) return;
  const heir = x.parent ?? 'item';
  for (const y of t.types) if (y.parent === id) y.parent = x.parent;
  for (const e of Object.values(d.entities)) if (e.type === id) e.type = heir;
  // Links that pointed at entities of this type now point at the type that took them in.
  for (const f of [
    ...t.types.flatMap((y) => y.fields),
    ...t.propertySets.flatMap((p) => p.fields),
    ...cardsFields(d),
  ]) {
    if ((f.type === 'ref' || f.type === 'refList') && f.target === id) f.target = heir;
  }
  t.types = t.types.filter((y) => y.id !== id);
}

/** Own fields of every card, as the draft keeps them (to change in place). */
function cardsFields(d: ProjectData): FieldDef[] {
  return Object.values(d.entities).flatMap((e) =>
    Array.isArray(e.fields) ? (e.fields.filter((f) => isObject(f)) as unknown as FieldDef[]) : [],
  );
}

/** Where a field is defined: a type, a property set, or one card (its own field). */
export type FieldOwner = { kind: 'type' | 'set' | 'entity'; id: string };

function ownerFields(d: ProjectData, owner: FieldOwner): FieldDef[] | undefined {
  if (owner.kind === 'entity') {
    const e = d.entities[owner.id];
    if (!e) return undefined;
    if (!Array.isArray(e.fields)) e.fields = [];
    return e.fields as unknown as FieldDef[];
  }
  const t = editableTypes(d);
  return owner.kind === 'type'
    ? t.types.find((x) => x.id === owner.id)?.fields
    : t.propertySets.find((x) => x.id === owner.id)?.fields;
}

export function newField(type: FieldKind, label: string): FieldDef {
  return {
    id: newId(),
    label: label.trim(),
    type,
    ...(type === 'enum' ? { options: [] } : {}),
    ...(type === 'ref' || type === 'refList' ? { target: null } : {}),
    ...(type === 'table' ? { columns: [] } : {}),
    ...(type === 'tags' ? { catalog: null } : {}),
  };
}

export function addField(d: ProjectData, owner: FieldOwner, field: FieldDef): void {
  ownerFields(d, owner)?.push(field);
}

/** A changed kind keeps the field id, so values that still fit stay usable (see coerceValue). */
export function updateField(d: ProjectData, owner: FieldOwner, id: string, patch: Partial<Omit<FieldDef, 'id'>>): void {
  const fields = ownerFields(d, owner);
  const f = fields?.find((x) => x.id === id);
  if (!f) return;
  Object.assign(f, patch);
  if (f.type === 'enum') f.options ??= [];
  if ((f.type === 'ref' || f.type === 'refList') && f.target === undefined) f.target = null;
  if (f.type === 'table') f.columns ??= [];
  if (f.type === 'tags' && f.catalog === undefined) f.catalog = null;
}

/**
 * Removes the field from the schema; entity files keep its values (the field can be put back by undo). A
 * card's own field goes with its value.
 */
export function removeField(d: ProjectData, owner: FieldOwner, id: string): void {
  if (owner.kind === 'entity') {
    const e = d.entities[owner.id];
    if (!e || !Array.isArray(e.fields)) return;
    const kept = e.fields.filter((f) => !isObject(f) || f.id !== id);
    if (kept.length) e.fields = kept;
    else delete e.fields;
    if (isObject(e.values)) delete e.values[id];
    return;
  }
  const t = editableTypes(d);
  if (owner.kind === 'type') {
    const x = t.types.find((y) => y.id === owner.id);
    if (x) x.fields = x.fields.filter((f) => f.id !== id);
  } else {
    const s = t.propertySets.find((y) => y.id === owner.id);
    if (s) s.fields = s.fields.filter((f) => f.id !== id);
  }
}

export function moveField(d: ProjectData, owner: FieldOwner, from: number, to: number): void {
  const fields = ownerFields(d, owner);
  if (!fields || from < 0 || from >= fields.length || to < 0 || to >= fields.length) return;
  const [f] = fields.splice(from, 1);
  fields.splice(to, 0, f);
}

/** A card's own field becomes a field of a type: every card of the type gets it, this card keeps its value. */
export function promoteField(d: ProjectData, entity: string, field: string, type: string): void {
  const e = d.entities[entity];
  if (!e || !Array.isArray(e.fields)) return;
  const raw = e.fields.find((x) => isObject(x) && x.id === field);
  const f = normalizeField(raw && JSON.parse(JSON.stringify(raw)));
  if (!f || !editableTypes(d).types.some((x) => x.id === type)) return;
  const kept = e.fields.filter((x) => x !== raw);
  if (kept.length) e.fields = kept;
  else delete e.fields;
  addField(d, { kind: 'type', id: type }, f);
}

/** A field of the type is taken off one card (hidden) or put back; the value stays in the file. */
export function hideField(d: ProjectData, entity: string, field: string, hidden: boolean): void {
  const e = d.entities[entity];
  if (!e) return;
  const list = strings(e.hiddenFields).filter((x) => x !== field);
  if (hidden) list.push(field);
  if (list.length) e.hiddenFields = list;
  else delete e.hiddenFields;
}

/** A block shown or hidden on one card; null — as its type says. */
export function setCardSection(d: ProjectData, entity: string, section: CardSection, shown: boolean | null): void {
  const e = d.entities[entity];
  if (!e) return;
  const card: Partial<Record<CardSection, boolean>> = { ...(normalizeCard(e.card) ?? {}) };
  if (shown === null) delete card[section];
  else card[section] = shown;
  if (Object.keys(card).length) e.card = card;
  else delete e.card;
}

/** Cards that have a value in a field (the field of a type or set, before it is deleted). */
export function filledCount(d: Pick<ProjectData, 'entities'>, field: string): number {
  return Object.values(d.entities).filter((e) => {
    const v = isObject(e.values) ? e.values[field] : undefined;
    return v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0);
  }).length;
}

export function addSet(d: ProjectData, name: string, fields: FieldDef[] = []): string {
  const id = newId();
  editableTypes(d).propertySets.push({ id, name: name.trim(), fields });
  return id;
}

export function renameSet(d: ProjectData, id: string, name: string): void {
  const s = editableTypes(d).propertySets.find((x) => x.id === id);
  if (s) s.name = name;
}

export function deleteSet(d: ProjectData, id: string): void {
  const t = editableTypes(d);
  t.propertySets = t.propertySets.filter((s) => s.id !== id);
  for (const x of t.types) x.propertySets = x.propertySets.filter((s) => s !== id);
}

export function attachSet(d: ProjectData, typeId: string, setId: string, on: boolean): void {
  const x = editableTypes(d).types.find((y) => y.id === typeId);
  if (!x) return;
  x.propertySets = x.propertySets.filter((s) => s !== setId);
  if (on) x.propertySets.push(setId);
}

/** Remembers a pair of relation labels both ways ("жена" → "муж" and "муж" → "жена"). */
export function rememberPair(d: ProjectData, label: string, inverse: string): void {
  const a = label.trim();
  const b = inverse.trim();
  if (!a || !b) return;
  const t = editableTypes(d);
  for (const [x, y] of [
    [a, b],
    [b, a],
  ]) {
    const known = t.relationLabels.find((p) => p.label.toLowerCase() === x.toLowerCase());
    if (known) known.inverse = y;
    else t.relationLabels.push({ label: x, inverse: y });
  }
}

/** Forgets a pair the project remembered (both ways). */
export function forgetPair(d: ProjectData, label: string, inverse: string): void {
  const t = editableTypes(d);
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  t.relationLabels = t.relationLabels.filter(
    (p) => !(same(p.label, label) && same(p.inverse, inverse)) && !(same(p.label, inverse) && same(p.inverse, label)),
  );
}

/** The usual other side of a label: the project's own pairs first, then the defaults ("жена" → "муж"). */
export function inverseLabel(file: TypesFile, defaults: readonly LabelPair[], label: string): string | null {
  const key = label.trim().toLowerCase();
  if (!key) return null;
  return (
    file.relationLabels.find((p) => p.label.toLowerCase() === key)?.inverse ??
    defaults.find((p) => p.label.toLowerCase() === key)?.inverse ??
    null
  );
}

/** "жена:муж, мать:сын" (the defaults come from the interface language) as pairs. */
export function parsePairs(text: string): LabelPair[] {
  return text
    .split(',')
    .map((p) => p.split(':').map((s) => s.trim()))
    .filter((p): p is [string, string] => p.length === 2 && !!p[0] && !!p[1])
    .map(([label, inverse]) => ({ label, inverse }));
}

// ---------- catalogs of tags (0.4) ----------

export function findCatalog(file: TypesFile, id: string | null | undefined): Catalog | undefined {
  return id ? file.catalogs.find((c) => c.id === id) : undefined;
}

/** A tag by id in any catalog (tag ids are unique in the project). */
export function findTag(file: TypesFile, id: string): CatalogTag | undefined {
  for (const c of file.catalogs) {
    const tag = c.tags.find((x) => x.id === id);
    if (tag) return tag;
  }
  return undefined;
}

export function addCatalog(d: ProjectData, name: string): string {
  const id = newId();
  editableTypes(d).catalogs.push({ id, name: name.trim(), tags: [] });
  return id;
}

export function renameCatalog(d: ProjectData, id: string, name: string): void {
  const c = editableTypes(d).catalogs.find((x) => x.id === id);
  if (c) c.name = name;
}

/** Deletes a catalog: its fields lose the catalog, the values stay in the files (undo puts it back). */
export function deleteCatalog(d: ProjectData, id: string): void {
  const t = editableTypes(d);
  t.catalogs = t.catalogs.filter((c) => c.id !== id);
  for (const f of [
    ...t.types.flatMap((y) => y.fields),
    ...t.propertySets.flatMap((p) => p.fields),
    ...cardsFields(d),
  ]) {
    if (f.type === 'tags' && f.catalog === id) f.catalog = null;
  }
}

/** Adds a tag; a tag of the same name (any case) is not added twice, its id is returned instead. */
export function addTag(d: ProjectData, catalog: string, name: string, description = ''): string | null {
  const c = editableTypes(d).catalogs.find((x) => x.id === catalog);
  const clean = name.trim();
  if (!c || !clean) return null;
  const same = c.tags.find((x) => x.name.toLowerCase() === clean.toLowerCase());
  if (same) return same.id;
  const id = newId();
  c.tags.push({ id, name: clean, description, color: null });
  return id;
}

export function updateTag(
  d: ProjectData,
  catalog: string,
  id: string,
  patch: Partial<Pick<CatalogTag, 'name' | 'description' | 'color'>>,
): void {
  const tag = editableTypes(d)
    .catalogs.find((x) => x.id === catalog)
    ?.tags.find((x) => x.id === id);
  if (tag) Object.assign(tag, patch);
}

export function moveTag(d: ProjectData, catalog: string, from: number, to: number): void {
  const tags = editableTypes(d).catalogs.find((x) => x.id === catalog)?.tags;
  if (!tags || from < 0 || from >= tags.length || to < 0 || to >= tags.length) return;
  const [x] = tags.splice(from, 1);
  tags.splice(to, 0, x);
}

/** Deletes a tag and takes it off every entity. */
export function deleteTag(d: ProjectData, catalog: string, id: string): void {
  const c = editableTypes(d).catalogs.find((x) => x.id === catalog);
  if (!c) return;
  c.tags = c.tags.filter((x) => x.id !== id);
  for (const e of Object.values(d.entities)) {
    const values = e.values;
    if (!isObject(values)) continue;
    for (const [k, v] of Object.entries(values)) {
      if (Array.isArray(v) && v.includes(id)) values[k] = v.filter((x) => x !== id);
    }
  }
}
