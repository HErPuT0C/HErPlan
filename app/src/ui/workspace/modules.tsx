import { Database, FileText, GitBranch, Image, Map as MapIcon, SquareKanban, type LucideIcon } from 'lucide-react';
import type { MessageKey } from '../../i18n';
import type { ModuleKind } from '../../state/workspace';

export interface ModuleInfo {
  kind: ModuleKind;
  icon: LucideIcon;
  title: MessageKey;
  description: MessageKey;
  /** Version in which the editor arrives (PIPELINE.md); null once it is here. */
  release: string | null;
  /** Part of the editor is already here, the rest arrives in `release`. */
  partial?: boolean;
}

export const MODULES: Record<ModuleKind, ModuleInfo> = {
  map: { kind: 'map', icon: MapIcon, title: 'module.map', description: 'module.map.description', release: null },
  story: {
    kind: 'story',
    icon: GitBranch,
    title: 'module.story',
    description: 'module.story.description',
    release: null,
  },
  database: {
    kind: 'database',
    icon: Database,
    title: 'module.database',
    description: 'module.database.description',
    release: null,
  },
  documents: {
    kind: 'documents',
    icon: FileText,
    title: 'module.documents',
    description: 'module.documents.description',
    release: null,
  },
  tasks: {
    kind: 'tasks',
    icon: SquareKanban,
    title: 'module.tasks',
    description: 'module.tasks.description',
    release: '0.5',
  },
  assets: {
    kind: 'assets',
    icon: Image,
    title: 'module.assets',
    description: 'module.assets.description',
    release: null,
  },
};
