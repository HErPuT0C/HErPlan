import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import type { ProjectData } from '../core/project/types';
import type { GraphDoc } from '../canvas/model';
import { addDocument, asDocument, trashDocument } from '../documents/model';
import { sampleProject } from '../story/sample';
import { assetUses, imagesIn, moveAssetRefs, moveInText } from '../world/assets';
import { mapGraph, newMapGraph, refLabel, refNode, refOf } from './model';

describe('project map (F5-01)', () => {
  it('cards of objects show their current names and know when the object is gone', () => {
    let doc = '';
    const data = produce(sampleProject(), (d) => {
      const g = newMapGraph('Карта');
      doc = addDocument(d, '', 'План');
      g.nodes.push(refNode({ kind: 'entity', id: 'ent-mira' }, 0, 0, 'Карточка'));
      g.nodes.push(refNode({ kind: 'document', id: doc }, 300, 0, 'Документ'));
      g.nodes.push(refNode({ kind: 'chapter', id: 'g-ch1' }, 0, 200, 'Глава'));
      d.graphs[g.id] = g as unknown as ProjectData['graphs'][string];
    });
    const map = mapGraph(data)!;
    const refs = map.nodes.map((n) => refOf(n)!);
    expect(refs.map((r) => refLabel(data, r))).toEqual(['Мира', 'План', 'Глава 1. Мельница']);
    const renamed = produce(data, (d) => {
      d.entities['ent-mira'].name = 'Мирослава';
      trashDocument(d, doc);
    });
    expect(refs.map((r) => refLabel(renamed, r))).toEqual(['Мирослава', null, 'Глава 1. Мельница']);
  });

  it('a picture moved in the assets moves in documents and on the map; "where used" finds both', () => {
    let doc = '';
    const data = produce(sampleProject(), (d) => {
      doc = addDocument(
        d,
        '',
        'Карты',
        '# Карты\n\n![мельница](assets/maps/mill.png)\n\n![лес](<assets/maps/лес и река.png>)\n',
      );
      const g = newMapGraph('Карта');
      g.nodes.push(refNode({ kind: 'asset', id: 'assets/maps/mill.png' }, 0, 0, 'Картинка'));
      d.graphs[g.id] = g as unknown as ProjectData['graphs'][string];
    });
    expect(imagesIn(asDocument(data.documents[doc])!.body)).toEqual([
      'assets/maps/mill.png',
      'assets/maps/лес и река.png',
    ]);
    expect(
      assetUses(data, 'assets/maps')
        .map((u) => u.kind)
        .sort(),
    ).toEqual(['document', 'document', 'map']);

    const moved = produce(data, (d) => moveAssetRefs(d, 'assets/maps', 'assets/world maps'));
    expect(asDocument(moved.documents[doc])!.body).toBe(
      '# Карты\n\n![мельница](<assets/world maps/mill.png>)\n\n![лес](<assets/world maps/лес и река.png>)\n',
    );
    const map = mapGraph(moved) as GraphDoc;
    expect(refOf(map.nodes[0])).toEqual({ kind: 'asset', id: 'assets/world maps/mill.png' });
    // Undo steps recorded before the move keep the new paths too (Store.rewriteHistory).
    expect(moveInText('assets/maps/a.png', 'assets/maps', 'assets/m')).toBe('assets/m/a.png');
    expect(moveInText('текст без картинок assets/maps', 'assets/maps', 'assets/m')).toBe(
      'текст без картинок assets/maps',
    );
  });
});
