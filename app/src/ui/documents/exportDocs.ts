// Exports of documents from the interface: one document as PDF (F5-07), all documents and cards as Markdown
// for Obsidian (F5-08). Pending changes are saved first; the result is offered in the file explorer.

import type { JSONContent } from '@tiptap/core';
import { obsidianExport } from '../../documents/exportMarkdown';
import { fieldText, linkLabel } from '../../documents/lookups';
import { parseMarkdown } from '../../documents/markdown';
import { asDocument, docName } from '../../documents/model';
import type { DocxPicture } from '../../documents/docx';
import { renderPdf } from '../../documents/pdf';
import { t } from '../../i18n';
import { platform } from '../../platform';
import { folderNameFor } from '../../platform/paths';
import type { OpenProject } from '../../state/project';
import { typesFile } from '../../world/schema';
import { toast } from '../components';
import { errorText } from '../errors';
import { typeName } from '../world/typeNames';

function done(path: string, key: 'docs.export.pdfDone' | 'docs.export.mdDone' | 'docs.export.docxDone') {
  toast({
    kind: 'success',
    text: t(key, { path }),
    action: { label: t('common.revealInExplorer'), run: () => void platform().revealInExplorer(path) },
  });
}

/** Pictures of a document as data URLs for the PDF; a picture that cannot be read is left out. */
async function pictures(project: OpenProject, doc: JSONContent): Promise<Map<string, string>> {
  const paths = new Set<string>();
  const walk = (n: JSONContent) => {
    if (n.type === 'image' && typeof n.attrs?.src === 'string') paths.add(n.attrs.src);
    n.content?.forEach(walk);
  };
  walk(doc);
  const out = new Map<string, string>();
  for (const path of paths) {
    try {
      const url = /^(https?:|data:)/.test(path) ? path : await platform().assetUrl(project.dir, path);
      if (url.startsWith('data:')) {
        out.set(path, url);
        continue;
      }
      const blob = await (await fetch(url)).blob();
      out.set(
        path,
        await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(blob);
        }),
      );
    } catch {
      // Left out of the PDF.
    }
  }
  return out;
}

export async function exportPdf(project: OpenProject, id: string): Promise<void> {
  const p = platform();
  const doc = asDocument(project.store.getState().documents[id]);
  if (!doc) return;
  const name = folderNameFor(docName(doc.path)) || 'document';
  const target = await p.pickSaveFile(
    t('docs.export.pdf'),
    await p.joinPath(await p.defaultProjectsDir(), `${name}.pdf`),
    [{ name: 'PDF', extensions: ['pdf'] }],
  );
  if (!target) return;
  try {
    await project.saver?.flush();
    const data = project.store.getState();
    const body = parseMarkdown(asDocument(data.documents[id])?.body ?? '');
    const bytes = await renderPdf({
      title: docName(doc.path),
      doc: body,
      words: { contents: t('docs.export.contents'), page: (page, pages) => t('docs.export.page', { page, pages }) },
      images: await pictures(project, body),
      label: (kind, ref) => linkLabel(data, kind, ref),
      field: (entity, field) => fieldText(data, entity, field),
    });
    await p.exportBytes(target, bytes);
    done(target, 'docs.export.pdfDone');
  } catch (e) {
    toast({ kind: 'error', text: t('docs.export.failed', { reason: errorText(e) }) });
  }
}

/** A picture loaded from a URL of the same origin (a canvas drawn from it can be read). */
function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image'));
    img.src = url;
  });
}

/**
 * Pictures of a document for Word: PNG and JPEG as they are, others (SVG, WebP, GIF…) drawn into PNG; with
 * their sizes. A picture that cannot be read is left out.
 */
async function wordPictures(project: OpenProject, doc: JSONContent): Promise<Map<string, DocxPicture>> {
  const paths = new Set<string>();
  const walk = (n: JSONContent) => {
    if (n.type === 'image' && typeof n.attrs?.src === 'string') paths.add(n.attrs.src);
    n.content?.forEach(walk);
  };
  walk(doc);
  const out = new Map<string, DocxPicture>();
  for (const path of paths) {
    try {
      const url = /^(https?:|data:)/.test(path) ? path : await platform().assetUrl(project.dir, path);
      const blob = await (await fetch(url)).blob();
      // Through a blob URL the picture is of this page's origin: the canvas below stays readable.
      const local = URL.createObjectURL(blob);
      try {
        const img = await loadImage(local);
        const width = img.naturalWidth || 800;
        const height = img.naturalHeight || 600;
        const type = blob.type === 'image/png' ? 'png' : blob.type === 'image/jpeg' ? 'jpg' : null;
        if (type) {
          out.set(path, { data: new Uint8Array(await blob.arrayBuffer()), type, width, height });
          continue;
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d')?.drawImage(img, 0, 0, width, height);
        const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
        if (png) out.set(path, { data: new Uint8Array(await png.arrayBuffer()), type: 'png', width, height });
      } finally {
        URL.revokeObjectURL(local);
      }
    } catch {
      // Left out of the document.
    }
  }
  return out;
}

/** One document as Word (0.7.4). */
export async function exportDocx(project: OpenProject, id: string): Promise<void> {
  const p = platform();
  const doc = asDocument(project.store.getState().documents[id]);
  if (!doc) return;
  const name = folderNameFor(docName(doc.path)) || 'document';
  const target = await p.pickSaveFile(
    t('docs.export.docx'),
    await p.joinPath(await p.defaultProjectsDir(), `${name}.docx`),
    [{ name: 'Word', extensions: ['docx'] }],
  );
  if (!target) return;
  try {
    await project.saver?.flush();
    const data = project.store.getState();
    const body = parseMarkdown(asDocument(data.documents[id])?.body ?? '');
    // "Page {page} of {pages}" cut where the numbers go.
    const [before, rest = ''] = t('docs.export.page', { page: '\u0001', pages: '\u0002' }).split('\u0001');
    const [middle, after = ''] = rest.split('\u0002');
    // The Word writer is loaded on the first export only: it is large.
    const { renderDocx } = await import('../../documents/docx');
    const bytes = await renderDocx({
      title: docName(doc.path),
      doc: body,
      page: [before, middle, after],
      pictures: await wordPictures(project, body),
      label: (kind, ref) => linkLabel(data, kind, ref),
      field: (entity, field) => fieldText(data, entity, field),
    });
    await p.exportBytes(target, bytes);
    done(target, 'docs.export.docxDone');
  } catch (e) {
    toast({ kind: 'error', text: t('docs.export.failed', { reason: errorText(e) }) });
  }
}

export async function exportMarkdown(project: OpenProject): Promise<void> {
  const p = platform();
  const parent = await p.pickFolder(t('docs.export.mdPick'), await p.defaultProjectsDir());
  if (!parent) return;
  try {
    await project.saver?.flush();
    const data = project.store.getState();
    const base = `${folderNameFor(data.meta.name) || 'HErPlan'} — Markdown`;
    let target = await p.joinPath(parent, base);
    for (let i = 2; (await p.pathStatus(target)) !== 'missing'; i++)
      target = await p.joinPath(parent, `${base} (${i})`);
    const schema = typesFile(data);
    const files = obsidianExport(data, {
      cards: t('docs.export.cards'),
      fields: t('docs.export.fields'),
      relations: t('world.relations'),
      untitled: t('story.untitled'),
      typeName: (id) => typeName(schema.types.find((x) => x.id === id)),
    });
    await p.exportFiles(target, files);
    done(target, 'docs.export.mdDone');
  } catch (e) {
    toast({ kind: 'error', text: t('docs.export.failed', { reason: errorText(e) }) });
  }
}
