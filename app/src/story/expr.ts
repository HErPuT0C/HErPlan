// Condition and effect language of story graphs (ADR-005).
//
//   condition:  доверие >= 3 and not предал        Мира.доверие > 2 или пощадил_рыцаря
//   effects:    доверие += 1; пощадил_рыцаря = true; Мира.настроение = "рада"
//
// Keywords have English and Russian spellings (and/и, or/или, not/не, true/истина, false/ложь); the tree
// is language-neutral, so exporters see one form. Errors carry a code and a position: the interface turns
// the code into a sentence in the current language and underlines the place.

export type ValueType = 'bool' | 'number' | 'string';
export type Value = boolean | number | string;

export type Expr =
  | { kind: 'literal'; value: Value; pos: number }
  | { kind: 'var'; name: string; pos: number }
  | { kind: 'unary'; op: 'not' | 'neg'; arg: Expr; pos: number }
  | { kind: 'binary'; op: BinaryOp; left: Expr; right: Expr; pos: number };

export type BinaryOp = 'or' | 'and' | '==' | '!=' | '<' | '<=' | '>' | '>=' | '+' | '-' | '*' | '/' | '%';
export type EffectOp = '=' | '+=' | '-=';

export interface Effect {
  target: string;
  op: EffectOp;
  value: Expr;
  pos: number;
}

export type DiagnosticCode =
  | 'unclosedString'
  | 'badChar'
  | 'eqInCondition'
  | 'missingParen'
  | 'unexpectedEnd'
  | 'empty'
  | 'expectedValue'
  | 'trailing'
  | 'effectStart'
  | 'effectOp'
  | 'effectSeparator'
  | 'unknownVar'
  | 'notNeedsBool'
  | 'negNeedsNumber'
  | 'logicNeedsBool'
  | 'compareTypes'
  | 'numbersOnly'
  | 'conditionNotBool'
  | 'effectNumbersOnly'
  | 'assignType'
  | 'notInList';

export interface Diagnostic {
  code: DiagnosticCode;
  /** Values for the message: names, types (as ValueType), operators. */
  params: Record<string, string>;
  /** Character offsets into the source, for underlining. */
  from: number;
  to: number;
}

export class ExprError extends Error {
  constructor(readonly diagnostic: Diagnostic) {
    super(diagnostic.code);
  }
}

const fail = (code: DiagnosticCode, from: number, to: number, params: Record<string, string> = {}): never => {
  throw new ExprError({ code, params, from, to });
};

// ---------- lexer ----------

type TokenKind = 'num' | 'str' | 'bool' | 'ident' | 'op' | 'eof';
export interface Token {
  kind: TokenKind;
  text: string;
  value?: Value;
  pos: number;
  /** Length in the source (keywords are normalized, so `text` may differ from what was typed). */
  len: number;
}

const KEYWORDS: Record<string, { kind: 'op' | 'bool'; norm: string | boolean }> = {
  and: { kind: 'op', norm: 'and' },
  и: { kind: 'op', norm: 'and' },
  or: { kind: 'op', norm: 'or' },
  или: { kind: 'op', norm: 'or' },
  not: { kind: 'op', norm: 'not' },
  не: { kind: 'op', norm: 'not' },
  true: { kind: 'bool', norm: true },
  истина: { kind: 'bool', norm: true },
  false: { kind: 'bool', norm: false },
  ложь: { kind: 'bool', norm: false },
};
const SYMBOL_ALIASES: Record<string, string> = { '&&': 'and', '||': 'or', '!': 'not' };
const SYMBOLS = [
  '+=',
  '-=',
  '==',
  '!=',
  '<=',
  '>=',
  '&&',
  '||',
  '+',
  '-',
  '*',
  '/',
  '%',
  '<',
  '>',
  '=',
  '!',
  '(',
  ')',
  ';',
];
const IDENT_START = /[A-Za-zА-Яа-яЁё_]/;
const IDENT_PART = /[A-Za-zА-Яа-яЁё_0-9]/;

/** Words that cannot be variable names. */
export function isKeyword(word: string): boolean {
  return word.toLowerCase() in KEYWORDS;
}

/** A valid variable name: letters (Latin or Cyrillic), digits and "_", not starting with a digit. */
export function isIdentifier(word: string): boolean {
  return /^[A-Za-zА-Яа-яЁё_][A-Za-zА-Яа-яЁё_0-9]*$/.test(word) && !isKeyword(word);
}

export function lex(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\r') {
      i++;
      continue;
    }
    if (c === '\n') {
      tokens.push({ kind: 'op', text: ';', pos: i, len: 1 });
      i++;
      continue;
    }
    if (/[0-9]/.test(c)) {
      const m = /^[0-9]+(\.[0-9]+)?/.exec(src.slice(i))!;
      tokens.push({ kind: 'num', text: m[0], value: Number(m[0]), pos: i, len: m[0].length });
      i += m[0].length;
      continue;
    }
    if (c === '"' || c === "'" || c === '«') {
      const close = c === '«' ? '»' : c;
      const end = src.indexOf(close, i + 1);
      if (end < 0) fail('unclosedString', i, src.length);
      tokens.push({ kind: 'str', text: src.slice(i, end + 1), value: src.slice(i + 1, end), pos: i, len: end + 1 - i });
      i = end + 1;
      continue;
    }
    if (IDENT_START.test(c)) {
      let j = i + 1;
      // Dotted names address variables owned by an entity: Мира.доверие
      while (j < src.length && (IDENT_PART.test(src[j]) || (src[j] === '.' && IDENT_START.test(src[j + 1] ?? '')))) j++;
      const text = src.slice(i, j);
      const kw = KEYWORDS[text.toLowerCase()];
      if (kw?.kind === 'bool') tokens.push({ kind: 'bool', text, value: kw.norm as boolean, pos: i, len: j - i });
      else if (kw) tokens.push({ kind: 'op', text: kw.norm as string, pos: i, len: j - i });
      else tokens.push({ kind: 'ident', text, pos: i, len: j - i });
      i = j;
      continue;
    }
    const sym = SYMBOLS.find((s) => src.startsWith(s, i));
    if (!sym) fail('badChar', i, i + 1, { char: c });
    tokens.push({ kind: 'op', text: SYMBOL_ALIASES[sym!] ?? sym!, pos: i, len: sym!.length });
    i += sym!.length;
  }
  tokens.push({ kind: 'eof', text: '', pos: src.length, len: 0 });
  return tokens;
}

// ---------- parser (precedence climbing) ----------

const BINARY_PRECEDENCE: Record<string, number> = {
  or: 1,
  and: 2,
  '==': 3,
  '!=': 3,
  '<': 4,
  '<=': 4,
  '>': 4,
  '>=': 4,
  '+': 5,
  '-': 5,
  '*': 6,
  '/': 6,
  '%': 6,
};

class Parser {
  i = 0;
  constructor(
    readonly tokens: Token[],
    private readonly src: string,
  ) {}

  peek(): Token {
    return this.tokens[this.i];
  }

  private next(): Token {
    return this.tokens[this.i++];
  }

  private failAt(t: Token, code: DiagnosticCode, params: Record<string, string> = {}): never {
    return fail(code, t.pos, Math.max(t.pos + 1, t.pos + t.len), params);
  }

  atEnd(): boolean {
    return this.peek().kind === 'eof';
  }

  expression(minPrec = 1): Expr {
    let left = this.unary();
    for (;;) {
      const t = this.peek();
      const prec = t.kind === 'op' ? BINARY_PRECEDENCE[t.text] : undefined;
      if (prec === undefined || prec < minPrec) break;
      this.next();
      const right = this.expression(prec + 1);
      left = { kind: 'binary', op: t.text as BinaryOp, left, right, pos: t.pos };
    }
    const t = this.peek();
    if (t.kind === 'op' && t.text === '=' && minPrec === 1) this.failAt(t, 'eqInCondition');
    return left;
  }

  private unary(): Expr {
    const t = this.peek();
    if (t.kind === 'op' && t.text === 'not') {
      this.next();
      return { kind: 'unary', op: 'not', arg: this.unary(), pos: t.pos };
    }
    if (t.kind === 'op' && t.text === '-') {
      this.next();
      return { kind: 'unary', op: 'neg', arg: this.unary(), pos: t.pos };
    }
    return this.primary();
  }

  private primary(): Expr {
    const t = this.next();
    if (t.kind === 'num' || t.kind === 'str' || t.kind === 'bool')
      return { kind: 'literal', value: t.value!, pos: t.pos };
    if (t.kind === 'ident') return { kind: 'var', name: t.text, pos: t.pos };
    if (t.kind === 'op' && t.text === '(') {
      const e = this.expression();
      const close = this.next();
      if (close.kind !== 'op' || close.text !== ')') this.failAt(close, 'missingParen');
      return e;
    }
    if (t.kind === 'eof') this.failAt(t, this.src.trim() ? 'unexpectedEnd' : 'empty');
    return this.failAt(t, 'expectedValue', { token: this.src.slice(t.pos, t.pos + t.len) });
  }

  effects(): Effect[] {
    const out: Effect[] = [];
    while (!this.atEnd()) {
      const t = this.next();
      if (t.kind === 'op' && t.text === ';') continue;
      if (t.kind !== 'ident') this.failAt(t, 'effectStart');
      const op = this.next();
      if (op.kind !== 'op' || !['=', '+=', '-='].includes(op.text)) this.failAt(op, 'effectOp');
      const value = this.expression();
      out.push({ target: t.text, op: op.text as EffectOp, value, pos: t.pos });
      const sep = this.peek();
      if (!(sep.kind === 'eof' || (sep.kind === 'op' && sep.text === ';'))) this.failAt(sep, 'effectSeparator');
    }
    return out;
  }
}

export function parseCondition(src: string): Expr {
  const p = new Parser(lex(src), src);
  const e = p.expression();
  if (!p.atEnd()) {
    const t = p.peek();
    fail('trailing', t.pos, src.length, { token: src.slice(t.pos, t.pos + t.len) });
  }
  return e;
}

export function parseEffects(src: string): Effect[] {
  return new Parser(lex(src), src).effects();
}

/** Empty or whitespace-only: "no condition" (always true) or "no effects". */
export function isBlank(src: string | undefined | null): boolean {
  return !src || src.trim() === '';
}

// ---------- type checking against the variable registry ----------

export interface RegistryEntry {
  type: ValueType;
  /** Allowed values of a list (enum) variable, or entity names of an entity variable. */
  values?: readonly string[];
}

/** Variable names visible in one place (a graph), with their types. Keys are names as written. */
export type Registry = ReadonlyMap<string, RegistryEntry>;

function distance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

/** The registered name closest to a misspelt one, if it is close enough to be a likely typo. */
export function suggestName(name: string, registry: Registry): string | null {
  const lower = name.toLowerCase();
  let best = '';
  let bestScore = Infinity;
  for (const candidate of registry.keys()) {
    const c = candidate.toLowerCase();
    const short = c.split('.').pop()!;
    const score = Math.min(distance(lower, c), distance(lower, short));
    if (score < bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best && bestScore <= Math.max(2, Math.floor(name.length / 3)) ? best : null;
}

function unknown(name: string, pos: number, registry: Registry): never {
  const suggestion = suggestName(name, registry);
  return fail('unknownVar', pos, pos + name.length, suggestion ? { name, suggestion } : { name });
}

/** A string literal compared with or assigned to a list variable must be one of its values. */
function checkListValue(a: Expr, b: Expr, registry: Registry): void {
  if (a.kind !== 'var' || b.kind !== 'literal' || typeof b.value !== 'string') return;
  const values = registry.get(a.name)?.values;
  if (values && !values.includes(b.value)) {
    fail('notInList', b.pos, b.pos + b.value.length + 2, { name: a.name, value: b.value, values: values.join(', ') });
  }
}

export function typeOf(e: Expr, registry: Registry): ValueType {
  switch (e.kind) {
    case 'literal':
      return typeof e.value === 'boolean' ? 'bool' : typeof e.value === 'number' ? 'number' : 'string';
    case 'var': {
      const v = registry.get(e.name);
      if (!v) return unknown(e.name, e.pos, registry);
      return v.type;
    }
    case 'unary': {
      const t = typeOf(e.arg, registry);
      const want: ValueType = e.op === 'not' ? 'bool' : 'number';
      if (t !== want) fail(e.op === 'not' ? 'notNeedsBool' : 'negNeedsNumber', e.pos, e.pos + 1, { type: t });
      return want;
    }
    case 'binary': {
      const l = typeOf(e.left, registry);
      const r = typeOf(e.right, registry);
      const from = e.pos;
      const to = e.pos + (e.op === 'and' || e.op === 'or' ? 2 : e.op.length);
      if (e.op === 'and' || e.op === 'or') {
        if (l !== 'bool' || r !== 'bool') fail('logicNeedsBool', from, to, { op: e.op, type: l === 'bool' ? r : l });
        return 'bool';
      }
      if (e.op === '==' || e.op === '!=') {
        if (l !== r) fail('compareTypes', from, to, { left: l, right: r });
        checkListValue(e.left, e.right, registry);
        checkListValue(e.right, e.left, registry);
        return 'bool';
      }
      if (e.op === '+' && l === 'string' && r === 'string') return 'string';
      if (l !== 'number' || r !== 'number') fail('numbersOnly', from, to, { op: e.op, left: l, right: r });
      return ['<', '<=', '>', '>='].includes(e.op) ? 'bool' : 'number';
    }
  }
}

/** Null when the condition is fine (or blank: no condition), else the first problem. */
export function checkCondition(src: string, registry: Registry): Diagnostic | null {
  if (isBlank(src)) return null;
  try {
    const t = typeOf(parseCondition(src), registry);
    if (t !== 'bool') return { code: 'conditionNotBool', params: { type: t }, from: 0, to: src.length };
    return null;
  } catch (err) {
    if (err instanceof ExprError) return err.diagnostic;
    throw err;
  }
}

export function checkEffects(src: string, registry: Registry): Diagnostic | null {
  if (isBlank(src)) return null;
  try {
    for (const eff of parseEffects(src)) {
      const target = registry.get(eff.target);
      if (!target) unknown(eff.target, eff.pos, registry);
      const to = eff.pos + eff.target.length;
      const t = typeOf(eff.value, registry);
      if (eff.op !== '=' && target!.type !== 'number') {
        fail('effectNumbersOnly', eff.pos, to, { op: eff.op, name: eff.target, type: target!.type });
      }
      if (t !== target!.type) fail('assignType', eff.pos, to, { name: eff.target, type: target!.type, value: t });
      checkListValue({ kind: 'var', name: eff.target, pos: eff.pos }, eff.value, registry);
    }
    return null;
  } catch (err) {
    if (err instanceof ExprError) return err.diagnostic;
    throw err;
  }
}

// ---------- names used, for "where used" and renames ----------

/** Variable names read by a condition (empty when it does not parse). */
export function namesInCondition(src: string): string[] {
  try {
    return [...new Set(collect(parseCondition(src)))];
  } catch {
    return [];
  }
}

/** Variables an effect list changes and the ones it reads. */
export function namesInEffects(src: string): { writes: string[]; reads: string[] } {
  try {
    const effects = parseEffects(src);
    const reads = new Set<string>();
    for (const e of effects) {
      collect(e.value).forEach((n) => reads.add(n));
      if (e.op !== '=') reads.add(e.target);
    }
    return { writes: [...new Set(effects.map((e) => e.target))], reads: [...reads] };
  } catch {
    return { writes: [], reads: [] };
  }
}

function collect(e: Expr, out: string[] = []): string[] {
  if (e.kind === 'var') out.push(e.name);
  else if (e.kind === 'unary') collect(e.arg, out);
  else if (e.kind === 'binary') {
    collect(e.left, out);
    collect(e.right, out);
  }
  return out;
}

/**
 * The source with every use of variable `from` renamed to `to`; strings and other names are untouched.
 * Returns the source unchanged when it does not even split into tokens.
 */
export function renameVariable(src: string, from: string, to: string): string {
  let tokens: Token[];
  try {
    tokens = lex(src);
  } catch {
    return src;
  }
  let out = '';
  let last = 0;
  for (const t of tokens) {
    if (t.kind === 'ident' && t.text === from) {
      out += src.slice(last, t.pos) + to;
      last = t.pos + t.len;
    }
  }
  return out + src.slice(last);
}

// ---------- evaluation ----------

/** Current values by variable name. */
export type State = Map<string, Value>;

/** Division by zero gives 0 instead of an error: a playthrough must not stop on designer data (ADR-005). */
export function evaluate(e: Expr, state: State): Value {
  switch (e.kind) {
    case 'literal':
      return e.value;
    case 'var': {
      const v = state.get(e.name);
      if (v === undefined) throw new Error(`variable ${e.name} has no value`);
      return v;
    }
    case 'unary':
      return e.op === 'not' ? !evaluate(e.arg, state) : -(evaluate(e.arg, state) as number);
    case 'binary': {
      if (e.op === 'and') return Boolean(evaluate(e.left, state)) && Boolean(evaluate(e.right, state));
      if (e.op === 'or') return Boolean(evaluate(e.left, state)) || Boolean(evaluate(e.right, state));
      const l = evaluate(e.left, state);
      const r = evaluate(e.right, state);
      switch (e.op) {
        case '==':
          return l === r;
        case '!=':
          return l !== r;
        case '<':
          return (l as number) < (r as number);
        case '<=':
          return (l as number) <= (r as number);
        case '>':
          return (l as number) > (r as number);
        case '>=':
          return (l as number) >= (r as number);
        case '+':
          return typeof l === 'string' ? l + String(r) : (l as number) + (r as number);
        case '-':
          return (l as number) - (r as number);
        case '*':
          return (l as number) * (r as number);
        case '/':
          return r === 0 ? 0 : (l as number) / (r as number);
        case '%':
          return r === 0 ? 0 : (l as number) % (r as number);
      }
    }
  }
}

/** One change made by an effect, for the playthrough log. */
export interface Change {
  name: string;
  before: Value | undefined;
  after: Value;
}

/** Applies effects in order; `whole` names integer variables (their results are truncated). */
export function applyEffects(
  effects: Effect[],
  state: State,
  whole: (name: string) => boolean = () => false,
): Change[] {
  const changes: Change[] = [];
  for (const eff of effects) {
    const before = state.get(eff.target);
    const value = evaluate(eff.value, state);
    let after: Value = eff.op === '=' ? value : (before as number) + (eff.op === '+=' ? 1 : -1) * (value as number);
    if (typeof after === 'number' && whole(eff.target)) after = Math.trunc(after);
    state.set(eff.target, after);
    changes.push({ name: eff.target, before, after });
  }
  return changes;
}

/** The tree without source positions, as exported (docs/format/export-v1.md). */
export function stripPositions<T>(tree: T): T {
  return JSON.parse(JSON.stringify(tree, (key, value: unknown) => (key === 'pos' ? undefined : value))) as T;
}
