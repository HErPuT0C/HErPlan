// "Name in the game" (0.8): the Latin name a conversation, a character, an item or a variable has in the
// game's own files ("skeleton_talk"). HErPlan only keeps it; the button "suggest a name" makes one from the
// title by transliteration.

import type { GraphDoc } from '../canvas/model';
import type { JsonObject, ProjectData } from '../core/project/types';

const RU: Record<string, string> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  ё: 'yo',
  ж: 'zh',
  з: 'z',
  и: 'i',
  й: 'y',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'h',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'sch',
  ъ: '',
  ы: 'y',
  ь: '',
  э: 'e',
  ю: 'yu',
  я: 'ya',
};

/** A valid name in the game: Latin letters, digits and "_", starting with a letter. */
export function isGameKey(key: string): boolean {
  return /^[a-z][a-z0-9_]*$/.test(key);
}

/** "Разговор со скелетом" → "razgovor_so_skeletom"; empty when the title has nothing to make a name of. */
export function suggestKey(title: string): string {
  const latin = [...title.toLowerCase()].map((c) => RU[c] ?? c).join('');
  const key = latin
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return /^[0-9]/.test(key) ? `n_${key}` : key;
}

/** A suggested name that nothing in `taken` has: "ring", "ring_2", "ring_3"… */
export function freeKey(title: string, taken: Iterable<string>): string {
  const base = suggestKey(title);
  if (!base) return '';
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) if (!used.has(`${base}_${n}`)) return `${base}_${n}`;
}

export const keyOf = (o: { key?: unknown } | JsonObject | undefined | null): string =>
  o && typeof o.key === 'string' ? o.key : '';

/** The name of a graph in the game. */
export const graphKey = (g: GraphDoc | undefined): string => keyOf(g as { key?: unknown } | undefined);

/** Names taken among graphs, entities or variables: a name must not repeat inside its own kind. */
export function takenKeys(data: ProjectData, among: 'graphs' | 'entities' | 'variables', exceptId?: string): string[] {
  const list: { id?: unknown; key?: unknown }[] =
    among === 'variables'
      ? (((data.variables as { variables?: unknown }).variables as { id?: unknown; key?: unknown }[] | undefined) ?? [])
      : (Object.values(data[among]) as { id?: unknown; key?: unknown }[]);
  return list.filter((o) => o && o.id !== exceptId && typeof o.key === 'string' && o.key).map((o) => o.key as string);
}

export type KeyProblem = 'invalid' | 'taken';

/** What is wrong with a name typed by hand (blank is fine: no name yet). */
export function keyProblem(
  data: ProjectData,
  among: 'graphs' | 'entities' | 'variables',
  key: string,
  exceptId?: string,
): KeyProblem | null {
  if (!key) return null;
  if (!isGameKey(key)) return 'invalid';
  return takenKeys(data, among, exceptId).includes(key) ? 'taken' : null;
}
