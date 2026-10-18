import { GitBranch } from 'lucide-react';
import { emptyGraph, type GraphDoc } from '../../canvas/model';
import { newId } from '../../core/ids';
import { useStore } from '../../core/useStore';
import { t } from '../../i18n';
import type { OpenProject } from '../../state/project';
import { Button, EmptyState } from '../components';
import { CanvasView } from './CanvasView';

/**
 * The Story tab. In phase F2 it is the canvas with generic nodes; phase F3 adds chapters, dialogue,
 * choices and logic on the same engine.
 */
export function StoryEditor({ project }: { project: OpenProject }) {
  const graphId = useStore(
    project.store,
    (s) => Object.values(s.graphs).find((g) => (g as unknown as GraphDoc).kind === 'story')?.id as string | undefined,
  );
  if (graphId) return <CanvasView project={project} graphId={graphId} />;
  const create = () => {
    const id = newId();
    project.store.dispatch(t('canvas.step.createGraph'), (d) => {
      d.graphs[id] = emptyGraph(id, 'story', t('module.story')) as unknown as (typeof d.graphs)[string];
    });
  };
  return (
    <div className="module-placeholder">
      <EmptyState
        icon={<GitBranch size={48} strokeWidth={1.4} />}
        title={t('module.story')}
        text={t('canvas.storyEmpty')}
        actions={
          !project.readOnly && (
            <Button variant="primary" onClick={create}>
              {t('canvas.createStory')}
            </Button>
          )
        }
      />
    </div>
  );
}
