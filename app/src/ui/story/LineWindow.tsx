// The window of a line (0.8.2, "Редактор реплик" 4): a big window over the graph, opened by a double click on a
// line in a node or by "open the line" beside it. From the top: the scene as in the game with the controls
// of playing; the line's fields (who speaks, the text, style, face, gesture, emote, the times, the condition,
// the consequences, the actions) — changes are saved at once. ← → in the header (and Alt+← →) go to the line
// before and after without closing; Escape closes. Since 0.8.3 this is the only place a line is edited (the
// owner's wish; the side panel lists the lines to open): the text in the game's font with a toolbar over the
// selected words — their look and the plot devices — and new lines are added here too.

import { ChevronLeft, ChevronRight, ListVideo, Plus } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../../core/useStore';
import { t } from '../../i18n';
import { keyOf } from '../../story/gameKey';
import { asStory, graphOf, type PartKind } from '../../story/model';
import { Button, Dialog, IconButton } from '../components';
import { addPart, choiceAsDialogue, optionAsLine, partsOf } from '../../story/ops';
import { useStory } from './context';
import { LineRow } from './LineEditor';
import { participants } from './paletteItems';
import { LinePlayer } from './TypingPreview';

export function LineWindow({
  nodeId,
  lineId,
  kind = 'line',
  field,
  onLine,
  onClose,
}: {
  nodeId: string;
  lineId: string;
  /** A line of a dialogue, or (0.8.5) an option of a choice: edited and played as a line. */
  kind?: PartKind;
  /** A field of the line to put the caret in (data-field), when something led here. */
  field?: string;
  /** Another line of the node is shown. */
  onLine: (lineId: string) => void;
  onClose: () => void;
}) {
  const { project, graphId, edit } = useStory();
  const graph = useStore(project.store, (s) => graphOf(s, graphId));
  const entities = useStore(project.store, (s) => s.entities);
  const limits = useStore(project.store, (s) => s.meta.settings.dialogueLimits);
  const found = graph?.nodes.find((n) => n.id === nodeId);
  const node = found ? asStory(found) : null;
  const isOption = kind === 'option';
  // Options are said by their speaker, by default the hero: the card with "hero" as its name in the game.
  const hero = useMemo(() => Object.entries(entities).find(([, e]) => keyOf(e) === 'hero')?.[0] ?? null, [entities]);
  const lines = useMemo(
    () => (isOption ? (node?.options ?? []).map((o) => optionAsLine(o, hero)) : (node?.lines ?? [])),
    [isOption, node, hero],
  );
  /** What the scene plays: the dialogue, or the choice as one (its options as lines). */
  const played = useMemo(() => (node && isOption ? choiceAsDialogue(node, hero) : node), [node, isOption, hero]);
  // Who an option is said to: the last one but the hero who spoke in a dialogue leading to the choice.
  const listener = useStore(project.store, (s) => {
    if (!isOption) return null;
    const g = graphOf(s, graphId);
    for (const e of g?.edges ?? []) {
      if (e.to.node !== nodeId) continue;
      const from = g?.nodes.find((n) => n.id === e.from.node);
      const said = [...(asStory(from ?? ({ lines: [] } as never)).lines ?? [])].reverse();
      const who = said.find((l) => l.speaker && l.speaker !== 'narrator' && l.speaker !== hero)?.speaker;
      if (who) return who;
    }
    return null;
  });
  const index = lines.findIndex((l) => l.id === lineId);
  const line = index >= 0 ? lines[index] : null;
  const people = participants((graph?.nodes ?? []).flatMap((n) => asStory(n).lines ?? []));
  /** "Whole node": the lines one after another from the first, the speakers changing. */
  const [whole, setWhole] = useState(false);

  // The line was taken away (its own "remove"): the one that took its place, else the one before.
  const seen = useRef(index);
  useEffect(() => {
    if (index >= 0) {
      seen.current = index;
      return;
    }
    const left = partsOf(node ?? undefined, kind);
    if (left.length) onLine(left[Math.min(seen.current, left.length - 1)].id);
  }, [index, node, kind, onLine]);
  const add = () => {
    let id: string | null = null;
    // After this line, said by whoever spoke the line before it: dialogues alternate (an option: the hero).
    const speaker = !isOption && index >= 1 ? lines[index - 1].speaker : undefined;
    edit(t(isOption ? 'story.step.options' : 'story.step.lines'), (g) => {
      id = addPart(g, nodeId, kind, index + 1, speaker);
    });
    if (id) onLine(id);
  };
  // Led to a field of the line (a problem of it): the caret goes there, after the scene took the keys.
  useEffect(() => {
    if (!field) return;
    const timer = setTimeout(() => {
      const box = document.querySelector<HTMLElement>(`.line-window [data-field="${CSS.escape(field)}"]`);
      box?.scrollIntoView({ block: 'nearest' });
      const fields = 'textarea, input, select, button';
      (box?.matches(fields) ? box : box?.querySelector<HTMLElement>(fields))?.focus();
    }, 60);
    return () => clearTimeout(timer);
  }, [field, lineId]);
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
          ? t(isOption ? 'lineWindow.titleOption' : 'lineWindow.title', {
              n: index + 1,
              count: lines.length,
              title: node.title || t('story.untitled'),
            })
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
              node={played!}
              listener={listener}
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
            kind={kind}
          />
          {!project.readOnly && (
            <div className="line-window-foot">
              <Button size="sm" icon={<Plus size={14} />} onClick={add}>
                {t(isOption ? 'story.options.add' : 'story.lines.add')}
              </Button>
            </div>
          )}
        </>
      )}
    </Dialog>
  );
}
