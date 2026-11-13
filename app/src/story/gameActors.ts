// The people of the scene as the game moves them (0.8.4, "Редактор реплик" 7.9 and 7.10): gestures by the
// game's formulas, emotes that pop up, hang and fade, faces, and an interrupted line whose letters break off
// and fall. Pure: everything is a function of the time t from the start of the line, in pixels of the game.

import { noise } from './gameFx';
import type { GameLine } from './gameLine';
import { toward, type DialogueLine, type TowardValue } from './model';
import type { PalettePreview } from './palette';

export interface Offset {
  dx: number;
  dy: number;
}

/**
 * Where a gesture puts its maker (7.9), `t` seconds after it began; `side` is 1 or −1 (the owner: the one
 * spoken to stands on the right, side = 1). Outside its time a gesture does nothing — but "droop", which holds.
 */
export function gestureMove(id: string, g: { time: number; px: number } | undefined, t: number, side: number): Offset {
  if (!g || t < 0) return { dx: 0, dy: 0 };
  const { time, px } = g;
  if (id === 'droop') return { dx: 0, dy: Math.round(Math.min(1, t / 0.3) * px) };
  if (time <= 0 || t > time) return { dx: 0, dy: 0 };
  const k = t / time;
  let dx = 0;
  let dy = 0;
  switch (id) {
    case 'jump':
      dy = -Math.sin(Math.PI * k) * px;
      break;
    case 'shake':
      dx = (Math.floor(t * 30) % 2 === 0 ? 1 : -1) * px;
      break;
    case 'recoil':
      dx = side * px * (1 - k) ** 2;
      break;
    case 'nod':
      dy = Math.abs(Math.sin(2 * Math.PI * k)) * px;
      break;
    case 'lean':
      dx = -side * Math.sin(Math.PI * k) * px;
      break;
    case 'laugh':
      dy = -Math.abs(Math.sin(3 * Math.PI * k)) * px;
      break;
  }
  return { dx: Math.round(dx) || 0, dy: Math.round(dy) || 0 };
}

/**
 * An emote `age` seconds after it came (7.9): it pops up in `pop` seconds with a hop of `hop` pixels
 * (sin(part × π) × hop), hangs `time` seconds and fades in the last `fade` of them. Null once it is gone.
 */
export function emoteLook(age: number, e: PalettePreview['emote']): { up: number; alpha: number } | null {
  if (age < 0 || age >= e.time) return null;
  const up = age < e.pop ? Math.round(Math.sin((age / e.pop) * Math.PI) * e.hop) : 0;
  const alpha = e.fade > 0 && age > e.time - e.fade ? Math.max(0, (e.time - age) / e.fade) : 1;
  return { up, alpha };
}

/** Something one of the people does during a line: a gesture, an emote, a face (a face for someone else). */
export interface ActorEvent {
  time: number;
  kind: 'gesture' | 'emote' | 'face';
  id: string;
  /** Who does it: the speaker, or the one it is for. */
  who: string;
}

/** What the people do in a line: the fields hold from its start, the cues happen where the typing reaches them. */
export function actorEvents(line: DialogueLine, gl: GameLine): ActorEvent[] {
  const speaker = line.speaker ?? '';
  const out: ActorEvent[] = [];
  const add = (time: number, kind: ActorEvent['kind'], v: TowardValue | undefined, own: boolean) => {
    const x = toward(v);
    // The speaker's own face is the line's (faceAt); a face for someone else is theirs.
    if (!x || (kind === 'face' && own && !x.to)) return;
    out.push({ time, kind, id: x.id, who: x.to ?? speaker });
  };
  add(0, 'gesture', line.gesture, true);
  add(0, 'emote', line.emote, true);
  for (const c of gl.cues) {
    add(c.time, 'gesture', c.props.gesture, true);
    add(c.time, 'emote', c.props.emote, true);
    add(c.time, 'face', c.props.face, true);
  }
  return out.sort((a, b) => a.time - b.time);
}

/** Who the speaker speaks to (on the right of the scene): the one a field or cue is for, else the nearest other. */
export function listenerOf(lines: readonly DialogueLine[], index: number, gl: GameLine): string | null {
  const line = lines[index];
  if (!line) return null;
  const speaker = line.speaker;
  const named = actorEvents(line, gl).find((e) => e.who && e.who !== speaker)?.who;
  if (named) return named;
  const other = (l: DialogueLine | undefined) =>
    l?.speaker && l.speaker !== speaker && l.speaker !== 'narrator' ? l.speaker : null;
  for (let k = index - 1; k >= 0; k--) if (other(lines[k])) return other(lines[k]);
  for (let k = index + 1; k < lines.length; k++) if (other(lines[k])) return other(lines[k]);
  return null;
}

/** Where someone is now and what is over their head: their gestures added up, their latest emote. */
export function actorAt(
  events: readonly ActorEvent[],
  who: string,
  t: number,
  preview: Pick<PalettePreview, 'gestures' | 'emote'>,
  side: number,
): Offset & { emote: { id: string; up: number; alpha: number } | null; face: string | null } {
  let dx = 0;
  let dy = 0;
  let emote: { id: string; up: number; alpha: number } | null = null;
  let face: string | null = null;
  for (const e of events) {
    if (e.who !== who || e.time > t) continue;
    if (e.kind === 'gesture') {
      const m = gestureMove(e.id, preview.gestures[e.id], t - e.time, side);
      dx += m.dx;
      dy += m.dy;
    } else if (e.kind === 'emote') {
      const look = emoteLook(t - e.time, preview.emote);
      emote = look ? { id: e.id, ...look } : null;
    } else face = e.id;
  }
  return { dx, dy, emote, face };
}

export interface Debris {
  vx: number;
  up: number;
  gravity: number;
  life: number;
}

export const DEFAULT_DEBRIS: Debris = { vx: 46, up: 70, gravity: 520, life: 0.75 };

/** The numbers of an interrupted line from the palette (preview.debris), else the game's as of 11.11.2026. */
export function debrisOf(raw: Record<string, unknown> | undefined): Debris {
  const d = raw && typeof raw.debris === 'object' && raw.debris ? (raw.debris as Record<string, unknown>) : {};
  const num = (v: unknown, f: number) => (typeof v === 'number' && Number.isFinite(v) ? v : f);
  return {
    vx: num(d.vx, DEFAULT_DEBRIS.vx),
    up: num(d.up, DEFAULT_DEBRIS.up),
    gravity: num(d.gravity, DEFAULT_DEBRIS.gravity),
    life: num(d.life, DEFAULT_DEBRIS.life),
  };
}

/**
 * A letter of an interrupted line (7.10), `dt` seconds after the break: it flies off at a random speed
 * within ±vx, up at 0.2…1 × up, falls with `gravity`, lives life × 0.7…1.2 seconds and fades (in the second
 * half of its life). The randomness is the letter's own (by its number), so the same frame looks the same.
 * Null once it is gone.
 */
export function debrisAt(i: number, dt: number, d: Debris): (Offset & { alpha: number }) | null {
  const life = d.life * (0.7 + 0.5 * noise(i * 7 + 3));
  if (dt < 0 || dt >= life) return dt < 0 ? { dx: 0, dy: 0, alpha: 1 } : null;
  const vx = (noise(i * 31 + 1) * 2 - 1) * d.vx;
  const up = (0.2 + 0.8 * noise(i * 17 + 2)) * d.up;
  return {
    dx: Math.round(vx * dt),
    dy: Math.round(-up * dt + 0.5 * d.gravity * dt * dt),
    alpha: Math.min(1, 2 * (1 - dt / life)),
  };
}

/** When the last letter of an interrupted line is gone: the longest life there is. */
export function debrisEnd(d: Debris): number {
  return d.life * 1.2;
}
