// Project checks (FR-NAR-08, FR-NAR-10): unreachable nodes, dead ends, broken expressions, unused
// variables, plot devices that never pay off, dialogue over the project's soft limits. Each problem points
// at a place, so the problems panel can take the designer there.

import type { GraphDoc } from '../canvas/model';
import type { ProjectData } from '../core/project/types';
import { checkCondition, checkEffects, type Diagnostic } from './expr';
import { edgesFrom, reachableFrom, refKey, startOf } from './flow';
import { allGraphs, asStory, findNode, OFF_FLOW, type NodeRef, type StoryNode } from './model';
import { projectExpressions, unusedVariables } from './usage';
import { asRegistry, registryFor } from './variables';

export type ProblemCode =
  | 'noStart'
  | 'unreachable'
  | 'deadEnd'
  | 'optionNoExit'
  | 'conditionNoBranch'
  | 'exprError'
  | 'unknownVar'
  | 'unusedVar'
  | 'gunNoPayoff'
  | 'payoffMissing'
  | 'payoffBeforeSetup'
  | 'payoffNoSetup'
  | 'butterflyNoConsequence'
  | 'consequenceMissing'
  | 'consequenceBeforeCause'
  | 'consequenceNoCause'
  | 'tooManyLines'
  | 'lineTooLong'
  | 'jumpNoTarget'
  | 'chapterNoGraph'
  | 'refMissing';

export type Severity = 'error' | 'warning' | 'info';

export interface Problem {
  code: ProblemCode;
  severity: Severity;
  graph?: string;
  node?: string;
  edge?: string;
  variable?: string;
  params: Record<string, string | number>;
  /** Expression problems: the diagnostic, for its message and position. */
  diagnostic?: Diagnostic;
}

const SEVERITY: Record<ProblemCode, Severity> = {
  noStart: 'error',
  unreachable: 'warning',
  deadEnd: 'warning',
  optionNoExit: 'warning',
  conditionNoBranch: 'warning',
  exprError: 'error',
  unknownVar: 'error',
  unusedVar: 'info',
  gunNoPayoff: 'warning',
  payoffMissing: 'error',
  payoffBeforeSetup: 'warning',
  payoffNoSetup: 'warning',
  butterflyNoConsequence: 'warning',
  consequenceMissing: 'error',
  consequenceBeforeCause: 'warning',
  consequenceNoCause: 'warning',
  tooManyLines: 'warning',
  lineTooLong: 'warning',
  jumpNoTarget: 'error',
  chapterNoGraph: 'error',
  refMissing: 'warning',
};

/** Open plot threads ("незакрытые завязки") are these problems. */
export const OPEN_THREADS: ReadonlySet<ProblemCode> = new Set([
  'gunNoPayoff',
  'payoffMissing',
  'payoffNoSetup',
  'butterflyNoConsequence',
  'consequenceMissing',
  'consequenceNoCause',
]);

/** Nodes that need no connection to count as used: references to the world and plain nodes off the flow. */
const ANNOTATION_KINDS = new Set(['character', 'location', 'item', 'node']);

function problem(
  code: ProblemCode,
  where: Omit<Problem, 'code' | 'severity' | 'params'>,
  params: Problem['params'] = {},
): Problem {
  return { code, severity: SEVERITY[code], ...where, params };
}

/** Nodes of a graph reachable from its start and from jumps into it (graph-local, plus jump entries). */
function reachableInGraph(g: GraphDoc, jumpTargets: ReadonlySet<string>): Set<string> {
  const seen = new Set<string>();
  const queue: string[] = [];
  const push = (id: string) => {
    if (!seen.has(id)) {
      seen.add(id);
      queue.push(id);
    }
  };
  for (const n of g.nodes) if (n.kind === 'start' || jumpTargets.has(n.id)) push(n.id);
  for (let i = 0; i < queue.length; i++) {
    for (const e of edgesFrom(g, queue[i])) push(e.to.node);
  }
  return seen;
}

function storyGraphs(data: ProjectData): GraphDoc[] {
  return allGraphs(data).filter((g) => g.kind === 'story' || g.kind === 'chapter');
}

export function checkProject(data: ProjectData): Problem[] {
  const out: Problem[] = [];
  const graphs = storyGraphs(data);
  const limits = data.meta.settings.dialogueLimits;

  // Jump targets are entry points of their graphs.
  const jumpTargets = new Map<string, Set<string>>();
  for (const g of graphs) {
    for (const raw of g.nodes) {
      const target = asStory(raw).target;
      if (raw.kind === 'jump' && target) {
        let set = jumpTargets.get(target.graph);
        if (!set) jumpTargets.set(target.graph, (set = new Set()));
        set.add(target.node);
      }
    }
  }

  // Who points at whom with plot devices.
  const causes = new Map<string, NodeRef[]>();
  const setups = new Map<string, NodeRef[]>();

  for (const g of graphs) {
    const flowNodes = g.nodes.filter((n) => !OFF_FLOW.has(n.kind));
    const hasStart = !!startOf(g);
    if (!hasStart && flowNodes.length > 0) out.push(problem('noStart', { graph: g.id }));
    const reached = hasStart ? reachableInGraph(g, jumpTargets.get(g.id) ?? new Set()) : null;
    const connected = new Set(g.edges.flatMap((e) => [e.from.node, e.to.node]));

    for (const raw of g.nodes) {
      const n = asStory(raw);
      const where = { graph: g.id, node: n.id };
      const at: NodeRef = { graph: g.id, node: n.id };
      if (OFF_FLOW.has(n.kind)) continue;
      const annotation = ANNOTATION_KINDS.has(n.kind) && !connected.has(n.id);
      if (reached && !reached.has(n.id) && !annotation) out.push(problem('unreachable', where, { title: n.title }));

      const exits = edgesFrom(g, n.id);
      const isReached = !reached || reached.has(n.id);
      if (isReached && !annotation) {
        if (n.kind === 'choice') {
          const options = n.options ?? [];
          if (options.length === 0) out.push(problem('deadEnd', where, { title: n.title }));
          options.forEach((o, i) => {
            if (!exits.some((e) => e.from.port === o.id)) {
              out.push(problem('optionNoExit', where, { title: n.title, option: o.text || String(i + 1) }));
            }
          });
        } else if (n.kind === 'condition') {
          for (const port of ['yes', 'no'] as const) {
            if (!exits.some((e) => e.from.port === port)) {
              out.push(problem('conditionNoBranch', where, { title: n.title, branch: port }));
            }
          }
        } else if (!['end', 'jump', 'chapter'].includes(n.kind) && exits.length === 0) {
          out.push(problem('deadEnd', where, { title: n.title }));
        }
      }

      if (n.kind === 'jump' && (!n.target || !findNode(data, n.target))) {
        out.push(problem('jumpNoTarget', where, { title: n.title }));
      }
      if (n.kind === 'chapter' && (!n.graph || !data.graphs[n.graph])) {
        out.push(problem('chapterNoGraph', where, { title: n.title }));
      }
      if (['character', 'location', 'item'].includes(n.kind) && n.ref && !data.entities[n.ref]) {
        out.push(problem('refMissing', where, { title: n.title }));
      }
      if (n.kind === 'dialogue') checkDialogue(n, where, limits, out);
      if (n.kind === 'gun' || n.kind === 'butterfly') {
        const gun = n.kind === 'gun';
        const links = n.links ?? [];
        if (links.length === 0)
          out.push(problem(gun ? 'gunNoPayoff' : 'butterflyNoConsequence', where, { title: n.title }));
        let reachable: Set<string> | null = null;
        for (const link of links) {
          const target = findNode(data, link);
          if (!target) {
            out.push(problem(gun ? 'payoffMissing' : 'consequenceMissing', where, { title: n.title }));
            continue;
          }
          const map = gun ? setups : causes;
          const key = refKey(link);
          map.set(key, [...(map.get(key) ?? []), at]);
          reachable ??= reachableFrom(data, at);
          if (!reachable.has(key)) {
            out.push(
              problem(gun ? 'payoffBeforeSetup' : 'consequenceBeforeCause', where, {
                title: n.title,
                target: target.title,
              }),
            );
          }
        }
      }
    }
  }

  // Nodes marked as a payoff or a consequence that nothing sets up.
  for (const g of graphs) {
    for (const raw of g.nodes) {
      const n = asStory(raw);
      const key = refKey({ graph: g.id, node: n.id });
      if (n.plotRole === 'payoff' && !setups.has(key)) {
        out.push(problem('payoffNoSetup', { graph: g.id, node: n.id }, { title: n.title }));
      }
      if (n.plotRole === 'consequence' && !causes.has(key)) {
        out.push(problem('consequenceNoCause', { graph: g.id, node: n.id }, { title: n.title }));
      }
    }
  }

  // Expressions: parse errors, type errors, unknown names.
  const registries = new Map<string, ReturnType<typeof registryFor>>();
  for (const site of projectExpressions(data)) {
    let reg = registries.get(site.graph);
    if (!reg) registries.set(site.graph, (reg = registryFor(data, site.graph)));
    const d =
      site.kind === 'condition'
        ? checkCondition(site.source, asRegistry(reg))
        : checkEffects(site.source, asRegistry(reg));
    if (!d) continue;
    out.push(
      problem(
        d.code === 'unknownVar' ? 'unknownVar' : 'exprError',
        { graph: site.graph, node: site.node, edge: site.edge, diagnostic: d },
        { name: d.params.name ?? '', source: site.source },
      ),
    );
  }

  for (const v of unusedVariables(data)) out.push(problem('unusedVar', { variable: v.id }, { name: v.name }));
  return out;
}

function checkDialogue(
  n: StoryNode,
  where: { graph: string; node: string },
  limits: { maxLines: number; maxLineChars: number },
  out: Problem[],
): void {
  const lines = n.lines ?? [];
  if (lines.length > limits.maxLines) {
    out.push(problem('tooManyLines', where, { title: n.title, count: lines.length, max: limits.maxLines }));
  }
  const long = lines.filter((l) => [...l.text].length > limits.maxLineChars).length;
  if (long > 0) out.push(problem('lineTooLong', where, { title: n.title, count: long, max: limits.maxLineChars }));
}

export function countBySeverity(problems: readonly Problem[]): Record<Severity, number> {
  const counts: Record<Severity, number> = { error: 0, warning: 0, info: 0 };
  for (const p of problems) counts[p.severity]++;
  return counts;
}
