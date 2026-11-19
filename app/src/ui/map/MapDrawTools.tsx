// The drawing toolbar of the project map (0.9): the pen and the eraser that draw right on the map, with the
// pen's colour and width, and buttons that put figures of flowcharts, a table, a chart or a canvas to draw on
// in the middle of the view.

import {
  Brush,
  ChartColumn,
  Circle,
  Diamond,
  Eraser,
  PenLine,
  RectangleHorizontal,
  Squircle,
  Table,
  Type,
} from 'lucide-react';
import type { ComponentType } from 'react';
import type { CanvasEngine, PenTool } from '../../canvas/engine';
import { kindOf } from '../../canvas/kinds';
import { atom } from '../../core/atom';
import { useAtom } from '../../core/useStore';
import { PALETTE } from '../../drawing/model';
import { t } from '../../i18n';
import { CHART_KIND, DRAWING_KIND, shapeKind, TABLE_KIND } from '../../map/diagram';
import { IconButton } from '../components';
import { ParallelogramIcon } from '../canvas/kindIcons';

const PEN_WIDTHS = [2, 4, 8];
/** What the pen was last set to, for the next time it is taken up (in this session). */
const penSettings = atom<Omit<PenTool, 'mode'>>({ color: '#e03131', width: 4 });

const MAKE: { kind: string; icon: ComponentType<{ size?: number }> }[] = [
  { kind: shapeKind('rect'), icon: RectangleHorizontal },
  { kind: shapeKind('round'), icon: Squircle },
  { kind: shapeKind('ellipse'), icon: Circle },
  { kind: shapeKind('diamond'), icon: Diamond },
  { kind: shapeKind('para'), icon: ParallelogramIcon },
  { kind: shapeKind('text'), icon: Type },
  { kind: TABLE_KIND, icon: Table },
  { kind: CHART_KIND, icon: ChartColumn },
  { kind: DRAWING_KIND, icon: Brush },
];

/**
 * Where a new node of this size can go near (x, y) without covering another: the first free place on widening
 * rings of grid steps around it, or (x, y) itself when there is none near.
 */
function freeSpot(engine: CanvasEngine, x: number, y: number, size: { w: number; h: number }) {
  const nodes = engine.graph.nodes;
  const gap = 20;
  const free = (px: number, py: number) =>
    !nodes.some(
      (n) => px < n.x + n.w + gap && px + size.w + gap > n.x && py < n.y + n.h + gap && py + size.h + gap > n.y,
    );
  const step = 40;
  for (let ring = 0; ring <= 12; ring++) {
    for (let i = -ring; i <= ring; i++) {
      const around = [
        [i, -ring],
        [ring, i],
        [i, ring],
        [-ring, i],
      ];
      for (const [dx, dy] of around) {
        if (free(x + dx * step, y + dy * step)) return { x: x + dx * step, y: y + dy * step };
      }
    }
  }
  return { x, y };
}

export function MapDrawTools({ engine }: { engine: CanvasEngine }) {
  const pen = useAtom(engine.pen);
  const settings = useAtom(penSettings);
  const take = (mode: PenTool['mode']) => engine.setPen(pen?.mode === mode ? null : { mode, ...settings });
  const setPen = (change: Partial<PenTool>) => {
    penSettings.set({ ...settings, ...change });
    if (pen) engine.setPen({ ...pen, ...change });
  };
  const make = (kind: string) => {
    engine.setPen(null);
    const def = kindOf(kind);
    const c = engine.viewCenter();
    const spot = freeSpot(engine, c.x - def.size.w / 2, c.y - def.size.h / 2, def.size);
    engine.createNodeAt(kind, spot, def.shape ? '' : t(def.label));
  };
  return (
    <div className="map-tools" data-canvas-ignore="" role="toolbar" aria-label={t('map.tools')}>
      <IconButton
        size="sm"
        label={t('map.tools.pen')}
        icon={<PenLine size={16} />}
        pressed={pen?.mode === 'pen'}
        onClick={() => take('pen')}
      />
      <IconButton
        size="sm"
        label={t('map.tools.eraser')}
        icon={<Eraser size={16} />}
        pressed={pen?.mode === 'eraser'}
        onClick={() => take('eraser')}
      />
      {pen?.mode === 'pen' && (
        <>
          <span className="toolbar-sep" />
          <div className="map-tools-group" role="group" aria-label={t('draw.color')}>
            {PALETTE.map((c) => (
              <button
                key={c}
                type="button"
                className="draw-swatch"
                style={{ background: c }}
                aria-label={c}
                aria-pressed={settings.color === c}
                onClick={() => setPen({ color: c })}
              />
            ))}
          </div>
          <span className="toolbar-sep" />
          <div className="map-tools-group" role="group" aria-label={t('draw.width')}>
            {PEN_WIDTHS.map((w) => (
              <button
                key={w}
                type="button"
                className="draw-width"
                aria-label={t('draw.widthN', { n: w })}
                aria-pressed={settings.width === w}
                onClick={() => setPen({ width: w })}
              >
                <span style={{ width: w + 2, height: w + 2 }} />
              </button>
            ))}
          </div>
        </>
      )}
      <span className="toolbar-sep" />
      {MAKE.map(({ kind, icon: Icon }) => (
        <IconButton
          key={kind}
          size="sm"
          label={t('map.tools.add', { name: t(kindOf(kind).label) })}
          icon={<Icon size={16} />}
          onClick={() => make(kind)}
        />
      ))}
    </div>
  );
}
