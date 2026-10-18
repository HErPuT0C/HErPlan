import { toScreen } from '../../canvas/camera';
import type { CanvasEngine } from '../../canvas/engine';
import type { GraphDoc } from '../../canvas/model';
import type { ProjectData } from '../../core/project/types';
import type { Store } from '../../core/store';
import { useAtom, useStore } from '../../core/useStore';

/** A node's comment pops up while the pointer is over the node, at any zoom (FR-CNV-04). */
export function CommentBubble({
  engine,
  store,
  graphId,
}: {
  engine: CanvasEngine;
  store: Store<ProjectData>;
  graphId: string;
}) {
  const hover = useAtom(engine.hover);
  const view = useAtom(engine.view);
  const node = useStore(store, (s) =>
    hover ? (s.graphs[graphId] as unknown as GraphDoc | undefined)?.nodes.find((n) => n.id === hover) : undefined,
  );
  if (!node?.comment || engine.drag.get()) return null;
  const p = toScreen(view.camera, node.x + node.w, node.y);
  const left = Math.min(p.x + 8, view.width - 268);
  return (
    <div className="canvas-comment" style={{ left: Math.max(8, left), top: Math.max(8, p.y) }} role="tooltip">
      {node.comment}
    </div>
  );
}
