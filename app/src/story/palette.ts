// The game's palette (0.8): data/dialogue_palette.json in the project folder, written by the game side
// (Claude puts and updates it). HErPlan only reads it, to offer its lists in the dialogue editor; without
// the file every list is empty and the fields are filled as plain text.

export interface PaletteEntry {
  /** Goes into the dialogue file. */
  id: string;
  /** What the author sees. */
  name: string;
  color?: string;
  hint?: string;
}

export const PALETTE_LISTS = [
  'styles',
  'sizes',
  'reveals',
  'effects',
  'bubbles',
  'faces',
  'gestures',
  'emotes',
  'voices',
  'sounds',
] as const;
export type PaletteList = (typeof PALETTE_LISTS)[number];

export type Palette = Record<PaletteList, PaletteEntry[]>;

export const PALETTE_FILE = 'data/dialogue_palette.json';

export function emptyPalette(): Palette {
  return Object.fromEntries(PALETTE_LISTS.map((k) => [k, []])) as unknown as Palette;
}

export const EMPTY_PALETTE: Palette = emptyPalette();

function entry(raw: unknown): PaletteEntry | null {
  // A bare id is a list of names as they are.
  if (typeof raw === 'string') return raw ? { id: raw, name: raw } : null;
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== 'string' || !o.id) return null;
  return {
    id: o.id,
    name: typeof o.name === 'string' && o.name ? o.name : o.id,
    ...(typeof o.color === 'string' && o.color ? { color: o.color } : {}),
    ...(typeof o.hint === 'string' && o.hint ? { hint: o.hint } : {}),
  };
}

/** The palette read from the file's text; a missing or broken file gives empty lists (`ok` false when broken). */
export function parsePalette(text: string | null): { palette: Palette; ok: boolean } {
  const palette = emptyPalette();
  if (text === null) return { palette, ok: true };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { palette, ok: false };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { palette, ok: false };
  for (const list of PALETTE_LISTS) {
    const items = (raw as Record<string, unknown>)[list];
    if (!Array.isArray(items)) continue;
    const seen = new Set<string>();
    for (const item of items) {
      const e = entry(item);
      if (e && !seen.has(e.id)) {
        seen.add(e.id);
        palette[list].push(e);
      }
    }
  }
  return { palette, ok: true };
}

export function paletteEntry(palette: Palette, list: PaletteList, id: string | undefined | null): PaletteEntry | null {
  return id ? (palette[list].find((e) => e.id === id) ?? null) : null;
}

/** What the author sees for an id: its name in the palette, else the id itself. */
export function paletteName(palette: Palette, list: PaletteList, id: string | undefined | null): string {
  return paletteEntry(palette, list, id)?.name ?? id ?? '';
}

/** Is an id unknown to a list that has entries (an empty list knows nothing and blames nothing). */
export function notInPalette(palette: Palette, list: PaletteList, id: string | undefined | null): boolean {
  return !!id && palette[list].length > 0 && !palette[list].some((e) => e.id === id);
}
