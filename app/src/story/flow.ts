// How the story flows across graphs: edges inside a graph, chapter nodes that enter their own graph,
// end nodes that return to the chapter node above, jumps to any node. Used by the playthrough and checks.

import type { GraphDoc, GraphEdge } from '../canvas/model';
import type { ProjectData } from '../core/project/types';
import { asStory, findNode, graphOf, OFF_FLOW, storyRoot, type NodeRef, type StoryNode } from './model';

export const refKey = (r: NodeRef): string => `${r.graph}/${r.node}`;
export const sameRef = (a: NodeRef | null | undefined, b: NodeRef | null | undefined): boolean =>
  !!a && !!b && a.graph === b.graph && a.node === b.node;

/** Edges leaving a node, optionally only from one port, in the order they were made. */
export function edgesFrom(g: GraphDoc, nodeId: string, port?: string): GraphEdge[] {
  return g.edges.filter((e) => e.from.node === nodeId && (port === undefined || e.from.port === port));
}

/** The first start node of a graph: where the playthrough enters it. */
export function startOf(g: GraphDoc | undefined): StoryNode | undefined {
  return g?.nodes.find((n) => n.kind === 'start') as StoryNode | undefined;
}

/** The chapter node whose graph this is, with the graph that holds that node. */
export function parentChapter(data: ProjectData, graphId: string): NodeRef | null {
  const g = graphOf(data, graphId);
  const nodeId = g?.parent?.kind === 'node' ? g.parent.id : null;
  if (!nodeId) return null;
  for (const [id, other] of Object.entries(data.graphs)) {
    const nodes = (other as unknown as GraphDoc).nodes;
    if (nodes?.some((n) => n.id === nodeId && asStory(n).graph === graphId)) return { graph: id, node: nodeId };
  }
  return null;
}

/** Chapter nodes from the top of the story down to `graphId` (what the playthrough is "inside"). */
export function chapterStack(data: ProjectData, graphId: string): NodeRef[] {
  const stack: NodeRef[] = [];
  const seen = new Set<string>();
  let current: string | null = graphId;
  while (current && !seen.has(current)) {
    seen.add(current);
    const parent = parentChapter(data, current);
    if (!parent) break;
    stack.unshift(parent);
    current = parent.graph;
  }
  return stack;
}

/** Breadcrumb of graphs from the story overview down to `graphId`. */
export function graphPath(data: ProjectData, graphId: string): string[] {
  return [...chapterStack(data, graphId).map((r) => r.graph), graphId];
}

/** Display name of a graph: the chapter node's title (they are kept in sync), else the graph name. */
export function graphTitle(data: ProjectData, graphId: string): string {
  const parent = parentChapter(data, graphId);
  const node = parent && findNode(data, parent);
  return node?.title || graphOf(data, graphId)?.name || '';
}

/**
 * Every node the flow can reach from `from` (not counting `from` itself unless a loop returns to it):
 * edges, chapters entered at their start, chapter ends continuing after the chapter node, jumps.
 */
export function reachableFrom(data: ProjectData, from: NodeRef): Set<string> {
  const seen = new Set<string>();
  const queue: NodeRef[] = [];
  const push = (r: NodeRef | null | undefined) => {
    if (!r) return;
    const key = refKey(r);
    if (seen.has(key)) return;
    seen.add(key);
    queue.push(r);
  };
  for (const next of successors(data, from)) push(next);
  while (queue.length) {
    const r = queue.shift()!;
    for (const next of successors(data, r)) push(next);
  }
  return seen;
}

/** Where the flow can go right after a node, ignoring conditions. */
export function successors(data: ProjectData, at: NodeRef): NodeRef[] {
  const g = graphOf(data, at.graph);
  const node = g?.nodes.find((n) => n.id === at.node) as StoryNode | undefined;
  if (!g || !node || OFF_FLOW.has(node.kind)) return [];
  const out: NodeRef[] = edgesFrom(g, node.id).map((e) => ({ graph: at.graph, node: e.to.node }));
  if (node.kind === 'chapter' && node.graph) {
    const start = startOf(graphOf(data, node.graph));
    if (start) out.push({ graph: node.graph, node: start.id });
  }
  if (node.kind === 'jump' && node.target) out.push(node.target);
  if (node.kind === 'end') {
    // A chapter's end continues after its chapter node, possibly several levels up.
    let parent = parentChapter(data, at.graph);
    while (parent) {
      const pg = graphOf(data, parent.graph)!;
      const after = edgesFrom(pg, parent.node);
      if (after.length) {
        out.push(...after.map((e) => ({ graph: parent!.graph, node: e.to.node })));
        break;
      }
      parent = parentChapter(data, parent.graph);
    }
  }
  return out;
}

/** Entry points of the whole story: the start of the overview graph. */
export function storyStart(data: ProjectData): NodeRef | null {
  const root = storyRoot(data);
  const start = startOf(root);
  return root && start ? { graph: root.id, node: start.id } : null;
}
