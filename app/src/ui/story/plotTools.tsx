// Laying a plot device (Chekhov's gun, the butterfly effect) over a node, an option, a line or words: the
// hook that does it and the small menu button of option and line rows.

import { Sparkles } from 'lucide-react';
import { useState } from 'react';
import { t } from '../../i18n';
import { addMark } from '../../story/marks';
import type { MarkAnchor, PlotDevice } from '../../story/model';
import { storyNode } from '../../story/ops';
import { IconButton, Menu } from '../components';
import { DeviceIcon } from '../canvas/kindIcons';
import { useStory } from './context';

/** Lays a plot device over a node, option, line or words; the inspector then shows the new mark. */
export function useAddDevice(nodeId: string) {
  const { edit, inspect } = useStory();
  return (device: PlotDevice, anchor: MarkAnchor, selection: { start: number; end: number } | null = null) => {
    let id: string | null = null;
    edit(t(device === 'gun' ? 'plot.step.gun' : 'plot.step.butterfly'), (g) => {
      const n = storyNode(g, nodeId);
      if (n) id = addMark(n, device, anchor, selection)?.id ?? null;
    });
    if (id) inspect(nodeId, `mark:${id}`);
  };
}

/** A small menu button: lay Chekhov's gun or the butterfly effect over this option or line. */
export function DeviceMenu({ onDevice }: { onDevice: (device: PlotDevice) => void }) {
  const [at, setAt] = useState<{ x: number; y: number; anchor: HTMLElement } | null>(null);
  return (
    <>
      <IconButton
        size="sm"
        label={t('plot.add')}
        icon={<Sparkles size={14} />}
        aria-haspopup="menu"
        onClick={(e) => {
          const anchor = e.currentTarget;
          const r = anchor.getBoundingClientRect();
          setAt(at ? null : { x: r.left, y: r.bottom + 4, anchor });
        }}
      />
      {at && (
        <Menu
          x={at.x}
          y={at.y}
          anchor={at.anchor}
          label={t('plot.add')}
          onClose={() => setAt(null)}
          entries={[
            { id: 'gun', label: t('plot.gun'), icon: <DeviceIcon device="gun" />, onSelect: () => onDevice('gun') },
            {
              id: 'butterfly',
              label: t('plot.butterfly'),
              icon: <DeviceIcon device="butterfly" />,
              onSelect: () => onDevice('butterfly'),
            },
          ]}
        />
      )}
    </>
  );
}
