// How letters move and the screen shakes in the game (0.8.1, "Редактор реплик" 7.5 and 7.7): functions of
// the time, so the preview shows the same frame whenever it is asked for (no animations started once).
// Offsets are in pixels of the game, rounded as the game does.

/** frac(|sin(n × 12.9898) × 43758.5453|). */
export function noise(n: number): number {
  const x = Math.abs(Math.sin(n * 12.9898) * 43758.5453);
  return x - Math.floor(x);
}

const frac = (x: number) => x - Math.floor(x);

function hsv(h: number, s: number, v: number): string {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const u = v * (1 - (1 - f) * s);
  const [r, g, b] = [
    [v, u, p],
    [q, v, p],
    [p, v, u],
    [p, q, v],
    [u, p, v],
    [v, p, q],
  ][((i % 6) + 6) % 6];
  const hex = (x: number) =>
    Math.round(Math.max(0, Math.min(1, x)) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

export interface LetterMove {
  dx: number;
  dy: number;
  /** A colour of its own (the rainbow), else none. */
  col?: string;
}

/**
 * Where a letter is drawn now: `i` its number in the line, `t` seconds from the start of the line, `age`
 * seconds since it appeared; `params` by effect id (preview.effects). Unknown effects do nothing.
 */
export function letterMove(
  fx: readonly string[],
  params: Readonly<Record<string, Readonly<Record<string, number>>>>,
  i: number,
  t: number,
  age: number,
): LetterMove {
  let dx = 0;
  let dy = 0;
  let col: string | undefined;
  for (const id of fx) {
    const p = params[id] ?? {};
    const n = (k: string, fallback: number) => (typeof p[k] === 'number' ? p[k] : fallback);
    switch (id) {
      case 'shake': {
        const k = Math.floor(t * n('rate', 22));
        dx += Math.round((noise(k * 131 + i * 17) * 2 - 1) * n('px', 1));
        dy += Math.round((noise(k * 57 + i * 43 + 5) * 2 - 1) * n('px', 1));
        break;
      }
      case 'wave':
        dy += Math.round(Math.sin(t * n('speed', 9) - i * n('step', 0.7)) * n('px', 2));
        break;
      case 'rainbow':
        col = hsv(frac(t * n('speed', 0.5) + i * n('step', 0.06)), n('sat', 170) / 255, n('val', 255) / 255);
        break;
      case 'punch': {
        const time = n('time', 0.1);
        if (age < time) dy -= Math.round((1 - age / time) * n('px', 3));
        break;
      }
      case 'sink':
        dy += Math.round(Math.min(1, age / n('time', 1.2)) * n('px', 2));
        break;
      case 'twitch': {
        const k = Math.floor(t * n('rate', 9));
        if (noise(k * 71 + i * 29) < n('chance', 0.08)) {
          dx += noise(k * 13 + i) < 0.5 ? -1 : 1;
          dy += noise(k * 7 + i * 3) < 0.5 ? -1 : 1;
        }
        break;
      }
    }
  }
  return col ? { dx, dy, col } : { dx, dy };
}

export interface ShakeEvent {
  time: number;
  strength: number;
}

/**
 * The screen's shake at a moment (7.7): for shake_time seconds after each event the frame is moved by a
 * random ±strength pixels, weaker towards the end; a new shake over a running one takes the larger strength.
 */
export function shakeAt(events: readonly ShakeEvent[], t: number, shakeTime: number): { dx: number; dy: number } {
  let s = 0;
  for (const e of events) {
    const age = t - e.time;
    if (age < 0 || age >= shakeTime || e.strength <= 0) continue;
    s = Math.max(s, e.strength * (1 - age / shakeTime));
  }
  if (s <= 0) return { dx: 0, dy: 0 };
  const k = Math.floor(t * 60);
  return {
    dx: Math.round((noise(k * 19 + 1) * 2 - 1) * s),
    dy: Math.round((noise(k * 7 + 3) * 2 - 1) * s),
  };
}
