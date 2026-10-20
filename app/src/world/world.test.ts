import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import type { JsonObject, ProjectData } from '../core/project/types';
import { asEntity, listEntities, newEntity } from '../story/entities';
import { sampleProject } from '../story/sample';
import {
  addRelation,
  copyValues,
  deleteEntity,
  duplicateEntity,
  editRelation,
  entityUses,
  relationsOf,
  reorderEntities,
} from './entityOps';
import { applyPreset, PRESETS } from './presets';
import {
  addField,
  addSet,
  addType,
  attachSet,
  canSetParent,
  deleteType,
  effectiveFields,
  inverseLabel,
  isA,
  newField,
  parsePairs,
  rememberPair,
  removeField,
  rootKind,
  typesFile,
  updateType,
} from './schema';
import { coerceValue, compareValues, valueText } from './values';

const put = (d: ProjectData, type: string, name: string): string => {
  const e = newEntity(d, type, name);
  d.entities[e.id] = e as unknown as JsonObject;
  return e.id;
};

describe('world schema (F4-01…F4-03)', () => {
  it('built-in types always exist; hand-edited files are repaired', () => {
    expect(typesFile({ types: {} }).types.map((x) => x.id)).toEqual(['character', 'location', 'item']);
    const broken = typesFile({
      types: {
        types: [
          { id: 'a', name: 'A', parent: 'b' },
          { id: 'b', name: 'B', parent: 'a' },
          { id: 'c', name: 'C', parent: 'nowhere', fields: [{ id: 'f', label: 'F', type: 'weird' }] },
          { id: 'character', name: 'Герой', parent: 'a' },
        ],
      } as unknown as JsonObject,
    });
    expect(broken.types.map((x) => [x.id, x.parent])).toEqual([
      ['character', null],
      ['location', null],
      ['item', null],
      ['a', null],
      ['b', 'a'],
      ['c', null],
    ]);
    expect(broken.types[0].name).toBe('Герой');
    expect(broken.types[5].fields[0].type).toBe('text');
  });

  it('a subtype inherits fields and property sets; a set changed once changes everywhere', () => {
    const data = produce(sampleProject(), (d) => {
      const age = newField('number', 'Возраст');
      age.id = 'f-age';
      addField(d, { kind: 'type', id: 'character' }, age);
      const combat = addSet(d, 'Бой', [{ ...newField('number', 'Здоровье'), id: 'f-hp' }]);
      const knight = addType(d, 'Рыцарь', 'character');
      attachSet(d, knight, combat, true);
      attachSet(d, 'item', combat, true);
      // A field added to the set appears in every type that has it.
      addField(d, { kind: 'set', id: combat }, { ...newField('number', 'Броня'), id: 'f-armor' });
      d.meta.name = knight;
    });
    const schema = typesFile(data);
    const knight = data.meta.name;
    expect(effectiveFields(schema, knight).map((f) => f.field.id)).toEqual(['f-age', 'f-hp', 'f-armor']);
    expect(effectiveFields(schema, 'item').map((f) => f.field.id)).toEqual(['f-hp', 'f-armor']);
    expect(isA(schema, knight, 'character')).toBe(true);
    expect(rootKind(schema, knight)).toBe('character');
    expect(canSetParent(schema, 'character', knight)).toBe(false);
  });

  it('removing a field keeps the values in entity files; undo brings the field back with them', () => {
    const base = produce(sampleProject(), (d) => {
      addField(d, { kind: 'type', id: 'character' }, { ...newField('text', 'Прозвище'), id: 'f-nick' });
      (d.entities['ent-mira'].values as JsonObject) = { 'f-nick': 'Травница' };
    });
    const removed = produce(base, (d) => removeField(d, { kind: 'type', id: 'character' }, 'f-nick'));
    expect(effectiveFields(typesFile(removed), 'character')).toEqual([]);
    expect(asEntity(removed.entities['ent-mira'])?.values['f-nick']).toBe('Травница');
  });

  it('deleting a type moves its entities and subtypes up', () => {
    const data = produce(sampleProject(), (d) => {
      const weapon = addType(d, 'Оружие', 'item');
      const sword = addType(d, 'Меч', weapon);
      put(d, weapon, 'Лук');
      put(d, sword, 'Экскалибур');
      deleteType(d, weapon);
      updateType(d, 'character', { parent: sword });
    });
    const schema = typesFile(data);
    const sword = schema.types.find((x) => x.name === 'Меч')!;
    expect(sword.parent).toBe('item');
    expect(listEntities(data, 'item').map((e) => e.name)).toEqual(['Ключ', 'Лук', 'Экскалибур']);
    expect(schema.types[0].parent).toBeNull();
  });

  it('dialogue speakers include characters of subtypes', () => {
    const data = produce(sampleProject(), (d) => {
      const knight = addType(d, 'Рыцарь', 'character');
      put(d, knight, 'Сэр Ланс');
    });
    expect(listEntities(data, 'character').map((e) => e.name)).toEqual(['Мира', 'Борис', 'Сэр Ланс']);
    // Without the schema only the exact type counts (old callers).
    expect(listEntities({ entities: data.entities }, 'character').map((e) => e.name)).toEqual(['Мира', 'Борис']);
  });

  it('presets add a property set with labels and choices in the interface language', () => {
    const data = produce(sampleProject(), (d) => {
      applyPreset(d, PRESETS[0], 'character');
    });
    const fields = effectiveFields(typesFile(data), 'character').map((f) => f.field);
    expect(fields.length).toBe(PRESETS[0].fields.length);
    expect(fields.find((f) => f.type === 'enum')?.options?.length).toBeGreaterThan(1);
    expect(fields.find((f) => f.type === 'ref')?.target).toBe('location');
  });
});

describe('relations seen from both sides (F4-06)', () => {
  it('one relation, a label for each side, edited from either side', () => {
    let rel = '';
    const data = produce(sampleProject(), (d) => {
      rel = addRelation(d, 'ent-boris', 'ent-mira', 'жена', 'муж')!;
    });
    expect(relationsOf(data, 'ent-boris').map((r) => [r.other, r.label])).toEqual([['ent-mira', 'жена']]);
    expect(relationsOf(data, 'ent-mira').map((r) => [r.other, r.label, r.outgoing])).toEqual([
      ['ent-boris', 'муж', false],
    ]);
    const edited = produce(data, (d) =>
      editRelation(d, { owner: 'ent-boris', outgoing: false, id: rel }, { label: 'супруг' }),
    );
    expect(relationsOf(edited, 'ent-mira')[0].label).toBe('супруг');
    expect(relationsOf(edited, 'ent-boris')[0].inverse).toBe('супруг');
    const gone = produce(edited, (d) => deleteEntity(d, 'ent-mira'));
    expect(relationsOf(gone, 'ent-boris')).toEqual([]);
  });

  it('label pairs: the project remembers its own, defaults fill in the rest', () => {
    const defaults = parsePairs('жена:муж, муж:жена, наставник:ученик');
    const data = produce(sampleProject(), (d) => rememberPair(d, 'сюзерен', 'вассал'));
    const schema = typesFile(data);
    expect(inverseLabel(schema, defaults, 'Жена')).toBe('муж');
    expect(inverseLabel(schema, defaults, 'вассал')).toBe('сюзерен');
    expect(inverseLabel(schema, defaults, 'сосед')).toBeNull();
  });
});

describe('entity cards (F4-04, F4-08, F4-09)', () => {
  it('a duplicate sits right after the original; values can be copied between entities', () => {
    let copy = '';
    const data = produce(sampleProject(), (d) => {
      addField(d, { kind: 'type', id: 'character' }, { ...newField('number', 'Сила'), id: 'f-str' });
      (d.entities['ent-mira'].values as JsonObject) = { 'f-str': 7 };
      addRelation(d, 'ent-mira', 'ent-mill', 'живёт в', 'дом для');
      copy = duplicateEntity(d, 'ent-mira', 'Мира (копия)')!;
      copyValues(d, 'ent-mira', 'ent-boris');
    });
    expect(listEntities(data, 'character').map((e) => e.name)).toEqual(['Мира', 'Мира (копия)', 'Борис']);
    expect(asEntity(data.entities[copy])?.values).toEqual({ 'f-str': 7 });
    expect(
      relationsOf(data, 'ent-mill')
        .map((r) => r.other)
        .sort(),
    ).toEqual([copy, 'ent-mira'].sort());
    expect(asEntity(data.entities['ent-boris'])?.values).toEqual({ 'f-str': 7 });
    const reordered = produce(data, (d) => reorderEntities(d, ['ent-boris', 'ent-mira', copy]));
    expect(listEntities(reordered, 'character').map((e) => e.name)).toEqual(['Борис', 'Мира', 'Мира (копия)']);
  });

  it('knows where an entity is used: nodes, speakers, variables, fields of others', () => {
    const data = produce(sampleProject(), (d) => {
      addField(d, { kind: 'type', id: 'location' }, { ...newField('ref', 'Хозяйка'), id: 'f-owner' });
      (d.entities['ent-mill'].values as JsonObject) = { 'f-owner': 'ent-mira' };
      const companion = (d.variables as { variables: { id: string; initial: unknown }[] }).variables.find(
        (v) => v.id === 'v-companion',
      )!;
      companion.initial = 'ent-boris';
    });
    const kinds = entityUses(data, 'ent-mira').map((u) => u.kind);
    expect(kinds).toEqual(expect.arrayContaining(['node', 'speaker', 'variable', 'field']));
    expect(entityUses(data, 'ent-boris').map((u) => u.kind)).toEqual(expect.arrayContaining(['speaker', 'value']));
  });

  it('0.2 entity files open unchanged', () => {
    const old = { id: 'x', type: 'location', name: 'Мельница', description: 'У реки', image: null, order: 10 };
    expect(asEntity(old)).toEqual({ ...old, values: {}, relations: [] });
  });
});

describe('field values (F4-02)', () => {
  const ctx = { entityName: (id: string) => (id === 'e' ? 'Мира' : null), yes: 'да', no: 'нет' };
  it('reads tolerantly, shows and sorts', () => {
    const pct = newField('percent', 'Опасность');
    expect(coerceValue(pct, 140)).toBe(100);
    expect(coerceValue(newField('color', 'Цвет'), '#ABCDEF')).toBe('#abcdef');
    expect(coerceValue(newField('color', 'Цвет'), 'red')).toBeNull();
    const table = { ...newField('table', 'Статы'), columns: ['A', 'B'] };
    expect(coerceValue(table, { rows: [['1'], ['2', '3', '4']] })).toEqual({
      rows: [
        ['1', ''],
        ['2', '3'],
      ],
    });
    const list = newField('refList', 'Связи');
    expect(valueText(list, ['e', 'gone'], ctx)).toBe('Мира');
    const num = newField('number', 'Возраст');
    expect([3, null, 1].sort((a, b) => compareValues(num, a, b, ctx))).toEqual([1, 3, null]);
  });
});
