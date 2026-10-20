// Picks an image from the project's asset library: pictures by folder, filtered by name as you type.

import { useMemo, useState } from 'react';
import { searchKey } from '../../canvas/ops';
import { t } from '../../i18n';
import { platform } from '../../platform';
import type { OpenProject } from '../../state/project';
import { Dialog, EmptyState, Spinner } from '../components';
import { useAsync } from '../useAsync';
import { IMAGE_EXT } from './ImageField';

function Thumb({ project, path }: { project: OpenProject; path: string }) {
  const url = useAsync(() => platform().assetUrl(project.dir, path), [project.dir, path], '');
  return url ? <img src={url} alt="" loading="lazy" draggable={false} /> : <span className="asset-thumb-empty" />;
}

export function AssetPicker({
  project,
  title,
  onPick,
  onClose,
}: {
  project: OpenProject;
  title: string;
  onPick: (path: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const entries = useAsync(() => platform().listAssets(project.dir), [project.dir], null);
  const images = useMemo(() => {
    const q = searchKey(query.trim());
    return (entries ?? [])
      .filter((e) => e.kind === 'file' && IMAGE_EXT.test(e.path))
      .filter((e) => !q || searchKey(e.path).includes(q));
  }, [entries, query]);
  const folders = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const e of images) {
      const folder = e.path.slice(0, e.path.lastIndexOf('/'));
      map.set(folder, [...(map.get(folder) ?? []), e.path]);
    }
    return [...map];
  }, [images]);
  return (
    <Dialog open onClose={onClose} title={title} size="lg">
      <input
        className="input asset-picker-search"
        autoFocus
        value={query}
        placeholder={t('image.search')}
        aria-label={t('image.search')}
        onChange={(e) => setQuery(e.target.value)}
      />
      {entries === null && <Spinner />}
      {entries && images.length === 0 && <EmptyState title={t('image.noAssets')} text={t('image.noAssetsHint')} />}
      <div className="asset-picker">
        {folders.map(([folder, paths]) => (
          <section key={folder} className="asset-picker-folder">
            <h3 className="insp-heading">{folder.replace(/^assets\/?/, '') || t('module.assets')}</h3>
            <div className="asset-picker-grid">
              {paths.map((path) => (
                <button
                  key={path}
                  type="button"
                  className="asset-picker-item"
                  title={path}
                  onClick={() => {
                    onPick(path);
                    onClose();
                  }}
                >
                  <Thumb project={project} path={path} />
                  <span className="asset-picker-name">{path.split('/').pop()}</span>
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </Dialog>
  );
}
