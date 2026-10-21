import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import type { JsonObject } from '../core/project/types';
import { fieldText } from '../documents/lookups';
import { exportStory } from '../story/export';
import { asEntity } from '../story/entities';
import { sampleProject } from '../story/sample';
import { assetUses, moveAssetRefs } from './assets';
import { copyValues, entityUses } from './entityOps';
import {
  addCatalog,
  addField,
  cardFields,
  cardShows,
  deleteCatalog,
  effectiveFields,
  filledCount,
  hideField,
  newField,
  ownFields,
  promoteField,
  removeField,
  setCardSection,
  setSection,
  typesFile,
  updateField,
} from './schema';

const mira = (d: { entities: Record<string, JsonObject> }) => asEntity(d.entities['ent-mira'])!;
const labels = (data: ReturnType<typeof sampleProject>, id: string) =>
  cardFields(typesFile(data), asEntity(data.entities[id])!).map((f) => f.field.label);

describe('fields and blocks set up from the card (0.5)', () => {
  it('a field of one card only: the others do not get it; its value is read, exported and deleted with it', () => {
    const own = newField('text', 'Прозвище');
    const data = produce(sampleProject(), (d) => {
      addField(d, { kind: 'entity', id: 'ent-mira' }, own);
      d.entities['ent-mira'].values = { [own.id]: 'Травка' };
    });
    expect(labels(data, 'ent-mira')).toEqual(['Прозвище']);
    expect(labels(data, 'ent-boris')).toEqual([]);
    expect(cardFields(typesFile(data), mira(data))[0].from).toEqual({ kind: 'entity', id: 'ent-mira' });
    expect(fieldText(data, 'ent-mira', own.id)).toBe('Травка');
    const exported = exportStory(data, '0.5.0').entities.find((e) => e.id === 'ent-mira')!;
    expect(exported.values[own.id]).toBe('Травка');
    expect(exported.fields?.map((f) => f.label)).toEqual(['Прозвище']);

    const renamed = produce(data, (d) =>
      updateField(d, { kind: 'entity', id: 'ent-mira' }, own.id, { label: 'Кличка' }),
    );
    expect(labels(renamed, 'ent-mira')).toEqual(['Кличка']);
    const gone = produce(data, (d) => removeField(d, { kind: 'entity', id: 'ent-mira' }, own.id));
    expect(ownFields(mira(gone))).toEqual([]);
    expect(gone.entities['ent-mira'].fields).toBeUndefined();
    expect(mira(gone).values[own.id]).toBeUndefined();
  });

  it('a field of the type taken off one card stays on the others and comes back with its value', () => {
    const hp = newField('number', 'Здоровье');
    const data = produce(sampleProject(), (d) => {
      addField(d, { kind: 'type', id: 'character' }, hp);
      d.entities['ent-mira'].values = { [hp.id]: 120 };
      hideField(d, 'ent-mira', hp.id, true);
    });
    expect(labels(data, 'ent-mira')).toEqual([]);
    expect(labels(data, 'ent-boris')).toEqual(['Здоровье']);
    expect(exportStory(data, '0.5.0').entities.find((e) => e.id === 'ent-mira')!.hiddenFields).toEqual([hp.id]);
    expect(filledCount(data, hp.id)).toBe(1);
    const back = produce(data, (d) => hideField(d, 'ent-mira', hp.id, false));
    expect(labels(back, 'ent-mira')).toEqual(['Здоровье']);
    expect(mira(back).values[hp.id]).toBe(120);
    expect(back.entities['ent-mira'].hiddenFields).toBeUndefined();
  });

  it("a card's own field given to the whole type keeps its value; references in own fields are uses", () => {
    const friend = { ...newField('ref', 'Друг'), target: null };
    const data = produce(sampleProject(), (d) => {
      addField(d, { kind: 'entity', id: 'ent-mira' }, friend);
      d.entities['ent-mira'].values = { [friend.id]: 'ent-boris' };
    });
    expect(entityUses(data, 'ent-boris')).toContainEqual(
      expect.objectContaining({ kind: 'field', entity: 'ent-mira', field: 'Друг' }),
    );
    const shared = produce(data, (d) => promoteField(d, 'ent-mira', friend.id, 'character'));
    expect(ownFields(mira(shared))).toEqual([]);
    expect(effectiveFields(typesFile(shared), 'character').map((f) => f.field.label)).toEqual(['Друг']);
    expect(labels(shared, 'ent-boris')).toEqual(['Друг']);
    expect(mira(shared).values[friend.id]).toBe('ent-boris');
    // Values are copied between cards by the fields both have, own fields included.
    const copied = produce(shared, (d) => void copyValues(d, 'ent-mira', 'ent-boris'));
    expect(asEntity(copied.entities['ent-boris'])!.values[friend.id]).toBe('ent-boris');
  });

  it('a card shows or hides a block unlike its type, or as its type says', () => {
    const data = produce(sampleProject(), (d) => {
      setSection(d, 'character', 'relations', false);
      setCardSection(d, 'ent-mira', 'relations', true);
      setCardSection(d, 'ent-mira', 'uses', false);
    });
    const schema = typesFile(data);
    expect(cardShows(schema, mira(data), 'relations')).toBe(true);
    expect(cardShows(schema, asEntity(data.entities['ent-boris'])!, 'relations')).toBe(false);
    expect(cardShows(schema, mira(data), 'uses')).toBe(false);
    const reset = produce(data, (d) => {
      setCardSection(d, 'ent-mira', 'relations', null);
      setCardSection(d, 'ent-mira', 'uses', null);
    });
    expect(cardShows(typesFile(reset), mira(reset), 'relations')).toBe(false);
    expect(reset.entities['ent-mira'].card).toBeUndefined();
  });

  it('pictures in own fields are uses of the file and follow it when it moves; a deleted catalog is let go', () => {
    const picture = newField('image', 'Портрет');
    let catalog = '';
    const tags = newField('tags', 'Черты');
    const data = produce(sampleProject(), (d) => {
      catalog = addCatalog(d, 'Черты');
      tags.catalog = catalog;
      addField(d, { kind: 'entity', id: 'ent-mira' }, picture);
      addField(d, { kind: 'entity', id: 'ent-mira' }, tags);
      d.entities['ent-mira'].values = { [picture.id]: 'assets/world/mira.png' };
    });
    expect(assetUses(data, 'assets/world').map((u) => u.kind)).toEqual(['field']);
    const moved = produce(data, (d) => moveAssetRefs(d, 'assets/world', 'assets/people'));
    expect(mira(moved).values[picture.id]).toBe('assets/people/mira.png');
    const without = produce(data, (d) => deleteCatalog(d, catalog));
    expect(ownFields(mira(without)).find((f) => f.id === tags.id)?.catalog).toBeNull();
  });
});
