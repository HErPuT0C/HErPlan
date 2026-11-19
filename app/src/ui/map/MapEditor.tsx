// The project map (F5-01): the whole project on one canvas. Objects (chapters, documents, cards of the world
// database, pictures) are dragged onto it from the list on the left, or added there with a click; notes,
// frames and arrows come from the canvas itself. Double click on an object's card opens the object.

import {
  ArrowDownToLine,
  ArrowLeftToLine,
  ArrowRightToLine,
  ArrowUpToLine,
  Brush,
  ChartColumn,
  Map as MapIcon,
  Trash,
} from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { searchKey } from '../../canvas/ops';
import type { CanvasEngine } from '../../canvas/engine';
import type { GraphDoc, GraphNode } from '../../canvas/model';
import { useAtom, useStore } from '../../core/useStore';
import type { ProjectData } from '../../core/project/types';
import { docName, listDocuments } from '../../documents/model';
import { t } from '../../i18n';
import {
  mapGraph,
  MAP_REF_KINDS,
  newMapGraph,
  refLabel,
  refNode,
  refOf,
  REF_COLORS,
  REF_NODE,
  type MapRef,
  type MapRefKind,
} from '../../map/model';
import { platform } from '../../platform';
import { mapRequest, openDocument, openEntity, revealInStory } from '../../state/navigation';
import type { OpenProject } from '../../state/project';
import { asEntity, listEntities } from '../../story/entities';
import { graphTitle } from '../../story/flow';
import { allGraphs } from '../../story/model';
import { entitySearchText } from '../../world/mentions';
import { typesFile } from '../../world/schema';
import { CanvasView, type CanvasExtensions } from '../canvas/CanvasView';
import { EmptyState, Spinner, toast, type MenuEntry } from '../components';
import { useAsync } from '../useAsync';
import { useAssetDropTarget } from '../assetDrag';
import { IMAGE_EXT } from '../world/ImageField';
import { typeName } from '../world/typeNames';
import { MapContext, RefIcon, REF_KIND_NAMES } from './cards';
import {
  addColumnAt,
  addRowAt,
  cellAt,
  CHART_KIND,
  chartOf,
  chartText,
  DRAWING_KIND,
  drawingPath,
  removeColumnAt,
  removeRowAt,
  TABLE_KIND,
  tableCells,
  tableText,
} from '../../map/diagram';
import { useDrawingWindow } from '../drawing/DrawingHost';
import { drawingsFolder, newDrawing, openPicture } from '../drawing/drawFile';
import { ChartDialog } from './ChartDialog';
import { MapOpenNode } from './diagramCards';
import { MapDrawTools } from './MapDrawTools';
import './map.css';

interface Item {
  ref: MapRef;
  label: string;
  hint: string;
  /** More to find it by than its name and hint: a card's description and fields (0.7.3). */
  more?: string;
}

/** What a card of the map is found by in the canvas search besides its title: the object as it is now. */
function mapNodeText(node: GraphNode, data: ProjectData): string {
  if (node.kind === TABLE_KIND) return tableText(node);
  if (node.kind === CHART_KIND) return chartText(node);
  const ref = refOf(node);
  if (!ref) return '';
  const label = refLabel(data, ref) ?? '';
  if (ref.kind === 'entity') {
    const e = asEntity(data.entities[ref.id]);
    return e ? `${label}\n${entitySearchText(data, e)}` : label;
  }
  if (ref.kind === 'asset') return `${label}\n${ref.id.replace(/^assets\//, '')}`;
  return label;
}

export function openRef(ref: MapRef, project: OpenProject): void {
  if (ref.kind === 'entity') openEntity(ref.id);
  else if (ref.kind === 'document') openDocument(ref.id);
  else if (ref.kind === 'chapter') revealInStory({ graph: ref.id });
  else
    void platform()
      .openAsset(project.dir, ref.id)
      .catch(() => toast({ kind: 'error', text: t('map.cannotOpen') }));
}

export function MapEditor({ project }: { project: OpenProject }) {
  const { store, readOnly } = project;
  const graphId = useStore(store, (s) => mapGraph(s)?.id ?? null);

  // The map exists from the first visit; making it is not a step to undo.
  useEffect(() => {
    if (graphId || readOnly) return;
    const g = newMapGraph(t('module.map'));
    store.dispatch(
      t('map.step.create'),
      (d) => {
        if (!mapGraph(d)) d.graphs[g.id] = g as unknown as ProjectData['graphs'][string];
      },
      { history: false },
    );
  }, [graphId, readOnly, store]);

  if (!graphId) {
    return readOnly ? (
      <div className="module-placeholder">
        <EmptyState
          icon={<MapIcon size={48} strokeWidth={1.4} />}
          title={t('module.map')}
          text={t('map.emptyReadOnly')}
        />
      </div>
    ) : (
      <Spinner />
    );
  }
  return (
    <MapContext.Provider value={project}>
      <MapWorkspace project={project} graphId={graphId} />
    </MapContext.Provider>
  );
}

function MapWorkspace({ project, graphId }: { project: OpenProject; graphId: string }) {
  const { store, readOnly } = project;
  const [engine, setEngine] = useState<CanvasEngine | null>(null);
  const canvasBox = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ item: Item; x: number; y: number; over: boolean } | null>(null);

  const graph = () => store.getState().graphs[graphId] as unknown as GraphDoc | undefined;
  const nodeOf = (id: string) => graph()?.nodes.find((n) => n.id === id);
  const drawing = useDrawingWindow();
  const [chartFor, setChartFor] = useState<string | null>(null);

  /** Changes one card of the map as one undo step. */
  const changeNode = (id: string, label: string, recipe: (node: GraphNode) => void) => {
    if (readOnly) return;
    store.dispatch(label, (d) => {
      const node = (mapGraph(d) as GraphDoc | undefined)?.nodes.find((n) => n.id === id);
      if (node) recipe(node);
    });
  };

  /**
   * The drawing window for a canvas card: its drawing, or a new one in the drawings folder named after the card.
   * A drawing shared with another card (the card was copied) is saved as a picture of its own.
   */
  const openDrawing = (id: string) => {
    const node = nodeOf(id);
    if (!node || readOnly) return;
    const path = drawingPath(node);
    const name = node.title.trim() || t('map.kind.drawing');
    const shared = !!path && (graph()?.nodes ?? []).some((n) => n.id !== id && drawingPath(n) === path);
    drawing.draw(
      async () => {
        const folder = await drawingsFolder(project);
        if (path) {
          try {
            return await openPicture(project, path, shared ? { folder, name } : undefined);
          } catch {
            // The picture is gone: a new drawing in its place.
          }
        }
        return newDrawing(project, folder, name);
      },
      (saved) => {
        const now = nodeOf(id);
        if (now && drawingPath(now) !== saved) changeNode(id, t('map.step.drawing'), (n) => (n.drawing = saved));
      },
    );
  };

  /** A double click on a card, or Enter: opens what it points at, its drawing, or the data of its chart. */
  const openNode = (id: string): boolean => {
    const node = nodeOf(id);
    if (!node) return false;
    if (node.kind === CHART_KIND) {
      if (!readOnly) setChartFor(id);
      return true;
    }
    if (node.kind === DRAWING_KIND) {
      openDrawing(id);
      return true;
    }
    const ref = refOf(node);
    if (!ref) return false;
    if (refLabel(store.getState(), ref) !== null) openRef(ref, project);
    return true;
  };

  /** Entries at the top of a card's menu: rows and columns of a table where it was clicked, the chart's data… */
  const menuEntries = (id: string, world: { x: number; y: number }): MenuEntry[] => {
    const node = nodeOf(id);
    if (!node || readOnly) return [];
    if (node.kind === CHART_KIND) {
      return [
        { id: 'chart', label: t('map.chart.edit'), icon: <ChartColumn size={16} />, onSelect: () => setChartFor(id) },
      ];
    }
    if (node.kind === DRAWING_KIND) {
      return [{ id: 'draw', label: t('map.drawing.edit'), icon: <Brush size={16} />, onSelect: () => openDrawing(id) }];
    }
    if (node.kind !== TABLE_KIND) return [];
    const cells = tableCells(node);
    const cell = cellAt(node, world.x - node.x, world.y - node.y);
    const row = cell?.row ?? cells.length - 1;
    const col = cell?.col ?? cells[0].length - 1;
    const step = (recipe: (n: GraphNode) => void) => () => changeNode(id, t('map.step.table'), recipe);
    const entries: MenuEntry[] = [
      {
        id: 'row-above',
        label: t('map.table.rowAbove'),
        icon: <ArrowUpToLine size={16} />,
        onSelect: step((n) => addRowAt(n, row)),
      },
      {
        id: 'row-below',
        label: t('map.table.rowBelow'),
        icon: <ArrowDownToLine size={16} />,
        onSelect: step((n) => addRowAt(n, row + 1)),
      },
      {
        id: 'col-left',
        label: t('map.table.colLeft'),
        icon: <ArrowLeftToLine size={16} />,
        onSelect: step((n) => addColumnAt(n, col)),
      },
      {
        id: 'col-right',
        label: t('map.table.colRight'),
        icon: <ArrowRightToLine size={16} />,
        onSelect: step((n) => addColumnAt(n, col + 1)),
      },
    ];
    if (cell && cells.length > 1) {
      entries.push({
        id: 'row-del',
        label: t('map.table.removeRow'),
        icon: <Trash size={16} />,
        onSelect: step((n) => removeRowAt(n, cell.row)),
      });
    }
    if (cell && cells[0].length > 1) {
      entries.push({
        id: 'col-del',
        label: t('map.table.removeColumn'),
        icon: <Trash size={16} />,
        onSelect: step((n) => removeColumnAt(n, cell.col)),
      });
    }
    return entries;
  };

  // The canvas keeps the extensions it started with: they reach the handlers of the latest render through this.
  const handlers = useRef({ openNode, menuEntries });
  useLayoutEffect(() => {
    handlers.current = { openNode, menuEntries };
  });

  const ext: CanvasExtensions = useMemo(
    () => ({
      onOpenNode: (id) => handlers.current.openNode(id),
      menuEntries: (target, world) => (target.kind === 'node' ? handlers.current.menuEntries(target.id, world) : []),
      nodeText: mapNodeText,
    }),
    [],
  );
  const chartNode = chartFor ? nodeOf(chartFor) : undefined;

  // "Show this card on the map" (a picture's "where used").
  const wanted = useAtom(mapRequest);
  useEffect(() => {
    if (!wanted || !engine) return;
    mapRequest.set(null);
    if (wanted.node && nodeOf(wanted.node)) {
      engine.select({ nodes: new Set([wanted.node]), edges: new Set(), groups: new Set() });
      engine.reveal(wanted.node);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted, engine]);

  const place = (item: Item, world: { x: number; y: number }) => {
    if (!engine || readOnly) return;
    const sample = refNode(item.ref, 0, 0, '');
    engine.createNodeAt(
      REF_NODE,
      { x: world.x - sample.w / 2, y: world.y - 20 },
      t(REF_KIND_NAMES[item.ref.kind]),
      null,
      (n) => {
        n.ref = { ...item.ref };
        n.color = REF_COLORS[item.ref.kind];
        n.w = sample.w;
        n.h = sample.h;
      },
    );
  };

  // Objects are dragged with pointer events (HTML5 drag and drop is off in the desktop window, see
  // usePointerDrag); a click without moving adds the object in the middle of the view.
  const startDrag = (item: Item) => (e: ReactPointerEvent) => {
    if (e.button !== 0 || readOnly) return;
    const x0 = e.clientX;
    const y0 = e.clientY;
    let moved = false;
    const overCanvas = (x: number, y: number) => {
      const r = canvasBox.current?.getBoundingClientRect();
      return !!r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    };
    const move = (m: PointerEvent) => {
      if (!moved && Math.hypot(m.clientX - x0, m.clientY - y0) < 5) return;
      moved = true;
      document.documentElement.dataset.dragging = '';
      setDrag({ item, x: m.clientX, y: m.clientY, over: overCanvas(m.clientX, m.clientY) });
    };
    const up = (u: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      delete document.documentElement.dataset.dragging;
      setDrag(null);
      if (!engine) return;
      if (!moved) place(item, engine.viewCenter());
      else if (overCanvas(u.clientX, u.clientY)) place(item, engine.worldAtClient(u.clientX, u.clientY));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // A picture dragged from the assets tab (0.7.3) goes onto the map where it is let go.
  const assetOver = useAssetDropTarget(canvasBox, {
    accepts: (path, folder) => !readOnly && !folder && IMAGE_EXT.test(path),
    // Several picked pictures go side by side (0.7.5).
    drop: (_path, point, group) => {
      if (!engine) return;
      const at = engine.worldAtClient(point.x, point.y);
      group
        .filter((g) => !g.folder && IMAGE_EXT.test(g.path))
        .forEach((g, i) => {
          const item: Item = {
            ref: { kind: 'asset', id: g.path },
            label: g.path.slice(g.path.lastIndexOf('/') + 1),
            hint: '',
          };
          place(item, { x: at.x + i * 230, y: at.y });
        });
    },
  });

  return (
    <MapOpenNode.Provider value={(id) => void openNode(id)}>
      <div className="map" data-tour="map">
        <ObjectList project={project} onStart={startDrag} />
        <div
          ref={canvasBox}
          className={['map-canvas', (drag?.over || assetOver) && 'map-canvas-over'].filter(Boolean).join(' ')}
        >
          <CanvasView project={project} graphId={graphId} cameraKey={`map:${graphId}`} ext={ext} onEngine={setEngine} />
          {engine && !readOnly && <MapDrawTools engine={engine} />}
        </div>
        {drag && (
          <div className="map-drag-ghost" style={{ left: drag.x + 12, top: drag.y + 8 }}>
            <RefIcon kind={drag.item.ref.kind} /> {drag.item.label}
          </div>
        )}
      </div>
      {drawing.window}
      {chartNode && (
        <ChartDialog
          title={chartNode.title || t('map.kind.chart')}
          data={chartOf(chartNode)}
          onSave={(data) => changeNode(chartNode.id, t('map.step.chart'), (n) => (n.chart = data))}
          onClose={() => setChartFor(null)}
        />
      )}
    </MapOpenNode.Provider>
  );
}

/** Everything that can go onto the map, by kind, filtered by name. */
function ObjectList({
  project,
  onStart,
}: {
  project: OpenProject;
  onStart: (item: Item) => (e: ReactPointerEvent) => void;
}) {
  const data = useStore(project.store, (s) => s);
  const [query, setQuery] = useState('');
  // A picture pointed at in the list shows itself beside the list (0.7.4).
  const [preview, setPreview] = useState<{ path: string; top: number; left: number } | null>(null);
  const assets = useAsync(() => platform().listAssets(project.dir), [project.dir], null);
  const schema = useMemo(() => typesFile(data), [data]);
  const groups = useMemo(() => {
    const items: Record<MapRefKind, Item[]> = {
      chapter: allGraphs(data)
        .filter((g) => g.kind === 'story' || g.kind === 'chapter')
        .map((g) => ({ ref: { kind: 'chapter', id: g.id }, label: graphTitle(data, g.id), hint: '' })),
      document: listDocuments(data).map((d) => ({
        ref: { kind: 'document', id: d.id },
        label: docName(d.path),
        hint: d.path.split('/').slice(0, -1).join(' / '),
      })),
      entity: listEntities(data).map((e) => ({
        ref: { kind: 'entity', id: e.id },
        label: e.name || t('story.untitled'),
        hint: typeName(schema.types.find((x) => x.id === e.type)),
        more: entitySearchText(data, e),
      })),
      // A picture is found by the folders it is in, too (0.7.3).
      asset: (assets ?? [])
        .filter((a) => a.kind === 'file' && IMAGE_EXT.test(a.path))
        .map((a) => ({
          ref: { kind: 'asset', id: a.path },
          label: a.path.split('/').pop() ?? a.path,
          hint: a.path.split('/').slice(1, -1).join(' / '),
        })),
    };
    return items;
  }, [data, assets, schema]);
  const q = searchKey(query);
  /** Names that have the query first, then what has it in the description, fields or folders. */
  const sorted = (list: Item[]) => [
    ...list.filter((x) => searchKey(x.label).includes(q)),
    ...list.filter((x) => !searchKey(x.label).includes(q)),
  ];
  return (
    <nav className="map-objects" aria-label={t('map.objects')}>
      <input
        className="input"
        type="search"
        value={query}
        placeholder={t('map.search')}
        aria-label={t('map.search')}
        onChange={(e) => setQuery(e.target.value)}
      />
      <p className="muted small">{t('map.hint')}</p>
      <div className="map-objects-list">
        {MAP_REF_KINDS.map((kind) => {
          const shown = q
            ? sorted(groups[kind].filter((x) => searchKey(`${x.label} ${x.hint} ${x.more ?? ''}`).includes(q)))
            : groups[kind];
          if (!shown.length) return null;
          return (
            <section key={kind} className="map-objects-group">
              <h3 className="insp-heading">{t(GROUP_NAMES[kind])}</h3>
              {shown.map((item) => (
                <button
                  key={`${kind}:${item.ref.id}`}
                  type="button"
                  className="schema-item map-object"
                  title={item.hint || item.label}
                  onPointerDown={(e) => {
                    setPreview(null);
                    onStart(item)(e);
                  }}
                  onMouseEnter={(e) => {
                    if (kind !== 'asset' || document.documentElement.dataset.dragging !== undefined) return;
                    const r = e.currentTarget.getBoundingClientRect();
                    setPreview({ path: item.ref.id, top: r.top, left: r.right + 8 });
                  }}
                  onMouseLeave={() => setPreview(null)}
                >
                  <RefIcon kind={kind} />
                  <span className="docs-item-name">{item.label}</span>
                  {kind === 'asset' && item.hint && <span className="muted small map-object-hint">{item.hint}</span>}
                </button>
              ))}
            </section>
          );
        })}
      </div>
      {preview && <PicturePreview project={project} {...preview} />}
    </nav>
  );
}

/** A picture of the list, bigger, beside it while it is pointed at. */
function PicturePreview({
  project,
  path,
  top,
  left,
}: {
  project: OpenProject;
  path: string;
  top: number;
  left: number;
}) {
  const url = useAsync(() => platform().assetUrl(project.dir, path), [project.dir, path], '');
  if (!url) return null;
  return (
    <div
      className="map-preview"
      style={{ top: Math.max(8, Math.min(top - 40, window.innerHeight - 260)), left }}
      aria-hidden="true"
    >
      <img src={url} alt="" draggable={false} />
      <span className="muted small">{path.replace(/^assets\//, '')}</span>
    </div>
  );
}

const GROUP_NAMES = {
  chapter: 'map.group.chapters',
  document: 'map.group.documents',
  entity: 'map.group.entities',
  asset: 'map.group.assets',
} as const;
