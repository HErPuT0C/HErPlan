// Ready-made property sets (F4-05): fields a character, a location or an item usually needs. Applying a
// preset adds a property set of the project's own (labels in the interface language at that moment) and
// attaches it to a type; after that it is an ordinary set the designer can change.

import { t, type MessageKey } from '../i18n';
import { addSet, attachSet, newField, type FieldKind } from './schema';
import type { ProjectData } from '../core/project/types';

interface PresetField {
  label: MessageKey;
  type: FieldKind;
  /** enum: "a, b, c"; table: column titles the same way. */
  list?: MessageKey;
  /** ref, refList: the type the field points at. */
  target?: string;
}

export interface Preset {
  id: 'character' | 'location' | 'item';
  name: MessageKey;
  fields: PresetField[];
}

export const PRESETS: readonly Preset[] = [
  {
    id: 'character',
    name: 'preset.character',
    fields: [
      { label: 'preset.character.age', type: 'number' },
      { label: 'preset.character.gender', type: 'enum', list: 'preset.character.genders' },
      { label: 'preset.character.role', type: 'enum', list: 'preset.character.roles' },
      { label: 'preset.character.looks', type: 'richtext' },
      { label: 'preset.character.nature', type: 'richtext' },
      { label: 'preset.character.goal', type: 'richtext' },
      { label: 'preset.character.fear', type: 'text' },
      { label: 'preset.character.home', type: 'ref', target: 'location' },
      { label: 'preset.character.color', type: 'color' },
    ],
  },
  {
    id: 'location',
    name: 'preset.location',
    fields: [
      { label: 'preset.location.region', type: 'text' },
      { label: 'preset.location.climate', type: 'enum', list: 'preset.location.climates' },
      { label: 'preset.location.danger', type: 'percent' },
      { label: 'preset.location.population', type: 'number' },
      { label: 'preset.location.mood', type: 'richtext' },
      { label: 'preset.location.near', type: 'refList', target: 'location' },
    ],
  },
  {
    id: 'item',
    name: 'preset.item',
    fields: [
      { label: 'preset.item.price', type: 'number' },
      { label: 'preset.item.rarity', type: 'enum', list: 'preset.item.rarities' },
      { label: 'preset.item.unique', type: 'bool' },
      { label: 'preset.item.stats', type: 'table', list: 'preset.item.statColumns' },
    ],
  },
];

const split = (text: string) =>
  text
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

/** Adds the preset as a property set of the project and attaches it to `typeId`; returns the set id. */
export function applyPreset(d: ProjectData, preset: Preset, typeId: string): string {
  const fields = preset.fields.map((p) => {
    const f = newField(p.type, t(p.label));
    if (p.type === 'enum' && p.list) f.options = split(t(p.list));
    if (p.type === 'table' && p.list) f.columns = split(t(p.list));
    if ((p.type === 'ref' || p.type === 'refList') && p.target) f.target = p.target;
    return f;
  });
  const id = addSet(d, t(preset.name), fields);
  attachSet(d, typeId, id, true);
  return id;
}
