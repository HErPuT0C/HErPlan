// Picks what to put into a document (F5-04, 0.5): a link to a card, a story node, another document or a file
// of the assets, found by typing. Then, when the object is in several places (a card in the database, on the
// map, on the story canvas), where the link leads; for a card, its field's value can go in instead of a link.

import type { JsonObject } from '../../core/project/types';
import type { JSONContent } from '@tiptap/core';
import { ArrowLeft, Contact, File as FileIcon, FileText, Workflow } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { searchKey } from '../../canvas/ops';
import { useStore } from '../../core/useStore';
import { fieldText } from '../../documents/lookups';
import type { LinkKind } from '../../documents/markdown';
import { docName, listDocuments } from '../../documents/model';
import { placeKey, placesOf } from '../../documents/places';
import { t, type MessageKey } from '../../i18n';
import { platform } from '../../platform';
import type { OpenProject } from '../../state/project';
import { asEntity, listEntities } from '../../story/entities';
import { graphTitle } from '../../story/flow';
import { allGraphs, asStory } from '../../story/model';
import { cardFields, typesFile } from '../../world/schema';
import { Dialog } from '../components';
import { useAsync } from '../useAsync';
import { typeName } from '../world/typeNames';
import { placeLabel } from './places';

interface Item {
  kind: LinkKind;
  id: string;
  label: string;
  hint: string;
}

const KINDS: { kind: LinkKind; name: MessageKey; icon: ReactNode }[] = [
  { kind: 'ent', name: 'docs.insert.cards', icon: <Contact size={14} aria-hidden="true" /> },
  { kind: 'doc', name: 'docs.insert.docs', icon: <FileText size={14} aria-hidden="true" /> },
  { kind: 'node', name: 'docs.insert.nodes', icon: <Workflow size={14} aria-hidden="true" /> },
  { kind: 'asset', name: 'docs.insert.files', icon: <FileIcon size={14} aria-hidden="true" /> },
];

export function InsertPicker({
  project,
  except,
  onPick,
  onClose,
}: {
  project: OpenProject;
  /** The document being edited: not offered as a link to itself. */
  except: string;
  onPick: (content: JSONContent) => void;
  onClose: () => void;
}) {
  const data = useStore(project.store, (s) => s);
  const files = useAsync(() => platform().listAssets(project.dir), [project.dir], null);
  const [query, setQuery] = useState('');
  const [only, setOnly] = useState<LinkKind | null>(null);
  const [chosen, setChosen] = useState<Item | null>(null);
  const schema = useMemo(() => typesFile(data), [data]);

  const items: Item[] = useMemo(
    () => [
      ...listEntities(data).map((e) => ({
        kind: 'ent' as const,
        id: e.id,
        label: e.name || t('story.untitled'),
        hint: typeName(schema.types.find((x) => x.id === e.type)),
      })),
      ...listDocuments(data)
        .filter((d) => d.id !== except)
        .map((d) => ({ kind: 'doc' as const, id: d.id, label: docName(d.path), hint: d.path })),
      ...allGraphs(data)
        .filter((g) => g.kind === 'story' || g.kind === 'chapter')
        .flatMap((g) =>
          g.nodes
            .filter((n) => n.kind !== 'sticker')
            .map((n) => ({
              kind: 'node' as const,
              id: `${g.id}/${n.id}`,
              label: asStory(n).title || t('story.untitled'),
              hint: graphTitle(data, g.id),
            })),
        ),
      ...(files ?? [])
        .filter((f) => f.kind === 'file')
        .map((f) => ({
          kind: 'asset' as const,
          id: f.path,
          label: f.path.slice(f.path.lastIndexOf('/') + 1),
          hint: f.path.slice('assets/'.length, Math.max(0, f.path.lastIndexOf('/'))),
        })),
    ],
    [data, except, files, schema],
  );

  const q = searchKey(query);
  const shown = items.filter(
    (x) => (!only || x.kind === only) && (!q || searchKey(`${x.label} ${x.hint}`).includes(q)),
  );

  const link = (item: Item, place: string) => {
    onPick({ type: 'objectLink', attrs: { kind: item.kind, ref: item.id, label: item.label, place } });
    onClose();
  };
  const pick = (item: Item) => {
    // A card can also go in as the value of one of its fields; an object in several places asks where to lead.
    if (item.kind === 'ent' || placesOf(data, item.kind, item.id).length > 1) setChosen(item);
    else link(item, '');
  };

  // One dialog for both steps: when it closes, the focus goes back to the text and typing goes on there.
  return (
    <Dialog
      open
      onClose={onClose}
      title={chosen ? t('docs.insert.linkTo', { name: chosen.label }) : t('docs.insert.title')}
    >
      {chosen ? (
        <Second project={project} item={chosen} onBack={() => setChosen(null)} {...{ link, onPick, onClose }} />
      ) : (
        <>
          <input
            className="input node-picker-search"
            autoFocus
            value={query}
            placeholder={t('docs.insert.search')}
            aria-label={t('docs.insert.search')}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && shown[0] && pick(shown[0])}
          />
          <div className="doc-insert-kinds" role="radiogroup" aria-label={t('docs.insert.kinds')}>
            <button type="button" className="chip" role="radio" aria-checked={!only} onClick={() => setOnly(null)}>
              {t('docs.insert.all')}
            </button>
            {KINDS.map((k) => (
              <button
                key={k.kind}
                type="button"
                className="chip"
                role="radio"
                aria-checked={only === k.kind}
                onClick={() => setOnly(k.kind)}
              >
                {k.icon} {t(k.name)}
              </button>
            ))}
          </div>
          <div className="node-picker" role="listbox" aria-label={t('docs.insert.title')}>
            {shown.length === 0 && <p className="muted small">{t('docs.insert.none')}</p>}
            {shown.slice(0, 300).map((item, i) => {
              const kind = KINDS.find((k) => k.kind === item.kind)!;
              return (
                <div key={`${item.kind}:${item.id}`}>
                  {item.kind !== shown[i - 1]?.kind && <div className="node-picker-graph">{t(kind.name)}</div>}
                  <button
                    type="button"
                    role="option"
                    aria-selected="false"
                    className="node-picker-item"
                    onClick={() => pick(item)}
                  >
                    <span>
                      {kind.icon} {item.label}
                    </span>
                    {item.hint && <span className="muted small">{item.hint}</span>}
                  </button>
                </div>
              );
            })}
          </div>
        </>
      )}
    </Dialog>
  );
}

/** The second step: where the link leads, or (for a card) the value of which field goes in. */
function Second({
  project,
  item,
  onBack,
  link,
  onPick,
  onClose,
}: {
  project: OpenProject;
  item: Item;
  onBack: () => void;
  link: (item: Item, place: string) => void;
  onPick: (content: JSONContent) => void;
  onClose: () => void;
}) {
  const data = useStore(project.store, (s) => s);
  const places = placesOf(data, item.kind, item.id);
  const entity = item.kind === 'ent' ? asEntity(data.entities[item.id]) : null;
  const fields = entity
    ? [
        { id: 'name', label: t('world.name') },
        { id: 'description', label: t('world.description') },
        ...cardFields(typesFile(data), entity)
          .filter(({ field }) => field.type !== 'image' && field.type !== 'table')
          .map(({ field }) => ({ id: field.id, label: field.label || t('schema.untitledField') })),
      ]
    : [];
  const value = (field: string) => fieldText(data, item.id, field)?.replace(/\s+/g, ' ').slice(0, 60) ?? '';
  return (
    <>
      <button type="button" className="entity-link doc-insert-back" onClick={onBack}>
        <ArrowLeft size={14} aria-hidden="true" /> {t('docs.insert.back')}
      </button>
      <div className="node-picker" role="listbox" aria-label={t('docs.place.title')}>
        <div className="node-picker-graph">{t('docs.place.title')}</div>
        {places.map((p, i) => (
          <button
            key={placeKey(p)}
            type="button"
            role="option"
            aria-selected="false"
            className="node-picker-item"
            onClick={() => link(item, i === 0 ? '' : placeKey(p))}
          >
            <span>{placeLabel(data, p)}</span>
            {i === 0 && <span className="muted small">{t('docs.place.own')}</span>}
          </button>
        ))}
        {entity && (
          <>
            <div className="node-picker-graph">{t('docs.insert.fieldValue')}</div>
            <p className="muted small doc-insert-note">{t('docs.insert.fieldValueHint')}</p>
            {fields.map((f) => (
              <button
                key={f.id}
                type="button"
                role="option"
                aria-selected="false"
                className="node-picker-item"
                onClick={() => {
                  onPick({ type: 'liveField', attrs: { entity: item.id, field: f.id } as JsonObject });
                  onClose();
                }}
              >
                <span>{f.label}</span>
                <span className="muted small">{value(f.id)}</span>
              </button>
            ))}
          </>
        )}
      </div>
    </>
  );
}
