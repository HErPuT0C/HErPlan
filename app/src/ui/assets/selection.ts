// Several files and folders of the assets picked at once (0.7.5), as in the Windows explorer: a click picks
// one, Ctrl+click adds or takes away one, Shift+click picks a run from the last one clicked; the arrows move,
// Shift or Ctrl with them stretch the run; a frame drawn with the mouse picks what it touches.

export interface Picked {
  /** Paths picked, in the order they are shown. */
  paths: string[];
  /** Where a run starts (the last one clicked without Shift). */
  anchor: string | null;
  /** Where the keyboard is. */
  focus: string | null;
}

export const NONE: Picked = { paths: [], anchor: null, focus: null };

/** The paths between two of `order`, both included, in the order shown. */
function run(order: readonly string[], a: string, b: string): string[] {
  const i = order.indexOf(a);
  const j = order.indexOf(b);
  if (i < 0 || j < 0) return [b];
  return order.slice(Math.min(i, j), Math.max(i, j) + 1);
}

const inOrder = (order: readonly string[], paths: Iterable<string>) => {
  const set = new Set(paths);
  return order.filter((p) => set.has(p));
};

export function clickPick(
  order: readonly string[],
  state: Picked,
  path: string,
  keys: { ctrl: boolean; shift: boolean },
): Picked {
  if (keys.shift && state.anchor && order.includes(state.anchor)) {
    const range = run(order, state.anchor, path);
    return {
      paths: keys.ctrl ? inOrder(order, [...state.paths, ...range]) : range,
      anchor: state.anchor,
      focus: path,
    };
  }
  if (keys.ctrl) {
    const has = state.paths.includes(path);
    return {
      paths: has ? state.paths.filter((p) => p !== path) : inOrder(order, [...state.paths, path]),
      anchor: path,
      focus: path,
    };
  }
  return { paths: [path], anchor: path, focus: path };
}

/**
 * The keyboard: the focus moves by `step` (±1 across, ± the number of columns up and down); with `stretch`
 * (Shift or Ctrl held) the run goes from the anchor to the new place, otherwise the new place alone is picked.
 */
export function keyPick(order: readonly string[], state: Picked, step: number, stretch: boolean): Picked {
  if (!order.length) return NONE;
  const at = state.focus ? order.indexOf(state.focus) : -1;
  const next = order[at < 0 ? (step > 0 ? 0 : order.length - 1) : Math.max(0, Math.min(order.length - 1, at + step))];
  if (!stretch) return { paths: [next], anchor: next, focus: next };
  const anchor = state.anchor && order.includes(state.anchor) ? state.anchor : (state.focus ?? next);
  return { paths: run(order, anchor, next), anchor, focus: next };
}

export const pickAll = (order: readonly string[]): Picked => ({
  paths: [...order],
  anchor: order[0] ?? null,
  focus: order.at(-1) ?? null,
});

/** A frame drawn with the mouse: what it touches, added to what was picked before when Ctrl is held. */
export function framePick(order: readonly string[], before: Picked, touched: string[], add: boolean): Picked {
  const paths = inOrder(order, add ? [...before.paths, ...touched] : touched);
  return { paths, anchor: paths[0] ?? null, focus: paths.at(-1) ?? null };
}

/** What stays picked when the shown list changes (another folder, a search): only what is still shown. */
export function keepShown(order: readonly string[], state: Picked): Picked {
  const paths = inOrder(order, state.paths);
  if (paths.length === state.paths.length) return state;
  return {
    paths,
    anchor: state.anchor && order.includes(state.anchor) ? state.anchor : null,
    focus: state.focus && order.includes(state.focus) ? state.focus : null,
  };
}
