// Sentences for codes from the story logic: expression errors, project checks, playthrough problems.
// The logic stays language-neutral; these tables keep every message key literal for the i18n tests.

import type { ProjectData } from '../../core/project/types';
import { t, type MessageKey } from '../../i18n';
import type { Problem, ProblemCode } from '../../story/checks';
import type { Diagnostic, DiagnosticCode, ValueType } from '../../story/expr';
import { graphTitle } from '../../story/flow';
import type { ActionType } from '../../story/model';
import type { PaletteList } from '../../story/palette';
import type { PlayProblem, PlayProblemCode } from '../../story/play';

const EXPR: Record<DiagnosticCode, MessageKey> = {
  unclosedString: 'expr.unclosedString',
  badChar: 'expr.badChar',
  eqInCondition: 'expr.eqInCondition',
  missingParen: 'expr.missingParen',
  unexpectedEnd: 'expr.unexpectedEnd',
  empty: 'expr.empty',
  expectedValue: 'expr.expectedValue',
  trailing: 'expr.trailing',
  effectStart: 'expr.effectStart',
  effectOp: 'expr.effectOp',
  effectSeparator: 'expr.effectSeparator',
  unknownVar: 'expr.unknownVar',
  notNeedsBool: 'expr.notNeedsBool',
  negNeedsNumber: 'expr.negNeedsNumber',
  logicNeedsBool: 'expr.logicNeedsBool',
  compareTypes: 'expr.compareTypes',
  numbersOnly: 'expr.numbersOnly',
  conditionNotBool: 'expr.conditionNotBool',
  effectNumbersOnly: 'expr.effectNumbersOnly',
  assignType: 'expr.assignType',
  notInList: 'expr.notInList',
  callEmpty: 'expr.callEmpty',
  unknownItem: 'expr.unknownItem',
  unknownCharacter: 'expr.unknownCharacter',
  unknownLine: 'expr.unknownLine',
  unknownListVar: 'expr.unknownListVar',
};

const TYPES: Record<ValueType, MessageKey> = { bool: 'type.bool', number: 'type.number', string: 'type.string' };
const TYPE_PARAMS = new Set(['type', 'left', 'right', 'value']);

export function diagnosticText(d: Diagnostic): string {
  const params: Record<string, string> = {};
  for (const [key, value] of Object.entries(d.params)) {
    params[key] =
      TYPE_PARAMS.has(key) && value in TYPES && d.code !== 'notInList'
        ? t(TYPES[value as ValueType])
        : key === 'op' && value === 'and'
          ? t('expr.and')
          : key === 'op' && value === 'or'
            ? t('expr.or')
            : value;
  }
  if (d.code === 'unknownVar' && params.suggestion) return t('expr.unknownVarSuggest', params);
  return t(EXPR[d.code], params);
}

const CHECKS: Record<ProblemCode, MessageKey> = {
  noStart: 'check.noStart',
  unreachable: 'check.unreachable',
  deadEnd: 'check.deadEnd',
  optionNoExit: 'check.optionNoExit',
  conditionNoBranch: 'check.conditionNoBranch',
  exprError: 'check.exprError',
  unknownVar: 'check.unknownVar',
  unusedVar: 'check.unusedVar',
  gunNoPayoff: 'check.gunNoPayoff',
  payoffMissing: 'check.payoffMissing',
  payoffBeforeSetup: 'check.payoffBeforeSetup',
  payoffNoSetup: 'check.payoffNoSetup',
  butterflyNoConsequence: 'check.butterflyNoConsequence',
  consequenceMissing: 'check.consequenceMissing',
  consequenceBeforeCause: 'check.consequenceBeforeCause',
  consequenceNoCause: 'check.consequenceNoCause',
  tooManyLines: 'check.tooManyLines',
  lineTooLong: 'check.lineTooLong',
  jumpNoTarget: 'check.jumpNoTarget',
  chapterNoGraph: 'check.chapterNoGraph',
  refMissing: 'check.refMissing',
  giveNoExit: 'check.giveNoExit',
  noGraphKey: 'check.noGraphKey',
  badKey: 'check.badKey',
  refNoKey: 'check.refNoKey',
  lineEmpty: 'check.lineEmpty',
  lineNoSpeaker: 'check.lineNoSpeaker',
  choiceNoFallback: 'check.choiceNoFallback',
  secretNoTimer: 'check.secretNoTimer',
  manySecrets: 'check.manySecrets',
  notInPalette: 'check.notInPalette',
  faceNotDrawn: 'check.faceNotDrawn',
  towardOutsider: 'check.towardOutsider',
  actionNoRef: 'check.actionNoRef',
  emptyCycle: 'check.emptyCycle',
  gameSaid: 'check.gameSaid',
};

/** The lists of the game's palette, as the checks name them. */
export const PALETTE_LIST_NAMES: Record<PaletteList, MessageKey> = {
  styles: 'palette.styles',
  sizes: 'palette.sizes',
  reveals: 'palette.reveals',
  effects: 'palette.effects',
  bubbles: 'palette.bubbles',
  faces: 'palette.faces',
  gestures: 'palette.gestures',
  emotes: 'palette.emotes',
  voices: 'palette.voices',
  sounds: 'palette.sounds',
};

export const ACTION_NAMES: Record<ActionType, MessageKey> = {
  give_item: 'action.give_item',
  take_item: 'action.take_item',
  hire: 'action.hire',
  dismiss: 'action.dismiss',
  list_add: 'action.list_add',
  give_list: 'action.give_list',
  save: 'action.save',
  event: 'action.event',
  start_quest: 'action.start_quest',
};

const GIVE_BRANCH: Record<string, MessageKey> = {
  given: 'story.port.given',
  cancel: 'story.port.cancel',
  empty: 'story.port.empty',
};

export function problemText(p: Problem, data: ProjectData): string {
  const params: Record<string, string | number> = { ...p.params };
  if (p.graph) params.graph = graphTitle(data, p.graph);
  if (p.code === 'conditionNoBranch') params.branch = t(p.params.branch === 'yes' ? 'story.port.yes' : 'story.port.no');
  if (p.code === 'giveNoExit') params.branch = t(GIVE_BRANCH[String(p.params.branch)] ?? 'story.port.given');
  if (p.code === 'notInPalette') params.list = t(PALETTE_LIST_NAMES[p.params.list as PaletteList]);
  if (p.code === 'actionNoRef') params.action = t(ACTION_NAMES[p.params.action as ActionType]);
  if (p.code === 'refNoKey')
    params.what = t(p.params.what === 'variable' ? 'check.what.variable' : 'check.what.entity');
  if (p.diagnostic) params.message = diagnosticText(p.diagnostic);
  return t(CHECKS[p.code], params);
}

const PLAY: Record<PlayProblemCode, MessageKey> = {
  noStart: 'play.problem.noStart',
  noStartHere: 'play.problem.noStartHere',
  missingNode: 'play.problem.missingNode',
  chapterNoStart: 'play.problem.chapterNoStart',
  jumpNoTarget: 'play.problem.jumpNoTarget',
  loop: 'play.problem.loop',
  badExpression: 'play.problem.badExpression',
  deadEnd: 'play.problem.deadEnd',
  noOptions: 'play.problem.noOptions',
};

export function playProblemText(p: PlayProblem, data?: ProjectData): string {
  const params = { ...p.params };
  if (data && params.graph) params.graph = graphTitle(data, params.graph);
  return t(PLAY[p.code], params);
}
