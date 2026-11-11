// A conversation as plain text (0.8, item 23 of "Dialogues"): a script to read, send to a voice actor or a
// translator. Nodes in the order the talk goes from its start (the rest after them), each line as
// "SPEAKER (directions): text", choices with their options and where each leads. Effects written in braces
// are left out, as the player never sees them; cues between words stay as [directions].

import type { GraphDoc } from '../../canvas/model';
import type { ProjectData } from '../../core/project/types';
import { t } from '../../i18n';
import { edgesFrom, graphTitle, startOf } from '../../story/flow';
import { graphKey } from '../../story/gameKey';
import { cueAt } from '../../story/marks';
import { asStory, graphOf, GIVE_PORTS, textMarks, toward, type StoryNode, type TowardValue } from '../../story/model';
import { paletteName, type Palette } from '../../story/palette';
import { textPieces } from '../../story/textEffects';
import { cueText, speakerName } from './lineLook';

/** Nodes in the order the talk goes: from the start along the exits (options in their order), then the rest. */
export function talkOrder(g: GraphDoc): StoryNode[] {
  const byId = new Map(g.nodes.map((n) => [n.id, asStory(n)]));
  const seen = new Set<string>();
  const out: StoryNode[] = [];
  const visit = (id: string) => {
    if (seen.has(id) || !byId.has(id)) return;
    seen.add(id);
    const n = byId.get(id)!;
    if (n.kind === 'sticker') return;
    out.push(n);
    const ports = portOrder(n);
    const exits = [...edgesFrom(g, id)].sort((a, b) => ports(a.from.port) - ports(b.from.port));
    for (const e of exits) visit(e.to.node);
  };
  const start = startOf(g);
  if (start) visit(start.id);
  for (const n of g.nodes) if (!seen.has(n.id)) visit(n.id);
  return out;
}

/** The order of a node's exits: options and lines in their order, then the rest. */
function portOrder(n: StoryNode): (port: string) => number {
  const order = [
    ...(n.options ?? []).map((o) => o.id),
    ...GIVE_PORTS,
    'yes',
    'no',
    'out',
    ...(n.lines ?? []).map((l) => l.id),
  ];
  return (port) => {
    const i = order.indexOf(port);
    return i < 0 ? order.length : i;
  };
}

const upper = (s: string) => s.toLocaleUpperCase();

const GIVE_WORDS = { given: 'story.port.given', cancel: 'story.port.cancel', empty: 'story.port.empty' } as const;

/** The line as the player reads it, with cues between the words as [directions]. */
function lineText(
  text: string,
  n: StoryNode,
  lineId: string,
  palette: Palette,
  nameOf: (id: string) => string,
): string {
  const braced = textPieces(text).effects.filter((e) => e.braced);
  const cues = textMarks(n)
    .filter((m) => m.device === 'cue' && m.anchor.kind === 'line' && m.anchor.id === lineId)
    .map((m) => ({ at: cueAt(text, m), text: m.device === 'cue' ? cueText(m.props, palette, nameOf) : '' }))
    .sort((a, b) => a.at - b.at);
  let out = '';
  for (let i = 0; i <= text.length; i++) {
    for (const c of cues.filter((x) => x.at === i)) out += ` [${c.text}] `;
    if (i === text.length) break;
    const cut = braced.find((b) => b.start <= i && i < b.end);
    if (cut) {
      i = cut.end - 1;
      continue;
    }
    out += text[i];
  }
  return out.replace(/[ \t]{2,}/g, ' ').trim();
}

export function conversationScript(data: ProjectData, graphId: string, palette: Palette): string {
  const g = graphOf(data, graphId);
  if (!g) return '';
  const entity = (id: string | null | undefined) => speakerName(data.entities, id);
  const title = (id: string) => g.nodes.find((n) => n.id === id)?.title || t('story.untitled');
  const exitsOf = (n: StoryNode, port?: string) =>
    edgesFrom(g, n.id, port)
      .map((e) => `«${title(e.to.node)}»`)
      .join(', ');
  const aimed = (what: string, list: 'gestures' | 'emotes', v: TowardValue | undefined) => {
    const x = toward(v);
    if (!x) return null;
    const name = paletteName(palette, list, x.id);
    return x.to ? `${what}: ${name} → ${entity(x.to)}` : `${what}: ${name}`;
  };

  const name = g.kind === 'story' ? g.name : graphTitle(data, graphId);
  const key = graphKey(g);
  const out: string[] = [key ? t('script.titleKey', { name, key }) : t('script.title', { name }), ''];
  for (const n of talkOrder(g)) {
    const head = n.title || t('story.untitled');
    switch (n.kind) {
      case 'start':
        continue;
      case 'dialogue': {
        out.push(n.when !== undefined ? `— ${head} — (${t('script.when', { when: n.when || '…' })})` : `— ${head} —`);
        for (const l of n.lines ?? []) {
          const directions = [
            l.style && paletteName(palette, 'styles', l.style),
            l.face && `${t('line.face').toLocaleLowerCase()}: ${paletteName(palette, 'faces', l.face)}`,
            aimed(t('line.gesture').toLocaleLowerCase(), 'gestures', l.gesture),
            aimed(t('line.emote').toLocaleLowerCase(), 'emotes', l.emote),
          ].filter(Boolean);
          const who = upper(entity(l.speaker)) + (directions.length ? ` (${directions.join('; ')})` : '');
          const when = l.condition?.trim() ? ` [${t('script.if', { condition: l.condition.trim() })}]` : '';
          out.push(`${who}${when}: ${lineText(l.text, n, l.id, palette, entity)}`);
          if (l.interruptExit) {
            const to = exitsOf(n, l.id);
            if (to) out.push(`    (${t('script.interrupted', { to })})`);
          }
        }
        const lineIds = new Set((n.lines ?? []).map((l) => l.id));
        const next = edgesFrom(g, n.id)
          .filter((e) => !lineIds.has(e.from.port))
          .map((e) => `«${title(e.to.node)}»`)
          .join(', ');
        if (next && n.when === undefined) out.push(`→ ${next}`);
        break;
      }
      case 'choice': {
        const about = [t('story.kind.choice').toLocaleLowerCase()];
        if (typeof n.timer === 'number') about.push(t('choice.timerCard', { seconds: n.timer }).toLocaleLowerCase());
        if (n.checkpoint) about.push(t('choice.checkpoint').toLocaleLowerCase());
        out.push(`— ${head} — (${about.join('; ')})`);
        if (n.text?.trim()) out.push(n.text.trim());
        (n.options ?? []).forEach((o, i) => {
          const marks = [
            o.condition.trim() && t('script.if', { condition: o.condition.trim() }),
            o.once && t('choice.once').toLocaleLowerCase(),
          ].filter(Boolean);
          const to = exitsOf(n, o.id);
          const text = o.secret ? t('script.secret') : lineText(o.text, n, o.id, palette, entity) || '…';
          out.push(
            `  ${o.secret ? '*' : i + 1}. ${text}${marks.length ? ` [${marks.join('; ')}]` : ''}${to ? ` → ${to}` : ''}`,
          );
        });
        break;
      }
      case 'give': {
        out.push(`— ${head} — (${t('story.kind.give').toLocaleLowerCase()})`);
        const ways = GIVE_PORTS.map((port) => {
          const to = exitsOf(n, port);
          return to ? `${t(GIVE_WORDS[port])} → ${to}` : null;
        }).filter(Boolean);
        if (ways.length) out.push(`  ${ways.join('; ')}`);
        break;
      }
      case 'condition':
        out.push(`— ${head} — [${t('script.if', { condition: n.expr?.trim() || '…' })}]`);
        for (const port of ['yes', 'no'] as const) {
          const to = exitsOf(n, port);
          if (to) out.push(`  ${t(port === 'yes' ? 'story.port.yes' : 'story.port.no')} → ${to}`);
        }
        break;
      case 'end':
        out.push(`— ${head} —`);
        if (n.text?.trim()) out.push(n.text.trim());
        break;
      default: {
        out.push(`— ${head} —`);
        if (n.text?.trim()) out.push(n.text.trim());
        const next = exitsOf(n);
        if (next) out.push(`→ ${next}`);
      }
    }
    out.push('');
  }
  return `${out.join('\n').trimEnd()}\n`;
}
