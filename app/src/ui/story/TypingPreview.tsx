// The preview of lines as the game types them (0.8, item 19 of "Dialogues"; 0.8.1, "Редактор реплик" 6.2).
// Playing is a function of the time t from the start of the line: every frame works out again, from t, what
// is out, where each letter is (effects), how the frame shakes, which cues have happened and the face. So
// "again" really starts again — the cues fire, the screen shakes, the letters move — as many times as asked.
// The numbers are the game's (preview of the palette); the text is still in the editor's font: the game's
// font, the bubble and the speaker come with the scene (0.8.2).

import { ChevronRight, Pause, Play, RotateCcw } from 'lucide-react';
import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { ProjectData } from '../../core/project/types';
import { useAtom } from '../../core/useStore';
import { t } from '../../i18n';
import { gameFiles } from '../../state/gameFiles';
import { letterMove, shakeAt, type ShakeEvent } from '../../story/gameFx';
import { faceAt, gameLine } from '../../story/gameLine';
import { textMarksOn } from '../../story/marks';
import { toward, type DialogueLine, type StoryNode } from '../../story/model';
import { DEFAULT_TEXT, paletteName, type Palette } from '../../story/palette';
import { Button, Dialog } from '../components';
import { cueText, speakerName } from './lineLook';

/** How long a cue stays shown. */
const CUE_SHOWN = 1.2;
/** Screen pixels for a pixel of the game, in this preview. */
const SCALE = 2;

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
          // A new line: a fresh start.
          key={`${line.id}-${index}`}
          node={node}
          line={line}
          palette={palette}
          entities={entities}
          position={t('preview.position', { n: index + 1, count: lines.length })}
          hasNext={index < last}
          onNext={() => (index < last ? setIndex(index + 1) : onClose())}
        />
      ) : (
        <p className="muted">{t('story.card.noLines')}</p>
      )}
      <p className="muted small">{t(palette.preview ? 'preview.hintGame' : 'preview.hintDefault')}</p>
    </Dialog>
  );
}

function TypedLine({
  node,
  line,
  palette,
  entities,
  position,
  hasNext,
  onNext,
}: {
  node: StoryNode;
  line: DialogueLine;
  palette: Palette;
  entities: ProjectData['entities'];
  position: string;
  hasNext: boolean;
  onNext: () => void;
}) {
  const preview = palette.preview;
  const shakeTime = preview?.text.shake_time ?? DEFAULT_TEXT.shake_time;
  // Worked out once per version of the line, not on every frame.
  const { gl, shakes } = useMemo(() => {
    const gl = gameLine(line.text, line.style, textMarksOn(node, { kind: 'line', id: line.id }), preview);
    const shakes: ShakeEvent[] = [
      ...gl.cues.flatMap((c) => (typeof c.props.shake === 'number' ? [{ time: c.time, strength: c.props.shake }] : [])),
      ...gl.chunks.filter((c) => c.shake > 0).map((c) => ({ time: c.time, strength: c.shake })),
    ];
    return { gl, shakes };
  }, [node, line.id, line.text, line.style, preview]);
  const auto = typeof line.auto === 'number' ? line.auto : null;

  // The clock: t seconds from the start of the line; "from the start" sets it back to 0, nothing else to undo.
  const [t0, setT] = useState(0);
  const [playing, setPlaying] = useState(true);
  const origin = useRef(0);
  const frozen = useRef(0);
  useEffect(() => {
    if (!playing) return;
    origin.current = performance.now() - frozen.current * 1000;
    let frame = 0;
    const tick = () => {
      setT((performance.now() - origin.current) / 1000);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing]);
  const restart = () => {
    frozen.current = 0;
    origin.current = performance.now();
    setT(0);
    setPlaying(true);
  };
  const pause = () => {
    frozen.current = t0;
    setPlaying(!playing);
  };
  const done = t0 >= gl.end;
  /** Space or a click on the text: the rest of the line at once; once it is out, the next line. */
  const advance = () => {
    if (done) return onNext();
    frozen.current = gl.end;
    origin.current = performance.now() - gl.end * 1000;
    setT(gl.end);
  };
  const advanceRef = useRef(advance);
  useEffect(() => {
    advanceRef.current = advance;
  });
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== ' ' || (e.target as HTMLElement).closest('button, input, select, textarea')) return;
      e.preventDefault();
      advanceRef.current();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  // "auto": on by itself once its seconds after the line are over.
  const goesOn = done && auto !== null && playing && t0 >= gl.end + auto;
  const onNextRef = useRef(onNext);
  useEffect(() => {
    onNextRef.current = onNext;
  });
  useEffect(() => {
    if (goesOn) onNextRef.current();
  }, [goesOn]);

  const nameOf = (id: string) => speakerName(entities, id);
  const shake = shakeAt(shakes, t0, shakeTime);
  const recent = gl.cues.filter((c) => c.time <= t0 && t0 - c.time < CUE_SHOWN && typeof c.props.pause !== 'number');
  const face = faceAt(gl, line.face, t0);
  const params = preview?.effects ?? {};
  /** The first letter not out yet: the caret stands before it. */
  const caretAt = gl.letters.find((l) => l.i >= 0 && l.appear > t0)?.at ?? -1;
  const statics = [
    `${t('line.face')}: ${paletteName(palette, 'faces', face)}`,
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
        <strong className="typing-speaker">{speakerName(entities, line.speaker)}</strong>
        {statics.map((s) => (
          <span key={s as string} className="chip typing-chip">
            {s}
          </span>
        ))}
        <span className="muted small typing-position">{position}</span>
      </div>
      {line.condition?.trim() && <p className="muted small">{t('script.if', { condition: line.condition.trim() })}</p>}
      <div
        className="typing-box"
        style={{ translate: `${shake.dx * SCALE}px ${shake.dy * SCALE}px` } as CSSProperties}
        role="button"
        tabIndex={0}
        aria-label={t(done ? 'preview.next' : 'preview.skip')}
        data-done={done ? '' : undefined}
        data-shake={shake.dx || shake.dy ? `${shake.dx},${shake.dy}` : undefined}
        onClick={advance}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          advance();
        }}
      >
        {gl.letters.map((l) => {
          if (l.i < 0) return null;
          const out = l.appear <= t0;
          const move = out ? letterMove(l.props.fx, params, l.i, t0, t0 - l.appear) : { dx: 0, dy: 0 };
          return (
            <Fragment key={l.at}>
              {/* The caret stands where the typing is. */}
              {!done && l.at === caretAt && <span className="typing-caret" aria-hidden="true" />}
              <span
                className="typing-letter"
                data-bold={l.props.bold ? '' : undefined}
                data-out={out ? '' : undefined}
                style={{
                  color: move.col ?? l.props.col,
                  fontWeight: l.props.bold ? 700 : undefined,
                  fontSize: l.props.size === 2 ? '1.6em' : undefined,
                  visibility: out ? undefined : 'hidden',
                  left: move.dx * SCALE || undefined,
                  top: move.dy * SCALE || undefined,
                }}
              >
                {l.ch}
              </span>
            </Fragment>
          );
        })}
      </div>
      <div className="typing-cues" aria-live="polite">
        {recent.map((c, i) => (
          <span key={`${c.at}-${i}`} className="chip typing-cue">
            {cueText(c.props, palette, nameOf)}
          </span>
        ))}
      </div>
      <div className="typing-foot">
        {auto !== null && done && !goesOn && (
          <span className="muted small">
            {t('preview.auto', { seconds: Math.max(0, gl.end + auto - t0).toFixed(1) })}
          </span>
        )}
        <Button size="sm" variant="ghost" icon={<RotateCcw size={14} />} onClick={restart}>
          {t('preview.again')}
        </Button>
        <Button size="sm" variant="ghost" icon={playing ? <Pause size={14} /> : <Play size={14} />} onClick={pause}>
          {t(playing ? 'preview.pause' : 'preview.resume')}
        </Button>
        <Button size="sm" variant="primary" icon={<ChevronRight size={14} />} onClick={onNext}>
          {t(hasNext ? 'play.next' : 'preview.close')}
        </Button>
      </div>
    </div>
  );
}
