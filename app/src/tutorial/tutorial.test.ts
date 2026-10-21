import { describe, expect, it } from 'vitest';
import { allFiles } from '../core/project/files';
import type { ProjectData } from '../core/project/types';
import { linksIn } from '../documents/links';
import { fieldText, linkLabel } from '../documents/lookups';
import { canonicalBlocks, parseMarkdown, writeMarkdown } from '../documents/markdown';
import { listDocuments } from '../documents/model';
import type { Locale } from '../i18n';
import { mapGraph, refLabel, refOf } from '../map/model';
import { checkProject } from '../story/checks';
import { exportStory } from '../story/export';
import { playAct, playActions, startPlay } from '../story/play';
import { listEntities } from '../story/entities';
import { listLabels } from '../tasks/labels';
import { listBoards } from '../tasks/model';
import { imagesIn } from '../world/assets';
import { tutorialProject } from './project';

/** Plays the story taking the first of `prefer` that is offered (else the only way on) and returns the endings reached. */
function play(data: ProjectData, prefer: string[]): string[] {
  let s = startPlay(data);
  for (let step = 0; step < 200 && s.status === 'running'; step++) {
    const actions = playActions(data, s);
    const action =
      actions.find((a) => prefer.includes(a.label) && (a.kind !== 'option' || a.enabled)) ??
      actions.find((a) => a.kind !== 'option' || a.enabled);
    if (!action) break;
    s = playAct(data, s, action);
  }
  expect(s.status).toBe('ended');
  return s.log.flatMap((e) => (e.kind === 'arrive' && e.nodeKind === 'end' ? [e.title] : []));
}

describe.each<Locale>(['ru', 'en'])('the tutorial project (F7-05), %s', (locale) => {
  const { data, assets } = tutorialProject(locale, '0.7.0', new Date('2026-10-22T10:00:00Z'));
  const files = new Set(assets.map((a) => (a.folder ? `assets/${a.folder}/${a.name}` : `assets/${a.name}`)));

  it('has a story without a single problem the checks can find', () => {
    expect(checkProject(data).map((p) => `${p.severity} ${p.code} ${p.graph ?? ''}/${p.node ?? ''}`)).toEqual([]);
  });

  it('plays to each of its three endings', () => {
    const t = (ru: string, en: string) => (locale === 'ru' ? ru : en);
    const helpBuy = [t('Помочь Веле с сетями', 'Help Vela with the nets')];
    expect(
      play(data, [
        t('Спуститься в кладовую', 'Go down to the storeroom'),
        ...helpBuy,
        t('Вспомнить про компас', 'Remember the compass'),
      ]),
    ).toContain(t('Корабль спасён', 'The ship is saved'));
    expect(play(data, [...helpBuy, t('Ждать рассвета', 'Wait for dawn')])).toContain(t('Долгая ночь', 'A long night'));
    expect(play(data, [t('Уйти ни с чем', 'Leave empty-handed')])).toContain(
      t('Маяк тёмный', 'The lighthouse stays dark'),
    );
  });

  it('links of its documents, tasks and map all lead somewhere; pictures are among its files', () => {
    for (const doc of listDocuments(data)) {
      for (const link of linksIn(doc.body)) {
        if (link.field)
          expect(fieldText(data, link.ref, link.field), `${doc.path}: ${link.ref}.${link.field}`).not.toBeNull();
        else if (link.kind === 'asset') expect(files).toContain(link.ref);
        else expect(linkLabel(data, link.kind, link.ref), `${doc.path}: ${link.kind}:${link.ref}`).not.toBeNull();
      }
      for (const path of imagesIn(doc.body)) expect(files).toContain(path);
    }
    for (const e of listEntities(data)) if (e.image) expect(files).toContain(e.image);
    expect(files).toContain(data.meta.cover);
    for (const n of mapGraph(data)!.nodes) {
      const ref = refOf(n);
      if (ref) expect(refLabel(data, ref)).not.toBeNull();
    }
    const [board] = listBoards(data);
    expect(board.lists.map((l) => l.tasks.length)).toEqual([2, 2, 2]);
    expect(board.trash).toHaveLength(1);
    expect(listLabels(data).map((l) => l.pattern)).toEqual(['stripes', 'dots', 'grid', 'waves']);
  });

  it('documents are written and read back by the Markdown save without a change', () => {
    for (const doc of listDocuments(data)) {
      const parsed = parseMarkdown(doc.body);
      const written = writeMarkdown(parsed);
      expect(written.exact, doc.path).toBe(true);
      expect(canonicalBlocks(parseMarkdown(written.text).content ?? [])).toEqual(canonicalBlocks(parsed.content ?? []));
    }
  });

  it('is saved as ordinary project files and exports for an engine', () => {
    const paths = allFiles(data).map((f) => f.path);
    expect(paths).toEqual(expect.arrayContaining(['project.json', 'data/types.json', 'data/variables.json']));
    expect(paths.filter((p) => p.startsWith('documents/'))).toHaveLength(4);
    const exported = exportStory(data, '0.7.0');
    expect(exported.story.graphs).toHaveLength(4);
    expect(exported.entities.find((e) => e.id === 'tut-suhar')?.fields?.length).toBe(1);
    // The pictures are SVG drawn for the project.
    for (const a of assets) expect(a.text.startsWith('<svg')).toBe(true);
  });
});
