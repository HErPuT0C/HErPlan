import {
  BookOpen,
  Bug,
  ChevronRight,
  CircleAlert,
  CornerDownRight,
  Diamond,
  FileJson,
  GitBranch,
  PanelRight,
  Play,
  TriangleAlert,
  Variable,
} from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { benchGraph } from '../../canvas/bench';
import type { CanvasEngine, GraphHooks, HitTarget } from '../../canvas/engine';
import { createNode } from '../../canvas/ops';
import { newId } from '../../core/ids';
import type { ProjectData } from '../../core/project/types';
import { APP_VERSION } from '../../core/version';
import { useAtom, useAtomSelect, useStore } from '../../core/useStore';
import { t } from '../../i18n';
import { platform } from '../../platform';
import { openVariables, revealRequest } from '../../state/navigation';
import type { OpenProject } from '../../state/project';
import { settings } from '../../state/settings';
import { checkProject, countBySeverity } from '../../story/checks';
import { exportJson } from '../../story/export';
import { graphPath, graphTitle, refKey } from '../../story/flow';
import { HEADER_H } from '../../canvas/model';
import { CHOICE_PROMPT_H, FOLDED_LINES } from '../../story/kinds';
import { addMark, linkMark, plotSources } from '../../story/marks';
import {
  allGraphs,
  CHOICE_ROW_H,
  DIALOGUE_LINE_H,
  DIALOGUE_TOP,
  findNode,
  graphOf,
  OFF_FLOW,
  PLOT_DEVICES,
  storyRoot,
  type MarkAnchor,
  type NodeRef,
  type StoryNode,
} from '../../story/model';
import {
  addLink,
  chapterGraphsOf,
  createChapterGraph,
  deleteChapterGraphs,
  newStoryGraph,
  pasteChapterGraphs,
  storyNode,
} from '../../story/ops';
import { startPlay } from '../../story/play';
import { Button, EmptyState, IconButton, MenuButton, toast } from '../components';
import { errorText } from '../errors';
import { CanvasView, type CanvasExtensions } from '../canvas/CanvasView';
import { DeviceIcon } from '../canvas/kindIcons';
import { StoryContext, storyIndex, type IncomingLink, type StoryActions } from './context';
import { Inspector, type InspectFocus } from './Inspector';
import { PlayPanel, type PlayHistory } from './PlayPanel';
import { ProblemsPanel } from './ProblemsPanel';
import './cards';
import './story.css';

type Side = 'inspector' | 'play' | 'problems' | null;

/** Where to go once the canvas of a graph is ready. */
interface Pending {
  graph: string;
  node?: string;
  highlight?: string[];
  field?: string;
}

/** The option or dialogue line at a height inside a card (see the card layout in story/kinds.ts). */
function cardRow(node: StoryNode, y: number): { anchor: MarkAnchor; index: number } | null {
  if (node.kind === 'choice') {
    const i = Math.floor((y - HEADER_H - CHOICE_PROMPT_H) / CHOICE_ROW_H);
    const o = node.options?.[i];
    return o && i >= 0 ? { anchor: { kind: 'option', id: o.id }, index: i } : null;
  }
  if (node.kind === 'dialogue') {
    const lines = node.lines ?? [];
    const shown = node.expanded ? lines.length : Math.min(lines.length, FOLDED_LINES);
    const i = Math.floor((y - HEADER_H - DIALOGUE_TOP) / DIALOGUE_LINE_H);
    return i >= 0 && i < shown ? { anchor: { kind: 'line', id: lines[i].id }, index: i } : null;
  }
  return null;
}

/** Plot links and problems by node, rebuilt shortly after the project changes; no checks when they are off. */
function useStoryIndex(project: OpenProject, checks: boolean): void {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const rebuild = () => {
      timer = null;
      const data = project.store.getState();
      const incoming = new Map<string, IncomingLink[]>();
      for (const g of allGraphs(data)) {
        for (const src of plotSources(g)) {
          for (const link of src.links) {
            const key = refKey(link);
            const entry: IncomingLink = { kind: src.device, from: src.at, title: src.title, mark: src.mark?.id };
            incoming.set(key, [...(incoming.get(key) ?? []), entry]);
          }
        }
      }
      const problems = checks ? checkProject(data) : [];
      const rank = { error: 3, warning: 2, info: 1 } as const;
      const worst = new Map<string, 'error' | 'warning' | 'info'>();
      for (const p of problems) {
        if (!p.graph || !p.node) continue;
        const key = refKey({ graph: p.graph, node: p.node });
        const was = worst.get(key);
        if (!was || rank[p.severity] > rank[was]) worst.set(key, p.severity);
      }
      storyIndex.set({ incoming, worst, problems });
    };
    rebuild();
    const unsubscribe = project.store.subscribe(() => {
      if (timer === null) timer = setTimeout(rebuild, 250);
    });
    return () => {
      unsubscribe();
      if (timer !== null) clearTimeout(timer);
    };
  }, [project, checks]);
}

/** Where a story tab is: the graph it shows (kept in the tab, see workspace.ts) and its canvas cameras. */
export interface StoryTabProps {
  /** The workspace tab, so two story tabs keep separate places and cameras. */
  tab: string;
  /** The graph the tab showed last time. */
  graph?: string;
  onGraph: (graph: string) => void;
}

/** The Story tab (FR-NAR-*): chapter overview and chapter graphs on the canvas, with logic and playthrough. */
export function StoryEditor({ project, ...tab }: { project: OpenProject } & StoryTabProps) {
  const rootId = useStore(project.store, (s) => storyRoot(s)?.id);
  if (!rootId) return <EmptyStory project={project} />;
  return <StoryWorkspace project={project} rootId={rootId} {...tab} />;
}

function EmptyStory({ project }: { project: OpenProject }) {
  const create = () => {
    const g = newStoryGraph(t('module.story'), t('story.kind.start'));
    project.store.dispatch(t('canvas.step.createGraph'), (d) => {
      d.graphs[g.id] = g as unknown as ProjectData['graphs'][string];
    });
  };
  return (
    <div className="module-placeholder">
      <EmptyState
        icon={<GitBranch size={48} strokeWidth={1.4} />}
        title={t('module.story')}
        text={t('canvas.storyEmpty')}
        actions={
          !project.readOnly && (
            <Button variant="primary" onClick={create}>
              {t('canvas.createStory')}
            </Button>
          )
        }
      />
    </div>
  );
}

function StoryWorkspace({
  project,
  rootId,
  tab,
  graph: initialGraph,
  onGraph,
}: { project: OpenProject; rootId: string } & StoryTabProps) {
  const { store, readOnly } = project;
  const [graphId, setGraphState] = useState(() =>
    initialGraph && store.getState().graphs[initialGraph] ? initialGraph : rootId,
  );
  // The workspace hears where the tab went (to remember it); the callback changes with every render.
  const onGraphRef = useRef(onGraph);
  useLayoutEffect(() => {
    onGraphRef.current = onGraph;
  });
  const setGraphId = useCallback((id: string) => {
    setGraphState(id);
    onGraphRef.current(id);
  }, []);
  const [engine, setEngine] = useState<CanvasEngine | null>(null);
  const [chosenSide, setSide] = useState<Side>('inspector');
  const [focus, setFocus] = useState<InspectFocus | null>(null);
  const [play, setPlay] = useState<PlayHistory | null>(null);
  const pending = useRef<Pending | null>(null);
  const exists = useStore(store, (s) => !!s.graphs[graphId]);
  const path = useStore(store, (s) => graphPath(s, graphId).join('/'));
  const { problems } = useAtom(storyIndex);
  const counts = countBySeverity(problems);
  const showChecks = useAtomSelect(settings, (s) => s.showChecks);
  useStoryIndex(project, showChecks);
  // Problems were open when checks got switched off in the settings: show the inspector instead.
  const side = chosenSide === 'problems' && !showChecks ? 'inspector' : chosenSide;

  // A deleted chapter (or an undone creation) takes the view back to the overview.
  const current = exists ? graphId : rootId;

  /** Applies a pending selection once the canvas of its graph exists. */
  const settle = useCallback((e: CanvasEngine | null) => {
    const p = pending.current;
    if (!e || !p || e.graphId !== p.graph) return;
    pending.current = null;
    if (p.node) {
      e.select({ nodes: new Set([p.node]), edges: new Set(), groups: new Set() });
      e.reveal(p.node);
    }
    if (p.highlight) e.setHighlight(new Set(p.highlight), p.node ?? null);
    if (p.node && p.field) setFocus({ node: p.node, field: p.field, at: performance.now() });
  }, []);

  const go = useCallback(
    (target: Pending) => {
      pending.current = target;
      if (target.graph === current && engine) settle(engine);
      else setGraphId(target.graph);
    },
    [current, engine, settle, setGraphId],
  );

  const actions: StoryActions = useMemo(
    () => ({
      project,
      graphId: current,
      show: (ref, field) => {
        if (field) setSide('inspector');
        go({ graph: ref.graph, node: ref.node || undefined, field });
      },
      openChapter: (nodeId) => {
        const node = findNode(store.getState(), { graph: current, node: nodeId });
        if (node?.graph && store.getState().graphs[node.graph]) setGraphId(node.graph);
      },
      inspect: (nodeId, field) => {
        setSide('inspector');
        go({ graph: current, node: nodeId, field: field ?? 'title' });
      },
      edit: (label, recipe, mergeKey) => {
        if (readOnly) return;
        store.dispatch(
          label,
          (d) => {
            const g = graphOf(d, current);
            if (g) recipe(g, d);
          },
          mergeKey ? { mergeKey } : {},
        );
      },
    }),
    [project, store, current, go, readOnly, setGraphId],
  );

  // "Where used" and problems in other editors ask to show a place here. A request is used once, so
  // switching tabs or reopening the editor does not jump back to an old place.
  const goRef = useRef(go);
  useLayoutEffect(() => {
    goRef.current = go;
  });
  useEffect(() => {
    const take = () => {
      const r = revealRequest.get();
      if (!r) return;
      revealRequest.set(null);
      if (r.field) setSide('inspector');
      goRef.current({ graph: r.graph, node: r.node, highlight: r.highlight, field: r.field });
    };
    // A request made just before this editor opened (the workspace switched to it) is taken right away.
    const timer = setTimeout(take, 0);
    const unsubscribe = revealRequest.subscribe(take);
    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, []);

  /** A new playthrough state; the canvas follows the current node. */
  const follow = (history: PlayHistory) => {
    setPlay(history);
    const pos = history[history.length - 1]?.pos;
    if (pos) go({ graph: pos.graph, node: pos.node, highlight: [pos.node] });
  };

  /** How the current run started, for "start over": a node, a graph's start, or the whole story. */
  const [runFrom, setRunFrom] = useState<{ node?: NodeRef; graph?: string }>({});
  /** Plays from a node, from the start of a graph (by default the one on the canvas), or the whole story. */
  const startRun = (from: { node?: NodeRef; graph?: string } = { graph: current }) => {
    setRunFrom(from);
    follow([startPlay(store.getState(), from.node, from.graph)]);
    setSide('play');
  };

  const hooks: GraphHooks = useMemo(
    () => ({
      create: (d, node) => {
        if (node.kind === 'chapter') createChapterGraph(d, node, t('story.kind.start'));
      },
      remove: (d, nodes) => deleteChapterGraphs(d, nodes),
      copy: (clip, data) => {
        const graphs = chapterGraphsOf(data, clip.nodes);
        if (graphs.length) clip.graphs = graphs;
      },
      paste: (d, nodes, clip, ids) =>
        pasteChapterGraphs(d, nodes, clip.graphs ?? [], { from: clip.source, to: current, ids }),
    }),
    [current],
  );

  const ext: CanvasExtensions = {
    hooks,
    insertKind: 'scene',
    onOpenNode: (id) => {
      const node = findNode(store.getState(), { graph: current, node: id });
      if (node?.kind === 'chapter') {
        actions.openChapter(id);
        return true;
      }
      if (node?.kind === 'jump' && node.target) {
        actions.show(node.target);
        return true;
      }
      return false;
    },
    onLink: (from, key, to) =>
      actions.edit(t('story.step.link'), (g) => {
        const ref = { graph: current, node: to };
        const n = storyNode(g, from);
        if (!n) return;
        // An empty key: a gun or butterfly node of an older project, linked by itself.
        if (key) linkMark(n, key, ref);
        else addLink(g, from, ref);
      }),
    menuEntries: (target: HitTarget, world) => {
      const data = store.getState();
      if (target.kind === 'background') {
        return [
          { id: 'play', label: t('play.thisCanvas'), icon: <Play size={16} />, onSelect: () => startRun() },
          { id: 'play-all', label: t('play.fromStart'), icon: <Play size={16} />, onSelect: () => startRun({}) },
        ];
      }
      if (target.kind === 'edge') {
        return [
          {
            id: 'condition',
            label: t('story.edge.conditionMenu'),
            icon: <Diamond size={16} />,
            onSelect: () => {
              setSide('inspector');
              setFocus({ node: target.id, field: 'condition', at: performance.now() });
            },
          },
        ];
      }
      if (target.kind !== 'node') return [];
      const node = findNode(data, { graph: current, node: target.id });
      if (!node) return [];
      const entries = [];
      if (node.kind === 'chapter') {
        entries.push({
          id: 'open',
          label: t('story.chapter.open'),
          icon: <BookOpen size={16} />,
          shortcut: 'Enter',
          onSelect: () => actions.openChapter(node.id),
        });
      }
      if (node.kind === 'jump' && node.target) {
        const to = node.target;
        entries.push({
          id: 'goto',
          label: t('story.jump.go'),
          icon: <CornerDownRight size={16} />,
          onSelect: () => actions.show(to),
        });
      }
      if (!readOnly && !OFF_FLOW.has(node.kind) && !['start', 'gun', 'butterfly'].includes(node.kind)) {
        // Over an option or a line of the card: the device goes there; elsewhere on the whole node.
        const row = cardRow(node, world.y - node.y);
        const where = row
          ? t(row.anchor.kind === 'option' ? 'plot.onOption' : 'plot.onLine', { n: row.index + 1 })
          : t('plot.onNode');
        const anchor = row?.anchor ?? { kind: 'node' as const };
        for (const device of PLOT_DEVICES) {
          entries.push({
            id: `plot-${device}`,
            label: t('plot.menu', { device: t(device === 'gun' ? 'plot.gun' : 'plot.butterfly'), where }),
            icon: <DeviceIcon device={device} />,
            onSelect: () => {
              let id: string | null = null;
              actions.edit(t(device === 'gun' ? 'plot.step.gun' : 'plot.step.butterfly'), (g) => {
                const n = storyNode(g, node.id);
                if (n) id = addMark(n, device, anchor)?.id ?? null;
              });
              if (id) actions.inspect(node.id, `mark:${id}`);
            },
          });
        }
      }
      if (!OFF_FLOW.has(node.kind)) {
        entries.push({
          id: 'play-here',
          label: t('play.fromHere'),
          icon: <Play size={16} />,
          onSelect: () => startRun({ node: { graph: current, node: node.id } }),
        });
      }
      return entries;
    },
  };

  const exportStory = async () => {
    const data = store.getState();
    const dir = await platform().joinPath(project.dir, `${data.meta.name || 'story'}.json`);
    const target = await platform().pickSaveFile(t('story.export.title'), dir, [
      { name: t('story.export.filter'), extensions: ['json'] },
    ]);
    if (!target) return;
    try {
      await platform().exportText(target, exportJson(data, APP_VERSION));
      toast({ kind: 'success', text: t('story.export.done', { path: target }) });
    } catch (e) {
      toast({ kind: 'error', text: errorText(e) });
    }
  };

  const addTestChapter = () => {
    if (!engine || readOnly) return;
    const center = engine.viewCenter();
    const node = createNode('chapter', center.x, center.y, t('story.debug.chapter'));
    store.dispatch(t('story.debug.step'), (d) => {
      const g = graphOf(d, current);
      if (!g) return;
      g.nodes.push(node);
      const child = graphOf(d, createChapterGraph(d, node, t('story.kind.start')))!;
      const bench = benchGraph(5000, 8000);
      const ids = new Map(bench.nodes.map((n) => [n.id, newId()]));
      for (const n of bench.nodes) child.nodes.push({ ...n, id: ids.get(n.id)!, kind: 'scene' });
      for (const e of bench.edges) {
        child.edges.push({
          id: newId(),
          from: { node: ids.get(e.from.node)!, port: 'out' },
          to: { node: ids.get(e.to.node)!, port: 'in' },
        });
      }
      const start = child.nodes[0];
      start.x = -400;
      child.edges.push({
        id: newId(),
        from: { node: start.id, port: 'out' },
        to: { node: child.nodes[1].id, port: 'in' },
      });
    });
  };

  const crumbs = path.split('/').filter(Boolean);
  const data = store.getState();

  return (
    <StoryContext.Provider value={actions}>
      <div className="story">
        <header className="story-bar">
          <nav className="story-crumbs" aria-label={t('story.breadcrumbs')}>
            {crumbs.map((id, i) => (
              <span key={id} className="story-crumb">
                {i > 0 && <ChevronRight size={14} aria-hidden="true" className="muted" />}
                <button
                  type="button"
                  className="story-crumb-btn"
                  aria-current={id === current ? 'page' : undefined}
                  onClick={() => setGraphId(id)}
                >
                  {i === 0 ? graphOf(data, id)?.name || t('module.story') : graphTitle(data, id) || t('story.untitled')}
                </button>
              </span>
            ))}
          </nav>
          <div className="story-actions">
            <Button
              size="sm"
              variant="primary"
              icon={<Play size={14} />}
              title={t('play.thisCanvas')}
              onClick={() => startRun()}
            >
              {t('play.start')}
            </Button>
            {showChecks && (
              <Button
                size="sm"
                variant={side === 'problems' ? 'secondary' : 'ghost'}
                icon={
                  counts.error ? (
                    <CircleAlert size={14} className="text-danger" />
                  ) : (
                    <TriangleAlert size={14} className={counts.warning ? 'text-warning' : undefined} />
                  )
                }
                aria-pressed={side === 'problems'}
                onClick={() => setSide(side === 'problems' ? 'inspector' : 'problems')}
              >
                {t('problems.button', { count: counts.error + counts.warning })}
              </Button>
            )}
            <Button size="sm" variant="ghost" icon={<Variable size={14} />} onClick={() => openVariables()}>
              {t('var.button')}
            </Button>
            <Button size="sm" variant="ghost" icon={<FileJson size={14} />} onClick={() => void exportStory()}>
              {t('story.export.button')}
            </Button>
            <MenuButton
              label={t('story.more')}
              variant="ghost"
              size="sm"
              icon={<Bug size={14} />}
              entries={[
                {
                  id: 'test',
                  label: t('story.debug.testChapter'),
                  disabled: readOnly || !engine,
                  onSelect: addTestChapter,
                },
              ]}
            />
            <IconButton
              size="sm"
              label={t('story.inspector.toggle')}
              icon={<PanelRight size={16} />}
              pressed={side !== null}
              onClick={() => setSide(side ? null : 'inspector')}
            />
          </div>
        </header>
        <div className="story-main">
          <div className="story-canvas">
            <CanvasView
              key={current}
              project={project}
              graphId={current}
              cameraKey={`${tab}:${current}`}
              ext={ext}
              onEngine={(e) => {
                setEngine(e);
                settle(e);
              }}
            />
          </div>
          {side && engine && (
            <aside className="story-side" aria-label={t('story.side')}>
              {side === 'inspector' && <Inspector engine={engine} focus={focus} />}
              {side === 'problems' && <ProblemsPanel />}
              {side === 'play' && play && (
                <PlayPanel
                  history={play}
                  onChange={follow}
                  onRestart={() => startRun(runFrom)}
                  onClose={() => {
                    setPlay(null);
                    setSide('inspector');
                    engine.setHighlight(new Set(), null);
                  }}
                />
              )}
            </aside>
          )}
        </div>
      </div>
    </StoryContext.Provider>
  );
}
