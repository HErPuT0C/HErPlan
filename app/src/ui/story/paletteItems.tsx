// What each field of a line offers from the game's palette (0.8.1, "Редактор реплик" 2.1–2.3): styles in
// their colours, faces of the speaker by picture, emotes by icon, sounds and voices to hear, effects on a
// sample word, who speaks (cards with a name in the game, and the narrator).

import { useEffect, useRef } from 'react';
import type { ProjectData } from '../../core/project/types';
import { useAtom } from '../../core/useStore';
import { t } from '../../i18n';
import { gameFiles } from '../../state/gameFiles';
import { listEntities } from '../../story/entities';
import { entityGame } from '../../story/game';
import { keyOf } from '../../story/gameKey';
import { letterMove } from '../../story/gameFx';
import { NARRATOR, paletteName, paletteSpeaker, type Palette, type PaletteList } from '../../story/palette';
import { drawLine, useGameFont } from './gameAssets';
import { SpriteFrame, type SelectItem } from './PaletteSelect';

export function listItems(palette: Palette, list: PaletteList): SelectItem[] {
  return palette[list].map((e) => {
    const item: SelectItem = { id: e.id, name: e.name };
    if (e.hint) item.hint = e.hint;
    if (e.color) item.color = e.color;
    if (e.icon) item.icon = <SpriteFrame icon={e.icon} scale={2} />;
    if (e.sound) item.sound = e.sound;
    if (list === 'effects') item.sample = <EffectSample effect={e.id} />;
    return item;
  });
}

/** "Пример" in the game's font with an effect moving it, as the game would. */
export function EffectSample({ effect }: { effect: string }) {
  const { dir, palette } = useAtom(gameFiles);
  const font = useGameFont(dir, palette.preview?.font);
  const ref = useRef<HTMLCanvasElement>(null);
  const word = t('palette.sample');
  const scale = 2;
  useEffect(() => {
    const c = ref.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx || !font) return;
    const params = palette.preview?.effects ?? {};
    const color = palette.preview?.text.color ?? '#e8e6de';
    const start = performance.now();
    let frame = 0;
    const tick = () => {
      // The word appears letter by letter every two seconds, so "punch" and "sink" are seen too.
      const t0 = ((performance.now() - start) / 1000) % 2;
      ctx.clearRect(0, 0, c.width, c.height);
      const letters = [...word].map((ch, i) => {
        const m = letterMove([effect], params, i, t0, t0 - i * 0.03);
        return { ch, col: m.col ?? color, size: 1 as const, bold: false, dx: m.dx, dy: m.dy };
      });
      drawLine(ctx, font, letters, 4, 4, scale);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [font, effect, palette, word]);
  if (!font) return null;
  return (
    <canvas
      ref={ref}
      className="effect-sample"
      width={56 * scale}
      height={(font.font.cell_h + 8) * scale}
      aria-label={t('palette.sampleOf', { name: paletteName(palette, 'effects', effect) })}
    />
  );
}

/**
 * Faces a speaker can make: the game's list for their name in the game (with pictures), else the faces the
 * card names; `gray` says why there are none.
 */
export function faceItems(
  palette: Palette,
  entities: ProjectData['entities'],
  speaker: string | null | undefined,
): { items: SelectItem[]; gray: string | null } {
  const card = speaker && speaker !== NARRATOR ? entities[speaker] : undefined;
  const key = speaker === NARRATOR ? NARRATOR : keyOf(card);
  const game = paletteSpeaker(palette, key);
  const ids = game ? game.faces : card ? entityGame(card).faces : [];
  if (!ids.length) return { items: [], gray: t('line.noFaces') };
  const look = palette.preview?.speakers.find((s) => s.id === key);
  return {
    gray: null,
    items: ids.map((id) => {
      const strip = look?.faces[id];
      const item: SelectItem = { id, name: paletteName(palette, 'faces', id) };
      if (strip && look?.frame_w && look.frame_h) {
        item.icon = <SpriteFrame icon={{ image: strip, frame: 0, w: look.frame_w, h: look.frame_h }} scale={0.75} />;
      }
      return item;
    }),
  };
}

/** Who can speak a line (2.3): the narrator, and the characters that have a name in the game. */
export function speakerItems(palette: Palette, data: Pick<ProjectData, 'entities' | 'types'>): SelectItem[] {
  const describe = (key: string): Partial<SelectItem> => {
    const s = paletteSpeaker(palette, key);
    if (!s) return { hint: t('line.notInGameSpeaker') };
    const hint = [
      s.bubble && t('line.bubbleIs', { name: paletteName(palette, 'bubbles', s.bubble) }),
      s.voice && t('line.voiceIs', { name: paletteName(palette, 'voices', s.voice) }),
    ]
      .filter(Boolean)
      .join(' · ');
    return { color: s.color, hint: hint || undefined };
  };
  return [
    { id: NARRATOR, name: t('story.narrator'), ...describe(NARRATOR) },
    ...listEntities(data, 'character')
      .filter((e) => keyOf(e))
      .map((e) => ({ id: e.id, name: e.name || t('story.untitled'), ...describe(keyOf(e)) })),
  ];
}

/** Characters that speak at least one line in a graph: whom an emote, a gesture or a face can belong to. */
export function participants(lines: readonly { speaker: string | null }[]): string[] {
  return [...new Set(lines.map((l) => l.speaker).filter((s): s is string => !!s && s !== NARRATOR))];
}
