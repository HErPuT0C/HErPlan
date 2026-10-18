import {
  ClipboardPaste,
  Copy,
  CopyPlus,
  Group,
  Image as ImageIcon,
  Maximize,
  MessageSquareText,
  Palette,
  Pencil,
  Plus,
  Scissors,
  SquareDashed,
  StickyNote,
  Trash,
  Type,
  Ungroup,
} from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { Camera } from '../../canvas/camera';
import { CanvasEngine, type HitTarget, type StepKey } from '../../canvas/engine';
import type { PortHit } from '../../canvas/graphIndex';
import { creatableKinds, kindOf } from '../../canvas/kinds';
import type { GraphDoc } from '../../canvas/model';
import { createNode, groupNodes, insertNodeIntoEdge, setNodeProps } from '../../canvas/ops';
import { t, type MessageKey } from '../../i18n';
import type { OpenProject } from '../../state/project';
import { settings } from '../../state/settings';
import { EmptyState, Menu, type MenuEntry } from '../components';
import { CanvasToolbar } from './CanvasToolbar';
import { CommentBubble } from './CommentBubble';
import { HintPanel } from './HintPanel';
import { Minimap } from './Minimap';
import { NodeLayer } from './NodeLayer';
import { PromptDialog, type PromptRequest } from './PromptDialog';
import { SearchBar } from './SearchBar';
import { SelectionBar } from './SelectionBar';
import { SwatchPopover, type SwatchRequest } from './SwatchPopover';
import './canvas.css';

const STEP_LABELS: Record<StepKey, MessageKey> = {
  move: 'canvas.step.move',
  create: 'canvas.step.create',
  connect: 'canvas.step.connect',
  delete: 'canvas.step.delete',
  paste: 'canvas.step.paste',
  duplicate: 'canvas.step.duplicate',
  resize: 'canvas.step.resize',
};

/** No WebGL2 at all (a very old driver, some remote desktops): say so instead of showing a blank area. */
function supportsWebGL2(): boolean {
  try {
    return !!document.createElement('canvas').getContext('webgl2');
  } catch {
    return false;
  }
}

/** Cameras of graphs opened in this session, so switching tabs keeps the view. */
const cameras = new Map<string, Camera>();

interface MenuState {
  x: number;
  y: number;
  entries: MenuEntry[];
}

/** A graph on the canvas (FR-CNV-*): WebGL below, DOM nodes above, panels on top. */
export function CanvasView({
  project,
  graphId,
  onEngine,
}: {
  project: OpenProject;
  graphId: string;
  /** For the benchmark page, which drives the camera itself. */
  onEngine?: (engine: CanvasEngine | null) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const dom = useRef<HTMLDivElement>(null);
  const [engine, setEngine] = useState<CanvasEngine | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [searching, setSearching] = useState(false);
  const [prompt, setPrompt] = useState<PromptRequest | null>(null);
  const [swatch, setSwatch] = useState<SwatchRequest | null>(null);
  const [failed] = useState(() => !supportsWebGL2());
  const readOnly = project.readOnly;
  // The engine is created once per graph; its callbacks reach the latest handlers through this ref.
  const handlers = useRef<{
    contextMenu: (target: HitTarget, x: number, y: number, world: { x: number; y: number }) => void;
    create: (x: number, y: number, world: { x: number; y: number }, from: PortHit | null) => void;
  } | null>(null);
  const onEngineRef = useRef(onEngine);

  useEffect(() => {
    if (failed || !root.current || !canvas.current || !dom.current) return;
    let created: CanvasEngine;
    try {
      created = new CanvasEngine(
        root.current,
        canvas.current,
        dom.current,
        project.store,
        graphId,
        {
          onContextMenu: (target, x, y, world) => handlers.current?.contextMenu(target, x, y, world),
          onCreateRequest: (x, y, world, from) => handlers.current?.create(x, y, world, from),
          onSearchRequest: () => setSearching(true),
          label: (key) => t(STEP_LABELS[key]),
          panButton: () => settings.get().panButton,
          readOnly,
        },
        cameras.get(graphId) ?? null,
      );
    } catch (e) {
      console.error('canvas could not start', e);
      return;
    }
    setEngine(created);
    onEngineRef.current?.(created);
    return () => {
      cameras.set(graphId, created.currentCamera);
      onEngineRef.current?.(null);
      created.destroy();
      setEngine(null);
    };
  }, [project.store, graphId, readOnly, failed]);

  const graph = () => project.store.getState().graphs[graphId] as unknown as GraphDoc;

  const createAt = (kind: string, world: { x: number; y: number }, from: PortHit | null = null) => {
    if (!engine) return;
    const title = kind === 'sticker' ? '' : t(kindOf(kind).label);
    engine.createNodeAt(kind, world, title, from);
  };

  const groupSelection = () => {
    if (!engine) return;
    const s = engine.selection.get();
    if (s.nodes.size === 0) return;
    let id: string | null = null;
    engine.apply(t('canvas.step.group'), (g) => {
      id = groupNodes(g, s.nodes, t('canvas.groupDefault'))?.id ?? null;
    });
    if (id) engine.select({ nodes: new Set(), edges: new Set(), groups: new Set([id]) });
  };

  const kindEntries = (world: { x: number; y: number }, from: PortHit | null): MenuEntry[] =>
    creatableKinds()
      .filter((k) => !from || !k.sticker)
      .map((k) => ({
        id: `create-${k.id}`,
        label: t(k.label),
        icon: k.sticker ? <StickyNote size={16} /> : <Plus size={16} />,
        onSelect: () => createAt(k.id, world, from),
      }));

  const openCreateMenu = (x: number, y: number, world: { x: number; y: number }, from: PortHit | null) => {
    const rect = root.current?.getBoundingClientRect();
    if (readOnly || !rect) return;
    setMenu({ x: x + rect.left, y: y + rect.top, entries: kindEntries(world, from) });
  };

  const openContextMenu = (target: HitTarget, x: number, y: number, world: { x: number; y: number }) => {
    if (!engine) return;
    const s = engine.selection.get();
    const g = graph();
    const entries: MenuEntry[] = [];
    const sep = (id: string) => entries.push({ id, separator: true });
    const edit = !readOnly;
    if (target.kind === 'background') {
      if (edit) entries.push(...kindEntries(world, null), { id: 'sep1', separator: true });
      if (edit)
        entries.push({
          id: 'paste',
          label: t('canvas.paste'),
          icon: <ClipboardPaste size={16} />,
          shortcut: 'Ctrl+V',
          onSelect: () => void engine.paste(world),
        });
      entries.push(
        {
          id: 'all',
          label: t('canvas.selectAll'),
          icon: <SquareDashed size={16} />,
          shortcut: 'Ctrl+A',
          onSelect: () => engine.selectAll(),
        },
        {
          id: 'fit',
          label: t('canvas.fit'),
          icon: <Maximize size={16} />,
          shortcut: 'F',
          onSelect: () => engine.fit(),
        },
      );
    } else if (target.kind === 'node') {
      const node = g.nodes.find((n) => n.id === target.id);
      const ids = s.nodes.size > 0 ? s.nodes : new Set([target.id]);
      if (node && edit) {
        if (ids.size === 1) {
          entries.push({
            id: 'rename',
            label: t('canvas.rename'),
            icon: <Pencil size={16} />,
            onSelect: () =>
              setPrompt({
                title: t('canvas.rename'),
                label: t('canvas.nodeTitle'),
                value: node.title,
                onSubmit: (title) =>
                  engine.apply(t('canvas.step.rename'), (gr) => setNodeProps(gr, [node.id], { title })),
              }),
          });
        }
        entries.push(
          {
            id: 'color',
            label: t('canvas.color'),
            icon: <Palette size={16} />,
            onSelect: () =>
              setSwatch({
                x,
                y,
                mode: 'color',
                current: node.color ?? null,
                onPick: (color) => engine.apply(t('canvas.step.style'), (gr) => setNodeProps(gr, ids, { color })),
              }),
          },
          {
            id: 'icon',
            label: t('canvas.icon'),
            icon: <ImageIcon size={16} />,
            onSelect: () =>
              setSwatch({
                x,
                y,
                mode: 'icon',
                current: node.icon ?? null,
                onPick: (icon) => engine.apply(t('canvas.step.style'), (gr) => setNodeProps(gr, ids, { icon })),
              }),
          },
          {
            id: 'comment',
            label: node.comment ? t('canvas.editComment') : t('canvas.addComment'),
            icon: <MessageSquareText size={16} />,
            onSelect: () =>
              setPrompt({
                title: t('canvas.comment'),
                label: t('canvas.comment'),
                value: node.comment ?? '',
                multiline: true,
                allowEmpty: true,
                onSubmit: (comment) =>
                  engine.apply(t('canvas.step.comment'), (gr) => setNodeProps(gr, [node.id], { comment })),
              }),
          },
        );
        sep('sep1');
      }
      entries.push({
        id: 'copy',
        label: t('canvas.copy'),
        icon: <Copy size={16} />,
        shortcut: 'Ctrl+C',
        onSelect: () => void engine.copy(),
      });
      if (edit) {
        entries.push(
          {
            id: 'cut',
            label: t('canvas.cut'),
            icon: <Scissors size={16} />,
            shortcut: 'Ctrl+X',
            onSelect: () => void engine.copy(true),
          },
          {
            id: 'dup',
            label: t('canvas.duplicate'),
            icon: <CopyPlus size={16} />,
            shortcut: 'Ctrl+D',
            onSelect: () => engine.duplicate(),
          },
          {
            id: 'group',
            label: t('canvas.group'),
            icon: <Group size={16} />,
            shortcut: 'Ctrl+G',
            onSelect: groupSelection,
          },
        );
        const inGroup = g.groups.find((gr) => gr.members.includes(target.id));
        if (inGroup) {
          entries.push({
            id: 'leave',
            label: t('canvas.leaveGroup'),
            icon: <Ungroup size={16} />,
            onSelect: () =>
              engine.apply(t('canvas.step.group'), (gr) => {
                for (const group of gr.groups) group.members = group.members.filter((m) => !ids.has(m));
              }),
          });
        }
        sep('sep2');
        entries.push({
          id: 'delete',
          label: t('canvas.delete'),
          icon: <Trash size={16} />,
          shortcut: 'Del',
          danger: true,
          onSelect: () => engine.deleteSelection(),
        });
      }
    } else if (target.kind === 'edge') {
      const edge = g.edges.find((e) => e.id === target.id);
      if (edge && edit) {
        entries.push(
          {
            id: 'label',
            label: edge.label ? t('canvas.editLabel') : t('canvas.addLabel'),
            icon: <Type size={16} />,
            onSelect: () =>
              setPrompt({
                title: t('canvas.edgeLabel'),
                label: t('canvas.edgeLabel'),
                value: edge.label ?? '',
                allowEmpty: true,
                onSubmit: (label) =>
                  engine.apply(t('canvas.step.style'), (gr) => {
                    const e = gr.edges.find((x) => x.id === edge.id);
                    if (e) e.label = label;
                  }),
              }),
          },
          {
            id: 'color',
            label: t('canvas.color'),
            icon: <Palette size={16} />,
            onSelect: () =>
              setSwatch({
                x,
                y,
                mode: 'color',
                current: edge.color ?? null,
                onPick: (color) =>
                  engine.apply(t('canvas.step.style'), (gr) => {
                    const e = gr.edges.find((ex) => ex.id === edge.id);
                    if (e) e.color = color;
                  }),
              }),
          },
          {
            id: 'insert',
            label: t('canvas.insertNode'),
            icon: <Plus size={16} />,
            onSelect: () => {
              const node = createNode('node', world.x - 120, world.y - 60, t('canvas.kind.node'));
              engine.apply(t('canvas.step.create'), (gr) => insertNodeIntoEdge(gr, edge.id, node));
            },
          },
          { id: 'sep', separator: true },
          {
            id: 'delete',
            label: t('canvas.delete'),
            icon: <Trash size={16} />,
            shortcut: 'Del',
            danger: true,
            onSelect: () => engine.deleteSelection(),
          },
        );
      }
    } else if (target.kind === 'group') {
      const group = g.groups.find((gr) => gr.id === target.id);
      if (group && edit) {
        entries.push(
          {
            id: 'rename',
            label: t('canvas.rename'),
            icon: <Pencil size={16} />,
            onSelect: () =>
              setPrompt({
                title: t('canvas.rename'),
                label: t('canvas.groupTitle'),
                value: group.title,
                onSubmit: (title) =>
                  engine.apply(t('canvas.step.rename'), (gr) => {
                    const x = gr.groups.find((y) => y.id === group.id);
                    if (x) x.title = title;
                  }),
              }),
          },
          {
            id: 'color',
            label: t('canvas.color'),
            icon: <Palette size={16} />,
            onSelect: () =>
              setSwatch({
                x,
                y,
                mode: 'color',
                current: group.color ?? null,
                onPick: (color) =>
                  engine.apply(t('canvas.step.style'), (gr) => {
                    const x2 = gr.groups.find((y2) => y2.id === group.id);
                    if (x2) x2.color = color;
                  }),
              }),
          },
        );
        if (s.nodes.size > 0) {
          entries.push({
            id: 'add',
            label: t('canvas.addToGroup'),
            icon: <Group size={16} />,
            onSelect: () =>
              engine.apply(t('canvas.step.group'), (gr) => {
                const x3 = gr.groups.find((y3) => y3.id === group.id);
                if (x3) x3.members = [...new Set([...x3.members, ...s.nodes])];
              }),
          });
        }
        entries.push(
          { id: 'sep', separator: true },
          {
            id: 'ungroup',
            label: t('canvas.ungroup'),
            icon: <Ungroup size={16} />,
            onSelect: () =>
              engine.apply(t('canvas.step.group'), (gr) => {
                gr.groups = gr.groups.filter((y4) => y4.id !== group.id);
              }),
          },
          {
            id: 'delete',
            label: t('canvas.deleteGroup'),
            icon: <Trash size={16} />,
            danger: true,
            onSelect: () => {
              engine.select({ nodes: new Set(group.members), edges: new Set(), groups: new Set([group.id]) });
              engine.deleteSelection();
            },
          },
        );
      }
    }
    if (entries.length) setMenu({ x, y, entries });
  };

  useLayoutEffect(() => {
    handlers.current = { contextMenu: openContextMenu, create: openCreateMenu };
    onEngineRef.current = onEngine;
  });

  const onKeyDown = (e: KeyboardEvent) => {
    if (!engine || readOnly) return;
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyG') {
      e.preventDefault();
      groupSelection();
    }
    if (e.code === 'F2') {
      const s = engine.selection.get();
      if (s.nodes.size !== 1) return;
      const node = engine.nodeById([...s.nodes][0]);
      if (!node) return;
      e.preventDefault();
      setPrompt({
        title: t('canvas.rename'),
        label: t('canvas.nodeTitle'),
        value: node.title,
        onSubmit: (title) => engine.apply(t('canvas.step.rename'), (gr) => setNodeProps(gr, [node.id], { title })),
      });
    }
  };

  if (failed) {
    return (
      <div className="module-placeholder">
        <EmptyState title={t('canvas.failedTitle')} text={t('canvas.failedText')} />
      </div>
    );
  }

  // Dialogs live outside the canvas element: their clicks and keys must not reach the canvas engine.
  return (
    <>
      <div
        ref={root}
        className="canvas"
        tabIndex={0}
        role="application"
        aria-label={t('canvas.label')}
        aria-roledescription={t('canvas.roleDescription')}
        onKeyDown={onKeyDown}
      >
        <canvas ref={canvas} className="canvas-gl" aria-hidden="true" />
        <div ref={dom} className="canvas-dom">
          {engine && <NodeLayer engine={engine} store={project.store} graphId={graphId} readOnly={readOnly} />}
        </div>
        {engine && (
          <>
            <CanvasToolbar
              engine={engine}
              readOnly={readOnly}
              onSearch={() => setSearching(true)}
              onCreate={(kind) => createAt(kind, engine.viewCenter())}
            />
            <SelectionBar engine={engine} onGroup={groupSelection} />
            <HintPanel />
            <Minimap engine={engine} store={project.store} graphId={graphId} />
            <CommentBubble engine={engine} store={project.store} graphId={graphId} />
            {searching && (
              <SearchBar
                engine={engine}
                store={project.store}
                graphId={graphId}
                onClose={() => {
                  setSearching(false);
                  root.current?.focus();
                }}
              />
            )}
          </>
        )}
        {menu && (
          <Menu
            entries={menu.entries}
            x={menu.x}
            y={menu.y}
            label={t('canvas.menu')}
            onClose={() => {
              setMenu(null);
              root.current?.focus({ preventScroll: true });
            }}
          />
        )}
      </div>
      <PromptDialog request={prompt} onClose={() => setPrompt(null)} />
      <SwatchPopover request={swatch} onClose={() => setSwatch(null)} />
    </>
  );
}
