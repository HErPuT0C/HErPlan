import { memo, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import type { CanvasEngine } from '../../canvas/engine';
import { kindOf, portsOf } from '../../canvas/kinds';
import { colorHex, HEADER_H, type GraphDoc, type GraphGroup, type GraphNode } from '../../canvas/model';
import { CORNER_DIRS, setNodeProps } from '../../canvas/ops';
import type { ProjectData } from '../../core/project/types';
import type { Store } from '../../core/store';
import { useAtom, useStore } from '../../core/useStore';
import { t } from '../../i18n';
import { NodeIcon } from './icons';

interface LayerProps {
  engine: CanvasEngine;
  store: Store<ProjectData>;
  graphId: string;
  readOnly: boolean;
}

/**
 * Near zoom: nodes on screen are real DOM (ADR-002), so titles and texts are crisp, selectable and editable.
 * The layer's transform follows the camera (set by the engine); pointer events bubble up to the engine.
 */
export function NodeLayer({ engine, store, graphId, readOnly }: LayerProps) {
  const near = useAtom(engine.near);
  const graph = useStore(store, (s) => s.graphs[graphId] as unknown as GraphDoc | undefined);
  const selection = useAtom(engine.selection);
  const drag = useAtom(engine.drag);
  const resizing = useAtom(engine.resizing);
  const highlight = useAtom(engine.highlight);
  const hover = useAtom(engine.hover);
  const connected = useMemo(() => connectedPorts(graph), [graph]);
  if (!graph || near.lod === 'far') return null;
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  if (near.lod === 'mid') return <MidLabels ids={near.ids} byId={byId} drag={drag} />;

  const rename = (id: string, title: string) =>
    engine.apply(t('canvas.step.rename'), (g) => setNodeProps(g, [id], { title }));
  const retext = (id: string, text: string) =>
    engine.apply(t('canvas.step.text'), (g) => setNodeProps(g, [id], { text }), `text:${id}`);
  const retitleGroup = (id: string, title: string) =>
    engine.apply(t('canvas.step.rename'), (g) => {
      const group = g.groups.find((x) => x.id === id);
      if (group) group.title = title;
    });

  return (
    <>
      {graph.groups.map((group) => {
        const size = resizing?.kind === 'group' && resizing.id === group.id ? resizing : null;
        return (
          <GroupTitle
            key={group.id}
            group={size ? { ...group, x: size.x, y: size.y, w: size.w } : group}
            offset={drag?.groups.has(group.id) ? drag : null}
            readOnly={readOnly}
            onRename={retitleGroup}
          />
        );
      })}
      {near.ids.map((id) => {
        const node = byId.get(id);
        if (!node) return null;
        const moved = drag?.nodes.has(id);
        const size = resizing?.kind === 'node' && resizing.id === id ? resizing : node;
        return (
          <NodeCard
            key={id}
            node={node}
            x={size.x + (moved ? drag!.dx : 0)}
            y={size.y + (moved ? drag!.dy : 0)}
            w={size.w}
            h={size.h}
            selected={selection.nodes.has(id)}
            found={highlight.ids.has(id)}
            current={highlight.current === id}
            hot={hover === id}
            connected={connected.get(id) ?? ''}
            readOnly={readOnly}
            onRename={rename}
            onText={retext}
          />
        );
      })}
      {near.edgeLabels.map((label) => (
        <div key={label.id} className="cedge-label" style={{ transform: `translate(${label.x}px, ${label.y}px)` }}>
          {label.text}
        </div>
      ))}
    </>
  );
}

/** Connected port ids of each node, joined into one string so memoized cards compare it cheaply. */
function connectedPorts(graph: GraphDoc | undefined): Map<string, string> {
  const sets = new Map<string, Set<string>>();
  const add = (node: string, port: string) => {
    let set = sets.get(node);
    if (!set) sets.set(node, (set = new Set()));
    set.add(port);
  };
  for (const e of graph?.edges ?? []) {
    add(e.from.node, e.from.port);
    add(e.to.node, e.to.port);
  }
  return new Map([...sets].map(([id, set]) => [id, [...set].sort().join(' ')]));
}

/**
 * Mid zoom: WebGL draws the nodes, the DOM adds their titles at a readable size, fitted into the node's
 * box on screen (up to two lines) so titles never spill over their neighbours.
 */
function MidLabels({
  ids,
  byId,
  drag,
}: {
  ids: readonly string[];
  byId: Map<string, GraphNode>;
  drag: { nodes: ReadonlySet<string>; dx: number; dy: number } | null;
}) {
  return (
    <>
      {ids.map((id) => {
        const n = byId.get(id);
        if (!n || kindOf(n.kind).sticker) return null;
        const moved = drag?.nodes.has(id);
        const x = n.x + (moved ? drag!.dx : 0);
        const y = n.y + (moved ? drag!.dy : 0);
        const style = {
          transform: `translate(${x}px, ${y}px) scale(var(--label-scale))`,
          '--w': n.w,
          '--h': n.h,
        } as CSSProperties;
        return (
          <div key={id} className="clabel" style={style}>
            {n.title}
          </div>
        );
      })}
    </>
  );
}

interface CardProps {
  node: GraphNode;
  x: number;
  y: number;
  w: number;
  h: number;
  selected: boolean;
  found: boolean;
  current: boolean;
  /** Under the cursor (or the target of an edge being pulled): free side anchors show. */
  hot: boolean;
  /** Ids of ports with edges, space-separated. */
  connected: string;
  readOnly: boolean;
  onRename: (id: string, title: string) => void;
  onText: (id: string, text: string) => void;
}

const NodeCard = memo(function NodeCard({
  node,
  x,
  y,
  w,
  h,
  selected,
  found,
  current,
  hot,
  connected,
  readOnly,
  onRename,
  onText,
}: CardProps) {
  const linked = new Set(connected.split(' '));
  const kind = kindOf(node.kind);
  const color = colorHex(node.color, kind.color);
  const sticker = kind.sticker === true;
  const style = { transform: `translate(${x}px, ${y}px)`, width: w, height: h, '--node-color': color } as CSSProperties;
  return (
    <div
      className={[
        'cnode',
        sticker && 'cnode-sticker',
        selected && 'cnode-selected',
        found && 'cnode-found',
        current && 'cnode-current',
        hot && 'cnode-hot',
      ]
        .filter(Boolean)
        .join(' ')}
      style={style}
      data-node={node.id}
    >
      {!sticker && (
        <div className="cnode-head" style={{ height: HEADER_H }}>
          {node.icon && <NodeIcon name={node.icon} />}
          <Editable
            className="cnode-title"
            value={node.title}
            placeholder={t(kind.label)}
            readOnly={readOnly}
            onCommit={(v) => onRename(node.id, v)}
          />
          {node.comment && <span className="cnode-comment-dot" aria-label={t('canvas.hasComment')} />}
        </div>
      )}
      <Editable
        className="cnode-body"
        value={node.text ?? ''}
        placeholder={t('canvas.textPlaceholder')}
        multiline
        readOnly={readOnly}
        onCommit={(v) => onText(node.id, v)}
      />
      {portsOf({ ...node, w, h }).map((p) => (
        <span
          key={p.id}
          className={[
            'cnode-port',
            p.anchor && !linked.has(p.id) && 'cnode-port-free',
            p.side !== 'in' && 'cnode-port-start',
          ]
            .filter(Boolean)
            .join(' ')}
          style={{ left: p.x, top: p.y }}
          data-port={p.id}
        >
          {p.label && <span className={`cnode-port-label cnode-port-label-${p.face}`}>{p.label}</span>}
        </span>
      ))}
      {selected &&
        !readOnly &&
        CORNER_DIRS.map((dir) => (
          <span key={dir} className={`chandle chandle-${dir}`} data-resize="node" data-id={node.id} data-dir={dir} />
        ))}
    </div>
  );
});

interface EditableProps {
  value: string;
  placeholder: string;
  className: string;
  multiline?: boolean;
  readOnly: boolean;
  onCommit: (value: string) => void;
}

/** Text that turns into a field on double click: Enter (Ctrl+Enter for several lines) saves, Escape cancels. */
export function Editable({ value, placeholder, className, multiline = false, readOnly, onCommit }: EditableProps) {
  const [draft, setDraft] = useState<string | null>(null);
  // Escape and Enter finish editing; the blur that follows must not save a second time.
  const finished = useRef(false);
  if (draft === null) {
    return (
      <div
        className={[className, !value && 'cnode-empty'].filter(Boolean).join(' ')}
        data-canvas-text=""
        onDoubleClick={() => {
          if (readOnly) return;
          finished.current = false;
          setDraft(value);
        }}
      >
        {value || placeholder}
      </div>
    );
  }
  const finish = (save: boolean) => {
    if (finished.current) return;
    finished.current = true;
    if (save && draft !== value) onCommit(multiline ? draft : draft.trim() || value);
    setDraft(null);
  };
  const common = {
    className: `${className} cnode-edit`,
    value: draft,
    autoFocus: true,
    onChange: (e: { target: { value: string } }) => setDraft(e.target.value),
    onBlur: () => finish(true),
    onKeyDown: (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === 'Escape') finish(false);
      if (e.key === 'Enter' && (!multiline || e.ctrlKey)) {
        e.preventDefault();
        finish(true);
      }
    },
  };
  return multiline ? <textarea {...common} /> : <input {...common} />;
}

function GroupTitle({
  group,
  offset,
  readOnly,
  onRename,
}: {
  group: GraphGroup;
  offset: { dx: number; dy: number } | null;
  readOnly: boolean;
  onRename: (id: string, title: string) => void;
}) {
  const style = {
    transform: `translate(${group.x + (offset?.dx ?? 0)}px, ${group.y + (offset?.dy ?? 0)}px)`,
    width: group.w,
    height: HEADER_H,
  };
  return (
    <div className="cgroup-title" style={style}>
      <Editable
        className="cgroup-text"
        value={group.title}
        placeholder={t('canvas.groupPlaceholder')}
        readOnly={readOnly}
        onCommit={(v) => onRename(group.id, v)}
      />
    </div>
  );
}
