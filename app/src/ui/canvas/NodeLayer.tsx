import { memo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import type { CanvasEngine } from '../../canvas/engine';
import { kindOf, portsOf } from '../../canvas/kinds';
import { colorHex, HEADER_H, type GraphDoc, type GraphGroup, type GraphNode } from '../../canvas/model';
import { setNodeProps } from '../../canvas/ops';
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
      {graph.groups.map((group) => (
        <GroupTitle
          key={group.id}
          group={group}
          offset={drag?.groups.has(group.id) ? drag : null}
          readOnly={readOnly}
          onRename={retitleGroup}
        />
      ))}
      {near.ids.map((id) => {
        const node = byId.get(id);
        if (!node) return null;
        const moved = drag?.nodes.has(id);
        const size = resizing?.id === id ? resizing : null;
        return (
          <NodeCard
            key={id}
            node={node}
            x={node.x + (moved ? drag!.dx : 0)}
            y={node.y + (moved ? drag!.dy : 0)}
            w={size?.w ?? node.w}
            h={size?.h ?? node.h}
            selected={selection.nodes.has(id)}
            found={highlight.ids.has(id)}
            current={highlight.current === id}
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

/** Mid zoom: WebGL draws the nodes, the DOM adds only their titles at a readable size. */
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
        const x = n.x + (moved ? drag!.dx : 0) + 8;
        const y = n.y + (moved ? drag!.dy : 0) + HEADER_H / 2;
        return (
          <div key={id} className="clabel" style={{ transform: `translate(${x}px, ${y}px) scale(var(--label-scale))` }}>
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
  readOnly,
  onRename,
  onText,
}: CardProps) {
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
      {portsOf(node).map((p) => (
        <span key={p.id} className={`cnode-port cnode-port-${p.side}`} style={{ top: p.y }} />
      ))}
      {selected && !readOnly && <span className="cnode-resize" data-resize={node.id} />}
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
