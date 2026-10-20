// Cards of the project map (F5-01): a card that points at a chapter, a document, a card of the world database
// or a picture shows what that object is now; double click opens it.

import { BookOpen, Contact, FileText, Image as ImageIcon, Link2 } from 'lucide-react';
import { createContext, useContext } from 'react';
import { registerKind, sideAnchors } from '../../canvas/kinds';
import { useStore } from '../../core/useStore';
import { asDocument } from '../../documents/model';
import { t, type MessageKey } from '../../i18n';
import { refLabel, refOf, REF_NODE, type MapRefKind } from '../../map/model';
import { platform } from '../../platform';
import type { OpenProject } from '../../state/project';
import { asEntity } from '../../story/entities';
import { graphOf } from '../../story/model';
import { typesFile } from '../../world/schema';
import { registerCard, type CardBodyProps } from '../canvas/cardRegistry';
import { useAsync } from '../useAsync';
import { typeName } from '../world/typeNames';

export const MapContext = createContext<OpenProject | null>(null);

export const REF_KIND_NAMES: Record<MapRefKind, MessageKey> = {
  chapter: 'map.ref.chapter',
  document: 'map.ref.document',
  entity: 'map.ref.entity',
  asset: 'map.ref.asset',
};

export function RefIcon({ kind, size = 14 }: { kind: MapRefKind; size?: number }) {
  const Icon = { chapter: BookOpen, document: FileText, entity: Contact, asset: ImageIcon }[kind];
  return <Icon size={size} aria-hidden="true" />;
}

function Picture({ project, path }: { project: OpenProject; path: string }) {
  const url = useAsync(() => platform().assetUrl(project.dir, path), [project.dir, path], '');
  return url ? <img className="map-ref-picture" src={url} alt="" draggable={false} /> : null;
}

/** First words of a document's text, without Markdown and embeds. */
function preview(body: string): string {
  return body
    .replace(/<[^>]+>/g, '')
    .replace(/\[\[[^|\]]+\|([^\]]*)\]\]/g, '$1')
    .replace(/\{\{[^}]+\}\}/g, '…')
    .replace(/[#*_`>~|-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
}

function RefBody({ node }: CardBodyProps) {
  const project = useContext(MapContext);
  const data = useStore(project!.store, (s) => s);
  const ref = refOf(node);
  if (!project || !ref) return null;
  const name = refLabel(data, ref);
  if (name === null) return <div className="map-ref map-ref-missing">{t('map.missing')}</div>;
  let meta = '';
  let text = '';
  let picture: string | null = null;
  if (ref.kind === 'entity') {
    const e = asEntity(data.entities[ref.id]);
    meta = typeName(typesFile(data).types.find((x) => x.id === e?.type));
    text = e?.description ?? '';
    picture = e?.image ?? null;
  } else if (ref.kind === 'document') {
    const d = asDocument(data.documents[ref.id]);
    meta = d?.path.includes('/') ? d.path.split('/').slice(0, -1).join(' / ') : '';
    text = preview(d?.body ?? '');
  } else if (ref.kind === 'chapter') {
    const g = graphOf(data, ref.id);
    meta = t('map.nodes', { count: g?.nodes.filter((n) => n.kind !== 'sticker').length ?? 0 });
  } else {
    picture = ref.id;
  }
  return (
    <div className={`map-ref map-ref-${ref.kind}`}>
      <div className="map-ref-name">
        <RefIcon kind={ref.kind} />
        <span>{name}</span>
      </div>
      {meta && <div className="map-ref-meta">{meta}</div>}
      {picture && <Picture project={project} path={picture} />}
      {text && <div className="map-ref-text">{text}</div>}
    </div>
  );
}

registerKind({
  id: REF_NODE,
  label: 'map.kind.ref',
  color: '#4f8fe6',
  size: { w: 220, h: 110 },
  ports: (n) => sideAnchors(n),
  graphs: ['projectMap'],
  // Made by dragging an object onto the map, not from the create menu.
  hidden: true,
});
registerCard(REF_NODE, { body: RefBody, titleEditable: false, icon: Link2 });
