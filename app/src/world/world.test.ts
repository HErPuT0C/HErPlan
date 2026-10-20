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
  addCatalog,
  addField,
  addSet,
  addTag,
  deleteCatalog,
  deleteTag,
  findTag,
  setSection,
  showsSection,
  updateField,
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
import { assetUseCounts, assetUses, folderColors, movedPath, moveAssetRefs, setFolderColor } from './assets';
import { Store } from '../core/store';
import { exportStory } from '../story/export';

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
      addField(d, { kind: 'type', id: 'character' }, { ...newField('ref', 'Оружие'), id: 'f-weapon', target: weapon });
      deleteType(d, weapon);
      updateType(d, 'character', { parent: sword });
    });
    const schema = typesFile(data);
    const sword = schema.types.find((x) => x.name === 'Меч')!;
    expect(sword.parent).toBe('item');
    expect(listEntities(data, 'item').map((e) => e.name)).toEqual(['Ключ', 'Лук', 'Экскалибур']);
    expect(schema.types[0].parent).toBeNull();
    // A link field aimed at the deleted type now picks from the type that took its entities in.
    expect(schema.types[0].fields.find((f) => f.id === 'f-weapon')?.target).toBe('item');
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

  it('duplicates and copies values of entities saved in an earlier step (drafted values)', () => {
    const base = produce(sampleProject(), (d) => {
      addField(d, { kind: 'type', id: 'character' }, { ...newField('refList', 'Друзья'), id: 'f-friends' });
      addField(d, { kind: 'type', id: 'character' }, { ...newField('table', 'Статы'), id: 'f-stats', columns: ['A'] });
      (d.entities['ent-mira'].values as JsonObject) = { 'f-friends': ['ent-boris'], 'f-stats': { rows: [['1']] } };
    });
    const store = new Store(base);
    let copy: string | null = null;
    store.dispatch('dup', (d) => {
      copy = duplicateEntity(d, 'ent-mira', 'Мира 2');
    });
    store.dispatch('copy', (d) => void copyValues(d, 'ent-mira', 'ent-boris'));
    const data = store.getState();
    expect(asEntity(data.entities[copy!])?.values['f-friends']).toEqual(['ent-boris']);
    expect(asEntity(data.entities['ent-boris'])?.values['f-stats']).toEqual({ rows: [['1']] });
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

describe('asset library (F4-11, F4-12) and export of the database (F4-13)', () => {
  const withPictures = () =>
    produce(sampleProject(), (d) => {
      d.meta.cover = 'assets/cover.png';
      d.entities['ent-mira'].image = 'assets/world/mira.png';
      addField(d, { kind: 'type', id: 'location' }, { ...newField('image', 'Карта'), id: 'f-map' });
      (d.entities['ent-mill'].values as JsonObject) = { 'f-map': 'assets/world/maps/mill.png' };
      const chapter = d.graphs['g-root'] as unknown as { nodes: { id: string; image?: string }[] };
      chapter.nodes.find((n) => n.id === 'r-ch1')!.image = 'assets/chapters/one.png';
      setFolderColor(d, 'assets/world', '#e8b931');
      setFolderColor(d, 'assets/world/maps', '#3fb97a');
    });

  it('finds every use of a file or of anything inside a folder', () => {
    const data = withPictures();
    expect(assetUses(data, 'assets/world').map((u) => u.kind)).toEqual(['entity', 'field']);
    expect(assetUses(data, 'assets/world/mira.png')).toEqual([
      { kind: 'entity', path: 'assets/world/mira.png', entity: 'ent-mira', name: 'Мира' },
    ]);
    expect(assetUses(data, 'assets/chapters/one.png')[0]).toMatchObject({ kind: 'chapter', node: 'r-ch1' });
    expect(assetUseCounts(data).get('assets/cover.png')).toBe(1);
    // "assets/world2" is not inside "assets/world".
    expect(assetUses(data, 'assets/wor')).toEqual([]);
  });

  it('references and folder colours follow a renamed folder', () => {
    const data = produce(withPictures(), (d) => moveAssetRefs(d, 'assets/world', 'assets/мир'));
    expect(asEntity(data.entities['ent-mira'])?.image).toBe('assets/мир/mira.png');
    expect(asEntity(data.entities['ent-mill'])?.values['f-map']).toBe('assets/мир/maps/mill.png');
    expect(data.meta.cover).toBe('assets/cover.png');
    expect(folderColors(data)).toEqual({ 'assets/мир': '#e8b931', 'assets/мир/maps': '#3fb97a' });
    expect(movedPath('assets/worldly.png', 'assets/world', 'assets/мир')).toBe('assets/worldly.png');
  });

  it('a change outside the undo history is not undone', () => {
    const store = new Store(withPictures());
    store.dispatch('edit', (d) => void (d.meta.name = 'Новое'));
    store.dispatch('refs', (d) => moveAssetRefs(d, 'assets/world', 'assets/мир'), { history: false });
    expect(store.undoLabel).toBe('edit');
    store.undo();
    expect(store.getState().meta.name).not.toBe('Новое');
    expect(asEntity(store.getState().entities['ent-mira'])?.image).toBe('assets/мир/mira.png');
  });

  it('after a rename on disk, undo and redo do not bring the old path back', () => {
    const store = new Store(sampleProject());
    store.dispatch('picture', (d) => void (d.entities['ent-mira'].image = 'assets/a.png'));
    store.undo();
    // The file is renamed a.png → b.png on disk.
    store.dispatch('refs', (d) => moveAssetRefs(d, 'assets/a.png', 'assets/b.png'), { history: false });
    store.rewriteHistory((text) => movedPath(text, 'assets/a.png', 'assets/b.png'));
    store.redo();
    expect(asEntity(store.getState().entities['ent-mira'])?.image).toBe('assets/b.png');
  });

  it('the export carries types with their fields, values and relations', () => {
    const data = produce(withPictures(), (d) => {
      addRelation(d, 'ent-boris', 'ent-mira', 'жена', 'муж');
    });
    const out = exportStory(data, '0.3.0');
    const mill = out.entities.find((e) => e.id === 'ent-mill')!;
    expect(mill.values).toEqual({ 'f-map': 'assets/world/maps/mill.png' });
    expect(out.entities.find((e) => e.id === 'ent-boris')!.relations).toMatchObject([
      { to: 'ent-mira', label: 'жена', inverseLabel: 'муж' },
    ]);
    expect(out.schema.types.find((x) => x.id === 'location')).toMatchObject({
      builtIn: true,
      fields: [{ id: 'f-map', label: 'Карта', type: 'image' }],
    });
  });
});

describe('catalogs of tags and card blocks (0.4)', () => {
  it('tags are made once, put on cards of different types, shown with their names; deleting one takes it off', () => {
    let traits = '';
    let agile = '';
    let fieldId = '';
    const data = produce(sampleProject(), (d) => {
      traits = addCatalog(d, 'Черты');
      agile = addTag(d, traits, 'ловкий', 'уклоняется от первой атаки')!;
      expect(addTag(d, traits, 'Ловкий ')).toBe(agile);
      const field = newField('tags', 'Черты');
      fieldId = field.id;
      const set = addSet(d, 'Бой', [field]);
      attachSet(d, 'character', set, true);
      updateField(d, { kind: 'set', id: set }, field.id, { catalog: traits });
      const own = addTag(d, traits, 'самостоятельный')!;
      const mira = d.entities['ent-mira'];
      mira.values = { [field.id]: [agile, own] } as JsonObject;
    });
    const schema = typesFile(data);
    expect(schema.catalogs[0].tags.map((x) => x.name)).toEqual(['ловкий', 'самостоятельный']);
    const field = effectiveFields(schema, 'character').find((f) => f.field.id === fieldId)!.field;
    expect(field).toMatchObject({ type: 'tags', catalog: traits });
    const v = coerceValue(field, data.entities['ent-mira'].values?.[fieldId as never]);
    const ctx = { entityName: () => null, tagName: (id: string) => findTag(schema, id)?.name ?? null, yes: '', no: '' };
    expect(valueText(field, v, ctx)).toBe('ловкий, самостоятельный');

    const out = exportStory(data, '0.4.0');
    expect(out.schema.catalogs[0].name).toBe('Черты');
    expect(out.schema.catalogs[0].tags[0]).toMatchObject({ id: agile, description: 'уклоняется от первой атаки' });

    const without = produce(data, (d) => deleteTag(d, traits, agile));
    expect((without.entities['ent-mira'].values as Record<string, string[]>)[fieldId]).toHaveLength(1);
    const noCatalog = produce(data, (d) => deleteCatalog(d, traits));
    expect(effectiveFields(typesFile(noCatalog), 'character').find((f) => f.field.id === fieldId)!.field.catalog).toBe(
      null,
    );
  });

  it('a type hides card blocks for itself and its subtypes; a subtype can show them again', () => {
    let tag = '';
    let rare = '';
    const data = produce(sampleProject(), (d) => {
      tag = addType(d, 'Тег', null);
      rare = addType(d, 'Редкий тег', tag);
      setSection(d, tag, 'relations', false);
      setSection(d, tag, 'variables', false);
      setSection(d, rare, 'variables', true);
    });
    const schema = typesFile(data);
    expect(showsSection(schema, tag, 'relations')).toBe(false);
    expect(showsSection(schema, rare, 'relations')).toBe(false);
    expect(showsSection(schema, rare, 'variables')).toBe(true);
    expect(showsSection(schema, tag, 'description')).toBe(true);
    expect(showsSection(schema, 'character', 'relations')).toBe(true);
    // A hand-edited file with junk in "card" keeps only what it understands.
    const odd = typesFile({
      types: { types: [{ id: 'x', name: 'X', card: { uses: false, nonsense: 1 } }] } as unknown as JsonObject,
    });
    expect(odd.types.find((x) => x.id === 'x')!.card).toEqual({ uses: false });
  });
});
