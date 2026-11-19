// Opening a picture of the project for drawing, and saving what was drawn (0.9). A drawing HErPlan made (a PNG
// carrying its source) opens with its shapes and is saved over itself. Any other picture opens as the
// background of a new drawing, and the result is saved as a copy beside it — "forest (drawing).png" — the
// picture itself and every place it is used stay as they were (the owner's choice); the copy remembers the
// picture, so what was drawn on it can be changed later.

import { drawingOnPicture, emptyDrawing, type Drawing } from '../../drawing/model';
import { drawingOf, pngSize } from '../../drawing/png';
import { drawingPng } from '../../drawing/render';
import { getLocale, t } from '../../i18n';
import { platform } from '../../platform';
import type { OpenProject } from '../../state/project';
import { bumpAsset } from '../assetVersion';

/** Folders where drawings are made, in each language; one made in the other language is used as it is. */
const DRAWINGS = { ru: 'Рисунки', en: 'Drawings' } as const;

export interface DrawSession {
  title: string;
  drawing: Drawing;
  background: CanvasImageSource | null;
  /** What saving will do, for the window to say. */
  hint?: string;
  /** Writes the drawing; returns the path of the picture it is in now. */
  save: (d: Drawing) => Promise<string>;
  /** Shown once the window opens (the picture under an old drawing is gone…). */
  notice?: string;
}

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
};

const extOf = (path: string) => path.slice(path.lastIndexOf('.') + 1).toLowerCase();
const folderOf = (path: string) => path.slice(0, path.lastIndexOf('/'));
const stemOf = (path: string) => path.slice(path.lastIndexOf('/') + 1).replace(/\.[^.]+$/, '');

/** A picture from its bytes, ready to draw on a canvas, with its size; null when it cannot be read. */
export async function loadPicture(
  bytes: Uint8Array,
  path: string,
): Promise<{ image: CanvasImageSource; w: number; h: number } | null> {
  const blob = new Blob([bytes as BlobPart], { type: MIME[extOf(path)] ?? 'application/octet-stream' });
  try {
    const bitmap = await createImageBitmap(blob);
    return { image: bitmap, w: bitmap.width, h: bitmap.height };
  } catch {
    // SVG pictures are not made into bitmaps directly: through an image element.
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return { image: img, w: img.naturalWidth || 800, h: img.naturalHeight || 600 };
    } catch {
      return null;
    } finally {
      // The decoded image keeps its pixels; the URL is no longer needed once drawn… but drawImage needs it
      // alive in some browsers, so it is released a moment later.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    }
  }
}

/** The folder where new drawings go: "assets/Рисунки" (or the one already there in the other language). */
export async function drawingsFolder(project: OpenProject): Promise<string> {
  const folders = new Set(
    (await platform().listAssets(project.dir)).filter((e) => e.kind === 'folder').map((e) => e.path),
  );
  const existing = Object.values(DRAWINGS)
    .map((name) => `assets/${name}`)
    .find((p) => folders.has(p));
  return existing ?? `assets/${DRAWINGS[getLocale()]}`;
}

/** A new, empty drawing: saved the first time as `<name>.png` in `folder` (a free name), then over itself. */
export function newDrawing(project: OpenProject, folder: string, name: string): DrawSession {
  let path: string | null = null;
  return {
    title: t('draw.titleNew'),
    drawing: emptyDrawing(),
    background: null,
    save: async (d) => {
      const png = await drawingPng(d, null);
      if (path) await platform().replaceAsset(project.dir, path, png);
      else path = await platform().writeAsset(project.dir, folder, `${name}.png`, png);
      bumpAsset(path);
      return path;
    },
  };
}

/**
 * Opens a picture of the project for drawing (see the top of the file). With `copyTo`, a drawing of HErPlan is
 * saved as a new picture there instead of over itself (a canvas of the map copied with its drawing: each copy
 * gets its own once it is drawn on).
 */
export async function openPicture(
  project: OpenProject,
  path: string,
  copyTo?: { folder: string; name: string },
): Promise<DrawSession> {
  const bytes = await platform().readAsset(project.dir, path);
  const own = drawingOf(bytes);
  if (own) {
    let copy: string | null = null;
    // A drawing of HErPlan: its shapes, over the picture it was drawn on (when there was one).
    let background: CanvasImageSource | null = null;
    let drawing = own;
    let notice: string | undefined;
    if (own.background && own.background !== path) {
      const under = await platform()
        .readAsset(project.dir, own.background)
        .then((b) => loadPicture(b, own.background!))
        .catch(() => null);
      if (under) background = under.image;
      else {
        // The picture under it is gone: what was drawn stays as a part of this picture, drawn on further.
        const self = await loadPicture(bytes, path);
        background = self?.image ?? null;
        drawing = { ...own, items: [], background: path, bg: '' };
        notice = t('draw.backgroundMissing');
      }
    } else if (own.background === path) {
      background = (await loadPicture(bytes, path))?.image ?? null;
    }
    return {
      title: t('draw.titleEdit', { name: stemOf(path) }),
      drawing,
      background,
      notice,
      save: async (d) => {
        // Drawn over itself (its picture was lost): the strokes become part of the picture.
        const baked = d.background === path;
        const png = await drawingPng(d, background);
        const out = baked ? await drawingPng({ ...d, items: [] }, await pngImage(png, path)) : png;
        if (copyTo) {
          if (copy) await platform().replaceAsset(project.dir, copy, out);
          else copy = await platform().writeAsset(project.dir, copyTo.folder, `${copyTo.name}.png`, out);
          bumpAsset(copy);
          return copy;
        }
        await platform().replaceAsset(project.dir, path, out);
        bumpAsset(path);
        return path;
      },
    };
  }
  // Any other picture: a new drawing over it, saved as a copy beside it.
  const picture = await loadPicture(bytes, path);
  if (!picture) throw new Error(t('draw.cannotRead'));
  const size = extOf(path) === 'png' ? (pngSize(bytes) ?? picture) : picture;
  const name = t('draw.copyName', { name: stemOf(path) });
  let saved: string | null = null;
  return {
    title: t('draw.titlePicture', { name: stemOf(path) }),
    drawing: drawingOnPicture(path, size.w, size.h),
    background: picture.image,
    hint: t('draw.copyHint', { name: `${name}.png` }),
    save: async (d) => {
      const png = await drawingPng(d, picture.image);
      if (saved) await platform().replaceAsset(project.dir, saved, png);
      else saved = await platform().writeAsset(project.dir, folderOf(path), `${name}.png`, png);
      bumpAsset(saved);
      return saved;
    },
  };
}

/** A PNG just made, as a picture to draw on. */
async function pngImage(png: Uint8Array, path: string): Promise<CanvasImageSource | null> {
  return (await loadPicture(png, path))?.image ?? null;
}
