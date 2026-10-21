// Links of tasks to objects of the project (F6-04): what they are called now and where a click takes.

import type { ProjectData } from '../../core/project/types';
import { linkLabel } from '../../documents/lookups';
import type { SearchKind } from '../../search';
import { graphOf } from '../../story/model';
import { graphTitle } from '../../story/flow';
import type { TaskLink } from '../../tasks/model';
import { openItem } from '../search/searchUi';

/** The search kind of a link (a chapter is a graph). */
export const searchKindOf = (link: TaskLink): SearchKind => (link.kind === 'graph' ? 'chapter' : link.kind);

/** What the linked object is called now; null when it is gone. */
export function taskLinkLabel(data: ProjectData, link: TaskLink): string | null {
  switch (link.kind) {
    case 'entity':
      return linkLabel(data, 'ent', link.id);
    case 'document':
      return linkLabel(data, 'doc', link.id);
    case 'node':
      return linkLabel(data, 'node', link.id);
    case 'asset':
      return linkLabel(data, 'asset', link.id);
    case 'graph':
      return graphOf(data, link.id) ? graphTitle(data, link.id) : null;
  }
}

export function openTaskLink(link: TaskLink): void {
  openItem({ kind: searchKindOf(link), id: link.id });
}
