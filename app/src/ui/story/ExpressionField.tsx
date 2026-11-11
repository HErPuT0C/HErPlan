import { MessageCircleQuestion, Plus } from 'lucide-react';
import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useStore } from '../../core/useStore';
import { getLocale, t, type MessageKey } from '../../i18n';
import { listEntities } from '../../story/entities';
import { CALL_WORDS, callsIn, checkCondition, checkEffects, isKeyword, type CallName } from '../../story/expr';
import { callWorld, spokenParts } from '../../story/game';
import { asStory, graphOf } from '../../story/model';
import {
  asRegistry,
  guessType,
  listsFor,
  nameProblem,
  newVariable,
  registryFor,
  type VarType,
} from '../../story/variables';
import { Button, MenuButton, type MenuEntry } from '../components';
import { useStory } from './context';
import { diagnosticText } from './messages';

const CALL_NAMES: Record<CallName, MessageKey> = {
  has: 'call.has',
  hired: 'call.hired',
  seen: 'call.seen',
  notEmpty: 'call.notEmpty',
};
/** How many names a list of есть(), нанят()… offers at most. */
const MENU_LIMIT = 40;

const KEYWORDS = { ru: ['и', 'или', 'не', 'истина', 'ложь'], en: ['and', 'or', 'not', 'true', 'false'] } as const;
const WORD = /[A-Za-zА-Яа-яЁё_0-9.]+$/;
const MAX_SUGGESTIONS = 8;

interface Suggestion {
  name: string;
  detail: string;
}

const TYPE_LABEL: Record<VarType, Parameters<typeof t>[0]> = {
  bool: 'var.type.bool',
  int: 'var.type.int',
  float: 'var.type.float',
  string: 'var.type.string',
  enum: 'var.type.enum',
  entity: 'var.type.entity',
  list: 'var.type.list',
};

/**
 * A condition or a list of effects (ADR-005) with checking as you type: the faulty part is underlined
 * and explained, names are completed from the variable registry, an unknown name can become a variable
 * in one click.
 */
export function ExpressionField({
  label,
  kind,
  value,
  onChange,
  field,
  readOnly,
}: {
  label: string;
  kind: 'condition' | 'effects';
  value: string;
  onChange: (value: string) => void;
  /** Lets the inspector focus this field ("expr", "option:<id>:effects"…). */
  field: string;
  readOnly: boolean;
}) {
  const { project, graphId } = useStory();
  const id = useId();
  const area = useRef<HTMLTextAreaElement>(null);
  const variables = useStore(project.store, (s) => s.variables);
  const entities = useStore(project.store, (s) => s.entities);
  const graphs = useStore(project.store, (s) => s.graphs);
  // The registry depends on variables, entities (owner names) and graphs (chapter scopes).
  const registry = useMemo(
    () => registryFor(project.store.getState(), graphId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [variables, entities, graphs, graphId],
  );
  // Names inside есть(), нанят(), видел(), непусто() are checked against the database and the story (0.8).
  const world = useMemo(
    () => callWorld(project.store.getState(), graphId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [variables, entities, graphs, graphId],
  );
  const diagnostic = useMemo(
    () =>
      kind === 'condition'
        ? checkCondition(value, asRegistry(registry), world)
        : checkEffects(value, asRegistry(registry), world),
    [kind, value, registry, world],
  );
  const [caret, setCaret] = useState<number | null>(null);
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  /** Which question to the game is being put in: its names are offered under the field. */
  const [asking, setAsking] = useState<CallName | null>(null);

  const word = caret === null ? '' : (WORD.exec(value.slice(0, caret))?.[0] ?? '');
  const suggestions = useMemo<Suggestion[]>(() => {
    if (!word || dismissed) return [];
    const q = word.toLowerCase();
    const names: Suggestion[] = [...registry].map(([name, entry]) => ({
      name,
      detail: t(TYPE_LABEL[entry.variable.type]),
    }));
    const words = KEYWORDS[getLocale() === 'ru' ? 'ru' : 'en'].map((k) => ({ name: k, detail: t('expr.keyword') }));
    return [...names, ...words]
      .filter((s) => s.name.toLowerCase().includes(q) && s.name !== word)
      .sort((a, b) => Number(!a.name.toLowerCase().startsWith(q)) - Number(!b.name.toLowerCase().startsWith(q)))
      .slice(0, MAX_SUGGESTIONS);
  }, [word, registry, dismissed]);

  const accept = (s: Suggestion) => {
    if (caret === null) return;
    const start = caret - word.length;
    const next = value.slice(0, start) + s.name + value.slice(caret);
    onChange(next);
    const pos = start + s.name.length;
    requestAnimationFrame(() => {
      area.current?.setSelectionRange(pos, pos);
      setCaret(pos);
    });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (suggestions.length === 0) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((i) => (i + step + suggestions.length) % suggestions.length);
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      accept(suggestions[Math.min(active, suggestions.length - 1)]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setDismissed(true);
    }
  };

  const track = () => {
    const el = area.current;
    if (!el) return;
    setCaret(el.selectionStart === el.selectionEnd ? el.selectionStart : null);
  };

  // "Create variable" for an unknown name, with a type guessed from how it is used.
  const unknown = diagnostic?.code === 'unknownVar' && !diagnostic.params.suggestion ? diagnostic.params.name : null;
  const canCreate =
    unknown &&
    !unknown.includes('.') &&
    !isKeyword(unknown) &&
    !nameProblem(project.store.getState(), unknown, 'project', null);
  const create = () => {
    if (!unknown) return;
    const variable = newVariable(unknown, guessType(value, unknown));
    project.store.dispatch(t('var.step.create'), (d) => {
      const file = d.variables as { variables?: unknown[] };
      (file.variables ??= []).push(variable);
    });
  };

  // видел(<id>) holds an id: under the field it is said which line or option that is.
  const seen = useMemo(() => {
    const ids = callsIn(value, kind).filter((c) => c.fn === 'seen');
    if (!ids.length) return [];
    const parts = spokenParts(project.store.getState());
    return ids.map((c) => ({ id: c.arg, text: parts.get(c.arg)?.text }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, kind, graphs]);

  /** Puts a question to the game at the caret (or at the end), joined with "and" to what is there. */
  const insertCall = (fn: CallName, arg: string) => {
    const ru = getLocale() === 'ru';
    const call = `${CALL_WORDS[fn][ru ? 'ru' : 'en']}(${arg})`;
    const at = caret ?? value.length;
    const before = value.slice(0, at).trimEnd();
    const after = value.slice(at).trimStart();
    const glue = ru ? ' и ' : ' and ';
    onChange([before, call, after].filter(Boolean).join(kind === 'condition' ? glue : ' '));
    requestAnimationFrame(() => area.current?.focus());
  };
  /** What a question to the game can name here: items, characters, lines and options of this graph, lists. */
  const callNames = (fn: CallName): { arg: string; label: string }[] => {
    const data = project.store.getState();
    if (fn === 'has' || fn === 'hired') {
      return listEntities(data, fn === 'has' ? 'item' : 'character')
        .filter((e) => e.name.trim())
        .map((e) => ({ arg: e.name, label: e.name }));
    }
    if (fn === 'notEmpty') return [...listsFor(data, graphId).keys()].map((name) => ({ arg: name, label: name }));
    return (graphOf(data, graphId)?.nodes ?? []).flatMap((raw) => {
      const n = asStory(raw);
      const title = n.title || t('story.untitled');
      return [
        ...(n.lines ?? []).map((l) => ({ arg: l.id, label: `${title}: ${l.text.slice(0, 48) || '…'}` })),
        ...(n.options ?? []).map((o) => ({ arg: o.id, label: `${title} › ${o.text.slice(0, 48) || '…'}` })),
      ];
    });
  };
  const callEntries: MenuEntry[] = (Object.keys(CALL_NAMES) as CallName[]).map((fn) => ({
    id: fn,
    label: t(CALL_NAMES[fn]),
    onSelect: () => setAsking(fn),
  }));

  // Underline: a mirror of the text behind the field, with the faulty part marked.
  const from = diagnostic ? Math.min(diagnostic.from, value.length) : 0;
  const to = diagnostic ? Math.max(from + 1, Math.min(diagnostic.to, value.length + 1)) : 0;

  return (
    <div
      className={['field', 'expr-field', diagnostic && 'field-invalid'].filter(Boolean).join(' ')}
      data-field={field}
    >
      <label htmlFor={id} className="field-label">
        {label}
      </label>
      <div className="expr-box">
        <div className="expr-mirror" aria-hidden="true">
          {diagnostic ? (
            <>
              {value.slice(0, from)}
              <mark className="expr-error">{value.slice(from, to) || ' '}</mark>
              {value.slice(to)}
            </>
          ) : (
            value
          )}{' '}
        </div>
        <textarea
          ref={area}
          id={id}
          className="input expr-input"
          value={value}
          rows={1}
          spellCheck={false}
          readOnly={readOnly}
          placeholder={t(kind === 'condition' ? 'expr.placeholderCondition' : 'expr.placeholderEffects')}
          aria-invalid={diagnostic ? true : undefined}
          aria-describedby={`${id}-msg`}
          aria-autocomplete="list"
          aria-controls={suggestions.length ? `${id}-list` : undefined}
          onChange={(e) => {
            onChange(e.target.value);
            setDismissed(false);
            setActive(0);
            setCaret(e.target.selectionStart);
          }}
          onKeyDown={onKeyDown}
          onKeyUp={track}
          onClick={track}
          onBlur={() => setCaret(null)}
        />
        {suggestions.length > 0 && (
          <ul id={`${id}-list`} className="expr-suggest" role="listbox" aria-label={t('expr.suggestions')}>
            {suggestions.map((s, i) => (
              <li
                key={s.name}
                role="option"
                aria-selected={i === active}
                className="expr-suggest-item"
                onPointerDown={(e) => {
                  e.preventDefault();
                  accept(s);
                }}
              >
                <span>{s.name}</span>
                <span className="muted small">{s.detail}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div
        id={`${id}-msg`}
        className={diagnostic ? 'field-error' : 'field-hint'}
        role={diagnostic ? 'alert' : undefined}
      >
        {diagnostic ? diagnosticText(diagnostic) : t(kind === 'condition' ? 'expr.hintCondition' : 'expr.hintEffects')}
      </div>
      {seen.map((x) => (
        <div key={x.id} className="field-hint expr-seen">
          {x.text === undefined
            ? t('call.seenGone', { id: x.id })
            : t('call.seenIs', { id: x.id, text: x.text || '…' })}
        </div>
      ))}
      {canCreate && !readOnly && (
        <Button size="sm" variant="ghost" icon={<Plus size={14} />} onClick={create}>
          {t('expr.createVariable', { name: unknown })}
        </Button>
      )}
      {kind === 'condition' && !readOnly && (
        <MenuButton
          label={t('call.insert')}
          size="sm"
          variant="ghost"
          icon={<MessageCircleQuestion size={14} />}
          entries={callEntries}
        />
      )}
      {asking && (
        <select
          className="input expr-ask"
          value=""
          autoFocus
          aria-label={t(CALL_NAMES[asking])}
          onBlur={() => setAsking(null)}
          onChange={(e) => {
            if (e.target.value) insertCall(asking, e.target.value);
            setAsking(null);
          }}
        >
          <option value="">{t(CALL_NAMES[asking])}…</option>
          {callNames(asking)
            .slice(0, MENU_LIMIT * 5)
            .map((n) => (
              <option key={n.arg} value={n.arg}>
                {n.label}
              </option>
            ))}
        </select>
      )}
    </div>
  );
}
