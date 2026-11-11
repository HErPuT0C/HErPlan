// Small editors of what the game needs (0.8), shared by the dialogue inspector, the variables panel and the
// database cards: a value from the game's palette, a name in the game, a list of game actions, seconds.

import { Plus, Trash, Wand2 } from 'lucide-react';
import { useId, useState } from 'react';
import type { ProjectData } from '../../core/project/types';
import { t, type MessageKey } from '../../i18n';
import { listEntities } from '../../story/entities';
import { freeKey, keyProblem, takenKeys } from '../../story/gameKey';
import {
  ACTION_TYPES,
  toward,
  towardValue,
  type ActionType,
  type GameAction,
  type TowardValue,
} from '../../story/model';
import { type Palette, type PaletteList } from '../../story/palette';
import { listVariables } from '../../story/variables';
import { IconButton, MenuButton } from '../components';
import { ACTION_NAMES } from './messages';
import './game.css';

/**
 * One value of a palette list: a dropdown of the game's own names, or, when the game gave no list, a plain
 * text field for the id. A value the palette does not have stays, marked.
 */
export function PaletteInput({
  palette,
  list,
  value,
  label,
  onChange,
  disabled,
  className,
}: {
  palette: Palette;
  list: PaletteList;
  value: string | undefined | null;
  /** Names the field and stands in it while it is empty. */
  label: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
}) {
  const entries = palette[list];
  const current = value ?? '';
  const cls = ['input', 'palette-input', className].filter(Boolean).join(' ');
  if (!entries.length) {
    return (
      <input
        className={cls}
        value={current}
        disabled={disabled}
        placeholder={label}
        aria-label={label}
        title={t('palette.none')}
        spellCheck={false}
        onChange={(e) => onChange(e.target.value.trim())}
      />
    );
  }
  const known = entries.some((e) => e.id === current);
  const hint = entries.find((e) => e.id === current)?.hint;
  return (
    <select
      className={[cls, current && !known && 'palette-unknown'].filter(Boolean).join(' ')}
      value={current}
      disabled={disabled}
      aria-label={label}
      title={current && !known ? t('palette.unknown', { id: current }) : (hint ?? label)}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">{`${label}: —`}</option>
      {entries.map((e) => (
        <option key={e.id} value={e.id} title={e.hint}>
          {e.name}
        </option>
      ))}
      {current && !known && <option value={current}>{t('palette.unknown', { id: current })}</option>}
    </select>
  );
}

/** A gesture or an emote with "to whom": the palette value and, when it has one, another participant. */
export function TowardInput({
  palette,
  list,
  value,
  label,
  people,
  onChange,
  disabled,
}: {
  palette: Palette;
  list: PaletteList;
  value: TowardValue | undefined;
  label: string;
  /** Who it can be aimed at. */
  people: { id: string; name: string }[];
  onChange: (value: TowardValue | undefined) => void;
  disabled?: boolean;
}) {
  const v = toward(value);
  const gone = v?.to && !people.some((p) => p.id === v.to);
  return (
    <span className="toward-input">
      <PaletteInput
        palette={palette}
        list={list}
        value={v?.id}
        label={label}
        disabled={disabled}
        onChange={(id) => onChange(towardValue(id, v?.to))}
      />
      {v && (
        <select
          className="input toward-to"
          value={v.to ?? ''}
          disabled={disabled}
          aria-label={t('line.toward', { what: label })}
          title={t('line.toward', { what: label })}
          onChange={(e) => onChange(towardValue(v.id, e.target.value || null))}
        >
          <option value="">{t('line.towardNobody')}</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name || t('story.untitled')}
            </option>
          ))}
          {gone && <option value={v.to!}>{t('story.lines.deletedSpeaker')}</option>}
        </select>
      )}
    </span>
  );
}

/** Seconds (or any number) that may be left blank: blank is "not set", not zero. */
export function NumberBlank({
  value,
  label,
  onChange,
  disabled,
  min = 0,
  step = 0.1,
  placeholder,
}: {
  value: number | undefined;
  label: string;
  onChange: (value: number | undefined) => void;
  disabled?: boolean;
  min?: number;
  step?: number;
  placeholder?: string;
}) {
  const id = useId();
  return (
    <span className="number-blank">
      <label htmlFor={id} className="small muted">
        {label}
      </label>
      <input
        id={id}
        className="input"
        type="number"
        min={min}
        step={step}
        value={value ?? ''}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => {
          const n = e.target.value === '' ? NaN : Number(e.target.value);
          onChange(Number.isFinite(n) && n >= min ? n : undefined);
        }}
      />
    </span>
  );
}

/** Shown in the empty field: what a name in the game looks like (not interface text: the same in every language). */
const KEY_EXAMPLE = 'skeleton_talk';
const KEY_PROBLEMS: Record<'invalid' | 'taken', MessageKey> = { invalid: 'gameKey.invalid', taken: 'gameKey.taken' };

/**
 * "Name in the game": Latin, kept as typed even while it is wrong (said under the field); "suggest" makes
 * one from the title. Changing a name that was already there warns: the game knows the old one.
 */
export function GameKeyField({
  value,
  title,
  among,
  id: ownerId,
  data,
  onChange,
  disabled,
}: {
  value: string;
  /** What the suggestion is made from. */
  title: string;
  among: 'graphs' | 'entities' | 'variables';
  /** The object that has the name (its own name does not clash with itself). */
  id: string;
  data: () => ProjectData;
  onChange: (key: string) => void;
  disabled?: boolean;
}) {
  const fieldId = useId();
  // The name the field had when it was entered: a warning shows while it differs from it.
  const [was, setWas] = useState<string | null>(null);
  const problem = keyProblem(data(), among, value, ownerId);
  const changed = was !== null && was !== '' && was !== value;
  return (
    <div className={['field', 'game-key', problem && 'field-invalid'].filter(Boolean).join(' ')} data-field="key">
      <label htmlFor={fieldId} className="field-label">
        {t('gameKey.label')}
      </label>
      <div className="game-key-row">
        <input
          id={fieldId}
          className="input"
          value={value}
          disabled={disabled}
          spellCheck={false}
          placeholder={KEY_EXAMPLE}
          aria-invalid={problem ? true : undefined}
          aria-describedby={`${fieldId}-msg`}
          onFocus={() => setWas((w) => w ?? value)}
          onChange={(e) => onChange(e.target.value.trim())}
        />
        {!disabled && (
          <IconButton
            size="sm"
            label={t('gameKey.suggest')}
            icon={<Wand2 size={14} />}
            disabled={!title.trim()}
            onClick={() => {
              setWas((w) => w ?? value);
              onChange(freeKey(title, takenKeys(data(), among, ownerId)));
            }}
          />
        )}
      </div>
      <div
        id={`${fieldId}-msg`}
        className={problem ? 'field-error' : 'field-hint'}
        role={problem ? 'alert' : undefined}
      >
        {problem ? t(KEY_PROBLEMS[problem]) : changed ? t('gameKey.changed', { was: was ?? '' }) : t('gameKey.hint')}
      </div>
    </div>
  );
}

/** What an action refers to, by its kind. */
const NEEDS: Record<ActionType, 'item' | 'character' | 'list' | 'value' | null> = {
  give_item: 'item',
  take_item: 'item',
  hire: 'character',
  dismiss: 'character',
  list_add: 'list',
  give_list: 'list',
  save: null,
  event: 'value',
  start_quest: 'value',
};

const OWN_VALUE = '\u0000value';

/**
 * Game actions of a line, an option or a node: "+ action" with a choice of the kind, and for each one what
 * it refers to in the database.
 */
export function ActionsEditor({
  actions,
  data,
  onChange,
  disabled,
  field,
}: {
  actions: GameAction[] | undefined;
  data: ProjectData;
  onChange: (actions: GameAction[]) => void;
  disabled?: boolean;
  field?: string;
}) {
  const list = actions ?? [];
  const items = listEntities(data, 'item');
  const characters = listEntities(data, 'character');
  const lists = listVariables(data).filter((v) => v.type === 'list');
  const set = (i: number, patch: Partial<GameAction>) =>
    onChange(list.map((a, j) => (j === i ? clean({ ...a, ...patch }) : a)));
  return (
    <div className="actions-editor" data-field={field}>
      {list.map((a, i) => {
        const need = NEEDS[a.type];
        const options =
          need === 'item'
            ? items.map((e) => ({ id: e.id, name: e.name }))
            : need === 'character'
              ? characters.map((e) => ({ id: e.id, name: e.name }))
              : need === 'list'
                ? lists.map((v) => ({ id: v.id, name: v.name }))
                : [];
        const missing = a.ref && !options.some((o) => o.id === a.ref);
        return (
          <div key={i} className="action-row">
            <span className="action-kind">{t(ACTION_NAMES[a.type])}</span>
            {need && need !== 'value' && (
              <select
                className={['input', !a.ref && 'action-unset'].filter(Boolean).join(' ')}
                value={a.ref ?? ''}
                disabled={disabled}
                aria-label={t('action.ref')}
                onChange={(e) => set(i, { ref: e.target.value || null })}
              >
                <option value="">{t(need === 'list' ? 'action.pickList' : 'action.pick')}</option>
                {options.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name || t('story.untitled')}
                  </option>
                ))}
                {missing && <option value={a.ref!}>{t('story.card.deleted')}</option>}
              </select>
            )}
            {a.type === 'list_add' && (
              <select
                className="input"
                value={a.item ?? (a.value !== undefined ? OWN_VALUE : '')}
                disabled={disabled}
                aria-label={t('action.what')}
                onChange={(e) =>
                  set(
                    i,
                    e.target.value === OWN_VALUE
                      ? { item: null, value: a.value ?? '' }
                      : { item: e.target.value || null, value: undefined },
                  )
                }
              >
                <option value="">{t('action.what')}</option>
                {items.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name || t('story.untitled')}
                  </option>
                ))}
                <option value={OWN_VALUE}>{t('action.ownValue')}</option>
              </select>
            )}
            {(need === 'value' || (a.type === 'list_add' && !a.item && a.value !== undefined)) && (
              <input
                className="input"
                value={a.value ?? ''}
                disabled={disabled}
                spellCheck={false}
                placeholder={t(need === 'value' ? 'action.key' : 'action.value')}
                aria-label={t(need === 'value' ? 'action.key' : 'action.value')}
                onChange={(e) => onChange(list.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
              />
            )}
            {!disabled && (
              <IconButton
                size="sm"
                label={t('action.remove')}
                icon={<Trash size={14} />}
                onClick={() => onChange(list.filter((_, j) => j !== i))}
              />
            )}
          </div>
        );
      })}
      {!disabled && (
        <MenuButton
          label={t('action.add')}
          size="sm"
          variant="ghost"
          icon={<Plus size={14} />}
          entries={ACTION_TYPES.map((type) => ({
            id: type,
            label: t(ACTION_NAMES[type]),
            onSelect: () => onChange([...list, { type }]),
          }))}
        />
      )}
    </div>
  );
}

/** An action without the fields that hold nothing. */
function clean(a: GameAction): GameAction {
  const out: GameAction = { type: a.type };
  if (a.ref) out.ref = a.ref;
  if (a.item) out.item = a.item;
  if (a.value !== undefined) out.value = a.value;
  return out;
}
