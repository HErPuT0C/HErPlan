// Pictures written again under their own name (0.9: a drawing saved again) must show anew wherever they are:
// the window's cache would keep the old one under the same URL. Each rewrite bumps the file's version, which
// goes into its URL; places that show pictures follow the bumps.

import { useEffect, useState } from 'react';
import { atom } from '../core/atom';
import { useAtom } from '../core/useStore';
import { platform } from '../platform';

const versions = new Map<string, number>();
/** Changes whenever a picture was written again: what shows pictures redraws. */
export const assetVersions = atom(0);

/** Tells every place showing the file at `path` ("assets/…") that it changed. */
export function bumpAsset(path: string): void {
  versions.set(path, (versions.get(path) ?? 0) + 1);
  assetVersions.set((n) => n + 1);
}

/** The URL of a file with its version, so a picture written again is not taken from the cache. */
export function versioned(url: string, path: string): string {
  const v = versions.get(path);
  if (!v || !url || /^(data|blob):/.test(url)) return url;
  return `${url}${url.includes('?') ? '&' : '?'}v=${v}`;
}

/** The URL to show a file of the project by, kept fresh when it is written again; '' until known. */
export function useAssetUrl(dir: string, path: string | null | undefined): string {
  const version = useAtom(assetVersions);
  const [shown, setShown] = useState<{ key: string; url: string }>({ key: '', url: '' });
  const key = path ? `${dir}\n${path}\n${version}` : '';
  useEffect(() => {
    if (!path) return;
    let live = true;
    void platform()
      .assetUrl(dir, path)
      .then((url) => live && setShown({ key, url: versioned(url, path) }))
      .catch(() => live && setShown({ key, url: '' }));
    return () => {
      live = false;
    };
  }, [dir, path, key]);
  return shown.key === key ? shown.url : '';
}
