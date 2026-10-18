import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalSpaceAround,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalSpaceAround,
  Group,
} from 'lucide-react';
import type { CanvasEngine } from '../../canvas/engine';
import { alignNodes, type AlignMode } from '../../canvas/ops';
import { useAtom } from '../../core/useStore';
import { t, type MessageKey } from '../../i18n';
import { IconButton } from '../components';

const ALIGN: [AlignMode, MessageKey, typeof AlignStartVertical][] = [
  ['left', 'canvas.align.left', AlignStartVertical],
  ['hcenter', 'canvas.align.hcenter', AlignCenterVertical],
  ['right', 'canvas.align.right', AlignEndVertical],
  ['top', 'canvas.align.top', AlignStartHorizontal],
  ['vcenter', 'canvas.align.vcenter', AlignCenterHorizontal],
  ['bottom', 'canvas.align.bottom', AlignEndHorizontal],
  ['hspread', 'canvas.align.hspread', AlignHorizontalSpaceAround],
  ['vspread', 'canvas.align.vspread', AlignVerticalSpaceAround],
];

/** Shown while several nodes are selected: align, spread, group (FR-CNV-03, FR-CNV-04). */
export function SelectionBar({ engine, onGroup }: { engine: CanvasEngine; onGroup: () => void }) {
  const selection = useAtom(engine.selection);
  if (selection.nodes.size < 2) return null;
  return (
    <div className="canvas-selbar" data-canvas-ignore role="toolbar" aria-label={t('canvas.selectionTools')}>
      <span className="muted small">{t('canvas.selected', { count: selection.nodes.size })}</span>
      {ALIGN.map(([mode, label, Icon], i) => (
        <span key={mode} className="canvas-selbar-item">
          {(i === 3 || i === 6) && <span className="toolbar-sep" />}
          <IconButton
            size="sm"
            label={t(label)}
            icon={<Icon size={16} />}
            onClick={() => engine.apply(t('canvas.step.align'), (g) => alignNodes(g, selection.nodes, mode))}
          />
        </span>
      ))}
      <span className="toolbar-sep" />
      <IconButton size="sm" label={t('canvas.group')} icon={<Group size={16} />} onClick={onGroup} />
    </div>
  );
}
