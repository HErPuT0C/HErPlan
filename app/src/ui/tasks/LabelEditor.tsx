// The labels of the project (F6-03, FR-NAR-04): one registry, edited here — in the variables panel and from
// tasks. A colour from the palette or any HEX, a pattern or a symbol, and a preview of how the label looks.

import { Plus, Trash } from 'lucide-react';
import { useState } from 'react';
import { useStore } from '../../core/useStore';
import { t, type MessageKey } from '../../i18n';
import type { OpenProject } from '../../state/project';
import {
  addLabel,
  deleteLabel,
  LABEL_PALETTE,
  LABEL_PATTERNS,
  listLabels,
  normalizeColor,
  updateLabel,
  type LabelPattern,
  type ProjectLabel,
} from '../../tasks/labels';
import { listBoards } from '../../tasks/model';
import { Button, IconButton } from '../components';
import { LabelChip, labelStyle } from './LabelChip';

const PATTERN_NAMES: Record<LabelPattern, MessageKey> = {
  none: 'labels.pattern.none',
  stripes: 'labels.pattern.stripes',
  dots: 'labels.pattern.dots',
  grid: 'labels.pattern.grid',
  waves: 'labels.pattern.waves',
};

/** How many tasks carry each label. */
function useLabelUses(project: OpenProject): Map<string, number> {
  const boards = useStore(project.store, (s) => s.boards);
  const counts = new Map<string, number>();
  for (const b of listBoards({ boards })) {
    for (const task of b.lists.flatMap((l) => l.tasks)) {
      for (const l of task.labels) counts.set(l, (counts.get(l) ?? 0) + 1);
    }
  }
  return counts;
}

export function LabelsManager({ project, onCreated }: { project: OpenProject; onCreated?: (id: string) => void }) {
  const { store, readOnly } = project;
  const variables = useStore(store, (s) => s.variables);
  const labels = listLabels({ variables });
  const uses = useLabelUses(project);
  const [name, setName] = useState('');
  const create = () => {
    if (!name.trim()) return;
    let id = '';
    store.dispatch(t('labels.step'), (d) => {
      id = addLabel(d, name, LABEL_PALETTE[labels.length % LABEL_PALETTE.length]);
    });
    setName('');
    if (id) onCreated?.(id);
  };
  return (
    <div className="labels">
      <p className="muted small">{t('labels.hint')}</p>
      {!readOnly && (
        <div className="labels-new">
          <input
            className="input"
            value={name}
            placeholder={t('labels.newName')}
            aria-label={t('labels.newName')}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && create()}
          />
          <Button size="sm" variant="primary" icon={<Plus size={14} />} disabled={!name.trim()} onClick={create}>
            {t('labels.add')}
          </Button>
        </div>
      )}
      {labels.length === 0 && <p className="muted small">{t('labels.none')}</p>}
      {labels.map((l) => (
        <LabelRow key={l.id} project={project} label={l} uses={uses.get(l.id) ?? 0} />
      ))}
    </div>
  );
}

function LabelRow({ project, label, uses }: { project: OpenProject; label: ProjectLabel; uses: number }) {
  const { store, readOnly } = project;
  const [hex, setHex] = useState<string | null>(null);
  const change = (patch: Parameters<typeof updateLabel>[2], merge: string) =>
    store.dispatch(t('labels.step'), (d) => updateLabel(d, label.id, patch), {
      mergeKey: `label:${label.id}:${merge}`,
    });
  return (
    <div className="label-edit" data-label={label.id}>
      <div className="label-edit-row">
        <LabelChip label={label} />
        <input
          className="input"
          value={label.name}
          disabled={readOnly}
          aria-label={t('labels.name')}
          onChange={(e) => change({ name: e.target.value }, 'name')}
        />
        <span className="muted small">{t('labels.uses', { count: uses })}</span>
        {!readOnly && (
          <IconButton
            size="sm"
            label={t('labels.delete', { name: label.name })}
            icon={<Trash size={14} />}
            onClick={() => {
              if (uses && !window.confirm(t('labels.deleteUsed', { name: label.name, count: uses }))) return;
              store.dispatch(t('labels.step'), (d) => deleteLabel(d, label.id));
            }}
          />
        )}
      </div>
      <div className="label-edit-row" role="group" aria-label={t('labels.color')}>
        {LABEL_PALETTE.map((c) => (
          <button
            key={c}
            type="button"
            className="label-swatch"
            style={{ background: c }}
            aria-label={c}
            aria-pressed={label.color === c}
            disabled={readOnly}
            onClick={() => change({ color: c }, 'color')}
          />
        ))}
        <input
          className="input label-hex"
          value={hex ?? label.color}
          disabled={readOnly}
          aria-label={t('labels.hex')}
          aria-invalid={hex !== null && !normalizeColor(hex)}
          onFocus={() => setHex(label.color)}
          onBlur={() => setHex(null)}
          onChange={(e) => {
            setHex(e.target.value);
            if (normalizeColor(e.target.value)) change({ color: e.target.value }, 'color');
          }}
        />
        <input
          type="color"
          className="label-picker"
          value={label.color}
          disabled={readOnly}
          aria-label={t('labels.pick')}
          onChange={(e) => change({ color: e.target.value }, 'color')}
        />
      </div>
      <div className="label-edit-row" role="group" aria-label={t('labels.pattern')}>
        {LABEL_PATTERNS.map((p) => (
          <button
            key={p}
            type="button"
            className="label-pattern"
            style={labelStyle({ color: label.color, pattern: p })}
            title={t(PATTERN_NAMES[p])}
            aria-label={t(PATTERN_NAMES[p])}
            aria-pressed={label.pattern === p}
            disabled={readOnly}
            onClick={() => change({ pattern: p }, 'pattern')}
          />
        ))}
        <input
          className="input label-symbol"
          value={label.symbol}
          maxLength={4}
          placeholder="★"
          disabled={readOnly}
          aria-label={t('labels.symbol')}
          title={t('labels.symbolHint')}
          onChange={(e) => change({ symbol: e.target.value }, 'symbol')}
        />
      </div>
    </div>
  );
}
