// The scene of the preview as the game shows a line (0.8.2, "Редактор реплик" 7.2–7.8; 0.8.4, 7.9–7.10): a
// dark frame; the speaker on the left and the one spoken to on the right, turned to them — the sprite of
// their face from the palette (its frames running, the furniture under it standing still), or a box of their
// colour; their gestures, the emotes over their heads; the bubble of nine parts in the speaker's colour with
// its tail over the head, the letters in the game's font laid out in rows of the bubble's width, moving by
// their effects, the frame shaking; an interrupted line breaks off and falls. The narrator's bubble stands at
// the bottom in the middle, without a tail. Everything is drawn from the time t: the same t, the same picture.

import { useLayoutEffect, useMemo, useRef } from 'react';
import type { ProjectData } from '../../core/project/types';
import { actorAt, debrisAt, type ActorEvent, type Debris } from '../../story/gameActors';
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
  type PaletteIcon,
  type PalettePreview,
  type PreviewSpeaker,
} from '../../story/palette';
import { advance, drawGlyph, nineSlice, tint, useImage, useImages, type GameFont } from './gameAssets';

/** The scene's width in pixels of the game (the game's screen is 640 × 360). */
export const SCENE_W = 320;
const MIN_H = 96;
/** Someone without a sprite (7.9): a box of their colour. */
const BODY_W = 16;
const BODY_H = 24;
/** How far the people stand from the sides. */
const EDGE = 28;
const GROUND = 10;
const BACK = '#16141b';
const FLOOR = '#221f29';
/** The one spoken to stands on the right (the owner's answer): the speaker's side is 1, theirs −1. */
const SIDE = 1;

/** Who speaks a line (or is spoken to), as the scene needs it: colour, bubble, voice, sprite. */
export interface SceneSpeaker {
  /** The line's id of them: a card's id, or "narrator". */
  id: string;
  color: string;
  shape: BubbleShape;
  narrator: boolean;
  /** The voice's sound (path from data/), and its pitch. */
  voice?: string;
  pitch: number;
  /** Their sprite in the palette (faces as strips of frames), when the game has drawn them. */
  sprite?: PreviewSpeaker;
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
    id: speaker ?? '',
    color: p?.color ?? listed?.color ?? palette.preview?.text.color ?? '#e8e6de',
    shape: (shapeId && shapes[shapeId]) || Object.values(shapes)[0] || DEFAULT_SHAPE,
    narrator: speaker === NARRATOR || p?.narrator === true,
    voice: palette.voices.find((v) => v.id === voice)?.sound,
    pitch: p?.voice_pitch ?? game?.pitch ?? 1,
    sprite: p && Object.keys(p.faces).length ? p : undefined,
  };
}

/** The size of someone in the scene and the top of their head (from their top-left). */
function body(s: SceneSpeaker): { w: number; h: number; head: [number, number] } {
  const sp = s.sprite;
  if (!sp) return { w: BODY_W, h: BODY_H, head: [BODY_W / 2, 0] };
  const w = sp.frame_w ?? BODY_W;
  return { w, h: sp.frame_h ?? BODY_H, head: sp.head ?? [w / 2, 0] };
}

/** The strip of a face: the face asked for, else the neutral one, else any. */
function facePath(sp: PreviewSpeaker | undefined, face: string | null): string | undefined {
  if (!sp) return undefined;
  return (face && sp.faces[face]) || sp.faces.neutral || Object.values(sp.faces)[0];
}

export function GameScene({
  line,
  t,
  done,
  font,
  preview,
  speaker,
  listener,
  face,
  events,
  emotes,
  broken,
  debris,
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
  /** The one spoken to, on the right (none: the speaker alone). */
  listener: SceneSpeaker | null;
  /** The speaker's face now. */
  face: string;
  /** Gestures, emotes and faces of the people during the line. */
  events: readonly ActorEvent[];
  /** The pictures of the emotes, by id. */
  emotes: Readonly<Record<string, PaletteIcon | undefined>>;
  /** When the line was interrupted ("interrupt"), else null. */
  broken: number | null;
  debris: Debris;
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
  // Every picture the people may need during the line: all their faces, their furniture, the emotes.
  const paths = useMemo(() => {
    const out = new Set<string>();
    for (const s of [speaker, listener]) {
      if (!s?.sprite) continue;
      Object.values(s.sprite.faces).forEach((p) => out.add(p));
      if (s.sprite.under) out.add(s.sprite.under);
    }
    Object.values(emotes).forEach((ic) => ic && out.add(ic.image));
    return [...out].sort();
  }, [speaker, listener, emotes]);
  const images = useImages(dir, paths);

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
    const me = body(speaker);
    const them = listener ? body(listener) : null;
    const below = speaker.narrator ? 0 : me.h - me.head[1];
    const height = Math.max(
      MIN_H,
      speaker.narrator ? h + 16 + (them ? them.h + GROUND : 0) : h + tailH + below + GROUND + 10,
      them ? them.h + GROUND + 16 : 0,
    );
    const ground = height - GROUND;
    const meX = EDGE;
    const themX = them ? SCENE_W - EDGE - them.w : 0;
    const head = { x: meX + me.head[0], y: ground - me.h + me.head[1] };
    const bx = speaker.narrator
      ? Math.round((SCENE_W - w) / 2)
      : Math.round(Math.max(4, Math.min(SCENE_W - 4 - w, head.x - w / 2)));
    // The tail's top row lies on the frame; its point is just over the head.
    const by = speaker.narrator ? (them ? 8 : height - 8 - h) : head.y - 2 - tailH - h + 1;
    const tx = Math.round(Math.max(bx + shape.m / 2, Math.min(bx + w - shape.m / 2 - b.tail_w, head.x - b.tail_w / 2)));
    return { layout, w, h, height, ground, bx, by, tx, tailH, me, them, meX, themX };
  }, [line, font, preview.text.width, speaker, listener, b.min_w, b.tail_h, b.tail_w]);

  useLayoutEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const { layout, w, h, ground, bx, by, tx, tailH, me, them, meX, themX } = geo;
    ctx.imageSmoothingEnabled = false;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = BACK;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // The frame shakes, not the window around it.
    ctx.translate(shake.dx * scale, shake.dy * scale);
    ctx.fillStyle = FLOOR;
    ctx.fillRect(-8 * scale, ground * scale, (SCENE_W + 16) * scale, (GROUND + 8) * scale);

    /** Draws someone: the furniture under them where it stands, them where their gestures put them. */
    const person = (
      s: SceneSpeaker,
      size: ReturnType<typeof body>,
      x: number,
      mirrored: boolean,
      faceId: string | null,
    ) => {
      const now = actorAt(events, s.id, t, preview, mirrored ? -SIDE : SIDE);
      const top = ground - size.h;
      const sp = s.sprite;
      const strip = facePath(sp, now.face ?? faceId);
      const img = strip ? images.get(strip) : null;
      const under = sp?.under ? images.get(sp.under) : null;
      const frames = Math.max(1, sp?.frames ?? 1);
      const frame = Math.floor(t * (sp?.fps ?? 0)) % frames;
      const draw = (pic: HTMLImageElement, dx: number, dy: number) => {
        ctx.save();
        if (mirrored) {
          ctx.translate((x + size.w + dx) * scale, (top + dy) * scale);
          ctx.scale(-1, 1);
        } else ctx.translate((x + dx) * scale, (top + dy) * scale);
        ctx.drawImage(pic, frame * size.w, 0, size.w, size.h, 0, 0, size.w * scale, size.h * scale);
        ctx.restore();
      };
      if (under) draw(under, 0, 0);
      if (img) draw(img, now.dx, now.dy);
      else {
        ctx.fillStyle = s.color;
        ctx.fillRect((x + now.dx) * scale, (top + now.dy) * scale, size.w * scale, size.h * scale);
      }
      // The emote beside the head: its anchor (bottom middle) dx, dy from the top of the head.
      const ic = now.emote ? emotes[now.emote.id] : undefined;
      const sheet = ic ? images.get(ic.image) : null;
      if (now.emote && ic && sheet) {
        const e = preview.emote;
        const hx = mirrored ? x + size.w - size.head[0] : x + size.head[0];
        const ax = hx + (mirrored ? -e.dx : e.dx) + now.dx;
        const ay = top + size.head[1] + e.dy + now.dy - now.emote.up;
        ctx.globalAlpha = now.emote.alpha;
        ctx.drawImage(
          sheet,
          ic.frame * ic.w,
          0,
          ic.w,
          ic.h,
          (ax - e.origin[0]) * scale,
          (ay - e.origin[1]) * scale,
          ic.w * scale,
          ic.h * scale,
        );
        ctx.globalAlpha = 1;
      }
    };
    if (!speaker.narrator) person(speaker, me, meX, false, face);
    if (listener && them) person(listener, them, themX, true, null);

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

    // The letters that are out, where their effects put them now; interrupted, they break off and fall.
    const ox = bx + speaker.shape.pad_x;
    const oy = by + speaker.shape.pad_y;
    for (const p of layout.placed) {
      const l = p.letter;
      if (p.skip || l.appear > t || /\s/.test(l.ch)) continue;
      if (broken !== null && l.appear > broken) continue;
      const fall = broken !== null && t >= broken ? debrisAt(l.i, t - broken, debris) : { dx: 0, dy: 0, alpha: 1 };
      if (!fall) continue;
      const at = broken !== null && t >= broken ? broken : t;
      const move = letterMove(l.props.fx, preview.effects, l.i, at, at - l.appear);
      const col = move.col ?? l.props.col;
      ctx.globalAlpha = fall.alpha;
      drawGlyph(
        ctx,
        font,
        l.ch,
        col,
        l.props.size,
        l.props.bold,
        ox + p.x + move.dx + fall.dx,
        oy + p.y + move.dy + fall.dy,
        scale,
      );
    }
    ctx.globalAlpha = 1;
    // Typed out: "▼" blinks in the corner in the speaker's colour.
    if (done && broken === null && Math.floor(t * 2.5) % 2 === 0) {
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
  }, [
    geo,
    t,
    done,
    shake.dx,
    shake.dy,
    scale,
    speaker,
    listener,
    face,
    events,
    emotes,
    images,
    broken,
    debris,
    font,
    preview,
    b,
    fill,
    outline,
    tailFill,
    tailLine,
  ]);

  const out = line.letters.filter((l) => l.i >= 0 && l.appear <= t).length;
  // What the people do now, for those who do not see the canvas (and the tests).
  const me = actorAt(events, speaker.id, t, preview, SIDE);
  const them = listener ? actorAt(events, listener.id, t, preview, -SIDE) : null;
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
      data-face={speaker.narrator ? undefined : (me.face ?? face)}
      data-moved={me.dx || me.dy ? `${me.dx},${me.dy}` : undefined}
      data-emote={me.emote?.id}
      data-listener={listener?.id}
      data-listener-emote={them?.emote?.id}
      data-broken={broken !== null && t >= broken ? '' : undefined}
    />
  );
}
