import { X } from 'lucide-react';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { t } from '../../i18n';
import { IconButton } from './Button';

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  /** Escape and a click outside close the dialog; off while an action is running. */
  dismissable?: boolean;
  className?: string;
}

/** Modal dialog on the native <dialog>: focus stays inside, Escape works, the page behind is inert. */
export function Dialog(props: DialogProps) {
  return props.open ? <OpenDialog {...props} /> : null;
}

function OpenDialog({ onClose, title, children, footer, size = 'md', dismissable = true, className }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const pressedOnBackdrop = useRef(false);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    return () => dialog.close?.();
  }, []);

  return (
    <dialog
      ref={ref}
      className={['dialog', `dialog-${size}`, className].filter(Boolean).join(' ')}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        if (dismissable) onClose();
      }}
      onPointerDown={(e) => {
        pressedOnBackdrop.current = e.target === ref.current;
      }}
      onClick={(e) => {
        // Only a click that started and ended outside the content closes it (not a text selection drag).
        if (dismissable && pressedOnBackdrop.current && e.target === ref.current) onClose();
      }}
    >
      <div className="dialog-inner">
        <header className="dialog-header">
          <h2 id={titleId}>{title}</h2>
          <IconButton label={t('common.close')} icon={<X size={18} />} onClick={onClose} disabled={!dismissable} />
        </header>
        <div className="dialog-body">{children}</div>
        {footer && <footer className="dialog-footer">{footer}</footer>}
      </div>
    </dialog>
  );
}
