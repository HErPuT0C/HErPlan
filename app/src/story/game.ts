// What the dialogue editor knows about the game (0.8) besides the story itself: the card fields the game
// reads (name in the game, bubble, voice, faces), what есть(), нанят(), видел() and непусто() may name, and
// the text of a line as the player sees it.

import type { GraphDoc } from '../canvas/model';
import type { JsonObject, ProjectData } from '../core/project/types';
import { listEntities } from './entities';
import type { CallName, CallWorld } from './expr';
import { allGraphs, asStory } from './model';
import { textPieces } from './textEffects';
import { listsFor } from './variables';

/** What a character's or an item's card says to the game; kept in the entity file beside its name. */
export interface EntityGame {
  /** Name in the game ("skeleton", "ring_first"). */
  key: string;
  /** Character: the shape of the speech bubble, the voice (palette ids) and its pitch (1: as recorded). */
  bubble: string;
  voice: string;
  pitch: number | null;
  /** Character: the faces drawn for them (palette ids); empty: not said. */
  faces: string[];
}

export function entityGame(raw: JsonObject | { [k: string]: unknown } | undefined | null): EntityGame {
  const s = (v: unknown) => (typeof v === 'string' ? v : '');
  return {
    key: s(raw?.key),
    bubble: s(raw?.bubble),
    voice: s(raw?.voice),
    pitch: typeof raw?.pitch === 'number' && Number.isFinite(raw.pitch) ? raw.pitch : null,
    faces: Array.isArray(raw?.faces) ? raw.faces.filter((f): f is string => typeof f === 'string' && !!f) : [],
  };
}

/** Sets a game field of an entity (inside a Store recipe); empty values are not kept in the file. */
export function setEntityGame(entity: { [k: string]: unknown }, patch: Partial<EntityGame>): void {
  for (const [key, value] of Object.entries(patch)) {
    const empty = value === '' || value === null || value === undefined || (Array.isArray(value) && !value.length);
    if (empty) delete entity[key];
    else entity[key] = value;
  }
}

/** The line as the player reads it: without the effects written in braces. */
export function visibleText(text: string): string {
  const cuts = textPieces(text).effects.filter((e) => e.braced);
  if (!cuts.length) return text;
  let out = text;
  for (const c of [...cuts].sort((a, b) => b.start - a.start)) out = out.slice(0, c.start) + out.slice(c.end);
  return out.replace(/[ \t]{2,}/g, ' ').trim();
}

/** Characters of the line the player reads (the counter "N / 100"). */
export const visibleLength = (text: string): number => [...visibleText(text)].length;

export interface SpokenPart {
  graph: string;
  node: string;
  id: string;
  kind: 'line' | 'option';
  text: string;
}

/** Every dialogue line and choice option of the project by id: what видел(id) may name. */
export function spokenParts(data: ProjectData): Map<string, SpokenPart> {
  const out = new Map<string, SpokenPart>();
  for (const g of allGraphs(data)) partsOf(g, out);
  return out;
}

function partsOf(g: GraphDoc, out: Map<string, SpokenPart>): void {
  for (const raw of g.nodes ?? []) {
    const n = asStory(raw);
    for (const l of n.lines ?? []) out.set(l.id, { graph: g.id, node: n.id, id: l.id, kind: 'line', text: l.text });
    for (const o of n.options ?? []) {
      out.set(o.id, { graph: g.id, node: n.id, id: o.id, kind: 'option', text: o.text });
    }
  }
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** The entity of a kind ("item", "character") with this name, as есть() and нанят() write it. */
export function entityByName(data: ProjectData, kind: 'item' | 'character', name: string): string | null {
  return listEntities(data, kind).find((e) => same(e.name, name))?.id ?? null;
}

/**
 * What a question to the game names, as an id: the item, the character, the line or option, the list
 * variable; null when there is no such thing.
 */
export function resolveCall(
  data: ProjectData,
  graphId: string | null,
  fn: CallName,
  arg: string,
  parts?: ReadonlyMap<string, SpokenPart>,
): string | null {
  switch (fn) {
    case 'has':
      return entityByName(data, 'item', arg);
    case 'hired':
      return entityByName(data, 'character', arg);
    case 'seen':
      return (parts ?? spokenParts(data)).has(arg) ? arg : null;
    case 'notEmpty':
      return listsFor(data, graphId).get(arg)?.id ?? null;
  }
}

/** For checks: are the names in есть(), нанят(), видел() and непусто() known, as seen from a graph. */
export function callWorld(data: ProjectData, graphId: string | null): CallWorld {
  let parts: Map<string, SpokenPart> | null = null;
  return (fn, arg) =>
    resolveCall(data, graphId, fn, arg, fn === 'seen' ? (parts ??= spokenParts(data)) : undefined) !== null;
}
