// The game's palette (0.8): data/dialogue_palette.json in the project folder, written by the game side
// (Claude puts and updates it from the game's files). HErPlan only reads it, to offer its lists in the
// dialogue editor and to show a line as the game does. Without the file the fields are filled as plain text.
// Since 0.8.1 it also says who speaks in the game (speakers: colour, bubble, voice, faces), which actions the
// game knows, and everything the preview needs (preview: font, timings, effects, bubble, sprites); paths of
// pictures and sounds are from the data/ folder.

/** A picture inside a strip of frames: frame `frame` of `w` × `h` pixels. */
export interface PaletteIcon {
  image: string;
  frame: number;
  w: number;
  h: number;
}

export interface PaletteEntry {
  /** Goes into the dialogue file. */
  id: string;
  /** What the author sees. */
  name: string;
  color?: string;
  hint?: string;
  /** Emotes: the icon. */
  icon?: PaletteIcon;
  /** Voices and sounds: the file, from data/. */
  sound?: string;
}

/** Someone who speaks in the game, by the "name in the game" of a card. */
export interface PaletteSpeaker {
  id: string;
  name: string;
  color?: string;
  bubble?: string;
  voice?: string;
  /** Faces drawn for them; empty: none. */
  faces: string[];
}

export type ActionRef = 'item' | 'character' | 'variable' | 'text';

/** A game action the palette knows; `ref`: what it refers to (none for "save"). */
export interface PaletteAction {
  id: string;
  name: string;
  ref: ActionRef | null;
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

// ---------- preview: how the game shows a line ----------

/** What a style does to the letters it covers (preview.styles[].props); only what is set. */
export interface LetterLook {
  col?: string;
  size?: number;
  bold?: boolean;
  fx?: string[];
  cps?: number;
  speed?: number;
  reveal?: string;
  shake?: number;
  voice_pitch?: number;
  voice_gain?: number;
  face?: string;
}

export interface PreviewSpeaker {
  id: string;
  color?: string;
  bubble?: string;
  voice?: string;
  voice_pitch: number;
  /** Face id → strip of frames (path from data/). */
  faces: Record<string, string>;
  under?: string;
  frame_w?: number;
  frame_h?: number;
  frames?: number;
  fps?: number;
  /** The top of the head from the sprite's top-left corner. */
  head?: [number, number];
  narrator?: boolean;
}

export interface PreviewFont {
  image: string;
  cell_h: number;
  line_h: number;
  cap_top: number;
  cap_h: number;
  chars: string;
  xs: number[];
  ws: number[];
}

export interface PalettePreview {
  font: PreviewFont | null;
  text: {
    color: string;
    width: number;
    cps: number;
    pause_stop: number;
    pause_comma: number;
    interrupt_window: number;
    shake_time: number;
    blip_gap: number;
    blip_spread: number;
  };
  styles: Record<string, LetterLook>;
  effects: Record<string, Record<string, number>>;
  gestures: Record<string, { time: number; px: number }>;
  emote: { time: number; pop: number; hop: number; fade: number; dx: number; dy: number; origin: [number, number] };
  speakers: PreviewSpeaker[];
  /** The rest (bubble, debris…), kept as written for the scene of the next steps. */
  raw: Record<string, unknown>;
}

/** The numbers of the game as of 11.11.2026, for a project without a palette (or a palette without them). */
export const DEFAULT_TEXT: PalettePreview['text'] = {
  color: '#e8e6de',
  width: 190,
  cps: 32,
  pause_stop: 0.28,
  pause_comma: 0.12,
  interrupt_window: 3,
  shake_time: 0.14,
  blip_gap: 0.055,
  blip_spread: 0.16,
};

export interface Palette extends Record<PaletteList, PaletteEntry[]> {
  /** The file was there and read: values are picked from the lists, not typed. */
  loaded: boolean;
  speakers: PaletteSpeaker[];
  actions: PaletteAction[];
  preview: PalettePreview | null;
}

export const PALETTE_FILE = 'data/dialogue_palette.json';

export function emptyPalette(): Palette {
  return {
    ...(Object.fromEntries(PALETTE_LISTS.map((k) => [k, []])) as unknown as Record<PaletteList, PaletteEntry[]>),
    loaded: false,
    speakers: [],
    actions: [],
    preview: null,
  };
}

export const EMPTY_PALETTE: Palette = emptyPalette();

type Raw = Record<string, unknown>;
const isObject = (v: unknown): v is Raw => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x) : [];

function icon(raw: unknown): PaletteIcon | undefined {
  if (!isObject(raw) || !str(raw.image)) return undefined;
  return { image: raw.image as string, frame: num(raw.frame, 0), w: num(raw.w, 16), h: num(raw.h, 16) };
}

function entry(raw: unknown): PaletteEntry | null {
  // A bare id is a list of names as they are.
  if (typeof raw === 'string') return raw ? { id: raw, name: raw } : null;
  if (!isObject(raw)) return null;
  const id = str(raw.id);
  if (!id) return null;
  const out: PaletteEntry = { id, name: str(raw.name) ?? id };
  if (str(raw.color)) out.color = raw.color as string;
  if (str(raw.hint)) out.hint = raw.hint as string;
  const ic = icon(raw.icon);
  if (ic) out.icon = ic;
  if (str(raw.sound)) out.sound = raw.sound as string;
  return out;
}

function unique<T extends { id: string }>(list: T[]): T[] {
  const seen = new Set<string>();
  return list.filter((x) => !seen.has(x.id) && !!seen.add(x.id));
}

const REFS: readonly string[] = ['item', 'character', 'variable', 'text'];

function look(raw: unknown): LetterLook {
  if (!isObject(raw)) return {};
  const out: LetterLook = {};
  if (str(raw.col)) out.col = raw.col as string;
  if (typeof raw.size === 'number') out.size = raw.size;
  if (typeof raw.bold === 'boolean') out.bold = raw.bold;
  if (Array.isArray(raw.fx)) out.fx = strings(raw.fx);
  for (const k of ['cps', 'speed', 'shake', 'voice_pitch', 'voice_gain'] as const) {
    if (typeof raw[k] === 'number' && Number.isFinite(raw[k])) out[k] = raw[k] as number;
  }
  if (str(raw.reveal)) out.reveal = raw.reveal as string;
  if (str(raw.face)) out.face = raw.face as string;
  return out;
}

function byId<T>(list: unknown, read: (o: Raw) => T): Record<string, T> {
  const out: Record<string, T> = {};
  for (const o of Array.isArray(list) ? list : []) if (isObject(o) && str(o.id)) out[o.id as string] = read(o);
  return out;
}

function pair(v: unknown, fallback: [number, number]): [number, number] {
  return Array.isArray(v) && v.length >= 2 ? [num(v[0], fallback[0]), num(v[1], fallback[1])] : fallback;
}

function preview(raw: unknown): PalettePreview | null {
  if (!isObject(raw)) return null;
  const t = isObject(raw.text) ? raw.text : {};
  const f = isObject(raw.font) ? raw.font : null;
  const font: PreviewFont | null =
    f && str(f.image) && typeof f.chars === 'string' && Array.isArray(f.xs) && Array.isArray(f.ws)
      ? {
          image: f.image as string,
          cell_h: num(f.cell_h, 11),
          line_h: num(f.line_h, 11),
          cap_top: num(f.cap_top, 2),
          cap_h: num(f.cap_h, 7),
          chars: f.chars,
          xs: f.xs.map((x) => num(x, 0)),
          ws: f.ws.map((x) => num(x, 0)),
        }
      : null;
  const e = isObject(raw.emote) ? raw.emote : {};
  return {
    font,
    text: {
      color: str(t.color) ?? DEFAULT_TEXT.color,
      width: num(t.width, DEFAULT_TEXT.width),
      cps: num(t.cps, DEFAULT_TEXT.cps),
      pause_stop: num(t.pause_stop, DEFAULT_TEXT.pause_stop),
      pause_comma: num(t.pause_comma, DEFAULT_TEXT.pause_comma),
      interrupt_window: num(t.interrupt_window, DEFAULT_TEXT.interrupt_window),
      shake_time: num(t.shake_time, DEFAULT_TEXT.shake_time),
      blip_gap: num(t.blip_gap, DEFAULT_TEXT.blip_gap),
      blip_spread: num(t.blip_spread, DEFAULT_TEXT.blip_spread),
    },
    styles: byId(raw.styles, (o) => look(o.props)),
    effects: byId(raw.effects, (o) =>
      Object.fromEntries(
        Object.entries(isObject(o.params) ? o.params : {}).filter(
          (x): x is [string, number] => typeof x[1] === 'number',
        ),
      ),
    ),
    gestures: byId(raw.gestures, (o) => ({ time: num(o.time, 0.4), px: num(o.px, 2) })),
    emote: {
      time: num(e.time, 1.5),
      pop: num(e.pop, 0.16),
      hop: num(e.hop, 3),
      fade: num(e.fade, 0.25),
      dx: num(e.dx, 13),
      dy: num(e.dy, 11),
      origin: pair(e.origin, [6, 12]),
    },
    speakers: (Array.isArray(raw.speakers) ? raw.speakers : []).filter(isObject).flatMap((o): PreviewSpeaker[] => {
      const id = str(o.id);
      if (!id) return [];
      const faces = isObject(o.faces)
        ? Object.fromEntries(Object.entries(o.faces).filter((x): x is [string, string] => typeof x[1] === 'string'))
        : {};
      return [
        {
          id,
          color: str(o.color),
          bubble: str(o.bubble),
          voice: str(o.voice),
          voice_pitch: num(o.voice_pitch, 1),
          faces,
          under: str(o.under),
          frame_w: typeof o.frame_w === 'number' ? o.frame_w : undefined,
          frame_h: typeof o.frame_h === 'number' ? o.frame_h : undefined,
          frames: typeof o.frames === 'number' ? o.frames : undefined,
          fps: typeof o.fps === 'number' ? o.fps : undefined,
          head: Array.isArray(o.head) ? pair(o.head, [0, 0]) : undefined,
          narrator: o.narrator === true || undefined,
        },
      ];
    }),
    raw,
  };
}

/** The palette read from the file's text; a missing or broken file gives empty lists (`ok` false when broken). */
export function parsePalette(text: string | null): { palette: Palette; ok: boolean } {
  const palette = emptyPalette();
  if (text === null) return { palette, ok: true };
  let raw: unknown;
  try {
    // The game side may write a byte-order mark.
    raw = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    return { palette, ok: false };
  }
  if (!isObject(raw)) return { palette, ok: false };
  palette.loaded = true;
  for (const list of PALETTE_LISTS) {
    const items = raw[list];
    if (!Array.isArray(items)) continue;
    palette[list] = unique(items.map(entry).filter((e): e is PaletteEntry => e !== null));
  }
  palette.speakers = unique(
    (Array.isArray(raw.speakers) ? raw.speakers : []).filter(isObject).flatMap((o): PaletteSpeaker[] => {
      const id = str(o.id);
      return id
        ? [
            {
              id,
              name: str(o.name) ?? id,
              color: str(o.color),
              bubble: str(o.bubble),
              voice: str(o.voice),
              faces: strings(o.faces),
            },
          ]
        : [];
    }),
  );
  palette.actions = unique(
    (Array.isArray(raw.actions) ? raw.actions : []).filter(isObject).flatMap((o): PaletteAction[] => {
      const id = str(o.id);
      if (!id) return [];
      const ref = typeof o.ref === 'string' && REFS.includes(o.ref) ? (o.ref as ActionRef) : null;
      return [{ id, name: str(o.name) ?? id, ref, ...(str(o.hint) ? { hint: o.hint as string } : {}) }];
    }),
  );
  palette.preview = preview(raw.preview);
  return { palette, ok: true };
}

export function paletteEntry(palette: Palette, list: PaletteList, id: string | undefined | null): PaletteEntry | null {
  return id ? (palette[list].find((e) => e.id === id) ?? null) : null;
}

/** What the author sees for an id: its name in the palette, else the id itself. */
export function paletteName(palette: Palette, list: PaletteList, id: string | undefined | null): string {
  return paletteEntry(palette, list, id)?.name ?? id ?? '';
}

/**
 * Is an id unknown to the game: the palette was read and its list does not have it. A list the palette has
 * not got at all (or no palette) blames nothing.
 */
export function notInPalette(palette: Palette, list: PaletteList, id: string | undefined | null): boolean {
  return !!id && palette[list].length > 0 && !palette[list].some((e) => e.id === id);
}

/** The game's speaker a card stands for, by its "name in the game". */
export function paletteSpeaker(palette: Palette, key: string | null | undefined): PaletteSpeaker | null {
  return key ? (palette.speakers.find((s) => s.id === key) ?? null) : null;
}

/** What the actions HErPlan knew before the palette had a list of them refer to. */
const BUILT_IN_REFS: Record<string, ActionRef | null> = {
  give_item: 'item',
  take_item: 'item',
  hire: 'character',
  dismiss: 'character',
  list_add: 'variable',
  give_list: 'variable',
  save: null,
  event: 'text',
  start_quest: 'text',
};

/**
 * What an action refers to: by the palette's list of actions when it has one, else by HErPlan's own;
 * undefined when the game does not know the action.
 */
export function actionRef(palette: Palette, type: string): ActionRef | null | undefined {
  if (palette.actions.length) {
    const a = palette.actions.find((x) => x.id === type);
    return a ? a.ref : undefined;
  }
  return type in BUILT_IN_REFS ? BUILT_IN_REFS[type] : undefined;
}

/** The narrator's id in dialogue files (0.8.1): "speaker": "narrator"; null is "not chosen yet". */
export const NARRATOR = 'narrator';
