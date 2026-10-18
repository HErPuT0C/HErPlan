import { useSyncExternalStore } from 'react';
import { useAtom } from '../core/useStore';
import { useLocale } from '../i18n';
import { currentProject } from '../state/project';
import { ToastRegion } from './components';
import { Showcase } from './dev/Showcase';
import { StartScreen } from './start/StartScreen';
import { Workspace } from './workspace/Workspace';
import './app.css';

function subscribeHash(listener: () => void) {
  window.addEventListener('hashchange', listener);
  return () => window.removeEventListener('hashchange', listener);
}

export function App() {
  // Every text comes from t(); re-rendering the tree on a language change updates all of it.
  useLocale();
  const project = useAtom(currentProject);
  const hash = useSyncExternalStore(subscribeHash, () => window.location.hash);

  return (
    <>
      {hash === '#/dev/components' ? <Showcase /> : project ? <Workspace project={project} /> : <StartScreen />}
      <ToastRegion />
    </>
  );
}
