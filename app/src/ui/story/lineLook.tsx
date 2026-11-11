// How a dialogue line looks and sounds in the game (0.8), shared by the line editor, the cards, the preview
// and the script: the icons and names of cues, a cue in words, the look of marked words.

import { Hand, Smile, Timer, UserRound, Vibrate, Volume2 } from 'lucide-react';
import type { CSSProperties } from 'react';
import { t, type MessageKey } from '../../i18n';
import { cueAt, resolveRange, textMarksOn } from '../../story/marks';
import {
  CUE_KINDS,
  toward,
  type CueKind,
  type CueProps,
  type MarkAnchor,
  type StoryNode,
  type StyleProps,
  type TextMark,
} from '../../story/model';
import { NARRATOR, paletteEntry, paletteName, type Palette } from '../../story/palette';
import type { ProjectData } from '../../core/project/types';
import type { Highlight } from './MarkedText';

export const CUE_ICONS: Record<CueKind, typeof Timer> = {
  pause: Timer,
  shake: Vibrate,
  sound: Volume2,
  gesture: Hand,
  emote: Smile,
  face: UserRound,
};

export const CUE_NAMES: Record<CueKind, MessageKey> = {
  pause: 'cue.pause',
  shake: 'cue.shake',
  sound: 'cue.sound',
  gesture: 'cue.gesture',
  emote: 'cue.emote',
  face: 'cue.face',
};

/** What a cue is: the first of the kinds its props hold. */
export function cueKind(props: CueProps): CueKind {
  return CUE_KINDS.find((k) => props[k] !== undefined) ?? 'pause';
}

/** What a cue does, in words: "pause 0.4 s", "sound: Bell", "emote: Question → Hero". */
export function cueText(props: CueProps, palette: Palette, nameOf: (id: string) => string): string {
  const kind = cueKind(props);
  const name = t(CUE_NAMES[kind]);
  if (kind === 'pause') return t('cue.pauseText', { seconds: props.pause ?? 0 });
  if (kind === 'shake') return `${name} ${props.shake ?? 0}`;
  if (kind === 'sound') return `${name}: ${paletteName(palette, 'sounds', props.sound) || '—'}`;
  const x = toward(props[kind]);
  const list = kind === 'gesture' ? 'gestures' : kind === 'face' ? 'faces' : 'emotes';
  const what = paletteName(palette, list, x?.id) || '—';
  return x?.to ? `${name}: ${what} → ${nameOf(x.to)}` : `${name}: ${what}`;
}

/** How marked words look in the editor: the colour (their own, else their style's) and the weight. */
export function styleCss(props: StyleProps, palette: Palette, real = false): CSSProperties {
  const color = props.color || paletteEntry(palette, 'styles', props.style)?.color;
  const css: CSSProperties = {};
  if (color) css.color = color;
  if (real) {
    if (props.bold) css.fontWeight = 700;
    if (props.size === 'big') css.fontSize = '1.25em';
    if (props.size === 'small') css.fontSize = '0.8em';
  }
  return css;
}

/** Highlights of a line's words that have a look in the game, and where its cues are. */
export function gameMarks(node: StoryNode, anchor: MarkAnchor, text: string, palette: Palette, real = false) {
  const highlights: Highlight[] = [];
  const cues: { at: number; mark: TextMark }[] = [];
  for (const m of textMarksOn(node, anchor)) {
    if (m.device === 'cue') {
      cues.push({ at: cueAt(text, m), mark: m });
      continue;
    }
    const r = resolveRange(text, m.range);
    if (!r) continue;
    const cls = [
      'hl-style',
      m.props.bold && 'hl-bold',
      m.props.size && `hl-size-${m.props.size}`,
      m.props.effect && 'hl-fx',
    ];
    highlights.push({ ...r, className: cls.filter(Boolean).join(' '), style: styleCss(m.props, palette, real) });
  }
  cues.sort((a, b) => a.at - b.at);
  return { highlights, cues };
}

/**
 * Who speaks a line, as the author reads it (0.8.1): the narrator ("speaker": "narrator"), a card, or — for
 * null — "who speaks?", the line nobody was chosen for.
 */
export function speakerName(entities: ProjectData['entities'], id: string | null | undefined): string {
  if (id === NARRATOR) return t('story.narrator');
  if (!id) return t('line.whoSpeaksMissing');
  const e = entities[id];
  if (!e) return t('story.lines.deletedSpeaker');
  return (typeof e.name === 'string' && e.name) || t('story.untitled');
}
