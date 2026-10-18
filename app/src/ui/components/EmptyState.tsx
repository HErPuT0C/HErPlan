import type { ReactNode } from 'react';

export function EmptyState({
  icon,
  title,
  text,
  actions,
}: {
  icon?: ReactNode;
  title: string;
  text?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="empty">
      {icon && <div className="empty-icon">{icon}</div>}
      <h3 className="empty-title">{title}</h3>
      {text && <p className="empty-text">{text}</p>}
      {actions && <div className="empty-actions">{actions}</div>}
    </div>
  );
}
