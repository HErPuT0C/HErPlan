import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { applyEffects, checkCondition, checkEffects, evaluate, parseCondition, parseEffects, type Registry, type State } from '../src/expr.ts';

const registry: Registry = new Map([
  ['доверие', { type: 'number' }],
  ['пощадил_рыцаря', { type: 'bool' }],
  ['Мира.доверие', { type: 'number' }],
  ['Мира.настроение', { type: 'string' }],
  ['вера', { type: 'number' }],
]);
const state = (): State => new Map<string, boolean | number | string>([
  ['доверие', 3], ['пощадил_рыцаря', true], ['Мира.доверие', 1], ['Мира.настроение', 'спокойна'], ['вера', 0],
]);

test('Russian and English keywords produce the same AST shape', () => {
  const ru = parseCondition('доверие >= 3 и не пощадил_рыцаря');
  const en = parseCondition('доверие >= 3 and not пощадил_рыцаря');
  const strip = (x: unknown) => JSON.stringify(x, (k, v) => (k === 'pos' ? undefined : v));
  assert.equal(strip(ru), strip(en));
});

test('evaluates conditions with precedence and parentheses', () => {
  const s = state();
  assert.equal(evaluate(parseCondition('доверие >= 3 and пощадил_рыцаря'), s), true);
  assert.equal(evaluate(parseCondition('Мира.доверие > 2 или пощадил_рыцаря'), s), true);
  assert.equal(evaluate(parseCondition('not (доверие + 2 * 2 == 7)'), s), false);
  assert.equal(evaluate(parseCondition('Мира.настроение == «спокойна»'), s), true);
});

test('applies effects in order', () => {
  const s = state();
  applyEffects(parseEffects('доверие += 1; пощадил_рыцаря = ложь\nМира.настроение = "рада"; вера -= 2'), s);
  assert.equal(s.get('доверие'), 4);
  assert.equal(s.get('пощадил_рыцаря'), false);
  assert.equal(s.get('Мира.настроение'), 'рада');
  assert.equal(s.get('вера'), -2);
});

test('unknown variable gets a suggestion and a position', () => {
  const d = checkCondition('довере > 2', registry)!;
  assert.match(d.message, /Неизвестная переменная «довере».*«доверие»/);
  assert.deepEqual([d.from, d.to], [0, 6]);
});

test('helpful messages for common mistakes', () => {
  assert.match(checkCondition('доверие = 3', registry)!.message, /используйте «==»/);
  assert.match(checkCondition('доверие + 1', registry)!.message, /должно давать да\/нет/);
  assert.match(checkCondition('пощадил_рыцаря + 1 > 0', registry)!.message, /работает с числами/);
  assert.match(checkCondition('(доверие > 1', registry)!.message, /закрывающей скобки/);
  assert.match(checkCondition('доверие >', registry)!.message, /обрывается/);
  assert.match(checkCondition('"текст', registry)!.message, /не закрыта/);
  assert.match(checkEffects('пощадил_рыцаря += 1', registry)!.message, /только с числами/);
  assert.match(checkEffects('доверие = истина', registry)!.message, /нельзя присвоить да\/нет/);
  assert.equal(checkCondition('Мира.доверие >= 2 и пощадил_рыцаря', registry), null);
  assert.equal(checkEffects('Мира.доверие += 1', registry), null);
});
