import type { CanvasEngine } from '../../canvas/engine';
import type { GraphDoc } from '../../canvas/model';
import { HANDLE_DIRS, type HandleDir } from '../../canvas/ops';
import type { ProjectData } from '../../core/project/types';
import type { Store } from '../../core/store';
import { useAtom, useStore } from '../../core/useStore';

/** Where each handle sits on the frame, as fractions of its width and height. */
const AT: Record<HandleDir, [number, number]> = {
  nw: [0, 0],
  n: [0.5, 0],
  ne: [1, 0],
  e: [1, 0.5],
  se: [1, 1],
  s: [0.5, 1],
  sw: [0, 1],
  w: [0, 0.5],
};

/** At most this many selected frames get handles: beyond that they only clutter the view. */
const MAX_FRAMES = 8;

/**
 * Eight resize handles around each selected frame, like a picture in a word processor. Drawn in screen
 * space so they keep their size at any zoom; the engine picks them up by their data attributes.
 */
export function FrameHandles({
  engine,
  store,
  graphId,
  readOnly,
}: {
  engine: CanvasEngine;
  store: Store<ProjectData>;
  graphId: string;
  readOnly: boolean;
}) {
  const view = useAtom(engine.view);
  const selection = useAtom(engine.selection);
  const resizing = useAtom(engine.resizing);
  const drag = useAtom(engine.drag);
  const graph = useStore(store, (s) => s.graphs[graphId] as unknown as GraphDoc | undefined);
  if (readOnly || !graph || selection.groups.size === 0 || drag) return null;
  const { camera } = view;
  const frames = graph.groups.filter((g) => selection.groups.has(g.id)).slice(0, MAX_FRAMES);
  return (
    <div className="canvas-handles">
      {frames.flatMap((group) => {
        const r = resizing?.kind === 'group' && resizing.id === group.id ? resizing : group;
        return HANDLE_DIRS.map((dir) => {
          const [fx, fy] = AT[dir];
          const left = (r.x + r.w * fx) * camera.scale + camera.x;
          const top = (r.y + r.h * fy) * camera.scale + camera.y;
          return (
            <span
              key={`${group.id}-${dir}`}
              className={`chandle chandle-${dir}`}
              style={{ left, top }}
              data-resize="group"
              data-id={group.id}
              data-dir={dir}
            />
          );
        });
      })}
    </div>
  );
}
