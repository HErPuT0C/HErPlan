import { describe, expect, it } from 'vitest';
import {
  applyEffects,
  checkCondition,
  checkEffects,
  evaluate,
  isIdentifier,
  namesInCondition,
  namesInEffects,
  parseCondition,
  parseEffects,
  renameVariable,
  stripPositions,
  type Registry,
  type State,
} from './expr';

const registry: Registry = new Map([
  ['доверие', { type: 'number' as const }],
  ['пощадил_рыцаря', { type: 'bool' as const }],
  ['Мира.доверие', { type: 'number' as const }],
  ['Мира.настроение', { type: 'string' as const, values: ['спокойна', 'рада'] }],
  ['вера', { type: 'number' as const }],
]);

const state = (): State =>
  new Map<string, boolean | number | string>([
    ['доверие', 3],
    ['пощадил_рыцаря', true],
    ['Мира.доверие', 1],
    ['Мира.настроение', 'спокойна'],
    ['вера', 0],
  ]);

describe('expression language (ADR-005)', () => {
  it('Russian and English keywords give the same tree', () => {
    const ru = stripPositions(parseCondition('доверие >= 3 и не пощадил_рыцаря'));
    const en = stripPositions(parseCondition('доверие >= 3 and not пощадил_рыцаря'));
    const sym = stripPositions(parseCondition('доверие >= 3 && !пощадил_рыцаря'));
    expect(ru).toEqual(en);
    expect(sym).toEqual(en);
  });

  it('evaluates with precedence and brackets; division by zero gives 0', () => {
    const s = state();
    expect(evaluate(parseCondition('доверие >= 3 and пощадил_рыцаря'), s)).toBe(true);
    expect(evaluate(parseCondition('Мира.доверие > 2 или пощадил_рыцаря'), s)).toBe(true);
    expect(evaluate(parseCondition('not (доверие + 2 * 2 == 7)'), s)).toBe(false);
    expect(evaluate(parseCondition('Мира.настроение == «спокойна»'), s)).toBe(true);
    expect(evaluate(parseCondition('доверие / вера == 0'), s)).toBe(true);
  });

  it('applies effects in order and truncates whole-number variables', () => {
    const s = state();
    const changes = applyEffects(
      parseEffects('доверие += 1; пощадил_рыцаря = ложь\nМира.настроение = "рада"; вера -= 2.5'),
      s,
      (name) => name === 'вера',
    );
    expect([...s]).toEqual([
      ['доверие', 4],
      ['пощадил_рыцаря', false],
      ['Мира.доверие', 1],
      ['Мира.настроение', 'рада'],
      ['вера', -2],
    ]);
    expect(changes[0]).toEqual({ name: 'доверие', before: 3, after: 4 });
  });

  it('reports unknown names with a suggestion and a position', () => {
    const d = checkCondition('довере > 2', registry)!;
    expect(d).toMatchObject({ code: 'unknownVar', params: { name: 'довере', suggestion: 'доверие' } });
    expect([d.from, d.to]).toEqual([0, 6]);
  });

  it('explains the usual mistakes', () => {
    const code = (src: string, effects = false) =>
      (effects ? checkEffects(src, registry) : checkCondition(src, registry))?.code;
    expect(code('доверие = 3')).toBe('eqInCondition');
    expect(code('доверие + 1')).toBe('conditionNotBool');
    expect(code('пощадил_рыцаря + 1 > 0')).toBe('numbersOnly');
    expect(code('(доверие > 1')).toBe('missingParen');
    expect(code('доверие >')).toBe('unexpectedEnd');
    expect(code('"текст')).toBe('unclosedString');
    expect(code('доверие > 1 )')).toBe('trailing');
    expect(code('доверие @ 2')).toBe('badChar');
    expect(code('Мира.настроение == «грустна»')).toBe('notInList');
    expect(code('пощадил_рыцаря += 1', true)).toBe('effectNumbersOnly');
    expect(code('доверие = истина', true)).toBe('assignType');
    expect(code('3 = доверие', true)).toBe('effectStart');
    expect(code('доверие 3', true)).toBe('effectOp');
    expect(code('Мира.настроение = «злая»', true)).toBe('notInList');
    expect(checkCondition('Мира.доверие >= 2 и пощадил_рыцаря', registry)).toBeNull();
    expect(checkEffects('Мира.доверие += 1', registry)).toBeNull();
    expect(checkCondition('   ', registry)).toBeNull();
  });

  it('lists the names an expression reads and writes', () => {
    expect(namesInCondition('доверие > вера and доверие < 10')).toEqual(['доверие', 'вера']);
    expect(namesInEffects('доверие += вера; пощадил_рыцаря = истина')).toEqual({
      writes: ['доверие', 'пощадил_рыцаря'],
      reads: ['вера', 'доверие'],
    });
    expect(namesInCondition('доверие >')).toEqual([]);
  });

  it('renames a variable without touching strings or longer names', () => {
    expect(renameVariable('доверие > 2 и «доверие» != Мира.доверие', 'доверие', 'вера')).toBe(
      'вера > 2 и «доверие» != Мира.доверие',
    );
    expect(renameVariable('Мира.доверие += 1', 'Мира.доверие', 'Мира.симпатия')).toBe('Мира.симпатия += 1');
    expect(renameVariable('"не закрыто', 'a', 'b')).toBe('"не закрыто');
  });

  it('knows valid variable names', () => {
    expect(isIdentifier('доверие_2')).toBe(true);
    expect(isIdentifier('2доверие')).toBe(false);
    expect(isIdentifier('и')).toBe(false);
    expect(isIdentifier('with space')).toBe(false);
  });
});
