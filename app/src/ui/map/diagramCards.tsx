// Cards of diagrams on the project map (0.9): a table typed into right on the map, a chart drawn from its data
// (double click edits the data), and a canvas showing its drawing (double click draws). Figures of flowcharts
// and pen strokes are drawn by the canvas itself (NodeLayer).

import { Brush, Plus } from 'lucide-react';
import { createContext, useContext } from 'react';
import { HEADER_H, type GraphDoc, type GraphNode } from '../../canvas/model';
import { t } from '../../i18n';
import {
  addColumnAt,
  addRowAt,
  CHART_KIND,
  chartOf,
  DRAWING_KIND,
  drawingPath,
  fitTable,
  MAX_TABLE,
  setCell,
  TABLE_KIND,
  tableCells,
  tableLayout,
} from '../../map/diagram';
import { mapGraph } from '../../map/model';
import { useAssetUrl } from '../assetVersion';
import { registerCard, type CardBodyProps } from '../canvas/cardRegistry';
import { Editable } from '../canvas/NodeLayer';
import { ChartView } from './ChartView';
import { MapContext } from './cards';

/** Opens a card of the map as a double click does (the drawing window, the data of a chart). */
export const MapOpenNode = createContext<((id: string) => void) | null>(null);

/** Changes one node of the map as one undo step. */
export function useMapNodeChange(): (
  id: string,
  label: string,
  recipe: (node: GraphNode) => void,
  mergeKey?: string,
) => void {
  const project = useContext(MapContext);
  return (id, label, recipe, mergeKey) => {
    if (!project || project.readOnly) return;
    project.store.dispatch(
      label,
      (d) => {
        const node = (mapGraph(d) as GraphDoc | undefined)?.nodes.find((n) => n.id === id);
        if (node) recipe(node);
      },
      mergeKey ? { mergeKey } : {},
    );
  };
}

function TableBody({ node, w, h, readOnly }: CardBodyProps) {
  const change = useMapNodeChange();
  const cells = tableCells(node);
  const layout = tableLayout({ w, h }, cells);
  const write = (row: number, col: number, text: string) =>
    change(node.id, t('map.step.cell'), (n) => {
      n.cells = setCell(tableCells(n), row, col, text);
      fitTable(n);
    });
  return (
    <div
      className="map-table"
      style={{
        gridTemplateColumns: `repeat(${layout.cols}, minmax(0, 1fr))`,
        gridTemplateRows: layout.rows.map((r) => `${r}px`).join(' '),
      }}
    >
      {cells.flatMap((row, r) =>
        row.map((text, c) => (
          <Editable
            key={`${r}:${c}`}
            className={['map-cell', r === 0 && 'map-cell-head', c === layout.cols - 1 && 'map-cell-last']
              .filter(Boolean)
              .join(' ')}
            value={text}
            placeholder=""
            readOnly={readOnly}
            allowEmpty
            onCommit={(v) => write(r, c, v)}
          />
        )),
      )}
      {!readOnly && (
        <>
          <button
            type="button"
            className="map-table-add map-table-add-row"
            data-canvas-ignore=""
            aria-label={t('map.table.addRow')}
            title={t('map.table.addRow')}
            onClick={() => change(node.id, t('map.step.table'), (n) => addRowAt(n, tableCells(n).length))}
          >
            <Plus size={12} />
          </button>
          {layout.cols < MAX_TABLE.cols && (
            <button
              type="button"
              className="map-table-add map-table-add-col"
              data-canvas-ignore=""
              aria-label={t('map.table.addColumn')}
              title={t('map.table.addColumn')}
              onClick={() => change(node.id, t('map.step.table'), (n) => addColumnAt(n, tableCells(n)[0].length))}
            >
              <Plus size={12} />
            </button>
          )}
        </>
      )}
    </div>
  );
}

function ChartBody({ node, w, h }: CardBodyProps) {
  return (
    <div className="map-chart">
      <ChartView data={chartOf(node)} w={w - 2} h={h - HEADER_H - 2} label={node.title || t('map.kind.chart')} />
    </div>
  );
}

function DrawingBody({ node, readOnly }: CardBodyProps) {
  const project = useContext(MapContext);
  const open = useContext(MapOpenNode);
  const path = drawingPath(node);
  const url = useAssetUrl(project?.dir ?? '', path);
  if (!path) {
    return (
      <div className="map-drawing map-drawing-empty">
        {readOnly ? (
          <span className="muted small">{t('map.drawing.empty')}</span>
        ) : (
          <button type="button" className="map-drawing-start" data-canvas-ignore="" onClick={() => open?.(node.id)}>
            <Brush size={16} aria-hidden="true" />
            {t('map.drawing.start')}
          </button>
        )}
      </div>
    );
  }
  return (
    <div className="map-drawing" title={readOnly ? undefined : t('map.drawing.hint')}>
      {url && <img src={url} alt="" draggable={false} />}
    </div>
  );
}

registerCard(TABLE_KIND, { body: TableBody });
registerCard(CHART_KIND, { body: ChartBody });
registerCard(DRAWING_KIND, { body: DrawingBody });
