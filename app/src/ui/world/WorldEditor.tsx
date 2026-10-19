import { ImagePlus, MapPin, Package, Plus, Trash, UserRound, X } from 'lucide-react';
import { useState } from 'react';
import type { ProjectData } from '../../core/project/types';
import { useStore } from '../../core/useStore';
import { t, type MessageKey } from '../../i18n';
import { platform } from '../../platform';
import type { OpenProject } from '../../state/project';
import { listEntities, newEntity, type WorldEntity } from '../../story/entities';
import { allGraphs, asStory, type WorldKind } from '../../story/model';
import { renameEverywhere } from '../../story/usage';
import { fullName, listVariables } from '../../story/variables';
import { Button, IconButton, toast } from '../components';
import { errorText } from '../errors';
import { IMAGE_FILTERS } from '../start/filters';
import { useAsync } from '../useAsync';
import './world.css';

const SECTIONS: { kind: WorldKind; title: MessageKey; add: MessageKey; icon: typeof UserRound }[] = [
  { kind: 'character', title: 'world.characters', add: 'world.addCharacter', icon: UserRound },
  { kind: 'location', title: 'world.locations', add: 'world.addLocation', icon: MapPin },
  { kind: 'item', title: 'world.items', add: 'world.addItem', icon: Package },
];

/** How many story nodes and dialogue lines refer to an entity: shown before deleting it. */
function usesOf(data: ProjectData, id: string): number {
  let count = 0;
  for (const g of allGraphs(data)) {
    for (const raw of g.nodes) {
      const n = asStory(raw);
      if (n.ref === id) count++;
      count += (n.lines ?? []).filter((l) => l.speaker === id).length;
    }
  }
  return count + listVariables(data).filter((v) => v.owner?.id === id).length;
}

/**
 * The world of the story (F3-01): characters, locations and items with a picture and a description, for
 * dialogue speakers and reference nodes. The full database with types, fields and relations comes in 0.3.
 */
export function WorldEditor({ project }: { project: OpenProject }) {
  const entities = useStore(project.store, (s) => s.entities);
  return (
    <div className="world">
      <p className="muted small world-note">{t('world.note')}</p>
      <div className="world-columns">
        {SECTIONS.map((section) => (
          <WorldSection
            key={section.kind}
            project={project}
            section={section}
            list={listEntities({ entities }, section.kind)}
          />
        ))}
      </div>
    </div>
  );
}

function WorldSection({
  project,
  section,
  list,
}: {
  project: OpenProject;
  section: (typeof SECTIONS)[number];
  list: WorldEntity[];
}) {
  const { store, readOnly } = project;
  const Icon = section.icon;
  const add = () => {
    const entity = newEntity(store.getState(), section.kind, t('world.newName'));
    store.dispatch(t('world.step.add'), (d) => {
      d.entities[entity.id] = entity;
    });
    requestAnimationFrame(() =>
      document.querySelector<HTMLInputElement>(`[data-entity="${entity.id}"] input`)?.select(),
    );
  };
  return (
    <section className="world-section" aria-label={t(section.title)}>
      <header className="world-head">
        <Icon size={16} aria-hidden="true" />
        <h2>{t(section.title)}</h2>
        <span className="muted">{list.length}</span>
        {!readOnly && (
          <Button size="sm" variant="ghost" icon={<Plus size={14} />} onClick={add}>
            {t(section.add)}
          </Button>
        )}
      </header>
      {list.length === 0 && <p className="muted small">{t('world.empty')}</p>}
      {list.map((e) => (
        <EntityCard key={e.id} project={project} entity={e} />
      ))}
    </section>
  );
}

function EntityCard({ project, entity }: { project: OpenProject; entity: WorldEntity }) {
  const { store, readOnly, dir } = project;
  const url = useAsync(
    () => (entity.image ? platform().assetUrl(dir, entity.image) : Promise.resolve('')),
    [dir, entity.image],
    '',
  );
  const [name, setName] = useState(entity.name);
  const change = (patch: Partial<WorldEntity>, merge: string) =>
    store.dispatch(
      t('world.step.edit'),
      (d) => {
        const e = d.entities[entity.id];
        if (!e) return;
        if (patch.name !== undefined && patch.name !== e.name) {
          // Variables of this entity are written "Name.variable": keep expressions in step with the name.
          for (const v of listVariables(d).filter((x) => x.owner?.id === entity.id)) {
            const before = fullName(v, d);
            const after = fullName(v, { ...d, entities: { ...d.entities, [entity.id]: { ...e, name: patch.name } } });
            renameEverywhere(d, before, after, v);
          }
        }
        Object.assign(e, patch);
      },
      { mergeKey: `entity:${entity.id}:${merge}` },
    );
  const pickImage = async () => {
    const source = await platform().pickFile(t('world.pickImage'), IMAGE_FILTERS);
    if (!source) return;
    try {
      const path = await platform().importFile(dir, source, 'assets/world');
      change({ image: path }, 'image');
    } catch (e) {
      toast({ kind: 'error', text: errorText(e) });
    }
  };
  const remove = () => {
    const uses = usesOf(store.getState(), entity.id);
    if (uses && !window.confirm(t('world.deleteUsed', { name: entity.name, count: uses }))) return;
    store.dispatch(t('world.step.delete'), (d) => {
      delete d.entities[entity.id];
    });
  };
  return (
    <article className="entity" data-entity={entity.id}>
      <button
        type="button"
        className="entity-image"
        disabled={readOnly}
        aria-label={t('world.pickImage')}
        title={t('world.pickImage')}
        onClick={() => void pickImage()}
      >
        {url ? <img src={url} alt="" draggable={false} /> : <ImagePlus size={20} aria-hidden="true" />}
      </button>
      <div className="entity-body">
        <input
          className="input entity-name"
          value={name}
          disabled={readOnly}
          aria-label={t('world.name')}
          onChange={(e) => {
            setName(e.target.value);
            if (e.target.value.trim()) change({ name: e.target.value.trim() }, 'name');
          }}
        />
        <textarea
          className="input entity-description"
          value={entity.description}
          rows={2}
          disabled={readOnly}
          placeholder={t('world.description')}
          aria-label={t('world.description')}
          onChange={(e) => change({ description: e.target.value }, 'description')}
        />
      </div>
      {!readOnly && (
        <div className="entity-tools">
          {entity.image && (
            <IconButton
              size="sm"
              label={t('world.removeImage')}
              icon={<X size={14} />}
              onClick={() => change({ image: null }, 'image')}
            />
          )}
          <IconButton size="sm" label={t('world.delete')} icon={<Trash size={14} />} onClick={remove} />
        </div>
      )}
    </article>
  );
}
