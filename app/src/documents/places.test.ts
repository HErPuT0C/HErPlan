import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import type { ProjectData } from '../core/project/types';
import { newMapGraph, refNode } from '../map/model';
import { sampleProject } from '../story/sample';
import { assetUses, fileLinksIn, moveAssetRefs, moveInText } from '../world/assets';
import { attachmentContent } from '../ui/documents/attachments';
import { linksIn } from './links';
import { linkLabel } from './lookups';
import { canonicalBlocks, parseMarkdown, writeMarkdown } from './markdown';
import { addDocument, asDocument } from './model';
import { linkTarget, ownPlace, parsePlace, placeKey, placesOf } from './places';

describe('where links lead (0.5)', () => {
  it('lists every place of a card: the database, story nodes, the map, its picture', () => {
    let node = '';
    const data = produce(sampleProject(), (d) => {
      d.entities['ent-mira'].image = 'assets/world/mira.png';
      const g = newMapGraph('Карта');
      const n = refNode({ kind: 'entity', id: 'ent-mira' }, 0, 0, 'Карточка');
      node = n.id;
      g.nodes.push(n);
      d.graphs[g.id] = g as unknown as ProjectData['graphs'][string];
    });
    const places = placesOf(data, 'ent', 'ent-mira').map(placeKey);
    expect(places[0]).toBe('card:ent-mira');
    expect(places).toContain('story:g-ch1/a-who');
    expect(places).toContain(`map:${node}`);
    expect(places.at(-1)).toBe('assets:assets/world/mira.png');
    // A chosen place leads there while it exists; otherwise the card opens.
    expect(linkTarget(data, 'ent', 'ent-mira', `map:${node}`)).toEqual({ view: 'map', id: node });
    expect(linkTarget(data, 'ent', 'ent-mira', 'map:gone')).toEqual(ownPlace('ent', 'ent-mira'));
    expect(linkTarget(data, 'ent', 'ent-mira', 'nonsense')).toEqual(ownPlace('ent', 'ent-mira'));
    expect(parsePlace('story:g/n')).toEqual({ view: 'story', id: 'g/n' });
  });

  it('a file is in the assets, on cards and in documents; it is called by its name', () => {
    const data = produce(sampleProject(), (d) => {
      d.entities['ent-boris'].image = 'assets/a.png';
      addDocument(d, '', 'План', '![](assets/a.png)\n');
    });
    expect(placesOf(data, 'asset', 'assets/a.png').map((p) => p.view)).toEqual(['assets', 'card', 'doc']);
    expect(linkLabel(data, 'asset', 'assets/карты/лес.png')).toBe('лес.png');
  });

  it('a link with its place and a link to a file with spaces and brackets are written and read back', () => {
    const p = (...content: object[]) => ({ type: 'paragraph', content });
    const blocks = [
      p({ type: 'objectLink', attrs: { kind: 'ent', ref: 'ent-mira', label: 'Мира', place: 'story:g-ch1/a-who' } }),
      // "]" cannot be in a link written as [[…]]: that paragraph is written as HTML by the self-check.
      p({ type: 'objectLink', attrs: { kind: 'asset', ref: 'assets/лес и река [2].png', label: 'x', place: '' } }),
    ];
    const out = writeMarkdown({ type: 'doc', content: blocks });
    expect(out.exact).toBe(true);
    expect(out.text).toContain('[[ent:ent-mira|Мира|story:g-ch1/a-who]]');
    expect(out.text).toContain('<span data-link="asset:assets/лес и река [2].png">');
    expect(canonicalBlocks(parseMarkdown(out.text).content ?? [])).toEqual(canonicalBlocks(blocks));
    expect(linksIn(out.text)).toEqual(
      expect.arrayContaining([
        { kind: 'ent', ref: 'ent-mira', place: 'story:g-ch1/a-who' },
        { kind: 'asset', ref: 'assets/лес и река [2].png' },
      ]),
    );
  });

  it('links to files are uses of them and follow them when they move, with the places of links', () => {
    let doc = '';
    const data = produce(sampleProject(), (d) => {
      doc = addDocument(
        d,
        '',
        'План',
        '[[asset:assets/maps/a.txt|a.txt]] и [[ent:ent-mira|Мира|assets:assets/maps/m.png]] и <span data-link="asset:assets/maps/b &amp; c.txt">b</span>\n',
      );
    });
    expect(fileLinksIn(asDocument(data.documents[doc])!.body).sort()).toEqual([
      'assets/maps/a.txt',
      'assets/maps/b & c.txt',
      'assets/maps/m.png',
    ]);
    expect(assetUses(data, 'assets/maps').length).toBe(3);
    const moved = produce(data, (d) => moveAssetRefs(d, 'assets/maps', 'assets/карты'));
    expect(asDocument(moved.documents[doc])!.body).toBe(
      '[[asset:assets/карты/a.txt|a.txt]] и [[ent:ent-mira|Мира|assets:assets/карты/m.png]] и <span data-link="asset:assets/карты/b &amp; c.txt">b</span>\n',
    );
    expect(moveInText('[[asset:assets/other.txt|x]]', 'assets/maps', 'assets/m')).toBe('[[asset:assets/other.txt|x]]');
  });

  it('dropped files go in as pictures, other files as links to them', () => {
    expect(
      attachmentContent(['assets/Вложения/карта.png', 'assets/Вложения/заметки.txt', 'assets/Вложения/b.pdf']),
    ).toEqual([
      { type: 'image', attrs: { src: 'assets/Вложения/карта.png', alt: 'карта' } },
      {
        type: 'paragraph',
        content: [
          {
            type: 'objectLink',
            attrs: { kind: 'asset', ref: 'assets/Вложения/заметки.txt', label: 'заметки.txt', place: '' },
          },
          { type: 'text', text: ', ' },
          { type: 'objectLink', attrs: { kind: 'asset', ref: 'assets/Вложения/b.pdf', label: 'b.pdf', place: '' } },
        ],
      },
    ]);
  });
});
