// Files dropped into a document or pasted into it (0.5): they are copied into the assets, into the folder
// "Document attachments" (made when missing), and go into the text where they were dropped — pictures as
// pictures, other files as links to the file.

import type { JSONContent } from '@tiptap/core';
import { getLocale, t } from '../../i18n';
import { platform } from '../../platform';
import type { OpenProject } from '../../state/project';
import { toast } from '../components';
import { errorText } from '../errors';
import { pastedName } from '../useFileDrop';
import { IMAGE_EXT } from '../world/ImageField';

/** The folder's name in each language; one made in the other language is used as it is. */
const FOLDER_NAMES = { ru: 'Вложения в документы', en: 'Document attachments' } as const;

async function attachmentsFolder(project: OpenProject): Promise<string> {
  const folders = new Set(
    (await platform().listAssets(project.dir)).filter((e) => e.kind === 'folder').map((e) => e.path),
  );
  const existing = Object.values(FOLDER_NAMES)
    .map((name) => `assets/${name}`)
    .find((path) => folders.has(path));
  return existing ?? `assets/${FOLDER_NAMES[getLocale()]}`;
}

/** What goes into the text for copied files: pictures, then links to the other files in one paragraph. */
export function attachmentContent(paths: string[]): JSONContent[] {
  const name = (path: string) => path.slice(path.lastIndexOf('/') + 1);
  const pictures = paths.filter((p) => IMAGE_EXT.test(p));
  const others = paths.filter((p) => !IMAGE_EXT.test(p));
  return [
    ...pictures.map((src) => ({ type: 'image', attrs: { src, alt: name(src).replace(/\.[^.]+$/, '') } })),
    ...(others.length
      ? [
          {
            type: 'paragraph',
            content: others.flatMap((ref, i) => [
              ...(i ? [{ type: 'text', text: ', ' }] : []),
              { type: 'objectLink', attrs: { kind: 'asset', ref, label: name(ref), place: '' } },
            ]),
          },
        ]
      : []),
  ];
}

/** Copies files from the explorer (desktop) or dropped/pasted bytes (web, screenshots) into the attachments. */
export async function attach(project: OpenProject, source: { paths: string[] } | { files: File[] }): Promise<string[]> {
  try {
    const folder = await attachmentsFolder(project);
    const copied =
      'paths' in source
        ? await platform().importAssets(project.dir, source.paths, folder)
        : await Promise.all(
            source.files.map(async (f) =>
              platform().writeAsset(
                project.dir,
                folder,
                pastedName(f, t('docs.attachment')),
                new Uint8Array(await f.arrayBuffer()),
              ),
            ),
          );
    if (copied.length)
      toast({ kind: 'success', text: t('docs.attached', { count: copied.length, folder: folder.slice(7) }) }, 2500);
    return copied;
  } catch (e) {
    toast({ kind: 'error', text: t('docs.attachFailed', { reason: errorText(e) }) });
    return [];
  }
}
