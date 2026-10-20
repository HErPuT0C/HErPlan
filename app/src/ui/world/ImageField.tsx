// A picture of an entity or an image field (F4-04, FR-DB-07): chosen from the asset library, from disk,
// dropped from the file explorer, or pasted from the clipboard. Pictures are kept in the project's assets.

import { ClipboardPaste, FolderOpen, HardDrive, ImagePlus, X } from 'lucide-react';
import { useMemo, useRef, useState, type ClipboardEvent } from 'react';
import { t } from '../../i18n';
import { platform } from '../../platform';
import type { OpenProject } from '../../state/project';
import { Menu, toast, type MenuEntry } from '../components';
import { errorText } from '../errors';
import { IMAGE_FILTERS } from '../start/filters';
import { useAsync } from '../useAsync';
import { pastedName, useFileDrop } from '../useFileDrop';
import { AssetPicker } from './AssetPicker';

export const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|svg)$/i;

/** Saves an image file (pasted or dropped in the web build) into the project; returns its path. */
export async function saveImageFile(
  project: OpenProject,
  folder: string,
  file: File,
  fallback: string,
): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  return platform().writeAsset(project.dir, folder, pastedName(file, fallback), bytes);
}

/** The first image among clipboard items (a screenshot, a copied picture). */
export function clipboardImage(e: ClipboardEvent): File | null {
  for (const item of e.clipboardData.items) {
    if (item.kind === 'file' && item.type.startsWith('image/')) return item.getAsFile();
  }
  return null;
}

export function ImageField({
  project,
  value,
  onChange,
  folder = 'assets/world',
  label,
  large = false,
}: {
  project: OpenProject;
  value: string | null;
  onChange: (path: string | null) => void;
  folder?: string;
  label: string;
  large?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [picking, setPicking] = useState(false);
  const readOnly = project.readOnly;
  const url = useAsync(
    () => (value ? platform().assetUrl(project.dir, value) : Promise.resolve('')),
    [project.dir, value],
    '',
  );
  const stamp = useMemo(() => () => `image-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}`, []);

  const run = async (job: () => Promise<string | null | undefined>) => {
    try {
      const path = await job();
      if (path) onChange(path);
    } catch (e) {
      toast({ kind: 'error', text: errorText(e) });
    }
  };
  const fromDisk = () =>
    run(async () => {
      const source = await platform().pickFile(label, IMAGE_FILTERS);
      return source ? platform().importFile(project.dir, source, folder) : null;
    });
  const fromClipboard = () =>
    run(async () => {
      const items = await navigator.clipboard.read().catch(() => null);
      for (const item of items ?? []) {
        const type = item.types.find((x) => x.startsWith('image/'));
        if (!type) continue;
        const blob = await item.getType(type);
        return saveImageFile(project, folder, new File([blob], '', { type }), stamp());
      }
      toast({ kind: 'info', text: t('image.noClipboard') });
      return null;
    });
  const drop = useFileDrop(box, {
    disabled: readOnly,
    onPaths: (paths) =>
      void run(async () => {
        const copied = await platform().importAssets(project.dir, paths, folder);
        const image = copied.find((p) => IMAGE_EXT.test(p));
        if (!image) toast({ kind: 'info', text: t('image.notImage') });
        return image;
      }),
    onFiles: (files) => {
      const file = files.find((f) => f.type.startsWith('image/'));
      if (!file) return toast({ kind: 'info', text: t('image.notImage') });
      void run(() => saveImageFile(project, folder, file, stamp()));
    },
  });

  const entries: MenuEntry[] = [
    { id: 'assets', label: t('image.fromAssets'), icon: <FolderOpen size={16} />, onSelect: () => setPicking(true) },
    { id: 'disk', label: t('image.fromDisk'), icon: <HardDrive size={16} />, onSelect: () => void fromDisk() },
    {
      id: 'paste',
      label: t('image.fromClipboard'),
      icon: <ClipboardPaste size={16} />,
      shortcut: 'Ctrl+V',
      onSelect: () => void fromClipboard(),
    },
    ...(value
      ? [
          {
            id: 'remove',
            label: t('image.remove'),
            icon: <X size={16} />,
            danger: true,
            onSelect: () => onChange(null),
          },
        ]
      : []),
  ];

  return (
    <div
      ref={box}
      className={['image-field', large && 'image-field-large', drop.over && 'image-field-over']
        .filter(Boolean)
        .join(' ')}
      {...drop.dropProps}
    >
      <button
        type="button"
        className="image-field-btn"
        disabled={readOnly}
        aria-label={label}
        title={readOnly ? label : t('image.hint')}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setMenu({ x: r.left, y: r.bottom + 4 });
        }}
        onPaste={(e) => {
          const file = clipboardImage(e);
          if (!file || readOnly) return;
          e.preventDefault();
          void run(() => saveImageFile(project, folder, file, stamp()));
        }}
      >
        {url ? <img src={url} alt="" draggable={false} /> : <ImagePlus size={large ? 28 : 18} aria-hidden="true" />}
      </button>
      {menu && <Menu entries={entries} x={menu.x} y={menu.y} label={label} onClose={() => setMenu(null)} />}
      {picking && (
        <AssetPicker
          project={project}
          title={label}
          onPick={(path) => onChange(path)}
          onClose={() => setPicking(false)}
        />
      )}
    </div>
  );
}
