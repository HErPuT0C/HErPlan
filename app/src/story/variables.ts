// The project's single registry of variables and labels (FR-NAR-04), stored in data/variables.json.
// A variable has a type, an initial value and a scope (the whole project or one chapter); it may belong
// to an entity, and then expressions write it as "Мира.доверие".

import type { GraphDoc } from '../canvas/model';
import { newId } from '../core/ids';
import type { JsonObject, ProjectData } from '../core/project/types';
import { isIdentifier, type Registry, type RegistryEntry, type Value, type ValueType } from './expr';

/** "list" (0.8): a list the game fills (what was given, who was met); conditions ask непусто(имя). */
export type VarType = 'bool' | 'int' | 'float' | 'string' | 'enum' | 'entity' | 'list';
export const VAR_TYPES: readonly VarType[] = ['bool', 'int', 'float', 'string', 'enum', 'entity', 'list'];

/** Where the game keeps a variable (0.8): in the save ("world"), or outside saves ("game": the game remembers). */
export type VarMemory = 'world' | 'game';
export const VAR_MEMORIES: readonly VarMemory[] = ['world', 'game'];

export type VarScope = 'project' | { kind: 'graph'; id: string };

export interface Variable {
  id: string;
  name: string;
  type: VarType;
  /** bool → boolean, int/float → number, string/enum → string, entity → entity id or null. */
  initial: Value | null;
  scope: VarScope;
  owner: { kind: 'entity'; id: string } | null;
  description: string;
  /** Allowed values of an enum. */
  values?: string[];
  /** The name in the game (0.8): Latin, e.g. "skeleton_respect". */
  key?: string;
  /** Where the game keeps it; absent: in the save. */
  memory?: VarMemory;
  [extra: string]: unknown;
}

export interface Label {
  id: string;
  name: string;
  color: string;
  [extra: string]: unknown;
}

export interface VariablesFile {
  variables: Variable[];
  labels: Label[];
  [extra: string]: unknown;
}

const isObject = (v: unknown): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);

export function defaultInitial(type: VarType, values: readonly string[] = []): Value | null {
  switch (type) {
    case 'bool':
      return false;
    case 'int':
    case 'float':
      return 0;
    case 'string':
      return '';
    case 'enum':
      return values[0] ?? '';
    case 'entity':
    case 'list':
      return null;
  }
}

/** Fixes what a hand edit could break (wrong types, missing fields); unknown fields stay. */
export function normalizeVariable(raw: JsonObject): Variable | null {
  if (typeof raw.id !== 'string' || typeof raw.name !== 'string') return null;
  const type = VAR_TYPES.includes(raw.type as VarType)
    ? (raw.type as VarType)
    : raw.type === 'number'
      ? 'float'
      : 'string';
  const values = Array.isArray(raw.values) ? raw.values.filter((v): v is string => typeof v === 'string') : undefined;
  const scope: VarScope =
    isObject(raw.scope) && raw.scope.kind === 'graph' && typeof raw.scope.id === 'string'
      ? { kind: 'graph', id: raw.scope.id }
      : 'project';
  const owner =
    isObject(raw.owner) && raw.owner.kind === 'entity' && typeof raw.owner.id === 'string'
      ? { kind: 'entity' as const, id: raw.owner.id }
      : null;
  return {
    ...raw,
    id: raw.id,
    name: raw.name,
    type,
    initial: coerce(raw.initial, type, values),
    scope,
    owner,
    description: typeof raw.description === 'string' ? raw.description : '',
    ...(type === 'enum' ? { values: values ?? [] } : {}),
    ...(typeof raw.key === 'string' ? { key: raw.key } : {}),
    ...(raw.memory === 'game' || raw.memory === 'world' ? { memory: raw.memory } : {}),
  };
}

/** A value of the right shape for the type; anything else becomes the type's default. */
export function coerce(value: unknown, type: VarType, values: readonly string[] = []): Value | null {
  switch (type) {
    case 'bool':
      return typeof value === 'boolean' ? value : false;
    case 'int':
      return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : 0;
    case 'float':
      return typeof value === 'number' && Number.isFinite(value) ? value : 0;
    case 'string':
      return typeof value === 'string' ? value : '';
    case 'enum':
      return typeof value === 'string' && values.includes(value) ? value : (values[0] ?? '');
    case 'entity':
      return typeof value === 'string' ? value : null;
    case 'list':
      return null;
  }
}

/** Where the game keeps the variable: in the save unless it says otherwise. */
export const memoryOf = (v: Pick<Variable, 'memory'>): VarMemory => (v.memory === 'game' ? 'game' : 'world');

export function variablesFile(data: ProjectData): VariablesFile {
  const raw = data.variables as Partial<VariablesFile>;
  return {
    ...raw,
    variables: Array.isArray(raw.variables) ? raw.variables : [],
    labels: Array.isArray(raw.labels) ? raw.labels : [],
  };
}

export function listVariables(data: ProjectData): Variable[] {
  return variablesFile(data)
    .variables.map((v) => (isObject(v) ? normalizeVariable(v) : null))
    .filter((v): v is Variable => v !== null);
}

export function entityName(data: ProjectData, id: string): string | null {
  const e = data.entities[id];
  return e && typeof e.name === 'string' ? e.name : null;
}

/** The name as written in expressions: "доверие", or "Мира.доверие" for a variable of an entity. */
export function fullName(v: Variable, data: ProjectData): string {
  if (!v.owner) return v.name;
  const owner = entityName(data, v.owner.id);
  return owner ? `${ownerPrefix(owner)}.${v.name}` : v.name;
}

/** Entity names with spaces or punctuation become valid name parts: "Старый мельник" → "Старый_мельник". */
export function ownerPrefix(entity: string): string {
  const cleaned = entity
    .trim()
    .replace(/[^A-Za-zА-Яа-яЁё_0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return /^[0-9]/.test(cleaned) ? `_${cleaned}` : cleaned || '_';
}

export const valueTypeOf = (t: VarType): ValueType =>
  t === 'bool' ? 'bool' : t === 'int' || t === 'float' ? 'number' : 'string';

/** Chapter graphs a graph sits in, itself first: chapter variables are visible inside sub-chapters too. */
export function graphChain(data: ProjectData, graphId: string | null): string[] {
  const chain: string[] = [];
  const seen = new Set<string>();
  let current = graphId;
  while (current && !seen.has(current)) {
    seen.add(current);
    chain.push(current);
    const g = data.graphs[current] as unknown as GraphDoc | undefined;
    const parentNode = g?.parent?.kind === 'node' ? g.parent.id : null;
    current = parentNode ? graphOfNode(data, parentNode) : null;
  }
  return chain;
}

/** The graph that contains a node (chapter nodes link graphs into a tree). */
export function graphOfNode(data: ProjectData, nodeId: string): string | null {
  for (const [id, g] of Object.entries(data.graphs)) {
    if ((g as unknown as GraphDoc).nodes?.some((n) => n.id === nodeId)) return id;
  }
  return null;
}

/** Is the variable visible from this graph: project scope, or the graph is (inside) its chapter. */
export function visibleFrom(v: Variable, chain: readonly string[]): boolean {
  return v.scope === 'project' || chain.includes(v.scope.id);
}

export interface ScopedVariable extends RegistryEntry {
  variable: Variable;
}

/** Names visible from `graphId` (null: project variables only) and what they mean, for checks and play. */
export function registryFor(data: ProjectData, graphId: string | null): Map<string, ScopedVariable> {
  const chain = graphChain(data, graphId);
  const entities = Object.values(data.entities)
    .map((e) => (typeof e.name === 'string' ? e.name : ''))
    .filter(Boolean);
  const map = new Map<string, ScopedVariable>();
  // How close a scope is: the chapter itself, then the chapters around it, then the project.
  const depth = (v: Variable) => (v.scope === 'project' ? chain.length : chain.indexOf(v.scope.id));
  for (const v of listVariables(data)) {
    // Lists are not values of expressions: conditions ask непусто(имя), actions fill them.
    if (v.type === 'list' || !visibleFrom(v, chain)) continue;
    const name = fullName(v, data);
    // Names should not repeat where they are seen together (nameProblem); in a hand-edited file that does
    // happen, the closest scope wins, like a local variable shadowing an outer one.
    const seen = map.get(name);
    if (seen && depth(seen.variable) <= depth(v)) continue;
    const values = v.type === 'enum' ? (v.values ?? []) : v.type === 'entity' ? entities : undefined;
    map.set(name, { type: valueTypeOf(v.type), values, variable: v });
  }
  return map;
}

export const asRegistry = (m: Map<string, ScopedVariable>): Registry => m;

/** List variables visible from a graph, by the name written in непусто(…). */
export function listsFor(data: ProjectData, graphId: string | null): Map<string, Variable> {
  const chain = graphChain(data, graphId);
  const out = new Map<string, Variable>();
  for (const v of listVariables(data)) {
    if (v.type === 'list' && visibleFrom(v, chain)) out.set(fullName(v, data), v);
  }
  return out;
}

export type NameProblem = 'empty' | 'invalid' | 'taken';

/**
 * Checks a variable name before saving. Names must be unique among variables that can be seen together:
 * project variables with each other and with every chapter variable; chapter variables within a chapter
 * and the chapters nested in it.
 */
export function nameProblem(
  data: ProjectData,
  name: string,
  scope: VarScope,
  owner: Variable['owner'],
  exceptId?: string,
): NameProblem | null {
  const trimmed = name.trim();
  if (!trimmed) return 'empty';
  if (!isIdentifier(trimmed)) return 'invalid';
  const candidate: Variable = { id: '', name: trimmed, type: 'bool', initial: false, scope, owner, description: '' };
  const full = fullName(candidate, data).toLowerCase();
  const clash = listVariables(data).some((v) => {
    if (v.id === exceptId || fullName(v, data).toLowerCase() !== full) return false;
    if (v.scope === 'project' || scope === 'project') return true;
    const a = v.scope.id;
    const b = scope.id;
    return a === b || graphChain(data, a).includes(b) || graphChain(data, b).includes(a);
  });
  return clash ? 'taken' : null;
}

export function newVariable(name: string, type: VarType, scope: VarScope = 'project'): Variable {
  const values = type === 'enum' ? [] : undefined;
  return {
    id: newId(),
    name: name.trim(),
    type,
    initial: defaultInitial(type),
    scope,
    owner: null,
    description: '',
    ...(values ? { values } : {}),
  };
}

/**
 * A type guessed from how an unknown name is used, for "create this variable" right from an expression:
 * `x += 1` → int, `x = истина` → bool, `x == "a"` → string.
 */
export function guessType(source: string, name: string): VarType {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const around = new RegExp(`${esc}\\s*(\\+=|-=|==|!=|=|<=|>=|<|>)\\s*([^;\\n]*)`).exec(source);
  const before = new RegExp(`(==|!=|<=|>=|<|>)\\s*${esc}`).test(source);
  if (around) {
    const [, op, rhs] = around;
    if (op === '+=' || op === '-=' || op === '<' || op === '>' || op === '<=' || op === '>=') return 'int';
    const value = rhs.trim().toLowerCase();
    if (/^(истина|ложь|true|false)\b/.test(value)) return 'bool';
    if (/^-?\d+\.\d+/.test(value)) return 'float';
    if (/^-?\d/.test(value)) return 'int';
    if (/^["'«]/.test(value)) return 'string';
  }
  if (before) return 'int';
  return 'bool';
}

/** Display form of a value: "да", "3", "«рада»". */
export function valueText(value: Value | null | undefined, yes: string, no: string, none: string): string {
  if (value === null || value === undefined) return none;
  if (typeof value === 'boolean') return value ? yes : no;
  if (typeof value === 'string') return `«${value}»`;
  return String(value);
}
