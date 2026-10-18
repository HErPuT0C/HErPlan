// Every expression in the project and the variables it touches: "where used" (FR-NAR-06), unused
// variables, renames across the project, and project checks all start here.

import type { GraphDoc } from '../canvas/model';
import type { ProjectData } from '../core/project/types';
import { namesInCondition, namesInEffects, renameVariable } from './expr';
import { allGraphs, asStory } from './model';
import { listVariables, registryFor, type Variable } from './variables';

export type ExprKind = 'condition' | 'effects';

/** Where an expression lives: an edge, a choice option, or a node field. */
export interface ExprSite {
  graph: string;
  node?: string;
  edge?: string;
  option?: string;
  field: 'condition' | 'expr' | 'effects';
  kind: ExprKind;
  source: string;
}

/** All non-blank expressions of one graph. */
export function graphExpressions(g: GraphDoc): ExprSite[] {
  const out: ExprSite[] = [];
  const add = (site: Omit<ExprSite, 'graph'>) => {
    if (site.source.trim()) out.push({ graph: g.id, ...site });
  };
  for (const e of g.edges) add({ edge: e.id, field: 'condition', kind: 'condition', source: e.condition ?? '' });
  for (const raw of g.nodes) {
    const n = asStory(raw);
    if (n.kind === 'condition') add({ node: n.id, field: 'expr', kind: 'condition', source: n.expr ?? '' });
    if (n.kind === 'effect' || n.kind === 'butterfly') {
      add({ node: n.id, field: 'effects', kind: 'effects', source: n.effects ?? '' });
    }
    if (n.kind === 'choice') {
      for (const o of n.options ?? []) {
        add({ node: n.id, option: o.id, field: 'condition', kind: 'condition', source: o.condition ?? '' });
        add({ node: n.id, option: o.id, field: 'effects', kind: 'effects', source: o.effects ?? '' });
      }
    }
  }
  return out;
}

export function projectExpressions(data: ProjectData): ExprSite[] {
  return allGraphs(data).flatMap(graphExpressions);
}

export interface Usage {
  site: ExprSite;
  writes: boolean;
  reads: boolean;
}

/**
 * Where each variable is changed and read, by variable id. A name resolves in the graph where it is
 * written, so a chapter variable and a project variable with the same name are told apart.
 */
export function variableUsage(data: ProjectData): Map<string, Usage[]> {
  const usage = new Map<string, Usage[]>();
  const registries = new Map<string, ReturnType<typeof registryFor>>();
  for (const site of projectExpressions(data)) {
    let reg = registries.get(site.graph);
    if (!reg) registries.set(site.graph, (reg = registryFor(data, site.graph)));
    const { writes, reads } =
      site.kind === 'condition' ? { writes: [], reads: namesInCondition(site.source) } : namesInEffects(site.source);
    const touched = new Map<string, { writes: boolean; reads: boolean }>();
    for (const name of writes) {
      const v = reg.get(name)?.variable;
      if (v) touched.set(v.id, { writes: true, reads: touched.get(v.id)?.reads ?? false });
    }
    for (const name of reads) {
      const v = reg.get(name)?.variable;
      if (v) touched.set(v.id, { writes: touched.get(v.id)?.writes ?? false, reads: true });
    }
    for (const [id, how] of touched) {
      const list = usage.get(id);
      const entry = { site, ...how };
      if (list) list.push(entry);
      else usage.set(id, [entry]);
    }
  }
  return usage;
}

/** Nodes of one graph that use a variable (for highlighting on the canvas); edges count by their source. */
export function nodesUsing(g: GraphDoc, usages: readonly Usage[]): Set<string> {
  const ids = new Set<string>();
  for (const u of usages) {
    if (u.site.graph !== g.id) continue;
    if (u.site.node) ids.add(u.site.node);
    else if (u.site.edge) {
      const e = g.edges.find((x) => x.id === u.site.edge);
      if (e) {
        ids.add(e.from.node);
        ids.add(e.to.node);
      }
    }
  }
  return ids;
}

/**
 * Rewrites every expression that sees variable `v` under its old name (inside a Store recipe), so
 * conditions and effects keep working after a rename. Call it before renaming the variable, or the entity
 * that owns it: the old name must still resolve to the variable.
 */
export function renameEverywhere(draft: ProjectData, oldName: string, newName: string, v: Variable): void {
  if (oldName === newName) return;
  for (const g of allGraphs(draft)) {
    const reg = registryFor(draft, g.id);
    // Only graphs where the old name meant this variable.
    if (reg.get(oldName)?.variable.id !== v.id) continue;
    const fix = (src: string | undefined) => (src ? renameVariable(src, oldName, newName) : src);
    for (const e of g.edges) if (e.condition) e.condition = fix(e.condition);
    for (const raw of g.nodes) {
      const n = asStory(raw);
      if (n.expr) n.expr = fix(n.expr);
      if (n.effects) n.effects = fix(n.effects);
      for (const o of n.options ?? []) {
        if (o.condition) o.condition = fix(o.condition)!;
        if (o.effects) o.effects = fix(o.effects)!;
      }
    }
  }
}

/** Variables never mentioned by any expression. */
export function unusedVariables(data: ProjectData): Variable[] {
  const usage = variableUsage(data);
  return listVariables(data).filter((v) => !usage.has(v.id));
}

/** Expression names of every variable, for autocompletion in a graph. */
export function namesFor(data: ProjectData, graphId: string | null): { name: string; variable: Variable }[] {
  return [...registryFor(data, graphId)].map(([name, entry]) => ({ name, variable: entry.variable }));
}
