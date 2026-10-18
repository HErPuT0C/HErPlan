// Condition and effect language for story graphs (ADR-005 candidate).
//
//   condition:  доверие >= 3 and not предал        Мира.доверие > 2 или пощадил_рыцаря
//   effects:    доверие += 1; пощадил_рыцаря = true; Мира.настроение = "рада"
//
// Keywords have English and Russian spellings (and/и, or/или, not/не, true/истина, false/ложь);
// the AST is language-neutral so exporters for Unity and GameMaker only see one form.

export type ValueType = 'bool' | 'number' | 'string';
export type Value = boolean | number | string;

export type Expr =
  | { kind: 'literal'; value: Value; pos: number }
  | { kind: 'var'; name: string; pos: number }
  | { kind: 'unary'; op: 'not' | 'neg'; arg: Expr; pos: number }
  | { kind: 'binary'; op: BinaryOp; left: Expr; right: Expr; pos: number };

export type BinaryOp = 'or' | 'and' | '==' | '!=' | '<' | '<=' | '>' | '>=' | '+' | '-' | '*' | '/' | '%';

export interface Effect {
  target: string;
  op: '=' | '+=' | '-=';
  value: Expr;
  pos: number;
}

export interface Diagnostic {
  message: string;
  // Character offsets into the source, for underlining in the editor.
  from: number;
  to: number;
}

export class ExprError extends Error {
  diagnostic: Diagnostic;
  constructor(diagnostic: Diagnostic) {
    super(diagnostic.message);
    this.diagnostic = diagnostic;
  }
}

// ---------- lexer ----------

type TokenKind = 'num' | 'str' | 'ident' | 'op' | 'eof';
interface Token {
  kind: TokenKind;
  text: string;
  value?: Value;
  pos: number;
}

const KEYWORDS: Record<string, { kind: 'op' | 'bool'; norm: string | boolean }> = {
  and: { kind: 'op', norm: 'and' }, и: { kind: 'op', norm: 'and' },
  or: { kind: 'op', norm: 'or' }, или: { kind: 'op', norm: 'or' },
  not: { kind: 'op', norm: 'not' }, не: { kind: 'op', norm: 'not' },
  true: { kind: 'bool', norm: true }, истина: { kind: 'bool', norm: true },
  false: { kind: 'bool', norm: false }, ложь: { kind: 'bool', norm: false },
};
const SYMBOL_ALIASES: Record<string, string> = { '&&': 'and', '||': 'or', '!': 'not' };
const SYMBOLS = ['+=', '-=', '==', '!=', '<=', '>=', '&&', '||', '+', '-', '*', '/', '%', '<', '>', '=', '!', '(', ')', ';'];
const IDENT_START = /[A-Za-zА-Яа-яЁё_]/;
const IDENT_PART = /[A-Za-zА-Яа-яЁё_0-9]/;

function lex(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\r') { i++; continue; }
    if (c === '\n') { tokens.push({ kind: 'op', text: ';', pos: i }); i++; continue; }
    if (/[0-9]/.test(c)) {
      const m = /^[0-9]+(\.[0-9]+)?/.exec(src.slice(i))!;
      tokens.push({ kind: 'num', text: m[0], value: Number(m[0]), pos: i });
      i += m[0].length;
      continue;
    }
    if (c === '"' || c === "'" || c === '«') {
      const close = c === '«' ? '»' : c;
      const end = src.indexOf(close, i + 1);
      if (end < 0) throw new ExprError({ message: 'Строка не закрыта кавычкой', from: i, to: src.length });
      tokens.push({ kind: 'str', text: src.slice(i, end + 1), value: src.slice(i + 1, end), pos: i });
      i = end + 1;
      continue;
    }
    if (IDENT_START.test(c)) {
      let j = i + 1;
      // Dotted names address variables owned by an entity: Мира.доверие
      while (j < src.length && (IDENT_PART.test(src[j]) || (src[j] === '.' && IDENT_START.test(src[j + 1] ?? '')))) j++;
      const text = src.slice(i, j);
      const kw = KEYWORDS[text.toLowerCase()];
      if (kw?.kind === 'bool') tokens.push({ kind: 'num', text, value: kw.norm as boolean, pos: i });
      else if (kw) tokens.push({ kind: 'op', text: kw.norm as string, pos: i });
      else tokens.push({ kind: 'ident', text, pos: i });
      i = j;
      continue;
    }
    const sym = SYMBOLS.find((s) => src.startsWith(s, i));
    if (!sym) throw new ExprError({ message: `Непонятный символ «${c}»`, from: i, to: i + 1 });
    tokens.push({ kind: 'op', text: SYMBOL_ALIASES[sym] ?? sym, pos: i });
    i += sym.length;
  }
  tokens.push({ kind: 'eof', text: '', pos: src.length });
  return tokens;
}

// ---------- parser (precedence climbing) ----------

const BINARY_PRECEDENCE: Record<string, number> = {
  or: 1, and: 2, '==': 3, '!=': 3, '<': 4, '<=': 4, '>': 4, '>=': 4, '+': 5, '-': 5, '*': 6, '/': 6, '%': 6,
};

class Parser {
  i = 0;
  tokens: Token[];
  private src: string;
  constructor(tokens: Token[], src: string) {
    this.tokens = tokens;
    this.src = src;
  }

  private peek(): Token { return this.tokens[this.i]; }
  private next(): Token { return this.tokens[this.i++]; }
  private fail(t: Token, message: string): never {
    throw new ExprError({ message, from: t.pos, to: Math.max(t.pos + 1, t.pos + t.text.length) });
  }

  atEnd(): boolean { return this.peek().kind === 'eof'; }

  expect(text: string, message: string): void {
    const t = this.next();
    if (t.kind !== 'op' || t.text !== text) this.fail(t, message);
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
    if (t.kind === 'op' && t.text === '=' && minPrec === 1)
      this.fail(t, 'Для сравнения используйте «==», а «=» — только в эффектах');
    return left;
  }

  private unary(): Expr {
    const t = this.peek();
    if (t.kind === 'op' && t.text === 'not') { this.next(); return { kind: 'unary', op: 'not', arg: this.unary(), pos: t.pos }; }
    if (t.kind === 'op' && t.text === '-') { this.next(); return { kind: 'unary', op: 'neg', arg: this.unary(), pos: t.pos }; }
    return this.primary();
  }

  private primary(): Expr {
    const t = this.next();
    if (t.kind === 'num' || t.kind === 'str') return { kind: 'literal', value: t.value!, pos: t.pos };
    if (t.kind === 'ident') return { kind: 'var', name: t.text, pos: t.pos };
    if (t.kind === 'op' && t.text === '(') {
      const e = this.expression();
      this.expect(')', 'Не хватает закрывающей скобки «)»');
      return e;
    }
    if (t.kind === 'eof') this.fail(t, this.src.trim() ? 'Выражение обрывается: не хватает значения в конце' : 'Пустое выражение');
    this.fail(t, `Здесь ожидалось значение или имя переменной, а не «${t.text}»`);
  }

  effects(): Effect[] {
    const out: Effect[] = [];
    while (!this.atEnd()) {
      const t = this.next();
      if (t.kind === 'op' && t.text === ';') continue;
      if (t.kind !== 'ident') this.fail(t, 'Эффект начинается с имени переменной: «доверие += 1»');
      const op = this.next();
      if (op.kind !== 'op' || !['=', '+=', '-='].includes(op.text)) this.fail(op, 'После имени переменной нужен «=», «+=» или «-=»');
      const value = this.expression();
      out.push({ target: t.text, op: op.text as Effect['op'], value, pos: t.pos });
      const sep = this.peek();
      if (!(sep.kind === 'eof' || (sep.kind === 'op' && sep.text === ';'))) this.fail(sep, 'Эффекты разделяются «;» или переносом строки');
    }
    return out;
  }
}

export function parseCondition(src: string): Expr {
  const p = new Parser(lex(src), src);
  const e = p.expression();
  if (!p.atEnd()) {
    const t = p.tokens[p.i];
    throw new ExprError({ message: `Лишнее после выражения: «${t.text}»`, from: t.pos, to: src.length });
  }
  return e;
}

export function parseEffects(src: string): Effect[] {
  return new Parser(lex(src), src).effects();
}

// ---------- type checking against the project's variable registry ----------

export type Registry = Map<string, { type: ValueType }>;

const TYPE_NAMES: Record<ValueType, string> = { bool: 'да/нет', number: 'число', string: 'текст' };

function distance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

function suggest(name: string, registry: Registry): string {
  const lower = name.toLowerCase();
  let best = '';
  let bestScore = Infinity;
  for (const candidate of registry.keys()) {
    const c = candidate.toLowerCase();
    const short = c.split('.').pop()!;
    const score = Math.min(distance(lower, c), distance(lower, short));
    if (score < bestScore) { best = candidate; bestScore = score; }
  }
  return best && bestScore <= Math.max(2, Math.floor(name.length / 3)) ? ` Возможно, имелась в виду «${best}»?` : '';
}

export function typeOf(e: Expr, registry: Registry): ValueType {
  switch (e.kind) {
    case 'literal':
      return typeof e.value === 'boolean' ? 'bool' : typeof e.value === 'number' ? 'number' : 'string';
    case 'var': {
      const v = registry.get(e.name);
      if (!v) throw new ExprError({ message: `Неизвестная переменная «${e.name}».${suggest(e.name, registry)}`, from: e.pos, to: e.pos + e.name.length });
      return v.type;
    }
    case 'unary': {
      const t = typeOf(e.arg, registry);
      const want: ValueType = e.op === 'not' ? 'bool' : 'number';
      if (t !== want) throw new ExprError({ message: e.op === 'not' ? `«не» применяется к да/нет, а здесь ${TYPE_NAMES[t]}` : `Минус применяется к числу, а здесь ${TYPE_NAMES[t]}`, from: e.pos, to: e.pos + 1 });
      return want;
    }
    case 'binary': {
      const l = typeOf(e.left, registry);
      const r = typeOf(e.right, registry);
      const where = { from: e.pos, to: e.pos + e.op.length };
      if (e.op === 'and' || e.op === 'or') {
        if (l !== 'bool' || r !== 'bool') throw new ExprError({ message: `«${e.op === 'and' ? 'и' : 'или'}» соединяет условия да/нет, а здесь ${TYPE_NAMES[l === 'bool' ? r : l]}`, ...where });
        return 'bool';
      }
      if (e.op === '==' || e.op === '!=') {
        if (l !== r) throw new ExprError({ message: `Сравниваются разные типы: ${TYPE_NAMES[l]} и ${TYPE_NAMES[r]}`, ...where });
        return 'bool';
      }
      if (e.op === '+' && l === 'string' && r === 'string') return 'string';
      if (l !== 'number' || r !== 'number') throw new ExprError({ message: `«${e.op}» работает с числами, а здесь ${TYPE_NAMES[l]} и ${TYPE_NAMES[r]}`, ...where });
      return ['<', '<=', '>', '>='].includes(e.op) ? 'bool' : 'number';
    }
  }
}

export function checkCondition(src: string, registry: Registry): Diagnostic | null {
  try {
    const t = typeOf(parseCondition(src), registry);
    if (t !== 'bool') return { message: `Условие должно давать да/нет, а даёт ${TYPE_NAMES[t]}. Например: «${src.trim()} > 0»`, from: 0, to: src.length };
    return null;
  } catch (err) {
    if (err instanceof ExprError) return err.diagnostic;
    throw err;
  }
}

export function checkEffects(src: string, registry: Registry): Diagnostic | null {
  try {
    for (const eff of parseEffects(src)) {
      const target = registry.get(eff.target);
      if (!target) throw new ExprError({ message: `Неизвестная переменная «${eff.target}».${suggest(eff.target, registry)}`, from: eff.pos, to: eff.pos + eff.target.length });
      const t = typeOf(eff.value, registry);
      if (eff.op !== '=' && target.type !== 'number') throw new ExprError({ message: `«${eff.op}» работает только с числами, а «${eff.target}» — ${TYPE_NAMES[target.type]}`, from: eff.pos, to: eff.pos + eff.target.length });
      if (t !== target.type) throw new ExprError({ message: `«${eff.target}» — ${TYPE_NAMES[target.type]}, ему нельзя присвоить ${TYPE_NAMES[t]}`, from: eff.pos, to: eff.pos + eff.target.length });
    }
    return null;
  } catch (err) {
    if (err instanceof ExprError) return err.diagnostic;
    throw err;
  }
}

// ---------- evaluation ----------

export type State = Map<string, Value>;

export function evaluate(e: Expr, state: State): Value {
  switch (e.kind) {
    case 'literal': return e.value;
    case 'var': {
      const v = state.get(e.name);
      if (v === undefined) throw new Error(`variable ${e.name} has no value`);
      return v;
    }
    case 'unary': return e.op === 'not' ? !evaluate(e.arg, state) : -(evaluate(e.arg, state) as number);
    case 'binary': {
      if (e.op === 'and') return Boolean(evaluate(e.left, state)) && Boolean(evaluate(e.right, state));
      if (e.op === 'or') return Boolean(evaluate(e.left, state)) || Boolean(evaluate(e.right, state));
      const l = evaluate(e.left, state) as number;
      const r = evaluate(e.right, state) as number;
      switch (e.op) {
        case '==': return l === r;
        case '!=': return l !== r;
        case '<': return l < r;
        case '<=': return l <= r;
        case '>': return l > r;
        case '>=': return l >= r;
        case '+': return (l as unknown as string) + (r as unknown as string) as unknown as number;
        case '-': return l - r;
        case '*': return l * r;
        case '/': return r === 0 ? 0 : l / r;
        case '%': return r === 0 ? 0 : l % r;
      }
    }
  }
}

export function applyEffects(effects: Effect[], state: State): void {
  for (const eff of effects) {
    const value = evaluate(eff.value, state);
    if (eff.op === '=') state.set(eff.target, value);
    else state.set(eff.target, (state.get(eff.target) as number) + (eff.op === '+=' ? 1 : -1) * (value as number));
  }
}
