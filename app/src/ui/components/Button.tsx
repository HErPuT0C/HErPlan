import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Spinner } from './Spinner';
import { Tooltip } from './Tooltip';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: 'md' | 'sm';
  icon?: ReactNode;
  /** Shown after the label, e.g. the chevron of a menu button. */
  trailing?: ReactNode;
  /** Shows a spinner and blocks clicks while an action runs. */
  busy?: boolean;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  trailing,
  busy = false,
  className,
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={['btn', `btn-${variant}`, size === 'sm' && 'btn-sm', className].filter(Boolean).join(' ')}
    >
      {busy ? <Spinner size={14} /> : icon}
      {children !== undefined && <span>{children}</span>}
      {trailing}
    </button>
  );
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Accessible name and tooltip; icon-only buttons must have one. */
  label: string;
  icon: ReactNode;
  size?: 'md' | 'sm';
  pressed?: boolean;
}

export function IconButton({
  label,
  icon,
  size = 'md',
  pressed,
  className,
  type = 'button',
  ...rest
}: IconButtonProps) {
  return (
    <Tooltip text={label}>
      <button
        {...rest}
        type={type}
        aria-label={label}
        aria-pressed={pressed}
        className={['icon-btn', size === 'sm' && 'icon-btn-sm', className].filter(Boolean).join(' ')}
      >
        {icon}
      </button>
    </Tooltip>
  );
}
