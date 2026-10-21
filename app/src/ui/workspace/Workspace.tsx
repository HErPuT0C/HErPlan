import { useEffect, useRef, useState } from 'react';
import { useAtom } from '../../core/useStore';
import {
  assetRequest,
  catalogRequest,
  closeVariables,
  documentRequest,
  entityRequest,
  mapRequest,
  revealRequest,
} from '../../state/navigation';
import { t } from '../../i18n';
import { platform } from '../../platform';
import { closeProject, type OpenProject } from '../../state/project';
import { settings } from '../../state/settings';
import {
  closeOtherTabs,
  closeTab,
  cycleTab,
  EMPTY_WORKSPACE,
  HOME,
  openTab,
  parseWorkspace,
  serializeWorkspace,
  setTabDoc,
  setTabGraph,
  WORKSPACE_FILE,
  type WorkspaceState,
} from '../../state/workspace';
import { Button, Dialog, toast } from '../components';
import { errorText } from '../errors';
import { useHotkeys } from '../hotkeys';
import { exportProject } from '../project/exportProject';
import { HistoryDialog } from '../project/HistoryDialog';
import { SettingsDialog } from '../settings/SettingsDialog';
import { Dashboard } from './Dashboard';
import { StoryEditor } from '../story/StoryEditor';
import { VariablesPanel } from '../story/VariablesPanel';
import { WorldEditor } from '../world/WorldEditor';
import { AssetsEditor } from '../assets/AssetsEditor';
import { DocumentsEditor } from '../documents/DocumentsEditor';
import { MapEditor } from '../map/MapEditor';
import { ModulePlaceholder } from './ModulePlaceholder';
import { ProjectHeader } from './ProjectHeader';
import { TabStrip } from './TabStrip';
import './workspace.css';

/** The open project: header, tabs, and the active editor. */
export function Workspace({ project }: { project: OpenProject }) {
  const { dashboardView } = useAtom(settings);
  const [tabs, setTabs] = useTabs(project);
  const [dialog, setDialog] = useState<'history' | 'settings' | null>(null);
  const [closeError, setCloseError] = useState<string | null>(null);

  const close = async (discard = false) => {
    try {
      await closeProject({ discard });
    } catch (e) {
      setCloseError(errorText(e));
    }
  };

  useHotkeys({
    undo: () => !project.readOnly && project.store.undo(),
    redo: () => !project.readOnly && project.store.redo(),
    save: () => {
      if (!project.saver) return;
      project.saver.flush().then(
        () => toast({ kind: 'success', text: t('save.savedNow') }, 2000),
        () => undefined,
      );
    },
    closeTab: () => tabs.active !== HOME && setTabs((s) => closeTab(s, s.active)),
    nextTab: () => setTabs((s) => cycleTab(s, 1)),
    prevTab: () => setTabs((s) => cycleTab(s, -1)),
    settings: () => setDialog('settings'),
  });

  const activeTab = tabs.tabs.find((tab) => tab.id === tabs.active);

  // "Show this node" from the variables panel or elsewhere: bring a story tab to the front.
  const request = useAtom(revealRequest);
  useEffect(() => {
    if (!request) return;
    setTabs((s) => {
      if (s.tabs.find((tab) => tab.id === s.active)?.kind === 'story') return s;
      const story = s.tabs.find((tab) => tab.kind === 'story');
      return story ? { ...s, active: story.id } : openTab(s, 'story');
    });
  }, [request, setTabs]);
  // "Open this card" (a link to an entity) or a catalog of tags: bring the database tab to the front.
  const wantedEntity = useAtom(entityRequest);
  const wantedCatalog = useAtom(catalogRequest);
  const wanted = wantedEntity ?? wantedCatalog;
  useEffect(() => {
    if (!wanted) return;
    setTabs((s) => {
      if (s.tabs.find((tab) => tab.id === s.active)?.kind === 'database') return s;
      const db = s.tabs.find((tab) => tab.kind === 'database');
      return db ? { ...s, active: db.id } : openTab(s, 'database');
    });
  }, [wanted, setTabs]);
  // "Open this document" (a link in a document, the project map): bring a documents tab to the front.
  const wantedDoc = useAtom(documentRequest);
  useEffect(() => {
    if (!wantedDoc) return;
    setTabs((s) => {
      const active = s.tabs.find((tab) => tab.id === s.active);
      const docs = active?.kind === 'documents' ? active : s.tabs.find((tab) => tab.kind === 'documents');
      const next = docs ? { ...s, active: docs.id } : openTab(s, 'documents');
      return setTabDoc(next, next.active, wantedDoc.id);
    });
    documentRequest.set(null);
  }, [wantedDoc, setTabs]);
  // "Show this file": bring the assets tab to the front.
  const wantedAsset = useAtom(assetRequest);
  useEffect(() => {
    if (!wantedAsset) return;
    setTabs((s) => {
      if (s.tabs.find((tab) => tab.id === s.active)?.kind === 'assets') return s;
      const assets = s.tabs.find((tab) => tab.kind === 'assets');
      return assets ? { ...s, active: assets.id } : openTab(s, 'assets');
    });
  }, [wantedAsset, setTabs]);
  // "Show on the map": bring the map tab to the front.
  const wantedMap = useAtom(mapRequest);
  useEffect(() => {
    if (!wantedMap) return;
    setTabs((s) => {
      if (s.tabs.find((tab) => tab.id === s.active)?.kind === 'map') return s;
      const map = s.tabs.find((tab) => tab.kind === 'map');
      return map ? { ...s, active: map.id } : openTab(s, 'map');
    });
  }, [wantedMap, setTabs]);
  // The panel belongs to this project.
  useEffect(
    () => () => {
      closeVariables();
      revealRequest.set(null);
      entityRequest.set(null);
      catalogRequest.set(null);
      documentRequest.set(null);
      mapRequest.set(null);
      assetRequest.set(null);
    },
    [],
  );

  return (
    <div className="workspace">
      <ProjectHeader
        project={project}
        onHistory={() => setDialog('history')}
        onExport={() => void exportProject(project)}
        onSettings={() => setDialog('settings')}
        onClose={() => void close()}
      />
      <TabStrip
        state={tabs}
        onActivate={(id) => setTabs((s) => ({ ...s, active: id }))}
        onOpen={(kind) => setTabs((s) => openTab(s, kind))}
        onClose={(id) => setTabs((s) => closeTab(s, id))}
        onCloseOthers={(id) => setTabs((s) => closeOtherTabs(s, id))}
      />
      <main className="workspace-content" role="tabpanel" aria-label={t('tabs.content')}>
        {activeTab?.kind === 'story' ? (
          <StoryEditor
            key={activeTab.id}
            project={project}
            tab={activeTab.id}
            graph={activeTab.graph}
            onGraph={(graph) => setTabs((s) => setTabGraph(s, activeTab.id, graph))}
          />
        ) : activeTab?.kind === 'database' ? (
          <WorldEditor key={activeTab.id} project={project} />
        ) : activeTab?.kind === 'map' ? (
          <MapEditor key={activeTab.id} project={project} />
        ) : activeTab?.kind === 'documents' ? (
          <DocumentsEditor
            key={activeTab.id}
            project={project}
            doc={activeTab.doc ?? null}
            onDoc={(doc) => setTabs((s) => setTabDoc(s, activeTab.id, doc))}
          />
        ) : activeTab?.kind === 'assets' ? (
          <AssetsEditor key={activeTab.id} project={project} />
        ) : activeTab ? (
          <ModulePlaceholder key={activeTab.id} kind={activeTab.kind} />
        ) : (
          <Dashboard project={project} view={dashboardView} onOpen={(kind) => setTabs((s) => openTab(s, kind))} />
        )}
      </main>
      <VariablesPanel project={project} />
      <HistoryDialog project={project} open={dialog === 'history'} onClose={() => setDialog(null)} />
      <SettingsDialog open={dialog === 'settings'} onClose={() => setDialog(null)} project={project} />
      <Dialog
        open={closeError !== null}
        onClose={() => setCloseError(null)}
        size="sm"
        title={t('project.closeFailedTitle')}
        footer={
          <>
            <Button variant="danger" onClick={() => void close(true)}>
              {t('project.closeDiscard')}
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                setCloseError(null);
                void close();
              }}
            >
              {t('common.retry')}
            </Button>
          </>
        }
      >
        <p>{t('project.closeFailed', { reason: closeError ?? '' })}</p>
      </Dialog>
    </div>
  );
}

/** Tabs restored from .herplan/workspace.json and written back shortly after each change. */
function useTabs(project: OpenProject) {
  const [state, setState] = useState<WorkspaceState>(EMPTY_WORKSPACE);
  const loaded = useRef(false);

  useEffect(() => {
    let alive = true;
    loaded.current = false;
    platform()
      .readProjectFile(project.dir, WORKSPACE_FILE)
      .catch(() => null)
      .then((text) => {
        if (!alive) return;
        setState(parseWorkspace(text));
        loaded.current = true;
      });
    return () => {
      alive = false;
    };
  }, [project.dir]);

  useEffect(() => {
    if (!loaded.current || project.readOnly) return;
    const timer = setTimeout(() => {
      void platform()
        .writeProject(project.dir, [{ path: WORKSPACE_FILE, text: serializeWorkspace(state) }], [])
        .catch(() => undefined);
    }, 500);
    return () => clearTimeout(timer);
  }, [state, project]);

  return [state, setState] as const;
}
