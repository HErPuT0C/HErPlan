import { Maximize, Plus, Search, StickyNote, ZoomIn, ZoomOut } from 'lucide-react';
import { ZOOM_STEP } from '../../canvas/camera';
import type { CanvasEngine } from '../../canvas/engine';
import { useAtom } from '../../core/useStore';
import { t } from '../../i18n';
import { IconButton, Tooltip } from '../components';

export function CanvasToolbar({
  engine,
  readOnly,
  onSearch,
  onCreate,
}: {
  engine: CanvasEngine;
  readOnly: boolean;
  onSearch: () => void;
  onCreate: (kind: string) => void;
}) {
  const { camera } = useAtom(engine.view);
  return (
    <div className="canvas-toolbar" data-canvas-ignore role="toolbar" aria-label={t('canvas.toolbar')}>
      {!readOnly && (
        <>
          <IconButton
            size="sm"
            label={t('canvas.addNode')}
            icon={<Plus size={16} />}
            onClick={() => onCreate('node')}
          />
          <IconButton
            size="sm"
            label={t('canvas.addSticker')}
            icon={<StickyNote size={16} />}
            onClick={() => onCreate('sticker')}
          />
          <span className="toolbar-sep" />
        </>
      )}
      <IconButton
        size="sm"
        label={t('canvas.zoomOut')}
        icon={<ZoomOut size={16} />}
        onClick={() => engine.zoomBy(1 / ZOOM_STEP)}
      />
      <Tooltip text={t('canvas.zoomReset')}>
        <button
          type="button"
          className="canvas-zoom"
          onClick={() => engine.resetZoom()}
          aria-label={t('canvas.zoomReset')}
        >
          {`${Math.round(camera.scale * 100)}%`}
        </button>
      </Tooltip>
      <IconButton
        size="sm"
        label={t('canvas.zoomIn')}
        icon={<ZoomIn size={16} />}
        onClick={() => engine.zoomBy(ZOOM_STEP)}
      />
      <IconButton size="sm" label={t('canvas.fit')} icon={<Maximize size={16} />} onClick={() => engine.fit()} />
      <IconButton size="sm" label={t('canvas.search')} icon={<Search size={16} />} onClick={onSearch} />
    </div>
  );
}
