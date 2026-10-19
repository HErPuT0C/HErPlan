// Story editing operations. Like canvas/ops.ts they change data in place inside a Store recipe, so every
// one of them is undoable. Graph-level ones take a GraphDoc; chapter ones take the whole project, because
// a chapter node owns a graph of its own.

import { kindOf } from '../canvas/kinds';
import { emptyGraph, type GraphDoc, type GraphNode } from '../canvas/model';
import { createNode } from '../canvas/ops';
import { current, isDraft } from 'immer';
import { newId } from '../core/ids';
import type { ProjectData } from '../core/project/types';
import { asStory, graphOf, type ChoiceOption, type DialogueLine, type NodeRef, type StoryNode } from './model';

export function storyNode(g: GraphDoc, id: string): StoryNode | undefined {
  return g.nodes.find((n) => n.id === id) as StoryNode | undefined;
}

/** Fits a node's size to its content after a change (dialogue lines, choice options). */
export function fitNode(n: GraphNode): void {
  kindOf(n.kind).fit?.(n);
}

// ---------- dialogue (FR-NAR-03) ----------

export function addLine(g: GraphDoc, nodeId: string, line: Partial<DialogueLine> = {}, at?: number): string | null {
  const n = storyNode(g, nodeId);
  if (!n) return null;
  const lines = (n.lines ??= []);
  const fresh: DialogueLine = { id: newId(), speaker: line.speaker ?? null, text: line.text ?? '' };
  lines.splice(at ?? lines.length, 0, fresh);
  fitNode(n);
  return fresh.id;
}

export function updateLine(
  g: GraphDoc,
  nodeId: string,
  lineId: string,
  patch: Partial<Omit<DialogueLine, 'id'>>,
): void {
  const line = storyNode(g, nodeId)?.lines?.find((l) => l.id === lineId);
  if (line) Object.assign(line, patch);
}

export function removeLine(g: GraphDoc, nodeId: string, lineId: string): void {
  const n = storyNode(g, nodeId);
  if (!n?.lines) return;
  n.lines = n.lines.filter((l) => l.id !== lineId);
  fitNode(n);
}

/** Moves an item of a list from one index to another (lines, options). */
function move<T>(list: T[] | undefined, from: number, to: number): void {
  if (!list || from === to || from < 0 || from >= list.length) return;
  const [item] = list.splice(from, 1);
  list.splice(Math.max(0, Math.min(list.length, to)), 0, item);
}

export function moveLine(g: GraphDoc, nodeId: string, from: number, to: number): void {
  move(storyNode(g, nodeId)?.lines, from, to);
}

export function setExpanded(g: GraphDoc, nodeId: string, expanded: boolean): void {
  const n = storyNode(g, nodeId);
  if (!n) return;
  n.expanded = expanded;
  fitNode(n);
}

// ---------- choice ----------

export function addOption(g: GraphDoc, nodeId: string, text = ''): string | null {
  const n = storyNode(g, nodeId);
  if (!n) return null;
  const option: ChoiceOption = { id: newId(), text, condition: '', effects: '' };
  (n.options ??= []).push(option);
  fitNode(n);
  return option.id;
}

export function updateOption(
  g: GraphDoc,
  nodeId: string,
  optionId: string,
  patch: Partial<Omit<ChoiceOption, 'id'>>,
): void {
  const option = storyNode(g, nodeId)?.options?.find((o) => o.id === optionId);
  if (option) Object.assign(option, patch);
}

/** Removes an option together with the edges leaving its port. */
export function removeOption(g: GraphDoc, nodeId: string, optionId: string): void {
  const n = storyNode(g, nodeId);
  if (!n?.options) return;
  n.options = n.options.filter((o) => o.id !== optionId);
  g.edges = g.edges.filter((e) => !(e.from.node === nodeId && e.from.port === optionId));
  fitNode(n);
}

export function moveOption(g: GraphDoc, nodeId: string, from: number, to: number): void {
  move(storyNode(g, nodeId)?.options, from, to);
}

// ---------- links to other nodes ----------

export function addLink(g: GraphDoc, nodeId: string, ref: NodeRef): void {
  const n = storyNode(g, nodeId);
  if (!n || n.links?.some((l) => l.graph === ref.graph && l.node === ref.node)) return;
  (n.links ??= []).push({ graph: ref.graph, node: ref.node });
}

export function removeLink(g: GraphDoc, nodeId: string, ref: NodeRef): void {
  const n = storyNode(g, nodeId);
  if (n?.links) n.links = n.links.filter((l) => !(l.graph === ref.graph && l.node === ref.node));
}

// ---------- chapters (FR-NAR-01) ----------

/** A new story overview: the top graph, with its start node in place. */
export function newStoryGraph(name: string, startTitle: string): GraphDoc {
  const g = emptyGraph(newId(), 'story', name);
  g.nodes.push(createNode('start', 0, 0, startTitle));
  return g;
}

/** Gives a chapter node its own graph (with a start node) and adds that graph to the project. */
export function createChapterGraph(d: ProjectData, node: GraphNode, startTitle: string): string {
  const g = emptyGraph(newId(), 'chapter', node.title);
  g.parent = { kind: 'node', id: node.id };
  g.nodes.push(createNode('start', 0, 0, startTitle));
  d.graphs[g.id] = g as unknown as ProjectData['graphs'][string];
  asStory(node).graph = g.id;
  return g.id;
}

/** The graph of a chapter node and every sub-chapter graph inside it. */
export function chapterTree(data: ProjectData, graphId: string, out: string[] = []): string[] {
  const g = graphOf(data, graphId);
  if (!g || out.includes(graphId)) return out;
  out.push(graphId);
  for (const n of g.nodes) {
    const child = asStory(n).graph;
    if (n.kind === 'chapter' && child) chapterTree(data, child, out);
  }
  return out;
}

/** Deleting chapter nodes deletes their graphs (sub-chapters too); undo brings everything back. */
export function deleteChapterGraphs(d: ProjectData, nodes: readonly GraphNode[]): void {
  for (const n of nodes) {
    const child = asStory(n).graph;
    if (n.kind !== 'chapter' || !child) continue;
    const g = graphOf(d, child);
    // Only the graph this node owns: a copy pasted elsewhere owns a copy of its own.
    if (g?.parent?.kind !== 'node' || g.parent.id !== n.id) continue;
    for (const id of chapterTree(d, child)) delete d.graphs[id];
  }
}

/** Graphs that copied chapter nodes carry along on the clipboard. */
export function chapterGraphsOf(data: ProjectData, nodes: readonly GraphNode[]): GraphDoc[] {
  const ids: string[] = [];
  for (const n of nodes) {
    const child = asStory(n).graph;
    if (n.kind === 'chapter' && child) chapterTree(data, child, ids);
  }
  return ids.map((id) => structuredClone(graphOf(data, id)!));
}

/** Where the pasted nodes came from and went: references between copied nodes follow the copies. */
export interface PasteContext {
  /** Graph the nodes were copied from (unknown for an old clipboard). */
  from?: string;
  /** Graph they were pasted into. */
  to: string;
  /** Old node id → new node id in `to`. */
  ids: ReadonlyMap<string, string>;
}

/**
 * Pasted chapter nodes get copies of their graphs (from the clipboard), with new ids throughout, so the
 * copy and the original can be edited and deleted separately: jumps, consequences and payoffs between
 * copied nodes point at the copies, and variables of a copied chapter are copied with it.
 */
export function pasteChapterGraphs(
  d: ProjectData,
  pasted: readonly GraphNode[],
  carried: readonly GraphDoc[],
  context?: PasteContext,
): void {
  const source = new Map(carried.map((g) => [g.id, g]));
  const original = (id: string): GraphDoc | undefined => {
    const g = source.get(id) ?? graphOf(d, id);
    return g && isDraft(g) ? current(g) : g;
  };
  // Pass 1: copy every graph of the pasted chapters (sub-chapters too) and give all of it new ids.
  const graphIds = new Map<string, string>();
  const nodeIds = new Map<string, ReadonlyMap<string, string>>();
  if (context?.from) {
    graphIds.set(context.from, context.to);
    nodeIds.set(context.from, context.ids);
  }
  const copies: { g: GraphDoc; oldId: string; owner: GraphNode }[] = [];
  const plan = (owner: GraphNode) => {
    const child = asStory(owner).graph;
    if (owner.kind !== 'chapter' || !child) return;
    const g0 = original(child);
    if (!g0 || graphIds.has(child)) {
      delete asStory(owner).graph;
      return;
    }
    const g = structuredClone(g0);
    const ids = new Map(g.nodes.map((n) => [n.id, newId()]));
    graphIds.set(child, newId());
    nodeIds.set(child, ids);
    copies.push({ g, oldId: child, owner });
    for (const n of g.nodes) n.id = ids.get(n.id)!;
    for (const n of g.nodes) plan(n);
  };
  for (const n of pasted) plan(n);

  // Pass 2: wire the copies in.
  for (const { g, oldId, owner } of copies) {
    const ids = nodeIds.get(oldId)!;
    const node = (old: string) => ids.get(old) ?? old;
    g.id = graphIds.get(oldId)!;
    g.parent = { kind: 'node', id: owner.id };
    for (const e of g.edges) {
      e.id = newId();
      e.from = { ...e.from, node: node(e.from.node) };
      e.to = { ...e.to, node: node(e.to.node) };
    }
    for (const group of g.groups) {
      group.id = newId();
      group.members = group.members.map(node);
    }
    asStory(owner).graph = g.id;
    d.graphs[g.id] = g as unknown as ProjectData['graphs'][string];
  }

  // References between copied nodes point at the copies; references to anything else stay.
  const remap = (ref: NodeRef): NodeRef => {
    const graph = graphIds.get(ref.graph);
    const node = nodeIds.get(ref.graph)?.get(ref.node);
    return graph && node ? { graph, node } : ref;
  };
  for (const n of [...pasted, ...copies.flatMap((c) => c.g.nodes)]) {
    const s = asStory(n);
    if (s.target) s.target = remap(s.target);
    if (s.links) s.links = s.links.map(remap);
  }

  // Variables of a copied chapter get copies scoped to the new chapter.
  const file = d.variables as { variables?: unknown[] };
  const chapterVars = (file.variables ?? []).filter(
    (v): v is { scope: { kind: string; id: string } } =>
      typeof v === 'object' &&
      v !== null &&
      typeof (v as { scope?: unknown }).scope === 'object' &&
      copies.some((c) => c.oldId === (v as { scope: { id?: string } }).scope?.id),
  );
  for (const v of chapterVars) {
    const plain = isDraft(v) ? current(v) : structuredClone(v);
    file.variables!.push({ ...plain, id: newId(), scope: { kind: 'graph', id: graphIds.get(v.scope.id)! } });
  }
}
