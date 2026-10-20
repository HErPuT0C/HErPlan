// Picks what to put into a document (F5-04): a link to a card, a live value of a card's field, a link to a
// story node or to another document. Typing filters; for a field, the card comes first, then its field.

import type { JSONContent } from '@tiptap/core';
import { useMemo, useState } from 'react';
import { searchKey } from '../../canvas/ops';
import { useStore } from '../../core/useStore';
import { docName, listDocuments } from '../../documents/model';
import { t } from '../../i18n';
import type { OpenProject } from '../../state/project';
import { listEntities } from '../../story/entities';
import { graphTitle } from '../../story/flow';
import { allGraphs, asStory } from '../../story/model';
import { effectiveFields, typesFile } from '../../world/schema';
import { Dialog } from '../components';
import { typeName } from '../world/typeNames';

export type InsertKind = 'entity' | 'field' | 'node' | 'doc';

interface Item {
  id: string;
  label: string;
  hint: string;
  group?: string;
}

export function InsertPicker({
  project,
  kind,
  onPick,
  onClose,
}: {
  project: OpenProject;
  kind: InsertKind;
  onPick: (content: JSONContent) => void;
  onClose: () => void;
}) {
  const data = useStore(project.store, (s) => s);
  const [query, setQuery] = useState('');
  const [entity, setEntity] = useState<string | null>(null);
  const schema = useMemo(() => typesFile(data), [data]);

  const items: Item[] = useMemo(() => {
    if (kind === 'doc') {
      return listDocuments(data).map((d) => ({ id: d.id, label: docName(d.path), hint: d.path }));
    }
    if (kind === 'node') {
      return allGraphs(data)
        .filter((g) => g.kind === 'story' || g.kind === 'chapter')
        .flatMap((g) =>
          g.nodes
            .filter((n) => n.kind !== 'sticker')
            .map((n) => ({
              id: `${g.id}/${n.id}`,
              label: asStory(n).title || t('story.untitled'),
              hint: t(`story.kind.${n.kind}` as never),
              group: graphTitle(data, g.id),
            })),
        );
    }
    if (kind === 'field' && entity) {
      const e = listEntities(data).find((x) => x.id === entity);
      return [
        { id: 'name', label: t('world.name'), hint: '' },
        { id: 'description', label: t('world.description'), hint: '' },
        ...effectiveFields(schema, e?.type ?? '')
          .filter(({ field }) => field.type !== 'image' && field.type !== 'table')
          .map(({ field }) => ({ id: field.id, label: field.label || t('schema.untitledField'), hint: '' })),
      ];
    }
    return listEntities(data).map((e) => ({
      id: e.id,
      label: e.name || t('story.untitled'),
      hint: typeName(schema.types.find((x) => x.id === e.type)),
    }));
  }, [kind, data, entity, schema]);

  const q = searchKey(query);
  const shown = items.filter((x) => !q || searchKey(`${x.label} ${x.hint} ${x.group ?? ''}`).includes(q));

  const pick = (item: Item) => {
    if (kind === 'field' && !entity) {
      setEntity(item.id);
      setQuery('');
      return;
    }
    if (kind === 'field') onPick({ type: 'liveField', attrs: { entity, field: item.id } });
    else {
      const linkKind = kind === 'entity' ? 'ent' : kind;
      onPick({ type: 'objectLink', attrs: { kind: linkKind, ref: item.id, label: item.label } });
    }
    onClose();
  };

  const title =
    kind === 'field' && entity
      ? t('docs.insert.whichField')
      : t(
          kind === 'entity'
            ? 'docs.insert.entity'
            : kind === 'field'
              ? 'docs.insert.field'
              : kind === 'node'
                ? 'docs.insert.node'
                : 'docs.insert.doc',
        );
  return (
    <Dialog open onClose={onClose} title={title}>
      <input
        className="input node-picker-search"
        autoFocus
        value={query}
        placeholder={t('docs.insert.search')}
        aria-label={t('docs.insert.search')}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && shown[0] && pick(shown[0])}
      />
      <div className="node-picker" role="listbox" aria-label={title}>
        {shown.length === 0 && <p className="muted small">{t('docs.insert.none')}</p>}
        {shown.map((item, i) => {
          const header = item.group !== undefined && item.group !== shown[i - 1]?.group;
          return (
            <div key={item.id}>
              {header && <div className="node-picker-graph">{item.group}</div>}
              <button
                type="button"
                role="option"
                aria-selected="false"
                className="node-picker-item"
                onClick={() => pick(item)}
              >
                <span>{item.label}</span>
                {item.hint && <span className="muted small">{item.hint}</span>}
              </button>
            </div>
          );
        })}
      </div>
    </Dialog>
  );
}
