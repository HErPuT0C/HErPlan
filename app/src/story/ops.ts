// Story editing operations. Like canvas/ops.ts they change data in place inside a Store recipe, so every
// one of them is undoable. Graph-level ones take a GraphDoc; chapter ones take the whole project, because
// a chapter node owns a graph of its own.

import { kindOf } from '../canvas/kinds';
import { emptyGraph, type GraphDoc, type GraphNode } from '../canvas/model';
import { createNode } from '../canvas/ops';
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

/**
 * Pasted chapter nodes get copies of their graphs (from the clipboard), with new ids throughout, so the
 * copy and the original can be edited and deleted separately.
 */
export function pasteChapterGraphs(d: ProjectData, pasted: readonly GraphNode[], carried: readonly GraphDoc[]): void {
  const source = new Map(carried.map((g) => [g.id, g]));
  const copy = (graphId: string, owner: GraphNode) => {
    const original = source.get(graphId) ?? graphOf(d, graphId);
    if (!original) {
      delete asStory(owner).graph;
      return;
    }
    const g = structuredClone(original);
    const ids = new Map<string, string>();
    const fresh = (old: string) => {
      let id = ids.get(old);
      if (!id) ids.set(old, (id = newId()));
      return id;
    };
    g.id = newId();
    g.parent = { kind: 'node', id: owner.id };
    for (const n of g.nodes) n.id = fresh(n.id);
    for (const e of g.edges) {
      e.id = newId();
      e.from = { ...e.from, node: fresh(e.from.node) };
      e.to = { ...e.to, node: fresh(e.to.node) };
    }
    for (const group of g.groups) {
      group.id = newId();
      group.members = group.members.map(fresh);
    }
    d.graphs[g.id] = g as unknown as ProjectData['graphs'][string];
    asStory(owner).graph = g.id;
    for (const n of g.nodes) {
      const child = asStory(n).graph;
      if (n.kind === 'chapter' && child) copy(child, n);
    }
  };
  for (const n of pasted) {
    const child = asStory(n).graph;
    if (n.kind === 'chapter' && child) copy(child, n);
  }
}
