// What links and live fields of documents show (F5-04): names of cards, titles of story nodes and documents,
// current values of fields. Used by the editor, the exports and "where used".

import type { ProjectData } from '../core/project/types';
import { t } from '../i18n';
import { asEntity } from '../story/entities';
import { asStory, graphOf } from '../story/model';
import { effectiveFields, findTag, typesFile } from '../world/schema';
import { coerceValue, valueText } from '../world/values';
import type { LinkKind } from './markdown';
import { asDocument, docName } from './model';

export function linkLabel(data: ProjectData, kind: LinkKind, ref: string): string | null {
  if (kind === 'ent') {
    const e = asEntity(data.entities[ref]);
    return e ? e.name || t('story.untitled') : null;
  }
  if (kind === 'doc') {
    const d = asDocument(data.documents[ref]);
    return d && !d.trashedAt ? docName(d.path) : null;
  }
  const [graph, node] = ref.split('/');
  const n = graphOf(data, graph)?.nodes.find((x) => x.id === node);
  return n ? asStory(n).title || t('story.untitled') : null;
}

export function fieldText(data: ProjectData, entity: string, field: string): string | null {
  const e = asEntity(data.entities[entity]);
  if (!e) return null;
  if (field === 'name') return e.name;
  if (field === 'description') return e.description;
  const schema = typesFile(data);
  const f = effectiveFields(schema, e.type).find((x) => x.field.id === field)?.field;
  if (!f) return null;
  return valueText(f, coerceValue(f, e.values[f.id]), {
    entityName: (id) => asEntity(data.entities[id])?.name ?? null,
    tagName: (id) => findTag(schema, id)?.name ?? null,
    yes: t('var.yes'),
    no: t('var.no'),
  });
}
