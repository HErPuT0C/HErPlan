// Where a link of a document leads (0.5): an object can be in several places at once — a card is in the
// database, on the project map and on the story canvas, a picture is in the assets, on cards and on the map.
// A link keeps the place chosen for it ("map:<node>", "story:<graph>/<node>", "card:<entity>", "doc:<id>",
// "assets:<path>"); without one, or when that place is gone, a click opens the object's own place.

import type { ProjectData } from '../core/project/types';
import { asEntity, listEntities } from '../story/entities';
import { allGraphs, asStory, graphOf } from '../story/model';
import { cardFields, typesFile } from '../world/schema';
import type { LinkKind } from './markdown';
import { asDocument, docName, listDocuments } from './model';
import { imagesIn } from '../world/assets';

export type PlaceView = 'card' | 'doc' | 'story' | 'map' | 'assets';

export interface Place {
  view: PlaceView;
  /** What the view opens: an entity, a document, "<graph>/<node>", a node of the map, a file. */
  id: string;
  /** For a story node or a card: its title or name. */
  name?: string;
}

const VIEWS: readonly PlaceView[] = ['card', 'doc', 'story', 'map', 'assets'];

export const placeKey = (p: Place): string => `${p.view}:${p.id}`;

export function parsePlace(text: string): Place | null {
  const at = text.indexOf(':');
  const view = text.slice(0, at) as PlaceView;
  const id = text.slice(at + 1);
  return at > 0 && id && VIEWS.includes(view) ? { view, id } : null;
}

/** The object's own place: the card in the database, the document, the node on its canvas, the file. */
export function ownPlace(kind: LinkKind, ref: string): Place {
  return {
    view: kind === 'ent' ? 'card' : kind === 'doc' ? 'doc' : kind === 'node' ? 'story' : 'assets',
    id: ref,
  };
}

function mapNodes(data: ProjectData, kind: string, id: string): Place[] {
  return allGraphs(data)
    .filter((g) => g.kind === 'projectMap')
    .flatMap((g) =>
      g.nodes
        .filter((n) => {
          const ref = n.ref as { kind?: string; id?: string } | undefined;
          return ref?.kind === kind && ref.id === id;
        })
        .map((n) => ({ view: 'map' as const, id: n.id })),
    );
}

/** Every place the object is in, its own place first; the same place is listed once. */
export function placesOf(data: ProjectData, kind: LinkKind, ref: string): Place[] {
  const out: Place[] = [ownPlace(kind, ref)];
  const add = (p: Place) => {
    if (!out.some((x) => placeKey(x) === placeKey(p))) out.push(p);
  };
  if (kind === 'ent') {
    for (const g of allGraphs(data)) {
      if (g.kind !== 'story' && g.kind !== 'chapter') continue;
      for (const raw of g.nodes) {
        const n = asStory(raw);
        if (n.ref === ref || (n.lines ?? []).some((l) => l.speaker === ref))
          add({ view: 'story', id: `${g.id}/${n.id}`, name: n.title });
      }
    }
    mapNodes(data, 'entity', ref).forEach(add);
    const image = asEntity(data.entities[ref])?.image;
    if (image) add({ view: 'assets', id: image });
  } else if (kind === 'doc') {
    mapNodes(data, 'document', ref).forEach(add);
  } else if (kind === 'asset') {
    mapNodes(data, 'asset', ref).forEach(add);
    const schema = typesFile(data);
    for (const e of listEntities(data)) {
      const uses =
        e.image === ref ||
        cardFields(schema, e).some(({ field }) => field.type === 'image' && e.values[field.id] === ref);
      if (uses) add({ view: 'card', id: e.id, name: e.name });
    }
    for (const d of listDocuments(data)) {
      if (imagesIn(d.body).includes(ref)) add({ view: 'doc', id: d.id, name: docName(d.path) });
    }
  }
  return out;
}

/** Is the place still there (a node not deleted, a card not removed…); files are not checked here. */
export function placeExists(data: ProjectData, place: Place): boolean {
  switch (place.view) {
    case 'card':
      return !!asEntity(data.entities[place.id]);
    case 'doc': {
      const d = asDocument(data.documents[place.id]);
      return !!d && !d.trashedAt;
    }
    case 'story': {
      const [graph, node] = place.id.split('/');
      return !!graphOf(data, graph)?.nodes.some((n) => n.id === node);
    }
    case 'map':
      return allGraphs(data).some((g) => g.kind === 'projectMap' && g.nodes.some((n) => n.id === place.id));
    case 'assets':
      return true;
  }
}

/** Where a click on a link leads: its chosen place while it exists, else the object's own place. */
export function linkTarget(data: ProjectData, kind: LinkKind, ref: string, place: string): Place {
  const chosen = place ? parsePlace(place) : null;
  return chosen && placeExists(data, chosen) ? chosen : ownPlace(kind, ref);
}
