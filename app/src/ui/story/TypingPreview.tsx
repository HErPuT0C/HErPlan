// The preview of lines as the game types them (0.8, item 19 of "Dialogues"): letter by letter, marked words
// at their speed and by their reveal, pauses held, other cues shown as they happen; a line with "auto" goes on
// by itself after its seconds, the others wait for "Next". A click on the text shows the rest at once, as
// games do. The base speed is the editor's assumption (story/typing.ts), not the game's own.

import { ChevronRight, RotateCcw } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { ProjectData } from '../../core/project/types';
import { useAtom } from '../../core/useStore';
import { t } from '../../i18n';
import { gameFiles } from '../../state/gameFiles';
import { resolveRange, textMarksOn } from '../../story/marks';
import { toward, type DialogueLine, type MarkAnchor, type StoryNode } from '../../story/model';
import { paletteEntry, paletteName, type Palette } from '../../story/palette';
import { BASE_CPS, typedAt, typing } from '../../story/typing';
import { Button, Dialog } from '../components';
import { cueText, gameMarks } from './lineLook';
import { highlightPieces, pieceStyle } from './MarkedText';

/** Effects of the palette the preview knows how to draw, by their usual ids. */
const DRAWN_EFFECTS = new Set(['shake', 'wave', 'rainbow', 'push', 'slide', 'twitch']);
/** How long a cue stays shown. */
const CUE_SHOWN = 1200;

export function TypingPreview({
  node,
  start,
  only,
  entities,
  onClose,
}: {
  node: StoryNode;
  /** The line to start with. */
  start: number;
  /** Only that line, not the ones after it. */
  only?: boolean;
  entities: ProjectData['entities'];
  onClose: () => void;
}) {
  const { palette } = useAtom(gameFiles);
  const lines = node.lines ?? [];
  const last = only ? start : lines.length - 1;
  const [index, setIndex] = useState(start);
  const line = lines[index];
  const nameOf = (id: string | null | undefined) =>
    id ? ((entities[id]?.name as string | undefined) ?? t('story.lines.deletedSpeaker')) : t('story.narrator');
  return (
    <Dialog
      open
      onClose={onClose}
      title={t('preview.title', { title: node.title || t('story.untitled') })}
      size="md"
      className="typing-dialog"
    >
      {line ? (
        <TypedLine
          // A new line, or the same one again: a fresh start.
          key={`${line.id}-${index}`}
          node={node}
          line={line}
          palette={palette}
          speaker={nameOf(line.speaker)}
          nameOf={nameOf}
          position={t('preview.position', { n: index + 1, count: lines.length })}
          hasNext={index < last}
          onNext={() => (index < last ? setIndex(index + 1) : onClose())}
        />
      ) : (
        <p className="muted">{t('story.card.noLines')}</p>
      )}
      <p className="muted small">{t('preview.hint', { cps: BASE_CPS })}</p>
    </Dialog>
  );
}

function TypedLine({
  node,
  line,
  palette,
  speaker,
  nameOf,
  position,
  hasNext,
  onNext,
}: {
  node: StoryNode;
  line: DialogueLine;
  palette: Palette;
  speaker: string;
  nameOf: (id: string) => string;
  position: string;
  hasNext: boolean;
  onNext: () => void;
}) {
  // Worked out once per version of the node, not on every frame of the clock.
  const { marks, ty, look } = useMemo(() => {
    const anchor: MarkAnchor = { kind: 'line', id: line.id };
    const marks = textMarksOn(node, anchor);
    return {
      marks,
      ty: typing(line.text, marks),
      look: gameMarks(node, anchor, line.text, palette, true),
    };
  }, [node, line.id, line.text, palette]);
  const [run, setRun] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [skipped, setSkipped] = useState(false);
  const began = useRef(0);
  const auto = typeof line.auto === 'number' ? line.auto * 1000 : null;
  const end = ty.total + (auto ?? 0);

  // The clock of the line: runs until the line is out (and its "auto" seconds are over).
  useEffect(() => {
    began.current = performance.now();
    let frame = 0;
    const tick = () => {
      const now = performance.now() - began.current;
      setElapsed(now);
      if (now < end + 50) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [run, end]);

  const shownAt = skipped ? Math.max(elapsed, ty.total) : elapsed;
  const { upto, cues } = typedAt(ty, shownAt);
  const done = shownAt >= ty.total;
  // "auto": on by itself once its seconds are over.
  const goesOn = done && auto !== null && elapsed >= end;
  const onNextRef = useRef(onNext);
  useEffect(() => {
    onNextRef.current = onNext;
  });
  useEffect(() => {
    if (goesOn) onNextRef.current();
  }, [goesOn]);

  const recent = cues.filter((c) => shownAt - c.at < CUE_SHOWN && typeof c.cue.pause !== 'number');
  const shaking = recent.some((c) => typeof c.cue.shake === 'number');
  // The face holds till the end of the line; the line's own face before any cue.
  const face = [...cues].reverse().find((c) => c.cue.face)?.cue.face ?? line.face;
  const style = paletteEntry(palette, 'styles', line.style);
  const pieces = highlightPieces(line.text, look.highlights, [upto, ...ty.hidden.flatMap((h) => [h.start, h.end])]);
  const hidden = (at: number) => ty.hidden.some((h) => h.start <= at && at < h.end);
  /** Effects of the palette drawn on the words at an offset (the ones the preview knows by their id). */
  const effectsAt = (at: number) =>
    marks.flatMap((m) => {
      if (m.device !== 'style' || !m.props.effect || !DRAWN_EFFECTS.has(m.props.effect)) return [];
      const r = resolveRange(line.text, m.range);
      return r && r.start <= at && at < r.end ? [`fx fx-${m.props.effect}`] : [];
    });

  const statics = [
    face && `${t('line.face')}: ${paletteName(palette, 'faces', face)}`,
    ...(['gesture', 'emote'] as const).map((k) => {
      const x = toward(line[k]);
      if (!x) return null;
      const what = paletteName(palette, k === 'gesture' ? 'gestures' : 'emotes', x.id);
      return `${t(k === 'gesture' ? 'line.gesture' : 'line.emote')}: ${what}${x.to ? ` → ${nameOf(x.to)}` : ''}`;
    }),
  ].filter(Boolean);

  return (
    <div className="typing">
      <div className="typing-head">
        <strong className="typing-speaker">{speaker}</strong>
        {statics.map((s) => (
          <span key={s as string} className="chip typing-chip">
            {s}
          </span>
        ))}
        <span className="muted small typing-position">{position}</span>
      </div>
      {line.condition?.trim() && <p className="muted small">{t('script.if', { condition: line.condition.trim() })}</p>}
      <div
        className={['typing-box', shaking && 'typing-shake'].filter(Boolean).join(' ')}
        style={style?.color ? ({ color: style.color } as CSSProperties) : undefined}
        role="button"
        tabIndex={0}
        aria-label={t(done ? 'preview.next' : 'preview.skip')}
        data-done={done ? '' : undefined}
        onClick={() => (done ? onNext() : setSkipped(true))}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' && e.key !== ' ') return;
          e.preventDefault();
          if (done) onNext();
          else setSkipped(true);
        }}
      >
        {pieces.map((p, i) => {
          if (p.start >= upto || hidden(p.start)) return null;
          const effects = effectsAt(p.start);
          return (
            <span
              key={i}
              className={[...p.over.map((h) => h.className), ...effects].join(' ') || undefined}
              style={pieceStyle(p.over)}
            >
              {p.text}
            </span>
          );
        })}
        {!done && <span className="typing-caret" aria-hidden="true" />}
      </div>
      <div className="typing-cues" aria-live="polite">
        {recent.map((c, i) => (
          <span key={`${c.at}-${i}`} className="chip typing-cue">
            {cueText(c.cue, palette, nameOf)}
          </span>
        ))}
      </div>
      <div className="typing-foot">
        {auto !== null && done && !goesOn && (
          <span className="muted small">
            {t('preview.auto', { seconds: Math.max(0, (end - elapsed) / 1000).toFixed(1) })}
          </span>
        )}
        <Button
          size="sm"
          variant="ghost"
          icon={<RotateCcw size={14} />}
          onClick={() => {
            setSkipped(false);
            setElapsed(0);
            setRun((r) => r + 1);
          }}
        >
          {t('preview.again')}
        </Button>
        <Button size="sm" variant="primary" icon={<ChevronRight size={14} />} onClick={onNext}>
          {t(hasNext ? 'play.next' : 'preview.close')}
        </Button>
      </div>
    </div>
  );
}
