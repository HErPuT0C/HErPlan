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
import { actionRef, type Palette, type PaletteList } from '../../story/palette';
import { listVariables } from '../../story/variables';
import { useAtom } from '../../core/useStore';
import { gameFiles } from '../../state/gameFiles';
import { IconButton, MenuButton } from '../components';
import { ACTION_NAMES } from './messages';
import { listItems } from './paletteItems';
import { PaletteSelect, type SelectItem } from './PaletteSelect';
import './game.css';

/**
 * One value of a palette list (0.8.1): picked from the list (styles in their colours, emotes by icon, sounds
 * to hear); typed only when the project has no palette. "— нет —" takes the field out of the file.
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
  return (
    <PaletteSelect
      label={label}
      value={value}
      items={listItems(palette, list)}
      noPalette={!palette.loaded}
      disabled={disabled}
      className={className}
      onChange={onChange}
    />
  );
}

/**
 * A gesture, an emote or a face, and who shows it (0.8.1: "кому" — the speaker by default, or another
 * participant of this conversation).
 */
export function TowardInput({
  palette,
  list,
  items,
  gray,
  value,
  label,
  people,
  nameOf,
  onChange,
  disabled,
  autoOpen,
  onOpened,
}: {
  palette: Palette;
  list: PaletteList;
  /** What to choose from, when not the whole list (the faces of a speaker). */
  items?: SelectItem[];
  gray?: string | null;
  value: TowardValue | undefined;
  label: string;
  /** Who else speaks in the conversation. */
  people: string[];
  nameOf: (id: string) => string;
  onChange: (value: TowardValue | undefined) => void;
  disabled?: boolean;
  autoOpen?: boolean;
  onOpened?: () => void;
}) {
  const v = toward(value);
  const gone = v?.to && !people.includes(v.to);
  return (
    <span className="toward-input">
      <PaletteSelect
        label={label}
        value={v?.id}
        items={items ?? listItems(palette, list)}
        gray={gray}
        noPalette={!palette.loaded}
        disabled={disabled}
        autoOpen={autoOpen}
        onOpened={onOpened}
        onChange={(id) => onChange(towardValue(id, v?.to))}
      />
      {v && (people.length > 0 || v.to) && (
        <select
          className="input toward-to"
          value={v.to ?? ''}
          disabled={disabled}
          aria-label={t('line.toward', { what: label })}
          title={t('line.toward', { what: label })}
          onChange={(e) => onChange(towardValue(v.id, e.target.value || null))}
        >
          <option value="">{t('line.towardSpeaker')}</option>
          {people.map((p) => (
            <option key={p} value={p}>
              {nameOf(p)}
            </option>
          ))}
          {gone && <option value={v.to!}>{nameOf(v.to!)}</option>}
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

const OWN_VALUE = '\u0000value';

/** What an action is called: by the palette, else by HErPlan's own names. */
export function actionName(palette: Palette, type: string): string {
  const own = palette.actions.find((a) => a.id === type)?.name;
  if (own) return own;
  return type in ACTION_NAMES ? t(ACTION_NAMES[type as ActionType]) : type;
}

/**
 * Game actions of a line, an option or a node: "+ action" with a choice of the kind (the palette's list of
 * actions when it has one, 0.8.1), and for each one what it refers to: an item, a character, a variable of
 * the database, or a text.
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
  const { palette } = useAtom(gameFiles);
  const list = actions ?? [];
  const items = listEntities(data, 'item');
  const characters = listEntities(data, 'character');
  // Lists first: the game fills them with "add to a list".
  const variables = listVariables(data).sort((a, b) => Number(b.type === 'list') - Number(a.type === 'list'));
  const kinds = palette.actions.length
    ? palette.actions.map((a) => ({ id: a.id, name: a.name }))
    : ACTION_TYPES.map((id) => ({ id, name: t(ACTION_NAMES[id]) }));
  const set = (i: number, patch: Partial<GameAction>) =>
    onChange(list.map((a, j) => (j === i ? clean({ ...a, ...patch }) : a)));
  return (
    <div className="actions-editor" data-field={field}>
      {list.map((a, i) => {
        const ref = actionRef(palette, a.type);
        const options =
          ref === 'item'
            ? items.map((e) => ({ id: e.id, name: e.name }))
            : ref === 'character'
              ? characters.map((e) => ({ id: e.id, name: e.name }))
              : ref === 'variable'
                ? variables.map((v) => ({ id: v.id, name: v.name }))
                : [];
        const missing = a.ref && !options.some((o) => o.id === a.ref);
        return (
          <div
            key={i}
            className={['action-row', ref === undefined && 'action-unknown'].filter(Boolean).join(' ')}
            title={ref === undefined ? t('palette.notInGame') : undefined}
          >
            <span className="action-kind">{actionName(palette, a.type)}</span>
            {(ref === 'item' || ref === 'character' || ref === 'variable') && (
              <select
                className={['input', !a.ref && 'action-unset'].filter(Boolean).join(' ')}
                value={a.ref ?? ''}
                disabled={disabled}
                aria-label={t('action.ref')}
                onChange={(e) => set(i, { ref: e.target.value || null })}
              >
                <option value="">{t(ref === 'variable' ? 'action.pickList' : 'action.pick')}</option>
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
            {(ref === 'text' || (a.type === 'list_add' && !a.item && a.value !== undefined)) && (
              <input
                className="input"
                value={a.value ?? ''}
                disabled={disabled}
                spellCheck={false}
                placeholder={t(ref === 'text' ? 'action.key' : 'action.value')}
                aria-label={t(ref === 'text' ? 'action.key' : 'action.value')}
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
          entries={kinds.map((k) => ({ id: k.id, label: k.name, onSelect: () => onChange([...list, { type: k.id }]) }))}
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
