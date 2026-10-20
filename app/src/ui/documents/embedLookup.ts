// Keeps what the embeds of open documents show (F5-04) in step with the project: names of entities, titles of
// story nodes and documents, values of fields; embeds redraw when what they show changes.

import { useEffect } from 'react';
import type { ProjectData } from '../../core/project/types';
import { fieldText, linkLabel } from '../../documents/lookups';
import { setAssetResolver, setEmbedLookup } from '../../documents/markdown';
import { platform } from '../../platform';
import type { OpenProject } from '../../state/project';

/** Keeps the embeds of every open document in step with the project. */
export function useEmbedLookup(project: OpenProject): void {
  useEffect(() => {
    const { store, dir } = project;
    setAssetResolver((path) => platform().assetUrl(dir, path));
    let last: ProjectData | null = null;
    const sync = () => {
      const data = store.getState();
      // Typing in a document changes only its text: the embeds have nothing new to show.
      if (
        last &&
        last.entities === data.entities &&
        last.graphs === data.graphs &&
        last.types === data.types &&
        Object.keys(last.documents).every((id) => last!.documents[id]?.path === data.documents[id]?.path) &&
        Object.keys(last.documents).length === Object.keys(data.documents).length
      ) {
        return;
      }
      last = data;
      setEmbedLookup({
        linkLabel: (kind, ref) => linkLabel(store.getState(), kind, ref),
        fieldText: (entity, field) => fieldText(store.getState(), entity, field),
      });
    };
    sync();
    return store.subscribe(sync);
  }, [project]);
}
