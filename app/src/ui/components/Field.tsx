import {
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';

interface FieldFrameProps {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  id: string;
  children: ReactNode;
  className?: string;
}

function FieldFrame({ label, hint, error, id, children, className }: FieldFrameProps) {
  return (
    <div className={['field', error && 'field-invalid', className].filter(Boolean).join(' ')}>
      <label htmlFor={id} className="field-label">
        {label}
      </label>
      {children}
      {error ? (
        <div id={`${id}-msg`} className="field-error" role="alert">
          {error}
        </div>
      ) : (
        hint && (
          <div id={`${id}-msg`} className="field-hint">
            {hint}
          </div>
        )
      )}
    </div>
  );
}

interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: ReactNode;
  error?: string | null;
}

export function TextField({ label, hint, error, id, className, ...rest }: TextFieldProps) {
  const auto = useId();
  const fieldId = id ?? auto;
  return (
    <FieldFrame label={label} hint={hint} error={error} id={fieldId} className={className}>
      <input
        {...rest}
        id={fieldId}
        className="input"
        aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? `${fieldId}-msg` : undefined}
      />
    </FieldFrame>
  );
}

interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  hint?: ReactNode;
  error?: string | null;
}

export function TextArea({ label, hint, error, id, className, ...rest }: TextAreaProps) {
  const auto = useId();
  const fieldId = id ?? auto;
  return (
    <FieldFrame label={label} hint={hint} error={error} id={fieldId} className={className}>
      <textarea
        {...rest}
        id={fieldId}
        className="input textarea"
        aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? `${fieldId}-msg` : undefined}
      />
    </FieldFrame>
  );
}

export interface SelectOption<T extends string | number> {
  value: T;
  label: string;
}

interface SelectFieldProps<T extends string | number> extends Omit<
  SelectHTMLAttributes<HTMLSelectElement>,
  'value' | 'onChange'
> {
  label: string;
  hint?: ReactNode;
  value: T;
  options: readonly SelectOption<T>[];
  onChange: (value: T) => void;
}

/** A native select: keyboard, screen readers and the Windows dropdown work without extra code. */
export function SelectField<T extends string | number>({
  label,
  hint,
  value,
  options,
  onChange,
  id,
  className,
  ...rest
}: SelectFieldProps<T>) {
  const auto = useId();
  const fieldId = id ?? auto;
  return (
    <FieldFrame label={label} hint={hint} id={fieldId} className={className}>
      <select
        {...rest}
        id={fieldId}
        className="input select"
        value={String(value)}
        aria-describedby={hint ? `${fieldId}-msg` : undefined}
        onChange={(e) => {
          const picked = options.find((o) => String(o.value) === e.target.value);
          if (picked) onChange(picked.value);
        }}
      >
        {options.map((o) => (
          <option key={String(o.value)} value={String(o.value)}>
            {o.label}
          </option>
        ))}
      </select>
    </FieldFrame>
  );
}

interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange'> {
  label: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

export function Checkbox({ label, checked, onChange, className, ...rest }: CheckboxProps) {
  return (
    <label className={['checkbox', className].filter(Boolean).join(' ')}>
      <input {...rest} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

export function Switch({ label, checked, onChange, className, ...rest }: CheckboxProps) {
  return (
    <label className={['switch', className].filter(Boolean).join(' ')}>
      <input {...rest} type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch-track" aria-hidden="true" />
      <span>{label}</span>
    </label>
  );
}
