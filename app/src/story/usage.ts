// Every expression in the project and the variables it touches: "where used" (FR-NAR-06), unused
// variables, renames across the project, and project checks all start here.

import type { GraphDoc } from '../canvas/model';
import type { ProjectData } from '../core/project/types';
import { callsIn, namesInCondition, namesInEffects, renameCallArg, renameVariable, type CallName } from './expr';
import { followText } from './marks';
import { allGraphs, asStory, OFF_FLOW, plotMarks } from './model';
import { renameInText, textPieces } from './textEffects';
import { listsFor, listVariables, registryFor, type Variable } from './variables';

export type ExprKind = 'condition' | 'effects';

/** Where an expression lives: an edge, a choice option, a node field, or effects written in a text. */
export interface ExprSite {
  graph: string;
  node?: string;
  edge?: string;
  option?: string;
  line?: string;
  /** text, comment, note, line, optionText: effects written in that text ("{x = 1}", see textEffects.ts). */
  field: 'condition' | 'expr' | 'effects' | 'text' | 'comment' | 'note' | 'line' | 'optionText';
  kind: ExprKind;
  source: string;
}

/**
 * All non-blank expressions of one graph. `known` tells variable names apart, for effects written without
 * braces in descriptions and comments; without it only braced ones are found.
 */
export function graphExpressions(g: GraphDoc, known?: (name: string) => boolean): ExprSite[] {
  const out: ExprSite[] = [];
  const add = (site: Omit<ExprSite, 'graph'>) => {
    if (site.source.trim()) out.push({ graph: g.id, ...site });
  };
  const inText = (text: string | undefined, site: Omit<ExprSite, 'graph' | 'kind' | 'source'>, bare: boolean) => {
    for (const e of textPieces(text, bare ? known : undefined).effects)
      add({ ...site, kind: 'effects', source: e.code });
  };
  for (const e of g.edges) add({ edge: e.id, field: 'condition', kind: 'condition', source: e.condition ?? '' });
  for (const raw of g.nodes) {
    const n = asStory(raw);
    // Stickers are the designer's notes beside the story: nothing in them runs.
    if (OFF_FLOW.has(n.kind)) continue;
    if (n.kind === 'condition') add({ node: n.id, field: 'expr', kind: 'condition', source: n.expr ?? '' });
    if (n.kind === 'effect' || n.kind === 'butterfly' || n.kind === 'give') {
      add({ node: n.id, field: 'effects', kind: 'effects', source: n.effects ?? '' });
    }
    if (n.kind === 'choice') {
      for (const o of n.options ?? []) {
        add({ node: n.id, option: o.id, field: 'condition', kind: 'condition', source: o.condition ?? '' });
        add({ node: n.id, option: o.id, field: 'effects', kind: 'effects', source: o.effects ?? '' });
        inText(o.text, { node: n.id, option: o.id, field: 'optionText' }, false);
        inText(o.note, { node: n.id, option: o.id, field: 'note' }, true);
      }
    }
    inText(n.text, { node: n.id, field: 'text' }, true);
    inText(n.comment, { node: n.id, field: 'comment' }, true);
    for (const l of n.lines ?? []) {
      inText(l.text, { node: n.id, line: l.id, field: 'line' }, false);
      // 0.8: a line can have a condition and effects of its own.
      add({ node: n.id, line: l.id, field: 'condition', kind: 'condition', source: l.condition ?? '' });
      add({ node: n.id, line: l.id, field: 'effects', kind: 'effects', source: l.effects ?? '' });
    }
  }
  return out;
}

/** Is a name a variable as seen from a graph: for effects written without braces. */
export function knownNames(data: ProjectData, graphId: string): (name: string) => boolean {
  let reg: ReturnType<typeof registryFor> | null = null;
  return (name) => (reg ??= registryFor(data, graphId)).has(name);
}

export function projectExpressions(data: ProjectData): ExprSite[] {
  return allGraphs(data).flatMap((g) => graphExpressions(g, knownNames(data, g.id)));
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
    // непусто(список) reads a list variable (0.8).
    const calls = callsIn(site.source, site.kind).filter((c) => c.fn === 'notEmpty');
    if (calls.length) {
      const lists = listsFor(data, site.graph);
      for (const c of calls) {
        const v = lists.get(c.arg);
        if (v) touched.set(v.id, { writes: touched.get(v.id)?.writes ?? false, reads: true });
      }
    }
    for (const [id, how] of touched) {
      const list = usage.get(id);
      const entry = { site, ...how };
      if (list) list.push(entry);
      else usage.set(id, [entry]);
    }
  }
  // Variables a give node writes to, and lists that actions fill or hand out (0.8).
  const note = (id: string | null | undefined, site: ExprSite, writes: boolean) => {
    if (!id) return;
    const entry = { site, writes, reads: !writes };
    const list = usage.get(id);
    if (list) list.push(entry);
    else usage.set(id, [entry]);
  };
  for (const g of allGraphs(data)) {
    for (const raw of g.nodes ?? []) {
      const n = asStory(raw);
      const at = (more: Partial<ExprSite> = {}): ExprSite => ({
        graph: g.id,
        node: n.id,
        field: 'effects',
        kind: 'effects',
        source: '',
        ...more,
      });
      if (n.kind === 'give') {
        note(n.store, at(), true);
        note(n.keep, at(), true);
      }
      const holders: { actions?: { type: string; ref?: string | null }[]; site: ExprSite }[] = [
        { actions: n.actions, site: at() },
        ...(n.lines ?? []).map((l) => ({ actions: l.actions, site: at({ line: l.id }) })),
        ...(n.options ?? []).map((o) => ({ actions: o.actions, site: at({ option: o.id }) })),
      ];
      for (const h of holders) {
        for (const a of h.actions ?? []) {
          if (a.type === 'list_add') note(a.ref, h.site, true);
          if (a.type === 'give_list') note(a.ref, h.site, false);
        }
      }
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
    const known = (name: string) => reg.has(name);
    const fixText = (text: string | undefined, bare: boolean) =>
      text ? renameInText(text, oldName, newName, bare ? known : undefined) : text;
    for (const e of g.edges) if (e.condition) e.condition = fix(e.condition);
    for (const raw of g.nodes) {
      const n = asStory(raw);
      if (n.expr) n.expr = fix(n.expr);
      if (n.effects) n.effects = fix(n.effects);
      // Texts that carry marked words keep the marks on them (followText).
      if (n.text) {
        const text = fixText(n.text, true)!;
        followText(n, { kind: 'node' }, n.text, text);
        n.text = text;
      }
      if (n.comment) n.comment = fixText(n.comment, true);
      for (const o of n.options ?? []) {
        if (o.condition) o.condition = fix(o.condition)!;
        if (o.effects) o.effects = fix(o.effects)!;
        if (o.note) o.note = fixText(o.note, true);
        if (o.text) {
          const text = fixText(o.text, false)!;
          followText(n, { kind: 'option', id: o.id }, o.text, text);
          o.text = text;
        }
      }
      for (const l of n.lines ?? []) {
        if (l.condition) l.condition = fix(l.condition);
        if (l.effects) l.effects = fix(l.effects);
        if (!l.text) continue;
        const text = fixText(l.text, false)!;
        followText(n, { kind: 'line', id: l.id }, l.text, text);
        l.text = text;
      }
    }
  }
}

/**
 * Rewrites the name inside есть(), нанят() or непусто() in every condition of the project (inside a Store
 * recipe), when the item, the character or the list variable it names is renamed (0.8).
 */
export function renameInCalls(draft: ProjectData, fns: readonly CallName[], oldName: string, newName: string): void {
  if (oldName === newName || !oldName.trim() || !newName.trim()) return;
  const fix = (src: string | undefined) => (src ? renameCallArg(src, fns, oldName, newName) : src);
  for (const g of allGraphs(draft)) {
    for (const e of g.edges ?? []) if (e.condition) e.condition = fix(e.condition);
    for (const raw of g.nodes ?? []) {
      const n = asStory(raw);
      if (n.expr) n.expr = fix(n.expr);
      for (const o of n.options ?? []) if (o.condition) o.condition = fix(o.condition)!;
      for (const l of n.lines ?? []) if (l.condition) l.condition = fix(l.condition);
    }
  }
}

export interface MarkMention {
  graph: string;
  node: string;
  mark: string;
}

/** Butterflies that name a variable among the ones their consequences depend on, by variable id. */
export function markMentions(data: ProjectData): Map<string, MarkMention[]> {
  const out = new Map<string, MarkMention[]>();
  for (const g of allGraphs(data)) {
    for (const raw of g.nodes) {
      for (const m of plotMarks(asStory(raw))) {
        for (const id of m.variables) {
          const entry = { graph: g.id, node: raw.id, mark: m.id };
          const list = out.get(id);
          if (list) list.push(entry);
          else out.set(id, [entry]);
        }
      }
    }
  }
  return out;
}

/** Variables never mentioned by any expression (or by a butterfly). */
export function unusedVariables(data: ProjectData): Variable[] {
  const usage = variableUsage(data);
  const mentions = markMentions(data);
  return listVariables(data).filter((v) => !usage.has(v.id) && !mentions.has(v.id));
}

/** Expression names of every variable, for autocompletion in a graph. */
export function namesFor(data: ProjectData, graphId: string | null): { name: string; variable: Variable }[] {
  return [...registryFor(data, graphId)].map(([name, entry]) => ({ name, variable: entry.variable }));
}
