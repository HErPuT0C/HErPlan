// The canvas engine: camera, input, selection and the render loop for one graph (ADR-002).
// React hosts it (CanvasView) and draws the near-zoom DOM nodes; everything per frame happens here,
// outside React. Changes to the graph go through the project store, so they are undoable and autosaved.

import type { Draft } from 'immer';
import { atom, type Atom } from '../core/atom';
import type { ProjectData } from '../core/project/types';
import type { Store } from '../core/store';
import {
  clampScale,
  fitBounds,
  lodFor,
  panToShow,
  setScaleAt,
  toWorld,
  visibleBounds,
  zoomAt,
  ZOOM_STEP,
  type Camera,
  type Lod,
} from './camera';
import { edgeCurve } from './geometry';
import { GraphIndex, type PortHit } from './graphIndex';
import { canEnd, canStart, OPPOSITE_FACE, portsOf } from './kinds';
import { GRID, snap, type Bounds, type GraphDoc, type GraphNode, type Rect } from './model';
import {
  connect,
  copySelection,
  defaultPort,
  deleteItems,
  EMPTY_SELECTION,
  isEmptySelection,
  isGraphClipboard,
  minSize,
  moveItems,
  movedNodeIds,
  nodeAtPort,
  pasteClipboard,
  resizeRect,
  setRect,
  usedStarts,
  type GraphClipboard,
  type HandleDir,
  type Selection,
} from './ops';
import { QUALITY, type QualityName, type QualityProfile } from './quality';
import { GraphRenderer, EMPTY_BATCH } from './gl/renderer';
import {
  anchorBatch,
  buildEdges,
  buildLinks,
  buildGroups,
  buildNodes,
  marqueeBatch,
  previewBatch,
  readTheme,
  type DragOffset,
  type Resizing,
  type SceneInput,
  type Theme,
} from './scene';

export type HitTarget =
  { kind: 'node'; id: string } | { kind: 'edge'; id: string } | { kind: 'group'; id: string } | { kind: 'background' };

export type StepKey = 'move' | 'create' | 'connect' | 'delete' | 'paste' | 'duplicate' | 'resize';

/** An edge pulled out of a port: `reverse` when it was pulled from an input, so the port is its end. */
export interface PulledEdge extends PortHit {
  reverse: boolean;
}

export interface CanvasCallbacks {
  /** Right click (or the menu key) on something: the host shows a context menu at screen (x, y). */
  onContextMenu: (target: HitTarget, x: number, y: number, world: { x: number; y: number }) => void;
  /** Double click on empty space, or an edge dropped on empty space: the host offers node kinds. */
  onCreateRequest: (x: number, y: number, world: { x: number; y: number }, from: PulledEdge | null) => void;
  /** Double click on a node (outside its texts) or Enter: the host may open it (a chapter). */
  onOpenNode?: (id: string) => boolean;
  /** Story graphs: chapter nodes own graphs, which must follow them through create, delete, copy and paste. */
  hooks?: GraphHooks;
  onSearchRequest: () => void;
  /** Labels of undo steps, in the interface language. */
  label: (key: StepKey) => string;
  panButton: () => 'middle' | 'right';
  readOnly: boolean;
}

/** Called inside the same undo step as the canvas change, with the whole project to change. */
export interface GraphHooks {
  create?: (project: Draft<ProjectData>, node: GraphNode) => void;
  remove?: (project: Draft<ProjectData>, nodes: GraphNode[]) => void;
  /** Adds what the copied nodes own to the clipboard (outside any change). */
  copy?: (clip: GraphClipboard, project: ProjectData) => void;
  paste?: (project: Draft<ProjectData>, nodes: GraphNode[], clip: GraphClipboard) => void;
}

export interface CanvasView {
  camera: Camera;
  lod: Lod;
  width: number;
  height: number;
}

/** What the DOM layer shows: changes only when nodes enter or leave the view, not on every frame. */
export interface NearView {
  lod: Lod;
  /** Near: nodes drawn as DOM cards. Mid: nodes that get a title label. */
  ids: readonly string[];
  /** Labelled edges in view (near zoom only), positioned at the middle of the curve. */
  edgeLabels: readonly EdgeLabel[];
}

export interface EdgeLabel {
  id: string;
  text: string;
  x: number;
  y: number;
}

type Gesture =
  | { kind: 'pan'; sx: number; sy: number; camera: Camera; moved: boolean; button: number }
  | { kind: 'marquee'; x0: number; y0: number; x1: number; y1: number; base: Selection }
  | {
      kind: 'move';
      wx: number;
      wy: number;
      nodes: Set<string>;
      groups: Set<string>;
      dx: number;
      dy: number;
      moved: boolean;
    }
  | { kind: 'connect'; from: PulledEdge; wx: number; wy: number }
  | {
      kind: 'resize';
      target: 'node' | 'group';
      id: string;
      dir: HandleDir;
      wx: number;
      wy: number;
      start: Rect;
      min: { w: number; h: number };
    };

const DRAG_THRESHOLD = 4;
let internalClipboard: GraphClipboard | null = null;

export class CanvasEngine {
  readonly view: Atom<CanvasView>;
  readonly near: Atom<NearView> = atom<NearView>({ lod: 'mid', ids: [], edgeLabels: [] });
  readonly hover: Atom<string | null> = atom<string | null>(null);
  readonly selection: Atom<Selection> = atom<Selection>(EMPTY_SELECTION);
  /** Search results to highlight, and the one in focus. */
  readonly highlight: Atom<{ ids: ReadonlySet<string>; current: string | null }> = atom({
    ids: new Set<string>() as ReadonlySet<string>,
    current: null as string | null,
  });
  /** Node drag or resize in progress, for the DOM layer to follow without store writes. */
  readonly drag: Atom<DragOffset | null> = atom<DragOffset | null>(null);
  readonly resizing: Atom<Resizing | null> = atom<Resizing | null>(null);

  private renderer: GraphRenderer;
  private camera: Camera = { x: 80, y: 80, scale: 1 };
  private lod: Lod = 'near';
  private width = 1;
  private height = 1;
  private theme: Theme = readTheme();
  private index: GraphIndex;
  /** Scene layers with the inputs they were built from; rebuilt only when an input changes. */
  private memo = new Map<string, { deps: unknown[]; value: unknown }>();
  private gesture: Gesture | null = null;
  private hoverEdge: string | null = null;
  private hoverNode: string | null = null;
  private spaceDown = false;
  private frame = 0;
  private animation: { from: Camera; to: Camera; start: number; duration: number } | null = null;
  private lastPointer = { x: 0, y: 0 };
  private labelScale = 0;
  private motionTimer: ReturnType<typeof setTimeout> | null = null;
  private lastCamera: Camera | null = null;
  private nearPublished = { at: 0, scale: 0, lod: '' as Lod | '', graph: null as GraphDoc | null };
  private nearTimer: ReturnType<typeof setTimeout> | null = null;
  private cleanups: (() => void)[] = [];
  private quality: QualityProfile;
  /** Node under the cursor while pulling an edge: its anchors light up. */
  private connectHover: string | null = null;

  constructor(
    private readonly root: HTMLElement,
    canvas: HTMLCanvasElement,
    private readonly domLayer: HTMLElement,
    private readonly store: Store<ProjectData>,
    readonly graphId: string,
    private readonly callbacks: CanvasCallbacks,
    initialCamera: Camera | null,
    quality: QualityName = 'normal',
  ) {
    this.quality = QUALITY[quality];
    this.renderer = new GraphRenderer(canvas, () => {
      this.memo.clear();
      this.requestRender();
    });
    this.index = new GraphIndex(this.graph);
    const rect = root.getBoundingClientRect();
    this.width = rect.width || 1;
    this.height = rect.height || 1;
    this.view = atom<CanvasView>({ camera: this.camera, lod: this.lod, width: this.width, height: this.height });
    if (initialCamera) this.camera = initialCamera;
    else this.fit(false);
    this.lod = lodFor(this.camera.scale, 'mid', this.quality.farBelow);
    this.attach();
    this.resize();
  }

  // --- Graph access ---

  get graph(): GraphDoc {
    return this.store.getState().graphs[this.graphId] as unknown as GraphDoc;
  }

  get gpu(): string {
    return this.renderer.gpu;
  }

  get currentCamera(): Camera {
    return this.camera;
  }

  /** Switches between the normal and the economy mode (a setting) without reopening the canvas. */
  setQuality(name: QualityName): void {
    if (this.quality === QUALITY[name]) return;
    this.quality = QUALITY[name];
    this.labelScale = 0;
    this.memo.clear();
    this.resize();
    this.publishNear();
  }

  private change(key: StepKey, recipe: (g: GraphDoc, project: Draft<ProjectData>) => void, mergeKey?: string): void {
    if (this.callbacks.readOnly) return;
    this.store.dispatch(
      this.callbacks.label(key),
      (d) => {
        const g = d.graphs[this.graphId] as unknown as GraphDoc | undefined;
        if (g) recipe(g, d);
      },
      mergeKey ? { mergeKey } : {},
    );
  }

  /** Any graph change from outside (undo, another view, a text edit in a DOM node). */
  private onStoreChange = (): void => {
    const graph = this.graph;
    if (!graph) return;
    if (graph !== this.index.graph) {
      this.index = new GraphIndex(graph);
      // Drop selected ids that no longer exist (deleted, or undone creation).
      const s = this.selection.get();
      const keep = (ids: ReadonlySet<string>, has: (id: string) => boolean) => new Set([...ids].filter(has));
      const next: Selection = {
        nodes: keep(s.nodes, (id) => this.index.nodeById.has(id)),
        edges: keep(s.edges, (id) => this.index.edgeById.has(id)),
        groups: keep(s.groups, (id) => this.index.groupById.has(id)),
      };
      if (next.nodes.size !== s.nodes.size || next.edges.size !== s.edges.size || next.groups.size !== s.groups.size) {
        this.selection.set(next);
      }
      this.requestRender();
    }
  };

  // --- Camera ---

  setCamera(next: Camera, animate = false): void {
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (animate && !reduced) {
      this.animation = { from: this.camera, to: next, start: performance.now(), duration: 180 };
    } else {
      this.animation = null;
      this.camera = next;
    }
    this.requestRender();
  }

  fit(animate = true): void {
    const b = this.index.bounds();
    if (!b) {
      this.setCamera({ x: this.width / 2 - 120, y: this.height / 3, scale: 1 }, animate);
      return;
    }
    this.setCamera(fitBounds(b, this.width, this.height), animate);
  }

  fitSelection(): void {
    const s = this.selection.get();
    const ids = movedNodeIds(this.graph, s.nodes, s.groups);
    const rects = [
      ...this.graph.nodes.filter((n) => ids.has(n.id)),
      ...this.graph.groups.filter((g) => s.groups.has(g.id)),
    ];
    if (rects.length === 0) return this.fit();
    const b = rects.reduce<Bounds>(
      (acc, r) => ({
        minX: Math.min(acc.minX, r.x),
        minY: Math.min(acc.minY, r.y),
        maxX: Math.max(acc.maxX, r.x + r.w),
        maxY: Math.max(acc.maxY, r.y + r.h),
      }),
      { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
    );
    this.setCamera(fitBounds(b, this.width, this.height), true);
  }

  zoomBy(factor: number, sx = this.width / 2, sy = this.height / 2): void {
    this.setCamera(zoomAt(this.camera, sx, sy, factor), true);
  }

  resetZoom(): void {
    this.setCamera(setScaleAt(this.camera, this.width / 2, this.height / 2, 1), true);
  }

  /** Brings a node into view (search, "go to"); zooms in to a readable level if needed. */
  reveal(id: string): void {
    const n = this.index.node(id);
    if (!n) return;
    let cam = this.camera;
    if (cam.scale < 0.62) cam = setScaleAt(cam, this.width / 2, this.height / 2, 0.8);
    cam = panToShow(cam, n, this.width, this.height, 80);
    this.setCamera(cam, true);
  }

  // --- Selection ---

  select(next: Selection): void {
    this.selection.set(next);
    this.requestRender();
  }

  selectAll(): void {
    const g = this.graph;
    this.select({
      nodes: new Set(g.nodes.map((n) => n.id)),
      edges: new Set(g.edges.map((e) => e.id)),
      groups: new Set(g.groups.map((x) => x.id)),
    });
  }

  setHighlight(ids: ReadonlySet<string>, current: string | null): void {
    this.highlight.set({ ids, current });
    this.requestRender();
  }

  // --- Commands used by menus and keys ---

  /**
   * Creates a node at a world point (snapped); a node pulled out of a port comes connected and sits on the
   * side it was pulled to. Selects the new node.
   */
  createNodeAt(
    kind: string,
    world: { x: number; y: number },
    title: string,
    from: PulledEdge | null = null,
    init?: (node: GraphNode) => void,
  ): string | null {
    if (this.callbacks.readOnly) return null;
    const placed = from
      ? nodeAtPort(kind, world, from.face, from.reverse ? 'start' : 'end', title)
      : nodeAtPort(kind, world, 'right', 'end', title);
    const node = placed.node;
    if (!from) {
      node.x = snap(world.x);
      node.y = snap(world.y);
    }
    init?.(node);
    this.change('create', (g, d) => {
      this.callbacks.hooks?.create?.(d, node);
      g.nodes.push(node);
      if (from && placed.port) {
        if (from.reverse) connect(g, { node: node.id, port: placed.port }, { node: from.node, port: from.port });
        else connect(g, { node: from.node, port: from.port }, { node: node.id, port: placed.port });
      }
    });
    this.select({ nodes: new Set([node.id]), edges: new Set(), groups: new Set() });
    // A new node always ends up in the visible area (FR-CNV-02).
    this.setCamera(panToShow(this.camera, node, this.width, this.height), true);
    return node.id;
  }

  /** Free spot near the centre of the view for nodes created from a toolbar or menu without a point. */
  viewCenter(): { x: number; y: number } {
    return toWorld(this.camera, this.width / 2, this.height / 2);
  }

  deleteSelection(): void {
    const s = this.selection.get();
    if (isEmptySelection(s)) return;
    this.change('delete', (g, d) => {
      const removed = g.nodes.filter((n) => s.nodes.has(n.id));
      deleteItems(g, s);
      if (removed.length) this.callbacks.hooks?.remove?.(d, removed);
    });
    this.select(EMPTY_SELECTION);
  }

  /** The selection on a clipboard, with whatever its nodes own. */
  private clip(): GraphClipboard | null {
    const clip = copySelection(this.graph, this.selection.get());
    if (clip) this.callbacks.hooks?.copy?.(clip, this.store.getState());
    return clip;
  }

  async copy(cut = false): Promise<void> {
    const clip = this.clip();
    if (!clip) return;
    internalClipboard = clip;
    try {
      await navigator.clipboard.writeText(JSON.stringify(clip));
    } catch {
      // The internal clipboard still works inside HErPlan.
    }
    if (cut) this.deleteSelection();
  }

  async paste(at?: { x: number; y: number }): Promise<void> {
    let clip = internalClipboard;
    try {
      const parsed: unknown = JSON.parse(await navigator.clipboard.readText());
      if (isGraphClipboard(parsed)) clip = parsed;
    } catch {
      // Not our data on the system clipboard: use the internal one.
    }
    if (!clip) return;
    const point = at ?? toWorld(this.camera, this.lastPointer.x, this.lastPointer.y);
    this.pasteAt(clip, point, 'paste');
  }

  duplicate(): void {
    const clip = this.clip();
    if (!clip) return;
    const b = clip.nodes.reduce((m, n) => ({ x: Math.min(m.x, n.x), y: Math.min(m.y, n.y) }), {
      x: Infinity,
      y: Infinity,
    });
    this.pasteAt(clip, { x: b.x + GRID * 2, y: b.y + GRID * 2 }, 'duplicate');
  }

  private pasteAt(clip: GraphClipboard, at: { x: number; y: number }, key: 'paste' | 'duplicate'): void {
    let pasted = { nodes: [] as string[], edges: [] as string[], groups: [] as string[] };
    this.change(key, (g, d) => {
      pasted = pasteClipboard(g, clip, at);
      const ids = new Set(pasted.nodes);
      const nodes = g.nodes.filter((n) => ids.has(n.id));
      if (nodes.length) this.callbacks.hooks?.paste?.(d, nodes, clip);
    });
    this.select({ nodes: new Set(pasted.nodes), edges: new Set(pasted.edges), groups: new Set(pasted.groups) });
  }

  nudge(dx: number, dy: number): void {
    const s = this.selection.get();
    if (s.nodes.size === 0 && s.groups.size === 0) return;
    this.change('move', (g) => moveItems(g, s.nodes, s.groups, dx, dy), 'nudge');
  }

  /** Applies a graph change from the host (rename, colour, group, align…) as one undo step. */
  apply(label: string, recipe: (g: GraphDoc) => void, mergeKey?: string): void {
    if (this.callbacks.readOnly) return;
    this.store.dispatch(
      label,
      (d) => {
        const g = d.graphs[this.graphId] as unknown as GraphDoc | undefined;
        if (g) recipe(g);
      },
      mergeKey ? { mergeKey } : {},
    );
  }

  // --- Input ---

  private attach(): void {
    const r = this.root;
    const on = <K extends keyof HTMLElementEventMap>(
      type: K,
      handler: (e: HTMLElementEventMap[K]) => void,
      options?: AddEventListenerOptions,
    ) => {
      r.addEventListener(type, handler, options);
      this.cleanups.push(() => r.removeEventListener(type, handler, options));
    };
    on('pointerdown', this.onPointerDown);
    on('pointermove', this.onPointerMove);
    on('pointerup', this.onPointerUp);
    on('pointercancel', this.onPointerUp);
    on('pointerleave', () => this.setHover(null, null));
    on('wheel', this.onWheel, { passive: false });
    on('dblclick', this.onDoubleClick);
    on('contextmenu', this.onContextMenu);
    on('keydown', this.onKeyDown);
    on('keyup', this.onKeyUp);
    r.addEventListener('blur', () => (this.spaceDown = false));
    this.cleanups.push(this.store.subscribe(this.onStoreChange));
    const observer = new ResizeObserver(() => this.resize());
    observer.observe(r);
    this.cleanups.push(() => observer.disconnect());
    // The accent colour can change in settings while the canvas is open.
    const themeWatch = new MutationObserver(() => {
      this.theme = readTheme();
      this.memo.clear();
      this.requestRender();
    });
    themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ['data-accent'] });
    this.cleanups.push(() => themeWatch.disconnect());
  }

  private resize(): void {
    const rect = this.root.getBoundingClientRect();
    this.width = Math.max(1, rect.width);
    this.height = Math.max(1, rect.height);
    this.renderer.resize(this.width, this.height, Math.min(window.devicePixelRatio || 1, this.quality.maxDpr));
    this.requestRender();
  }

  private local(e: { clientX: number; clientY: number }): { x: number; y: number } {
    const rect = this.root.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  /** Text fields inside DOM nodes keep their own mouse and keyboard behaviour. */
  private isEditable(target: EventTarget | null): boolean {
    if (!(target instanceof Element)) return false;
    return !!target.closest('input, textarea, select, [contenteditable="true"], [data-canvas-ignore]');
  }

  private hitAt(sx: number, sy: number): HitTarget & { port?: PortHit } {
    const w = toWorld(this.camera, sx, sy);
    const scale = this.camera.scale;
    if (this.lod !== 'far') {
      const port = this.index.portAt(w.x, w.y, 9 / scale);
      if (port) return { kind: 'node', id: port.node, port };
    }
    const node = this.index.nodeAt(w.x, w.y);
    if (node >= 0) return { kind: 'node', id: this.graph.nodes[node].id };
    const group = this.index.groupHeaderAt(w.x, w.y);
    if (group >= 0) return { kind: 'group', id: this.graph.groups[group].id };
    const edge = this.index.edgeAt(w.x, w.y, 6 / scale);
    if (edge >= 0) return { kind: 'edge', id: this.graph.edges[edge].id };
    return { kind: 'background' };
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (this.isEditable(e.target)) return;
    this.root.focus({ preventScroll: true });
    const p = this.local(e);
    this.lastPointer = p;
    const panButton = this.callbacks.panButton();
    const isPan = e.button === 1 || (e.button === 2 && panButton === 'right') || (e.button === 0 && this.spaceDown);
    if (isPan) {
      e.preventDefault();
      this.gesture = { kind: 'pan', sx: p.x, sy: p.y, camera: this.camera, moved: false, button: e.button };
      this.root.setPointerCapture(e.pointerId);
      this.root.dataset.gesture = 'pan';
      return;
    }
    if (e.button !== 0) return;
    const w = toWorld(this.camera, p.x, p.y);
    const handle = (e.target as Element | null)?.closest?.('[data-resize]');
    if (handle && !this.callbacks.readOnly) {
      const target = handle.getAttribute('data-resize') === 'group' ? 'group' : 'node';
      const id = handle.getAttribute('data-id') ?? '';
      const dir = (handle.getAttribute('data-dir') ?? 'se') as HandleDir;
      const item = target === 'node' ? this.index.node(id) : this.graph.groups.find((x) => x.id === id);
      if (item) {
        e.preventDefault();
        this.gesture = {
          kind: 'resize',
          target,
          id,
          dir,
          wx: w.x,
          wy: w.y,
          start: { x: item.x, y: item.y, w: item.w, h: item.h },
          min: minSize(item, target === 'group'),
        };
        this.root.setPointerCapture(e.pointerId);
        this.root.dataset.gesture = `resize-${dir}`;
        return;
      }
    }
    const hit = this.hitAt(p.x, p.y);
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    const s = this.selection.get();
    if (hit.kind === 'node' && hit.port && !this.callbacks.readOnly) {
      // Any port can be pulled: from an input the edge runs backwards, into this port (FR-CNV-02).
      this.gesture = { kind: 'connect', from: { ...hit.port, reverse: hit.port.side === 'in' }, wx: w.x, wy: w.y };
      this.root.setPointerCapture(e.pointerId);
      this.root.dataset.gesture = 'connect';
      return;
    }
    if (hit.kind === 'node' || hit.kind === 'group') {
      const key = hit.kind === 'node' ? 'nodes' : 'groups';
      let next = s;
      if (additive) {
        const ids = new Set(s[key]);
        if (ids.has(hit.id)) ids.delete(hit.id);
        else ids.add(hit.id);
        next = { ...s, [key]: ids };
      } else if (!s[key].has(hit.id)) {
        next = { ...EMPTY_SELECTION, [key]: new Set([hit.id]) };
      }
      this.select(next);
      if (!next[key].has(hit.id) || this.callbacks.readOnly) return;
      this.gesture = {
        kind: 'move',
        wx: w.x,
        wy: w.y,
        nodes: movedNodeIds(this.graph, next.nodes, next.groups),
        groups: new Set(next.groups),
        dx: 0,
        dy: 0,
        moved: false,
      };
      // Capture only once the drag starts: an early capture would retarget the double click that
      // opens a node title for editing.
      return;
    }
    if (hit.kind === 'edge') {
      const edges = new Set(additive ? s.edges : []);
      if (edges.has(hit.id)) edges.delete(hit.id);
      else edges.add(hit.id);
      this.select(additive ? { ...s, edges } : { ...EMPTY_SELECTION, edges });
      return;
    }
    if (!additive) this.select(EMPTY_SELECTION);
    this.gesture = { kind: 'marquee', x0: w.x, y0: w.y, x1: w.x, y1: w.y, base: additive ? s : EMPTY_SELECTION };
    this.root.setPointerCapture(e.pointerId);
  };

  private onPointerMove = (e: PointerEvent): void => {
    const p = this.local(e);
    this.lastPointer = p;
    const g = this.gesture;
    if (!g) {
      if (!this.isEditable(e.target)) this.updateHover(p);
      return;
    }
    const w = toWorld(this.camera, p.x, p.y);
    switch (g.kind) {
      case 'pan': {
        const dx = p.x - g.sx;
        const dy = p.y - g.sy;
        if (!g.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        g.moved = true;
        this.setCamera({ ...g.camera, x: g.camera.x + dx, y: g.camera.y + dy });
        return;
      }
      case 'marquee':
        g.x1 = w.x;
        g.y1 = w.y;
        this.requestRender();
        return;
      case 'move': {
        const rawDx = w.x - g.wx;
        const rawDy = w.y - g.wy;
        if (!g.moved && Math.hypot(rawDx, rawDy) * this.camera.scale < DRAG_THRESHOLD) return;
        if (!g.moved) this.root.setPointerCapture(e.pointerId);
        g.moved = true;
        // Snap to the grid; hold Alt to move freely.
        g.dx = e.altKey ? rawDx : snap(rawDx);
        g.dy = e.altKey ? rawDy : snap(rawDy);
        this.drag.set({ nodes: g.nodes, groups: g.groups, dx: g.dx, dy: g.dy });
        this.requestRender();
        return;
      }
      case 'connect': {
        g.wx = w.x;
        g.wy = w.y;
        const over = this.index.nodeAt(w.x, w.y);
        const id =
          over >= 0 ? this.graph.nodes[over].id : (this.index.portAt(w.x, w.y, 12 / this.camera.scale)?.node ?? null);
        if (id !== this.connectHover) {
          this.connectHover = id;
          this.hover.set(id);
        }
        this.requestRender();
        return;
      }
      case 'resize': {
        const r = resizeRect(g.start, g.dir, w.x - g.wx, w.y - g.wy, g.min, e.altKey);
        this.resizing.set({ kind: g.target, id: g.id, ...r });
        this.requestRender();
        return;
      }
    }
  };

  private onPointerUp = (e: PointerEvent): void => {
    const g = this.gesture;
    if (!g) return;
    this.gesture = null;
    delete this.root.dataset.gesture;
    if (this.root.hasPointerCapture(e.pointerId)) this.root.releasePointerCapture(e.pointerId);
    switch (g.kind) {
      case 'pan':
        // A right button press without dragging opens the context menu instead.
        if (!g.moved && g.button === 2) this.suppressContextMenu = false;
        else if (g.button === 2) this.suppressContextMenu = true;
        return;
      case 'marquee': {
        const b = {
          minX: Math.min(g.x0, g.x1),
          minY: Math.min(g.y0, g.y1),
          maxX: Math.max(g.x0, g.x1),
          maxY: Math.max(g.y0, g.y1),
        };
        const inside = this.index.nodesInside(b).map((i) => this.graph.nodes[i].id);
        const groups = this.graph.groups
          .filter((x) => x.x >= b.minX && x.y >= b.minY && x.x + x.w <= b.maxX && x.y + x.h <= b.maxY)
          .map((x) => x.id);
        this.select({
          nodes: new Set([...g.base.nodes, ...inside]),
          edges: new Set(g.base.edges),
          groups: new Set([...g.base.groups, ...groups]),
        });
        return;
      }
      case 'move':
        this.drag.set(null);
        if (g.moved && (g.dx !== 0 || g.dy !== 0)) {
          this.change('move', (graph) => moveItems(graph, g.nodes, g.groups, g.dx, g.dy));
        }
        this.requestRender();
        return;
      case 'connect': {
        this.connectHover = null;
        this.hover.set(null);
        this.requestRender();
        const p = this.local(e);
        const target = this.connectTarget(g.from, toWorld(this.camera, p.x, p.y));
        const mine = { node: g.from.node, port: g.from.port };
        if (target) {
          this.change('connect', (graph) =>
            g.from.reverse ? connect(graph, target, mine) : connect(graph, mine, target),
          );
        } else if (this.index.nodeAt(g.wx, g.wy) < 0) {
          // Dropped on empty space: offer a node that comes already connected (FR-CNV-02).
          this.callbacks.onCreateRequest(p.x, p.y, { x: g.wx, y: g.wy }, g.from);
        }
        return;
      }
      case 'resize': {
        const r = this.resizing.get();
        this.resizing.set(null);
        const s = g.start;
        if (r && (r.x !== s.x || r.y !== s.y || r.w !== s.w || r.h !== s.h)) {
          this.change('resize', (graph) => setRect(graph, g.target, g.id, r));
        }
        return;
      }
    }
  };

  private suppressContextMenu = false;

  /**
   * The other end for an edge pulled from `from`: a fitting port under the cursor, else the fitting port
   * of the node under the cursor that faces the pulled port.
   */
  private connectTarget(from: PulledEdge, w: { x: number; y: number }): { node: string; port: string } | null {
    const fits = from.reverse ? canStart : canEnd;
    const port = this.index.portAt(w.x, w.y, 12 / this.camera.scale);
    if (port && port.node !== from.node) {
      const node = this.index.node(port.node);
      const def = node && portsOf(node).find((x) => x.id === port.port);
      if (def && fits(def)) return { node: port.node, port: port.port };
    }
    const i = this.index.nodeAt(w.x, w.y);
    if (i < 0) return null;
    const node = this.graph.nodes[i];
    if (node.id === from.node) return null;
    const role = from.reverse ? 'start' : 'end';
    const id = defaultPort(node, role, from, from.reverse ? usedStarts(this.graph, node.id) : undefined);
    return id ? { node: node.id, port: id } : null;
  }

  private updateHover(p: { x: number; y: number }): void {
    const hit = this.hitAt(p.x, p.y);
    this.setHover(hit.kind === 'edge' ? hit.id : null, hit.kind === 'node' ? hit.id : null);
    this.root.dataset.hover = hit.kind === 'node' && hit.port && !this.callbacks.readOnly ? 'port' : hit.kind;
  }

  private setHover(edge: string | null, node: string | null): void {
    if (edge !== this.hoverEdge) {
      this.hoverEdge = edge;
      this.requestRender();
    }
    if (node !== this.hoverNode) {
      this.hoverNode = node;
      this.hover.set(node);
      if (this.lod === 'mid') this.requestRender();
    }
  }

  private onWheel = (e: WheelEvent): void => {
    if (this.isEditable(e.target) && !e.ctrlKey) return;
    e.preventDefault();
    const p = this.local(e);
    const lineScale = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? this.height : 1;
    const dx = e.deltaX * lineScale;
    const dy = e.deltaY * lineScale;
    // Ctrl+wheel and touchpad pinch zoom; a touchpad two-finger swipe pans; a mouse wheel zooms.
    const touchpadPan = !e.ctrlKey && (dx !== 0 || (Math.abs(dy) < 50 && !Number.isInteger(dy)));
    if (touchpadPan) {
      this.setCamera({ ...this.camera, x: this.camera.x - dx, y: this.camera.y - dy });
      return;
    }
    const factor = Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0015));
    this.setCamera(zoomAt(this.camera, p.x, p.y, factor));
  };

  private onDoubleClick = (e: MouseEvent): void => {
    if (this.isEditable(e.target)) return;
    const p = this.local(e);
    const hit = this.hitAt(p.x, p.y);
    if (hit.kind === 'background') {
      this.callbacks.onCreateRequest(p.x, p.y, toWorld(this.camera, p.x, p.y), null);
      return;
    }
    if (hit.kind !== 'node') return;
    // Up close the DOM card handles double clicks on its texts (rename).
    if (this.lod === 'near' && e.target instanceof Element && e.target.closest('[data-canvas-text]')) return;
    // The host may open the node (a chapter); otherwise, from afar, the view flies to it.
    if (this.callbacks.onOpenNode?.(hit.id) || this.lod === 'near') return;
    const n = this.index.node(hit.id);
    if (n) {
      this.setCamera(
        fitBounds({ minX: n.x, minY: n.y, maxX: n.x + n.w, maxY: n.y + n.h }, this.width, this.height, 160, 1),
        true,
      );
    }
  };

  private onContextMenu = (e: MouseEvent): void => {
    e.preventDefault();
    if (this.suppressContextMenu) {
      this.suppressContextMenu = false;
      return;
    }
    if (this.isEditable(e.target)) return;
    let p = this.local(e);
    // The keyboard menu key reports no position: use the last pointer position.
    if (e.clientX === 0 && e.clientY === 0) p = this.lastPointer;
    const hit = this.hitAt(p.x, p.y);
    const s = this.selection.get();
    if (hit.kind !== 'background') {
      const key = hit.kind === 'node' ? 'nodes' : hit.kind === 'edge' ? 'edges' : 'groups';
      if (!s[key].has(hit.id)) this.select({ ...EMPTY_SELECTION, [key]: new Set([hit.id]) });
    }
    const rect = this.root.getBoundingClientRect();
    this.callbacks.onContextMenu(
      hit.kind === 'background' ? { kind: 'background' } : { kind: hit.kind, id: hit.id },
      p.x + rect.left,
      p.y + rect.top,
      toWorld(this.camera, p.x, p.y),
    );
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    if (this.isEditable(e.target)) return;
    const ctrl = e.ctrlKey || e.metaKey;
    const key = e.code;
    const handled = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    if (key === 'Space') {
      this.spaceDown = true;
      this.root.dataset.space = 'true';
      return handled();
    }
    if (key === 'Delete' || key === 'Backspace') return (handled(), this.deleteSelection());
    if (key === 'Enter' && !ctrl) {
      const s = this.selection.get();
      if (s.nodes.size === 1 && this.callbacks.onOpenNode?.([...s.nodes][0])) handled();
      return;
    }
    if (key === 'Escape') {
      if (this.gesture) this.cancelGesture();
      else this.select(EMPTY_SELECTION);
      return handled();
    }
    if (ctrl && key === 'KeyA') return (handled(), this.selectAll());
    if (ctrl && key === 'KeyC') return (handled(), void this.copy());
    if (ctrl && key === 'KeyX') return (handled(), void this.copy(true));
    if (ctrl && key === 'KeyV') return (handled(), void this.paste());
    if (ctrl && key === 'KeyD') return (handled(), this.duplicate());
    if (ctrl && key === 'KeyF') return (handled(), this.callbacks.onSearchRequest());
    if (ctrl && (key === 'Equal' || key === 'NumpadAdd')) return (handled(), this.zoomBy(ZOOM_STEP));
    if (ctrl && (key === 'Minus' || key === 'NumpadSubtract')) return (handled(), this.zoomBy(1 / ZOOM_STEP));
    if (ctrl && (key === 'Digit0' || key === 'Numpad0')) return (handled(), this.resetZoom());
    if (!ctrl && key === 'KeyF') {
      handled();
      return isEmptySelection(this.selection.get()) ? this.fit() : this.fitSelection();
    }
    const arrows: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    if (key in arrows) {
      const step = e.shiftKey ? GRID * 5 : GRID;
      const [x, y] = arrows[key];
      handled();
      return this.nudge(x * step, y * step);
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    if (e.code === 'Space') {
      this.spaceDown = false;
      delete this.root.dataset.space;
    }
  };

  private cancelGesture(): void {
    this.gesture = null;
    this.connectHover = null;
    this.hover.set(null);
    this.drag.set(null);
    this.resizing.set(null);
    delete this.root.dataset.gesture;
    this.requestRender();
  }

  // --- Rendering ---

  requestRender = (): void => {
    if (this.frame) return;
    this.frame = requestAnimationFrame(this.render);
  };

  private layer<T>(name: string, deps: unknown[], build: () => T): T {
    const prev = this.memo.get(name);
    if (prev && prev.deps.length === deps.length && prev.deps.every((d, i) => d === deps[i])) return prev.value as T;
    const value = build();
    this.memo.set(name, { deps, value });
    return value;
  }

  private render = (now: number): void => {
    this.frame = 0;
    if (this.animation) {
      const a = this.animation;
      const t = Math.min(1, (now - a.start) / a.duration);
      const k = 1 - (1 - t) ** 3;
      const lerp = (x: number, y: number) => x + (y - x) * k;
      // Interpolate the scale geometrically so zooming feels even.
      const scale = clampScale(a.from.scale * (a.to.scale / a.from.scale) ** k);
      this.camera = { x: lerp(a.from.x, a.to.x), y: lerp(a.from.y, a.to.y), scale };
      if (t >= 1) {
        this.camera = a.to;
        this.animation = null;
      } else {
        this.requestRender();
      }
    }
    this.lod = lodFor(this.camera.scale, this.lod, this.quality.farBelow);
    const sel = this.selection.get();
    const hl = this.highlight.get();
    const drag = this.drag.get();
    const resizing = this.resizing.get();
    const input: SceneInput = {
      index: this.index,
      selection: sel,
      hoverEdge: this.hoverEdge,
      highlight: hl.ids,
      current: hl.current,
      drag,
      lod: this.lod,
      straight: this.lod === 'far' && this.index.graph.edges.length > this.quality.farCurveEdges,
      resizing,
      theme: this.theme,
    };
    // A node being resized is drawn from a patched index so edges follow its ports.
    if (resizing?.kind === 'node') {
      const graph = {
        ...this.index.graph,
        nodes: this.index.graph.nodes.map((n) => (n.id === resizing.id ? { ...n, ...resizing, kind: n.kind } : n)),
      };
      input.index = new GraphIndex(graph);
    }
    const edges = this.layer(
      'edges',
      [input.index, sel.edges, this.hoverEdge, drag, this.lod === 'far', input.straight, this.theme],
      () => buildEdges(input),
    );
    const nodes = this.layer('nodes', [input.index, sel.nodes, hl, drag, this.lod, this.theme], () =>
      buildNodes(input),
    );
    const groups = this.layer('groups', [input.index, sel.groups, drag, resizing, this.theme], () =>
      buildGroups(input),
    );
    const links = this.layer('links', [input.index, drag], () => buildLinks(input));

    let overlayBoxes = EMPTY_BATCH;
    let overlaySegs = EMPTY_BATCH;
    let overlayDiscs = EMPTY_BATCH;
    const g = this.gesture;
    if (g?.kind === 'marquee') overlayBoxes = marqueeBatch(g.x0, g.y0, g.x1, g.y1, this.theme);
    if (g?.kind === 'connect') overlaySegs = previewBatch(this.previewCurve(g.from, g.wx, g.wy), this.theme);
    // Mid zoom: WebGL shows the free anchors of the node under the cursor (up close the DOM card does).
    const hot = g?.kind === 'connect' ? this.connectHover : g ? null : this.hoverNode;
    const hotNode = hot && this.lod === 'mid' ? this.index.node(hot) : undefined;
    if (hotNode) overlayDiscs = anchorBatch(hotNode, this.theme);

    this.renderer.draw({
      camera: this.camera,
      groups,
      edges: edges.edges,
      arrows: edges.arrows,
      links: links.links,
      linkArrows: links.arrows,
      nodes: nodes.nodes,
      ports: nodes.ports,
      overlayBoxes,
      overlaySegs,
      overlayDiscs,
      grid: { bg: this.theme.bg, dot: this.theme.dot, step: GRID },
    });
    this.domLayer.style.transform = `translate(${this.camera.x}px, ${this.camera.y}px) scale(${this.camera.scale})`;
    this.trackMotion();
    this.publishView();
  };

  /** The edge following the cursor: out of the pulled port, or into it when pulled from an input. */
  private previewCurve(from: PulledEdge, wx: number, wy: number) {
    const cursor = { x: wx, y: wy };
    const away = OPPOSITE_FACE[from.face];
    return from.reverse ? edgeCurve(cursor, from, away, from.face) : edgeCurve(from, cursor, from.face, away);
  }

  /**
   * While the camera moves, the DOM layer is a GPU layer (smooth panning); shortly after it stops the
   * hint is dropped, so the browser draws the text again at the final scale and it stays crisp.
   */
  private trackMotion(): void {
    const c = this.camera;
    const prev = this.lastCamera;
    this.lastCamera = c;
    if (!prev || (prev.x === c.x && prev.y === c.y && prev.scale === c.scale)) return;
    this.domLayer.style.willChange = 'transform';
    if (this.motionTimer !== null) clearTimeout(this.motionTimer);
    this.motionTimer = setTimeout(() => {
      this.motionTimer = null;
      this.domLayer.style.willChange = '';
    }, 200);
  }

  /**
   * Mid-zoom titles keep a constant on-screen size: the layer counter-scales them through a variable.
   * Set only when it matters: a custom property change restyles the whole DOM layer.
   */
  private fitLabels(): void {
    if (this.lod === 'mid' && this.labelScale !== this.camera.scale) {
      this.labelScale = this.camera.scale;
      this.domLayer.style.setProperty('--label-scale', String(1 / this.camera.scale));
    }
  }

  private publishView(): void {
    if (this.quality.labelEveryFrame) this.fitLabels();
    this.view.set({ camera: this.camera, lod: this.lod, width: this.width, height: this.height });

    const last = this.nearPublished;
    const now = performance.now();
    const refresh = this.quality.nearRefreshMs;
    const urgent =
      last.lod !== this.lod ||
      last.graph !== this.graph ||
      Math.abs(Math.log(this.camera.scale / (last.scale || 1))) > 0.15;
    if (!urgent && now - last.at < refresh) {
      // Catch up once the camera stops.
      this.nearTimer ??= setTimeout(() => {
        this.nearTimer = null;
        this.publishNear();
      }, refresh);
      return;
    }
    this.publishNear();
  }

  private publishNear(): void {
    if (this.nearTimer !== null) {
      clearTimeout(this.nearTimer);
      this.nearTimer = null;
    }
    this.nearPublished = { at: performance.now(), scale: this.camera.scale, lod: this.lod, graph: this.graph };
    if (!this.quality.labelEveryFrame) this.fitLabels();
    const q = this.quality;
    const scale = this.camera.scale;
    const prev = this.near.get();
    let ids: readonly string[] = [];
    let edgeLabels: readonly EdgeLabel[];
    // Near: a wide margin so cards are mounted before they scroll in. Mid: titles are light, a small margin will do.
    const margin = this.lod === 'near' ? q.nearMarginPx : q.nearMarginPx / 3;
    if (this.lod === 'near' || (this.lod === 'mid' && scale >= q.labelScale)) {
      const visible = this.index.nodesIn(visibleBounds(this.camera, this.width, this.height, margin));
      if (this.lod === 'near') ids = visible.map((i) => this.graph.nodes[i].id);
      else if (visible.length <= q.labelLimit) {
        const nodes = this.graph.nodes;
        ids = visible.filter((i) => nodes[i].w * scale >= q.labelMinWidth).map((i) => nodes[i].id);
      }
    }
    if (this.lod === 'near') {
      const b = visibleBounds(this.camera, this.width, this.height, margin);
      const labels: EdgeLabel[] = [];
      this.graph.edges.forEach((e, i) => {
        const c = this.index.curves[i];
        if (!e.label || !c) return;
        const x = (c.x1 + c.x2) / 2;
        const y = (c.y1 + c.y2) / 2;
        if (x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY) labels.push({ id: e.id, text: e.label, x, y });
      });
      const sameLabels =
        labels.length === prev.edgeLabels.length &&
        labels.every((l, i) => {
          const p = prev.edgeLabels[i];
          return p.id === l.id && p.text === l.text && p.x === l.x && p.y === l.y;
        });
      edgeLabels = sameLabels ? prev.edgeLabels : labels;
    } else {
      edgeLabels = prev.edgeLabels.length ? [] : prev.edgeLabels;
    }
    const sameIds = ids.length === prev.ids.length && ids.every((id, i) => id === prev.ids[i]);
    if (!sameIds || prev.lod !== this.lod || edgeLabels !== prev.edgeLabels) {
      this.near.set({ lod: this.lod, ids: sameIds ? prev.ids : ids, edgeLabels });
    }
  }

  /** Nodes of the current graph, for the DOM layer. */
  nodeById(id: string): GraphNode | undefined {
    return this.index.node(id);
  }

  destroy(): void {
    cancelAnimationFrame(this.frame);
    if (this.nearTimer !== null) clearTimeout(this.nearTimer);
    if (this.motionTimer !== null) clearTimeout(this.motionTimer);
    this.cleanups.forEach((c) => c());
    this.renderer.destroy();
  }
}
