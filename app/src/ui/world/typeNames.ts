import { t, type MessageKey } from '../../i18n';
import type { WorldKind } from '../../story/model';
import { isBuiltIn, type EntityType, type FieldKind } from '../../world/schema';

const BUILT_IN: Record<WorldKind, MessageKey> = {
  character: 'world.type.character',
  location: 'world.type.location',
  item: 'world.type.item',
};

/** A type's name: its own, or for a built-in type that kept none, the name in the interface language. */
export function typeName(type: EntityType | undefined): string {
  if (!type) return t('world.type.unknown');
  return type.name || (isBuiltIn(type.id) ? t(BUILT_IN[type.id]) : t('story.untitled'));
}

export const FIELD_KIND_NAMES: Record<FieldKind, MessageKey> = {
  text: 'schema.kind.text',
  richtext: 'schema.kind.richtext',
  number: 'schema.kind.number',
  percent: 'schema.kind.percent',
  bool: 'schema.kind.bool',
  enum: 'schema.kind.enum',
  ref: 'schema.kind.ref',
  refList: 'schema.kind.refList',
  image: 'schema.kind.image',
  color: 'schema.kind.color',
  table: 'schema.kind.table',
};
