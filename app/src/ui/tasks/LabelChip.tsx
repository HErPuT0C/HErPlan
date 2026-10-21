// A label as it looks on tasks (F6-03): its colour, its pattern and its symbol, so labels tell apart without
// colour too.

import type { CSSProperties } from 'react';
import { textOn, type LabelPattern, type ProjectLabel } from '../../tasks/labels';

function patternImage(pattern: LabelPattern, ink: string): Pick<CSSProperties, 'backgroundImage' | 'backgroundSize'> {
  switch (pattern) {
    case 'stripes':
      return { backgroundImage: `repeating-linear-gradient(135deg, ${ink} 0 3px, transparent 3px 7px)` };
    case 'dots':
      return { backgroundImage: `radial-gradient(${ink} 1.3px, transparent 1.7px)`, backgroundSize: '6px 6px' };
    case 'grid':
      return {
        backgroundImage: `linear-gradient(${ink} 1px, transparent 1px), linear-gradient(90deg, ${ink} 1px, transparent 1px)`,
        backgroundSize: '6px 6px',
      };
    case 'waves':
      return {
        backgroundImage: `radial-gradient(circle at 50% 0, transparent 3px, ${ink} 3.5px, transparent 4.5px)`,
        backgroundSize: '8px 6px',
      };
    case 'none':
      return {};
  }
}

export function labelStyle(label: Pick<ProjectLabel, 'color' | 'pattern'>): CSSProperties {
  const text = textOn(label.color);
  const ink = text === '#ffffff' ? 'rgba(255, 255, 255, 0.3)' : 'rgba(0, 0, 0, 0.18)';
  return { backgroundColor: label.color, color: text, ...patternImage(label.pattern, ink) };
}

export function LabelChip({ label, compact = false }: { label: ProjectLabel; compact?: boolean }) {
  return (
    <span
      className={['task-label', compact && 'task-label-compact'].filter(Boolean).join(' ')}
      style={labelStyle(label)}
      title={label.name}
    >
      {label.symbol && <span className="task-label-symbol">{label.symbol}</span>}
      {!compact && <span className="task-label-name">{label.name}</span>}
    </span>
  );
}
