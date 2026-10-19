import type { ProjectData } from '../../core/project/types';
import { t } from '../../i18n';
import type { Value } from '../../story/expr';
import { listEntities } from '../../story/entities';
import type { Variable } from '../../story/variables';

/** An editor for one value of a variable's type: a switch, a number, text, a list item or an entity. */
export function ValueInput({
  variable,
  value,
  entities,
  onChange,
  disabled,
  label,
}: {
  variable: Pick<Variable, 'type' | 'values'>;
  value: Value | null;
  entities: ProjectData['entities'];
  onChange: (value: Value | null) => void;
  disabled?: boolean;
  label: string;
}) {
  switch (variable.type) {
    case 'bool':
      return (
        <label className="switch value-input">
          <input
            type="checkbox"
            role="switch"
            checked={value === true}
            disabled={disabled}
            aria-label={label}
            onChange={(e) => onChange(e.target.checked)}
          />
          <span className="switch-track" aria-hidden="true" />
          <span>{value === true ? t('var.yes') : t('var.no')}</span>
        </label>
      );
    case 'int':
    case 'float':
      return (
        <input
          className="input value-input"
          type="number"
          step={variable.type === 'int' ? 1 : 'any'}
          value={typeof value === 'number' ? value : 0}
          disabled={disabled}
          aria-label={label}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isFinite(n)) onChange(variable.type === 'int' ? Math.trunc(n) : n);
          }}
        />
      );
    case 'enum':
      return (
        <select
          className="input value-input"
          value={typeof value === 'string' ? value : ''}
          disabled={disabled}
          aria-label={label}
          onChange={(e) => onChange(e.target.value)}
        >
          {(variable.values ?? []).map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      );
    case 'entity':
      return (
        <select
          className="input value-input"
          value={typeof value === 'string' ? value : ''}
          disabled={disabled}
          aria-label={label}
          onChange={(e) => onChange(e.target.value || null)}
        >
          <option value="">{t('story.ref.none')}</option>
          {listEntities({ entities }).map((e) => (
            <option key={e.id} value={e.id}>
              {e.name || t('story.untitled')}
            </option>
          ))}
        </select>
      );
    default:
      return (
        <input
          className="input value-input"
          value={typeof value === 'string' ? value : ''}
          disabled={disabled}
          aria-label={label}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
}
