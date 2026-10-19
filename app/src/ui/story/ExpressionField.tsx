import { Plus } from 'lucide-react';
import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useStore } from '../../core/useStore';
import { getLocale, t } from '../../i18n';
import { checkCondition, checkEffects, isKeyword } from '../../story/expr';
import { asRegistry, guessType, nameProblem, newVariable, registryFor, type VarType } from '../../story/variables';
import { Button } from '../components';
import { useStory } from './context';
import { diagnosticText } from './messages';

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
  const diagnostic = useMemo(
    () =>
      kind === 'condition' ? checkCondition(value, asRegistry(registry)) : checkEffects(value, asRegistry(registry)),
    [kind, value, registry],
  );
  const [caret, setCaret] = useState<number | null>(null);
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState(false);

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
      {canCreate && !readOnly && (
        <Button size="sm" variant="ghost" icon={<Plus size={14} />} onClick={create}>
          {t('expr.createVariable', { name: unknown })}
        </Button>
      )}
    </div>
  );
}
