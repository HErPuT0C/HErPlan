// Project checks (FR-NAR-08, FR-NAR-10): unreachable nodes, dead ends, broken expressions, unused
// variables, plot devices that never pay off, dialogue over the project's soft limits. Each problem points
// at a place, so the problems panel can take the designer there.

import type { GraphDoc } from '../canvas/model';
import type { ProjectData } from '../core/project/types';
import { checkCondition, checkEffects, type Diagnostic } from './expr';
import { edgesFrom, reachableFrom, refKey, startOf } from './flow';
import { callWorld, visibleLength } from './game';
import { plotSources, rolesOf } from './marks';
import { allGraphs, asStory, findNode, isFlowGraph, OFF_FLOW, type NodeRef, type StoryNode } from './model';
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
  | 'refMissing'
  // 0.8, the story's own:
  | 'giveNoExit'
  // 0.8, "check the dialogue" (dialogueCheck.ts): what the game will stumble over.
  | 'noGraphKey'
  | 'badKey'
  | 'refNoKey'
  | 'lineEmpty'
  | 'lineNoSpeaker'
  | 'choiceNoFallback'
  | 'secretNoTimer'
  | 'manySecrets'
  | 'notInPalette'
  | 'faceNotDrawn'
  | 'towardOutsider'
  | 'actionNoRef'
  | 'actionUnknown'
  | 'emptyCycle'
  | 'gameSaid';

export type Severity = 'error' | 'warning' | 'info';

export interface Problem {
  code: ProblemCode;
  severity: Severity;
  graph?: string;
  node?: string;
  edge?: string;
  variable?: string;
  /** Plot devices laid over a node: which mark. */
  mark?: string;
  /** A dialogue line or a choice option of the node (0.8). */
  line?: string;
  option?: string;
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
  giveNoExit: 'warning',
  noGraphKey: 'error',
  badKey: 'error',
  refNoKey: 'warning',
  lineEmpty: 'warning',
  lineNoSpeaker: 'warning',
  choiceNoFallback: 'warning',
  secretNoTimer: 'warning',
  manySecrets: 'error',
  notInPalette: 'warning',
  faceNotDrawn: 'warning',
  towardOutsider: 'warning',
  actionNoRef: 'error',
  actionUnknown: 'error',
  emptyCycle: 'error',
  gameSaid: 'error',
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

export function problem(
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
  return allGraphs(data).filter(isFlowGraph);
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
        } else if (n.kind === 'give') {
          // "Nothing to give" may be left out: it then goes where "refused" goes.
          for (const port of ['given', 'cancel'] as const) {
            if (!exits.some((e) => e.from.port === port)) {
              out.push(problem('giveNoExit', where, { title: n.title, branch: port }));
            }
          }
        } else if (n.kind === 'dialogue') {
          // Exits of interrupted lines do not count: the dialogue must go somewhere when nobody interrupts.
          const lineIds = new Set((n.lines ?? []).map((l) => l.id));
          if (!exits.some((e) => !lineIds.has(e.from.port))) out.push(problem('deadEnd', where, { title: n.title }));
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
    }

    // Guns and butterflies, laid over nodes or (in older projects) nodes of their own.
    const reachableFromNode = new Map<string, Set<string>>();
    for (const src of plotSources(g)) {
      const gun = src.device === 'gun';
      const where = { graph: g.id, node: src.at.node, ...(src.mark ? { mark: src.mark.id } : {}) };
      if (src.links.length === 0)
        out.push(problem(gun ? 'gunNoPayoff' : 'butterflyNoConsequence', where, { title: src.title }));
      for (const link of src.links) {
        const target = findNode(data, link);
        if (!target) {
          out.push(problem(gun ? 'payoffMissing' : 'consequenceMissing', where, { title: src.title }));
          continue;
        }
        const map = gun ? setups : causes;
        const key = refKey(link);
        map.set(key, [...(map.get(key) ?? []), src.at]);
        let reachable = reachableFromNode.get(src.at.node);
        if (!reachable) reachableFromNode.set(src.at.node, (reachable = reachableFrom(data, src.at)));
        if (!reachable.has(key)) {
          out.push(
            problem(gun ? 'payoffBeforeSetup' : 'consequenceBeforeCause', where, {
              title: src.title,
              target: target.title,
            }),
          );
        }
      }
    }
  }

  // Nodes marked as a payoff or a consequence that nothing sets up.
  for (const g of graphs) {
    for (const raw of g.nodes) {
      const n = asStory(raw);
      const key = refKey({ graph: g.id, node: n.id });
      const roles = rolesOf(n);
      if (roles.includes('payoff') && !setups.has(key)) {
        out.push(problem('payoffNoSetup', { graph: g.id, node: n.id }, { title: n.title }));
      }
      if (roles.includes('consequence') && !causes.has(key)) {
        out.push(problem('consequenceNoCause', { graph: g.id, node: n.id }, { title: n.title }));
      }
    }
  }

  // Sets of lines (barks, 0.8) are outside the flow, but their lines have the same limits.
  for (const g of allGraphs(data)) {
    if (g.kind !== 'barks') continue;
    for (const raw of g.nodes) {
      if (raw.kind === 'dialogue') checkDialogue(asStory(raw), { graph: g.id, node: raw.id }, limits, out);
    }
  }

  // Expressions: parse errors, type errors, unknown names.
  const registries = new Map<string, ReturnType<typeof registryFor>>();
  const worlds = new Map<string, ReturnType<typeof callWorld>>();
  for (const site of projectExpressions(data)) {
    let reg = registries.get(site.graph);
    if (!reg) registries.set(site.graph, (reg = registryFor(data, site.graph)));
    let world = worlds.get(site.graph);
    if (!world) worlds.set(site.graph, (world = callWorld(data, site.graph)));
    const d =
      site.kind === 'condition'
        ? checkCondition(site.source, asRegistry(reg), world)
        : checkEffects(site.source, asRegistry(reg), world);
    if (!d) continue;
    out.push(
      problem(
        d.code === 'unknownVar' ? 'unknownVar' : 'exprError',
        {
          graph: site.graph,
          node: site.node,
          edge: site.edge,
          ...(site.line ? { line: site.line } : {}),
          ...(site.option ? { option: site.option } : {}),
          diagnostic: d,
        },
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
  // What the player reads: effects written in braces do not count (0.8).
  const long = lines.filter((l) => visibleLength(l.text) > limits.maxLineChars).length;
  if (long > 0) out.push(problem('lineTooLong', where, { title: n.title, count: long, max: limits.maxLineChars }));
}

export function countBySeverity(problems: readonly Problem[]): Record<Severity, number> {
  const counts: Record<Severity, number> = { error: 0, warning: 0, info: 0 };
  for (const p of problems) counts[p.severity]++;
  return counts;
}
