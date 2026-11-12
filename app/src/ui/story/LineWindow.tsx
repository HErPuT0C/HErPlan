// The window of a line (0.8.2, "Редактор реплик" 4): a big window over the graph, opened by a double click on a
// line in a node or by "open the line" beside it. From the top: the scene as in the game with the controls
// of playing; the line's fields (who speaks, the text, style, face, gesture, emote, the times, the condition,
// the consequences, the actions) — changes are saved at once, as in the side panel. ← → in the header (and
// Alt+← →) go to the line before and after without closing; Escape closes. The text in the game's font with
// its toolbar comes in 0.8.3.

import { ChevronLeft, ChevronRight, ListVideo } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useStore } from '../../core/useStore';
import { t } from '../../i18n';
import { asStory, graphOf } from '../../story/model';
import { Dialog, IconButton } from '../components';
import { useStory } from './context';
import { LineRow } from './LineEditor';
import { participants } from './paletteItems';
import { LinePlayer } from './TypingPreview';

export function LineWindow({
  nodeId,
  lineId,
  onLine,
  onClose,
}: {
  nodeId: string;
  lineId: string;
  /** Another line of the node is shown. */
  onLine: (lineId: string) => void;
  onClose: () => void;
}) {
  const { project, graphId } = useStory();
  const graph = useStore(project.store, (s) => graphOf(s, graphId));
  const entities = useStore(project.store, (s) => s.entities);
  const limits = useStore(project.store, (s) => s.meta.settings.dialogueLimits);
  const found = graph?.nodes.find((n) => n.id === nodeId);
  const node = found ? asStory(found) : null;
  const lines = node?.lines ?? [];
  const index = lines.findIndex((l) => l.id === lineId);
  const line = index >= 0 ? lines[index] : null;
  const people = participants((graph?.nodes ?? []).flatMap((n) => asStory(n).lines ?? []));
  /** "Whole node": the lines one after another from the first, the speakers changing. */
  const [whole, setWhole] = useState(false);

  const go = (delta: number) => {
    const next = lines[index + delta];
    if (next) onLine(next.id);
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      // In a field the arrows move the caret; Alt+arrows go to another line from anywhere.
      const inField = (e.target as HTMLElement).closest('input, textarea, select, [contenteditable]');
      if ((inField && !e.altKey) || e.ctrlKey || e.metaKey) return;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        go(e.key === 'ArrowLeft' ? -1 : 1);
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  return (
    <Dialog
      open
      onClose={onClose}
      size="xl"
      className="line-window"
      title={
        line && node
          ? t('lineWindow.title', { n: index + 1, count: lines.length, title: node.title || t('story.untitled') })
          : t('story.untitled')
      }
      actions={
        <span className="line-window-nav">
          <IconButton
            label={t('lineWindow.prev')}
            icon={<ChevronLeft size={18} />}
            disabled={index <= 0}
            onClick={() => go(-1)}
          />
          <IconButton
            label={t('lineWindow.next')}
            icon={<ChevronRight size={18} />}
            disabled={index < 0 || index >= lines.length - 1}
            onClick={() => go(1)}
          />
        </span>
      }
    >
      {!line || !node ? (
        <p className="muted">{t('lineWindow.gone')}</p>
      ) : (
        <>
          <div className="line-window-scene">
            <LinePlayer
              // Another line, or "whole node" switched: playing starts anew.
              key={`${line.id}-${whole}`}
              node={node}
              start={whole ? 0 : index}
              only={!whole}
              entities={entities}
              scale={3}
              extra={
                <button
                  type="button"
                  className="typing-speed line-window-whole"
                  aria-pressed={whole}
                  onClick={() => setWhole(!whole)}
                >
                  <ListVideo size={14} aria-hidden="true" /> {t('preview.wholeNode')}
                </button>
              }
            />
          </div>
          <LineRow
            key={line.id}
            line={line}
            index={index}
            last={index === lines.length - 1}
            node={node}
            maxChars={limits.maxLineChars}
            entities={entities}
            people={people}
            readOnly={project.readOnly}
            windowed
          />
        </>
      )}
    </Dialog>
  );
}
