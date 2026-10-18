import type { ReactNode } from 'react';

/** Side panel with the properties of the selected object (node, entity, task). */
export function PropertyPanel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <aside className="props" aria-label={title}>
      <header className="props-title">{title}</header>
      <div className="props-body">{children}</div>
    </aside>
  );
}

export function PropertySection({
  title,
  defaultOpen = true,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details className="props-section" open={defaultOpen}>
      <summary>{title}</summary>
      <div className="props-section-body">{children}</div>
    </details>
  );
}

export function PropertyRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="prop-row">
      <span className="prop-label">{label}</span>
      <div className="prop-value">{children}</div>
    </div>
  );
}
