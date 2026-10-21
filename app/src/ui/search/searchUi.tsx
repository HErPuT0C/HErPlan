// What the search shows and does in the interface (F6-06): an index that follows the project, icons and names
// of kinds, where an object is, and opening it where it lives.

import {
  BookOpen,
  Contact,
  File as FileIcon,
  FileText,
  Image as ImageIcon,
  SquareCheck,
  Tag,
  Variable,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import { useMemo } from 'react';
import type { ProjectData } from '../../core/project/types';
import { useStore } from '../../core/useStore';
import type { MessageKey } from '../../i18n';
import type { MapRef } from '../../map/model';
import { platform } from '../../platform';
import { searchIndex, type SearchItem, type SearchKind } from '../../search';
import {
  openCatalog,
  openDocument,
  openEntity,
  openTask,
  openVariables,
  revealAsset,
  revealInStory,
} from '../../state/navigation';
import type { OpenProject } from '../../state/project';
import { graphTitle } from '../../story/flow';
import { typesFile } from '../../world/schema';
import { useAsync } from '../useAsync';
import { IMAGE_EXT } from '../world/ImageField';
import { typeName } from '../world/typeNames';

export const KIND_NAMES: Record<SearchKind, MessageKey> = {
  entity: 'search.kind.entity',
  chapter: 'search.kind.chapter',
  document: 'search.kind.document',
  task: 'search.kind.task',
  node: 'search.kind.node',
  asset: 'search.kind.asset',
  variable: 'search.kind.variable',
  tag: 'search.kind.tag',
};

export function KindIcon({ item, size = 15 }: { item: Pick<SearchItem, 'kind' | 'id'>; size?: number }) {
  const icons: Record<SearchKind, LucideIcon> = {
    entity: Contact,
    chapter: BookOpen,
    document: FileText,
    task: SquareCheck,
    node: Workflow,
    asset: IMAGE_EXT.test(item.id) ? ImageIcon : FileIcon,
    variable: Variable,
    tag: Tag,
  };
  const Icon = icons[item.kind];
  return <Icon size={size} aria-hidden="true" className="search-kind-icon" />;
}

/** Where the object is: the type of a card, the chapter of a node, the folder of a document… */
export function whereText(data: ProjectData, item: SearchItem): string {
  switch (item.kind) {
    case 'entity':
      return typeName(typesFile(data).types.find((x) => x.id === item.where));
    case 'node':
      return graphTitle(data, item.where);
    case 'asset':
      return item.where.replace(/^assets\/?/, '');
    default:
      return item.where;
  }
}

/** The index of the open project, files of the assets included (listed once when the search opens). */
export function useSearchIndex(project: OpenProject): SearchItem[] {
  const data = useStore(project.store, (s) => s);
  const files = useAsync(
    () =>
      platform()
        .listAssets(project.dir)
        .then((list) => list.filter((f) => f.kind === 'file').map((f) => f.path)),
    [project.dir],
    [] as string[],
  );
  return useMemo(() => searchIndex(data, files), [data, files]);
}

/** Opens the object where it lives. */
export function openItem(item: Pick<SearchItem, 'kind' | 'id'>): void {
  switch (item.kind) {
    case 'entity':
      return openEntity(item.id);
    case 'chapter':
      return revealInStory({ graph: item.id });
    case 'document':
      return openDocument(item.id);
    case 'task':
      return openTask(item.id);
    case 'node': {
      const [graph, node] = item.id.split('/');
      return revealInStory({ graph, node, highlight: [node] });
    }
    case 'asset':
      return revealAsset(item.id);
    case 'variable':
      return openVariables(item.id);
    case 'tag':
      return openCatalog(item.id.split('/')[0]);
  }
}

/** What can go onto the project map: chapters, documents, cards, files. */
export function mapRefOf(item: Pick<SearchItem, 'kind' | 'id'>): MapRef | null {
  if (item.kind === 'entity' || item.kind === 'document' || item.kind === 'asset')
    return { kind: item.kind, id: item.id };
  if (item.kind === 'chapter') return { kind: 'chapter', id: item.id };
  return null;
}

/** The name with the part that matched marked. */
export function Marked({ text, query }: { text: string; query: string }) {
  const q = query.trim().toLocaleLowerCase().replace(/ё/g, 'е');
  const at = q ? text.toLocaleLowerCase().replace(/ё/g, 'е').indexOf(q) : -1;
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <mark className="search-mark">{text.slice(at, at + q.length)}</mark>
      {text.slice(at + q.length)}
    </>
  );
}
