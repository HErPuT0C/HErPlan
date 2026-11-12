// The preview of lines as the game types them (0.8, item 19 of "Dialogues"; 0.8.1, "Редактор реплик" 6.2;
// 0.8.2, 6.1 and 7.2–7.8). Playing is a function of the time t from the start of the line: every frame works
// out again, from t, what is out, where each letter is (effects), how the frame shakes, which cues have
// happened and the face. So "again" really starts again — as many times as asked — and the time slider shows
// any moment. With the game's font in the project, the line is drawn as the game draws it: in a bubble over
// the speaker, in the game's letters, beeping in the speaker's voice (GameScene); without it, in the
// editor's letters.

import { ChevronRight, Pause, Play, RotateCcw, Volume2, VolumeX } from 'lucide-react';
import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { ProjectData } from '../../core/project/types';
import { useAtom } from '../../core/useStore';
import { t } from '../../i18n';
import { gameFiles } from '../../state/gameFiles';
import { letterMove, shakeAt, type ShakeEvent } from '../../story/gameFx';
import { blips } from '../../story/gameLayout';
import { faceAt, gameLine } from '../../story/gameLine';
import { textMarksOn } from '../../story/marks';
import { toward, type DialogueLine, type StoryNode } from '../../story/model';
import { DEFAULT_TEXT, paletteName, type Palette } from '../../story/palette';
import { visibleText } from '../../story/game';
import { Button, Dialog, IconButton } from '../components';
import { preloadSounds, playNow, useGameFont } from './gameAssets';
import { GameScene, sceneSpeaker } from './GameScene';
import { cueText, speakerName } from './lineLook';

/** How long a cue stays shown. */
const CUE_SHOWN = 1.2;
/** Screen pixels for a pixel of the game, in the editor's letters. */
const SCALE = 2;
const SPEEDS = [0.5, 1, 2] as const;

// Remembered while the application runs: the speed and the sound are a habit, not a property of a line.
let lastSpeed = 1;
let lastSound = true;

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
  return (
    <Dialog
      open
      onClose={onClose}
      title={t('preview.title', { title: node.title || t('story.untitled') })}
      size="lg"
      className="typing-dialog"
    >
      <LinePlayer node={node} start={start} only={only} entities={entities} onEnd={onClose} />
    </Dialog>
  );
}

/**
 * Plays the lines of a node from `start` (only that one with `only`), with the controls of 6.1. `onEnd`: what
 * "next" does after the last line (none: no such button). The window of a line uses it with its own scale.
 */
export function LinePlayer({
  node,
  start,
  only,
  entities,
  onEnd,
  scale = 2,
  extra,
}: {
  node: StoryNode;
  start: number;
  only?: boolean;
  entities: ProjectData['entities'];
  onEnd?: () => void;
  /** Screen pixels for a pixel of the game in the scene. */
  scale?: number;
  /** More controls for the bar (the window's "whole node"). */
  extra?: ReactNode;
}) {
  const { palette, dir } = useAtom(gameFiles);
  const font = useGameFont(dir, palette.preview?.font);
  const lines = node.lines ?? [];
  const last = only ? start : lines.length - 1;
  const [index, setIndex] = useState(start);
  /** How many times "again" was pressed: every press is a fresh start (0.8.2). */
  const [run, setRun] = useState(0);
  const [speed, setSpeedState] = useState(lastSpeed);
  const [sound, setSoundState] = useState(lastSound);
  const line = lines[index];
  return (
    <>
      {line ? (
        <TypedLine
          // A new line, or "again": a fresh start, nothing kept from the play before.
          key={`${line.id}-${index}-${run}`}
          node={node}
          line={line}
          palette={palette}
          dir={dir}
          font={font}
          scale={scale}
          entities={entities}
          position={t('preview.position', { n: index + 1, count: lines.length })}
          hasNext={index < last}
          canEnd={!!onEnd}
          onNext={() => (index < last ? setIndex(index + 1) : onEnd?.())}
          // "Again" plays the conversation from its first line (the line alone, when only one is shown).
          onAgain={() => {
            setIndex(start);
            setRun((r) => r + 1);
          }}
          onReplay={() => setRun((r) => r + 1)}
          speed={speed}
          onSpeed={(s) => setSpeedState((lastSpeed = s))}
          sound={sound}
          onSound={(on) => setSoundState((lastSound = on))}
          extra={extra}
        />
      ) : (
        <p className="muted">{t('story.card.noLines')}</p>
      )}
      <p className="muted small">
        {t(palette.preview ? (font ? 'preview.hintScene' : 'preview.hintGame') : 'preview.hintDefault')}
      </p>
    </>
  );
}

function TypedLine({
  node,
  line,
  palette,
  dir,
  font,
  scale,
  entities,
  position,
  hasNext,
  canEnd,
  onNext,
  onAgain,
  onReplay,
  speed,
  onSpeed,
  sound,
  onSound,
  extra,
}: {
  node: StoryNode;
  line: DialogueLine;
  palette: Palette;
  dir: string | null;
  font: ReturnType<typeof useGameFont>;
  scale: number;
  entities: ProjectData['entities'];
  position: string;
  hasNext: boolean;
  canEnd: boolean;
  onNext: () => void;
  onAgain: () => void;
  onReplay: () => void;
  speed: number;
  onSpeed: (speed: number) => void;
  sound: boolean;
  onSound: (on: boolean) => void;
  extra?: ReactNode;
}) {
  const preview = palette.preview;
  const shakeTime = preview?.text.shake_time ?? DEFAULT_TEXT.shake_time;
  const speaker = useMemo(() => sceneSpeaker(palette, entities, line.speaker), [palette, entities, line.speaker]);
  // Worked out once per version of the line, not on every frame.
  const { gl, shakes, beeps } = useMemo(() => {
    const gl = gameLine(line.text, line.style, textMarksOn(node, { kind: 'line', id: line.id }), preview);
    const shakes: ShakeEvent[] = [
      ...gl.cues.flatMap((c) => (typeof c.props.shake === 'number' ? [{ time: c.time, strength: c.props.shake }] : [])),
      ...gl.chunks.filter((c) => c.shake > 0).map((c) => ({ time: c.time, strength: c.shake })),
    ];
    return { gl, shakes, beeps: blips(gl, preview, speaker.pitch) };
  }, [node, line.id, line.text, line.style, preview, speaker.pitch]);
  const auto = typeof line.auto === 'number' ? line.auto : null;
  const cueSound = (id: string | undefined) => (id ? palette.sounds.find((s) => s.id === id)?.sound : undefined);

  // The clock: t seconds from the start of the line, running `speed` times as fast as the real one.
  const [t0, setT] = useState(0);
  const [playing, setPlaying] = useState(true);
  /** The clock reads base + (now − origin) × speed: a jump sets the base, a pause keeps the last moment. */
  const origin = useRef(0);
  const base = useRef(0);
  const last = useRef(0);
  /** Up to which moment the sounds were played. */
  const heard = useRef(-0.001);
  useEffect(() => {
    if (!playing) return;
    base.current = last.current;
    origin.current = performance.now();
    let frame = 0;
    const tick = () => {
      const now = base.current + ((performance.now() - origin.current) / 1000) * speed;
      last.current = now;
      setT(now);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, speed]);
  /** Jumps to a moment (the slider, "finish the line"); `play` false stops there. */
  const seek = (to: number, play = playing) => {
    heard.current = to;
    base.current = to;
    last.current = to;
    origin.current = performance.now();
    setT(to);
    setPlaying(play);
  };
  const done = t0 >= gl.end;
  /** Space or a click on the text: the rest of the line at once; once it is out, the next line. */
  const advance = () => {
    if (done) return onNext();
    seek(gl.end);
  };
  // The scene takes the keys when the preview opens (not the window's "close", which Space would press),
  // unless the caret is in a field.
  const stage = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      if ((document.activeElement as HTMLElement | null)?.closest('input, textarea, select, [contenteditable]')) return;
      stage.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(id);
  }, []);
  const advanceRef = useRef(advance);
  useEffect(() => {
    advanceRef.current = advance;
  });
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const at = e.target as HTMLElement;
      // Space is "next" as in the game, on the buttons of the preview too; in a field it types, and the
      // buttons around the preview (the line's fields in its window) keep their own Space.
      if (e.key !== ' ' || at.closest('input, select, textarea, [contenteditable]')) return;
      if (at.closest('button') && !at.closest('.typing')) return;
      e.preventDefault();
      if (!e.repeat) advanceRef.current();
    };
    // A button pressed by Space fires on the key going up: that is "next" already, not the button.
    const up = (e: KeyboardEvent) => {
      const at = e.target as HTMLElement;
      if (e.key === ' ' && at.closest('button') && at.closest('.typing')) e.preventDefault();
    };
    window.addEventListener('keydown', key);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', key);
      window.removeEventListener('keyup', up);
    };
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

  // Sounds (7.6): the beeps and the sound cues between the last frame and this one, while it plays on.
  useEffect(() => {
    if (dir && sound) preloadSounds(dir, [speaker.voice, ...gl.cues.map((c) => cueSound(c.props.sound))]);
    // Once per line and voice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dir, sound, speaker.voice, gl]);
  useEffect(() => {
    const from = heard.current;
    heard.current = t0;
    if (!dir || !sound || !playing || t0 <= from || t0 - from > 0.5) return;
    for (const b of beeps) if (b.time > from && b.time <= t0) playNow(dir, speaker.voice, b.rate, b.gain);
    for (const c of gl.cues) {
      if (c.time > from && c.time <= t0 && c.props.sound) playNow(dir, cueSound(c.props.sound));
    }
    // The sounds of this moment only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t0]);

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
  const length = gl.end + (auto ?? 0);

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
      {font && preview ? (
        <div
          ref={stage}
          className="typing-stage"
          role="button"
          tabIndex={0}
          aria-label={t(done ? 'preview.next' : 'preview.skip')}
          onClick={advance}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            advance();
          }}
        >
          <GameScene
            line={gl}
            t={t0}
            done={done}
            font={font}
            preview={preview}
            speaker={speaker}
            dir={dir}
            scale={scale}
            shake={shake}
            label={`${speakerName(entities, line.speaker)}: ${visibleText(line.text)}`}
          />
        </div>
      ) : (
        <div
          ref={stage}
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
      )}
      <div className="typing-cues" aria-live="polite">
        {recent.map((c, i) => (
          <span key={`${c.at}-${i}`} className="chip typing-cue">
            {cueText(c.props, palette, nameOf)}
          </span>
        ))}
      </div>
      <div className="typing-time">
        <input
          type="range"
          className="typing-slider"
          aria-label={t('preview.time')}
          min={0}
          max={Math.max(0.01, length)}
          step={0.01}
          value={Math.min(t0, Math.max(0.01, length))}
          // Dragged: the moment shown, the effects frozen in it.
          onChange={(e) => seek(Number(e.target.value), false)}
        />
        <span className="muted small typing-clock">
          {t('preview.clock', { t: Math.min(t0, length).toFixed(2), end: gl.end.toFixed(2) })}
        </span>
      </div>
      <div className="typing-foot">
        {auto !== null && done && !goesOn && (
          <span className="muted small">
            {t('preview.auto', { seconds: Math.max(0, gl.end + auto - t0).toFixed(1) })}
          </span>
        )}
        <div className="typing-speeds" role="group" aria-label={t('preview.speed')}>
          {SPEEDS.map((s) => (
            <button
              key={s}
              type="button"
              className="typing-speed"
              aria-pressed={speed === s}
              // The moment stays where it is; from it on, the new pace.
              onClick={() => onSpeed(s)}
            >
              {t('preview.speedX', { n: String(s).replace('.', ',') })}
            </button>
          ))}
        </div>
        <IconButton
          size="sm"
          label={t(sound ? 'preview.soundOff' : 'preview.soundOn')}
          icon={sound ? <Volume2 size={14} /> : <VolumeX size={14} />}
          aria-pressed={sound}
          onClick={() => onSound(!sound)}
        />
        {extra}
        <Button size="sm" variant="ghost" icon={<RotateCcw size={14} />} onClick={onAgain}>
          {t('preview.again')}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon={playing && !done ? <Pause size={14} /> : <Play size={14} />}
          onClick={() => {
            // Typed out: play the line from its start; else stop or go on.
            if (done) onReplay();
            else setPlaying(!playing);
          }}
        >
          {t(playing && !done ? 'preview.pause' : done ? 'preview.play' : 'preview.resume')}
        </Button>
        {(hasNext || canEnd) && (
          <Button size="sm" variant="primary" icon={<ChevronRight size={14} />} onClick={onNext}>
            {t(hasNext ? 'play.next' : 'preview.close')}
          </Button>
        )}
      </div>
    </div>
  );
}
