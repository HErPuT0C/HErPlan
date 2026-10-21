// Where links of documents lead, from the interface (0.5): opening a place and naming it in menus.

import type { ProjectData } from '../../core/project/types';
import type { LinkKind } from '../../documents/markdown';
import { linkTarget, type Place } from '../../documents/places';
import { t } from '../../i18n';
import { openDocument, openEntity, openMap, revealAsset, revealInStory } from '../../state/navigation';
import { asEntity } from '../../story/entities';
import { graphTitle } from '../../story/flow';
import { asDocument, docName } from '../../documents/model';

export function openPlace(place: Place): void {
  switch (place.view) {
    case 'card':
      return openEntity(place.id);
    case 'doc':
      return openDocument(place.id);
    case 'story': {
      const [graph, node] = place.id.split('/');
      return revealInStory({ graph, node, highlight: [node] });
    }
    case 'map':
      return openMap(place.id);
    case 'assets':
      return revealAsset(place.id);
  }
}

/** A click on a link: the place chosen for it, or the object's own place. */
export function openLink(data: ProjectData, kind: LinkKind, ref: string, place: string): void {
  openPlace(linkTarget(data, kind, ref, place));
}

/** "Card in the database", "On the project map", "Story canvas: Meeting (Chapter 1)"… */
export function placeLabel(data: ProjectData, place: Place): string {
  switch (place.view) {
    case 'card':
      return t('docs.place.card', { name: asEntity(data.entities[place.id])?.name || t('story.untitled') });
    case 'doc': {
      const d = asDocument(data.documents[place.id]);
      return t('docs.place.doc', { name: d ? docName(d.path) : t('story.untitled') });
    }
    case 'story': {
      const graph = place.id.split('/')[0];
      return t('docs.place.story', { name: place.name || t('story.untitled'), graph: graphTitle(data, graph) });
    }
    case 'map':
      return t('docs.place.map');
    case 'assets':
      return t('docs.place.assets', { name: place.id.slice(place.id.lastIndexOf('/') + 1) });
  }
}
