// The project map (F5-01): a canvas of its own (a graph of kind "projectMap") whose cards point at objects of
// the project — chapters, documents, cards of the world database, pictures — next to ordinary notes and
// arrows. A card keeps a reference only; what it shows is read from the project, so it never goes stale.

import { newId } from '../core/ids';
import type { ProjectData } from '../core/project/types';
import { emptyGraph, type GraphDoc, type GraphNode } from '../canvas/model';
import { asDocument, docName } from '../documents/model';
import { asEntity } from '../story/entities';
import { graphTitle } from '../story/flow';
import { allGraphs } from '../story/model';

export type MapRefKind = 'chapter' | 'document' | 'entity' | 'asset';
export const MAP_REF_KINDS: readonly MapRefKind[] = ['chapter', 'document', 'entity', 'asset'];

export interface MapRef {
  kind: MapRefKind;
  id: string;
}

/** Node kind of a card that points at an object. */
export const REF_NODE = 'ref';

export function mapGraph(data: Pick<ProjectData, 'graphs'>): GraphDoc | undefined {
  return Object.values(data.graphs).find((g) => g.kind === 'projectMap') as GraphDoc | undefined;
}

export function newMapGraph(name: string): GraphDoc {
  return emptyGraph(newId(), 'projectMap', name);
}

export function refOf(node: GraphNode): MapRef | null {
  const ref = node.ref as Partial<MapRef> | undefined;
  return ref && MAP_REF_KINDS.includes(ref.kind as MapRefKind) && typeof ref.id === 'string'
    ? { kind: ref.kind as MapRefKind, id: ref.id }
    : null;
}

/** What the object is called now; null when it no longer exists. */
export function refLabel(data: ProjectData, ref: MapRef): string | null {
  switch (ref.kind) {
    case 'chapter': {
      const g = allGraphs(data).find((x) => x.id === ref.id);
      return g ? graphTitle(data, g.id) : null;
    }
    case 'document': {
      const d = asDocument(data.documents[ref.id]);
      return d && !d.trashedAt ? docName(d.path) : null;
    }
    case 'entity':
      return asEntity(data.entities[ref.id])?.name ?? null;
    case 'asset':
      return ref.id.split('/').pop() ?? ref.id;
  }
}

/** A card for an object, its top-left corner at a world point. */
export function refNode(ref: MapRef, x: number, y: number, title: string): GraphNode {
  return {
    id: newId(),
    kind: REF_NODE,
    title,
    x,
    y,
    w: ref.kind === 'asset' ? 200 : 220,
    h: ref.kind === 'asset' ? 180 : 110,
    ref,
  };
}
