// The scene of the preview as the game shows a line (0.8.2, "Редактор реплик" 7.2–7.8): a dark frame, the
// speaker (a box in the speaker's colour until the sprites come with step 4), the bubble of nine parts in the
// speaker's colour with its tail over the head, the letters in the game's font laid out in rows of the
// bubble's width, moving by their effects, the frame shaking. The narrator's bubble stands at the bottom in
// the middle, without a tail. Everything is drawn from the time t: the same t, the same picture.

import { useLayoutEffect, useMemo, useRef } from 'react';
import type { ProjectData } from '../../core/project/types';
import { entityGame } from '../../story/game';
import { letterMove } from '../../story/gameFx';
import { keyOf } from '../../story/gameKey';
import { bubbleSize, layoutText } from '../../story/gameLayout';
import type { GameLine } from '../../story/gameLine';
import {
  DEFAULT_SHAPE,
  NARRATOR,
  paletteSpeaker,
  type BubbleShape,
  type Palette,
  type PalettePreview,
} from '../../story/palette';
import { advance, drawGlyph, nineSlice, tint, useImage, type GameFont } from './gameAssets';

/** The scene's width in pixels of the game (the game's screen is 640 × 360; the speaker stands on the left). */
export const SCENE_W = 320;
const MIN_H = 96;
/** The speaker without a sprite (7.9): a box of the speaker's colour. */
const BODY_W = 16;
const BODY_H = 24;
const BODY_X = 40;
const GROUND = 10;
const BACK = '#16141b';
const FLOOR = '#221f29';

/** Who speaks a line, as the scene needs it: colour, bubble, voice. */
export interface SceneSpeaker {
  color: string;
  shape: BubbleShape;
  narrator: boolean;
  /** The voice's sound (path from data/), and its pitch. */
  voice?: string;
  pitch: number;
}

/** The speaker of a line from the palette (the game's numbers), else from the card's "for the game" fields. */
export function sceneSpeaker(
  palette: Palette,
  entities: ProjectData['entities'],
  speaker: string | null | undefined,
): SceneSpeaker {
  const card = speaker && speaker !== NARRATOR ? entities[speaker] : undefined;
  const key = speaker === NARRATOR ? NARRATOR : keyOf(card);
  const p = palette.preview?.speakers.find((s) => s.id === key);
  const listed = paletteSpeaker(palette, key);
  const game = card ? entityGame(card) : null;
  const shapeId = p?.bubble ?? listed?.bubble ?? game?.bubble;
  const shapes = palette.preview?.bubble.shapes ?? {};
  const voice = p?.voice ?? listed?.voice ?? game?.voice;
  return {
    color: p?.color ?? listed?.color ?? palette.preview?.text.color ?? '#e8e6de',
    shape: (shapeId && shapes[shapeId]) || Object.values(shapes)[0] || DEFAULT_SHAPE,
    narrator: speaker === NARRATOR || p?.narrator === true,
    voice: palette.voices.find((v) => v.id === voice)?.sound,
    pitch: p?.voice_pitch ?? game?.pitch ?? 1,
  };
}

export function GameScene({
  line,
  t,
  done,
  font,
  preview,
  speaker,
  dir,
  scale,
  shake,
  label,
}: {
  line: GameLine;
  t: number;
  done: boolean;
  font: GameFont;
  preview: PalettePreview;
  speaker: SceneSpeaker;
  dir: string | null;
  scale: number;
  shake: { dx: number; dy: number };
  /** What the scene says, for those who do not see it. */
  label: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const b = preview.bubble;
  const fill = useImage(dir, b.fill_image);
  const outline = useImage(dir, b.line_image);
  const tailFill = useImage(dir, b.tail_fill);
  const tailLine = useImage(dir, b.tail_line);

  // Where everything stands depends on the line, not on the moment.
  const geo = useMemo(() => {
    const layout = layoutText(
      line.letters,
      (ch, size, bold) => advance(font, ch, size, bold),
      font.font,
      preview.text.width,
    );
    const { shape } = speaker;
    const { w, h } = bubbleSize(layout.width, layout.height, shape, b.min_w);
    const tailH = speaker.narrator ? 0 : b.tail_h;
    const height = Math.max(MIN_H, speaker.narrator ? h + 16 : h + tailH + BODY_H + GROUND + 10);
    const ground = height - GROUND;
    const head = { x: BODY_X + BODY_W / 2, y: ground - BODY_H };
    const bx = speaker.narrator
      ? Math.round((SCENE_W - w) / 2)
      : Math.round(Math.max(4, Math.min(SCENE_W - 4 - w, head.x - w / 2)));
    // The tail's top row lies on the frame; its point is just over the head.
    const by = speaker.narrator ? height - 8 - h : head.y - 2 - tailH - h + 1;
    const tx = Math.round(Math.max(bx + shape.m / 2, Math.min(bx + w - shape.m / 2 - b.tail_w, head.x - b.tail_w / 2)));
    return { layout, w, h, height, ground, bx, by, tx, tailH };
  }, [line, font, preview.text.width, speaker, b.min_w, b.tail_h, b.tail_w]);

  useLayoutEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const { layout, w, h, ground, bx, by, tx, tailH } = geo;
    ctx.imageSmoothingEnabled = false;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = BACK;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // The frame shakes, not the window around it.
    ctx.translate(shake.dx * scale, shake.dy * scale);
    ctx.fillStyle = FLOOR;
    ctx.fillRect(-8 * scale, ground * scale, (SCENE_W + 16) * scale, (GROUND + 8) * scale);
    if (!speaker.narrator) {
      ctx.fillStyle = speaker.color;
      ctx.fillRect(BODY_X * scale, (ground - BODY_H) * scale, BODY_W * scale, BODY_H * scale);
    }

    // The bubble: the fill in its colour, see-through; the line in the speaker's.
    const frame = { x: speaker.shape.frame * b.frame_w, w: b.frame_w, h: b.frame_h, m: speaker.shape.m };
    ctx.globalAlpha = b.alpha;
    if (fill) nineSlice(ctx, tint(fill, b.fill), frame, bx, by, w, h, scale);
    else {
      ctx.fillStyle = b.fill;
      ctx.fillRect(bx * scale, by * scale, w * scale, h * scale);
    }
    if (tailH && tailFill)
      ctx.drawImage(tint(tailFill, b.fill), tx * scale, (by + h - 1) * scale, b.tail_w * scale, tailH * scale);
    ctx.globalAlpha = 1;
    if (outline) nineSlice(ctx, tint(outline, speaker.color), frame, bx, by, w, h, scale);
    else {
      ctx.strokeStyle = speaker.color;
      ctx.lineWidth = scale;
      ctx.strokeRect((bx + 0.5) * scale, (by + 0.5) * scale, (w - 1) * scale, (h - 1) * scale);
    }
    if (tailH) {
      if (tailLine) {
        ctx.drawImage(tint(tailLine, speaker.color), tx * scale, (by + h - 1) * scale, b.tail_w * scale, tailH * scale);
      } else {
        ctx.fillStyle = speaker.color;
        ctx.beginPath();
        ctx.moveTo(tx * scale, (by + h - 1) * scale);
        ctx.lineTo((tx + b.tail_w) * scale, (by + h - 1) * scale);
        ctx.lineTo((tx + b.tail_w / 2) * scale, (by + h - 1 + tailH) * scale);
        ctx.fill();
      }
    }

    // The letters that are out, where their effects put them now.
    const ox = bx + speaker.shape.pad_x;
    const oy = by + speaker.shape.pad_y;
    for (const p of layout.placed) {
      const l = p.letter;
      if (p.skip || l.appear > t || /\s/.test(l.ch)) continue;
      const move = letterMove(l.props.fx, preview.effects, l.i, t, t - l.appear);
      const col = move.col ?? l.props.col;
      drawGlyph(ctx, font, l.ch, col, l.props.size, l.props.bold, ox + p.x + move.dx, oy + p.y + move.dy, scale);
    }
    // Typed out: "▼" blinks in the corner in the speaker's colour.
    if (done && Math.floor(t * 2.5) % 2 === 0) {
      const aw = advance(font, '▼', 1, false);
      drawGlyph(
        ctx,
        font,
        '▼',
        speaker.color,
        1,
        false,
        bx + w - aw - 3,
        by + h - font.font.cap_top - font.font.cap_h - 3,
        scale,
      );
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }, [geo, t, done, shake.dx, shake.dy, scale, speaker, font, preview.effects, b, fill, outline, tailFill, tailLine]);

  const out = line.letters.filter((l) => l.i >= 0 && l.appear <= t).length;
  return (
    <canvas
      ref={ref}
      className="game-scene"
      width={SCENE_W * scale}
      height={geo.height * scale}
      style={{ width: SCENE_W * scale, height: geo.height * scale }}
      role="img"
      aria-label={label}
      data-out={out}
      data-done={done ? '' : undefined}
      data-shake={shake.dx || shake.dy ? `${shake.dx},${shake.dy}` : undefined}
      data-rows={geo.layout.rows.length}
      data-bubble={`${geo.w}x${geo.h}`}
    />
  );
}
