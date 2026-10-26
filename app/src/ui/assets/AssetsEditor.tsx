// The asset library (F4-11, F4-12): folders (with colours) on the left, files of the open folder in the
// middle, the selected file on the right with a preview, "open in Windows", "show in the explorer" and
// where it is used. Files and whole folders can be dropped in from the explorer; files move between folders
// by dragging them onto a folder or with "Move to…" of the right-click menu (0.5).

import {
  ExternalLink,
  File as FileIcon,
  FileText,
  Folder,
  FolderInput,
  FolderOpen,
  FolderPlus,
  FolderUp,
  Palette,
  Pencil,
  Trash,
  Upload,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { searchKey } from '../../canvas/ops';
import { useAtom, useStore } from '../../core/useStore';
import { formatBytes, formatDate, t, type MessageKey } from '../../i18n';
import { platform } from '../../platform';
import type { AssetEntry, PlatformError } from '../../platform/types';
import { assetRequest, openDocument, openEntity, openMap, openTask, revealInStory } from '../../state/navigation';
import type { OpenProject } from '../../state/project';
import {
  assetUseCounts,
  assetUses,
  baseName,
  folderColors,
  forgetFolder,
  moveAssetRefs,
  moveInText,
  parentOf,
  setFolderColor,
  type AssetUse,
} from '../../world/assets';
import { Button, EmptyState, IconButton, Menu, Spinner, toast, type MenuEntry } from '../components';
import { PromptDialog, type PromptRequest } from '../canvas/PromptDialog';
import { errorText } from '../errors';
import { useAsync } from '../useAsync';
import { useFileDrop } from '../useFileDrop';
import { startAssetDrag, useAssetDropTarget, type AssetDropTarget } from '../assetDrag';
import { IMAGE_EXT } from '../world/ImageField';
import './assets.css';

const ROOT = 'assets';
const COLORS: [string, MessageKey][] = [
  ['#e5534b', 'assets.color.red'],
  ['#f0a43c', 'assets.color.orange'],
  ['#e8b931', 'assets.color.yellow'],
  ['#3fb97a', 'assets.color.green'],
  ['#4f8fe6', 'assets.color.blue'],
  ['#7b86ff', 'assets.color.violet'],
  ['#e0609f', 'assets.color.pink'],
];

function Thumb({ project, path, size }: { project: OpenProject; path: string; size: number }) {
  const image = IMAGE_EXT.test(path);
  const url = useAsync(
    () => (image ? platform().assetUrl(project.dir, path) : Promise.resolve('')),
    [project.dir, path],
    '',
  );
  return (
    <span className="asset-thumb" style={{ width: size, height: size }}>
      {url ? (
        <img src={url} alt="" loading="lazy" draggable={false} />
      ) : /\.(md|txt|json|csv)$/i.test(path) ? (
        <FileText size={size / 2.5} aria-hidden="true" />
      ) : (
        <FileIcon size={size / 2.5} aria-hidden="true" />
      )}
    </span>
  );
}

export function AssetsEditor({
  project,
  folder: openFolder,
  onFolder,
}: {
  project: OpenProject;
  /** The folder open in this tab (kept by the tab, so it stays open when the tab is left and come back to). */
  folder: string | null;
  onFolder: (folder: string) => void;
}) {
  const { store, readOnly, dir } = project;
  const data = useStore(store, (s) => s);
  const [version, setVersion] = useState(0);
  const entries = useAsync(() => platform().listAssets(dir), [dir, version], null as AssetEntry[] | null);
  const folder = openFolder ?? ROOT;
  const setFolder = onFolder;
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [prompt, setPrompt] = useState<PromptRequest | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; entries: MenuEntry[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = () => setVersion((v) => v + 1);

  // "Show this file" (a link to a file in a document): its folder opens and the file is selected.
  const wanted = useAtom(assetRequest);
  useEffect(() => {
    if (!wanted) return;
    const timer = setTimeout(() => {
      assetRequest.set(null);
      setQuery('');
      setFolder(parentOf(wanted.path));
      setSelected(wanted.path);
      refresh();
    }, 0);
    return () => clearTimeout(timer);
    // The tab's setter is a new function each time; the request alone starts this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted]);
  const counts = useMemo(() => assetUseCounts(data), [data]);
  const colors = folderColors(data);

  const folders = useMemo(() => (entries ?? []).filter((e) => e.kind === 'folder').map((e) => e.path), [entries]);
  const known = new Set(folders);
  const current = folder === ROOT || known.has(folder) ? folder : ROOT;
  const q = searchKey(query.trim());
  const shown = useMemo(() => {
    const list = entries ?? [];
    if (!q) return list.filter((e) => parentOf(e.path) === current);
    // Searching looks through every folder: folders by their name first, then files by name or by the
    // folders they are in.
    return [
      ...list.filter((e) => e.kind === 'folder' && searchKey(baseName(e.path)).includes(q)),
      ...list.filter((e) => e.kind === 'file' && searchKey(e.path.slice(ROOT.length)).includes(q)),
    ];
  }, [entries, q, current]);
  /** While searching, the tree keeps the folders that match and the folders above them. */
  const treeFolders = useMemo(() => {
    if (!q) return folders;
    const keep = new Set<string>();
    for (const path of folders) {
      if (!searchKey(baseName(path)).includes(q)) continue;
      for (let p = path; p !== ROOT && p; p = parentOf(p)) keep.add(p);
    }
    return folders.filter((path) => keep.has(path));
  }, [folders, q]);

  /** Runs a disk operation, reports a failure, and lists the library again. */
  const run = async (job: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await job();
    } catch (e) {
      toast({ kind: 'error', text: errorText(e) });
    } finally {
      setBusy(false);
      refresh();
    }
  };

  const importPaths = (paths: string[], into: string) =>
    run(async () => {
      const copied = await platform().importAssets(dir, paths, into);
      toast({ kind: 'success', text: t('assets.imported', { count: copied.length }) });
    });
  const importFiles = (files: File[], into: string) =>
    run(async () => {
      for (const f of files) await platform().writeAsset(dir, into, f.name, new Uint8Array(await f.arrayBuffer()));
      toast({ kind: 'success', text: t('assets.imported', { count: files.length }) });
    });

  /** Renames or moves on disk, then points the project's references at the new place. */
  const move = (from: string, to: string) =>
    run(async () => {
      if (from === to) return;
      await platform().assetMove(dir, from, to);
      // Undo cannot move the file back, so the references follow it outside the undo history.
      store.dispatch(t('assets.step.move'), (d) => moveAssetRefs(d, from, to), { history: false });
      store.rewriteHistory((text) => moveInText(text, from, to));
      if (selected && (selected === from || selected.startsWith(`${from}/`)))
        setSelected(to + selected.slice(from.length));
      if (current === from || current.startsWith(`${from}/`)) setFolder(to + current.slice(from.length));
    });

  // A file or a folder dragged onto a folder — in the tree, among the files, in the path above — moves there
  // (0.7.3: the files and folders among the files take it too, and folders are dragged as well).
  const into = (folder: string): AssetDropTarget => ({
    accepts: (from) => !readOnly && from !== folder && !folder.startsWith(`${from}/`) && parentOf(from) !== folder,
    drop: (from) => void move(from, `${folder}/${baseName(from)}`),
  });

  const remove = (path: string, isFolder: boolean) => {
    const uses = assetUses(store.getState(), path).length;
    const question = uses
      ? t('assets.deleteUsed', { name: baseName(path), count: uses })
      : t(isFolder ? 'assets.deleteFolder' : 'assets.deleteFile', { name: baseName(path) });
    if (!window.confirm(question)) return;
    void run(async () => {
      try {
        await platform().assetDelete(dir, path);
      } catch (e) {
        // No Recycle Bin on that drive: only a clear second "yes" deletes for good.
        if ((e as PlatformError).code !== 'io' || !window.confirm(t('assets.deleteForever', { name: baseName(path) })))
          throw e;
        await platform().assetDelete(dir, path, true);
      }
      if (isFolder) store.dispatch(t('assets.step.color'), (d) => forgetFolder(d, path), { history: false });
      if (selected && (selected === path || selected.startsWith(`${path}/`))) setSelected(null);
      if (current === path || current.startsWith(`${path}/`)) setFolder(parentOf(path));
    });
  };

  const rename = (path: string) =>
    setPrompt({
      title: t('assets.rename'),
      label: t('assets.name'),
      value: baseName(path),
      onSubmit: (name) => void move(path, `${parentOf(path)}/${name}`),
    });
  /** A new folder in `parent` (the open folder, or the one whose menu was used). */
  const newFolder = (parent: string = current) =>
    setPrompt({
      title: t('assets.newFolder'),
      label: t('assets.name'),
      value: '',
      onSubmit: (name) => void run(() => platform().assetMkdir(dir, `${parent}/${name}`)),
    });
  const upload = () =>
    void run(async () => {
      const paths = await platform().pickFiles(t('assets.upload'));
      if (paths.length) {
        const copied = await platform().importAssets(dir, paths, current);
        toast({ kind: 'success', text: t('assets.imported', { count: copied.length }) });
      }
    });
  const uploadFolder = () =>
    void run(async () => {
      const path = await platform().pickFolder(t('assets.uploadFolder'));
      if (path) {
        const copied = await platform().importAssets(dir, [path], current);
        toast({ kind: 'success', text: t('assets.imported', { count: copied.length }) });
      }
    });

  /** "Move to…": every other folder; a folder cannot go into itself or into a folder inside it. */
  const moveMenu = (path: string, x: number, y: number) =>
    setMenu({
      x,
      y,
      entries: [ROOT, ...folders]
        .filter((f) => f !== path && !f.startsWith(`${path}/`))
        .map((f) => ({
          id: `to:${f}`,
          label: f === ROOT ? t('module.assets') : `${'  '.repeat(f.split('/').length - 2)}${baseName(f)}`,
          icon: <Folder size={16} style={{ color: colors[f] ?? undefined }} />,
          disabled: parentOf(path) === f,
          onSelect: () => void move(path, `${f}/${baseName(path)}`),
        })),
    });
  const openFile = (path: string) =>
    void platform()
      .openAsset(dir, path)
      .catch((x) => toast({ kind: 'error', text: errorText(x) }));
  /** Right click on a file: open it, show it in the explorer, rename, move to another folder, delete. */
  const fileMenu = (path: string, x: number, y: number) => {
    setSelected(path);
    setMenu({
      x,
      y,
      entries: [
        { id: 'open', label: t('assets.open'), icon: <ExternalLink size={16} />, onSelect: () => openFile(path) },
        { id: 'reveal', label: t('assets.reveal'), icon: <FolderOpen size={16} />, onSelect: () => void reveal(path) },
        { id: 'sep', separator: true },
        {
          id: 'rename',
          label: t('assets.rename'),
          icon: <Pencil size={16} />,
          disabled: readOnly,
          onSelect: () => rename(path),
        },
        {
          id: 'move',
          label: t('assets.moveTo'),
          icon: <FolderInput size={16} />,
          disabled: readOnly,
          onSelect: () => moveMenu(path, x, y),
        },
        { id: 'sep2', separator: true },
        {
          id: 'delete',
          label: t('assets.delete'),
          icon: <Trash size={16} />,
          danger: true,
          disabled: readOnly,
          onSelect: () => remove(path, false),
        },
      ],
    });
  };

  const folderMenu = (path: string, x: number, y: number) =>
    setMenu({
      x,
      y,
      entries: [
        {
          id: 'new',
          label: t('assets.newFolder'),
          icon: <FolderPlus size={16} />,
          disabled: readOnly,
          onSelect: () => newFolder(path),
        },
        ...(path === ROOT
          ? []
          : [
              {
                id: 'rename',
                label: t('assets.rename'),
                icon: <Pencil size={16} />,
                disabled: readOnly,
                onSelect: () => rename(path),
              },
              {
                id: 'move',
                label: t('assets.moveTo'),
                icon: <FolderInput size={16} />,
                disabled: readOnly,
                onSelect: () => moveMenu(path, x, y),
              },
              ...COLORS.map(([c, name]) => ({
                id: `color-${c}`,
                label: t(name),
                icon: <span className="asset-color-dot" style={{ background: c }} />,
                disabled: readOnly,
                onSelect: () => store.dispatch(t('assets.step.color'), (d) => setFolderColor(d, path, c)),
              })),
              {
                id: 'nocolor',
                label: t('assets.noColor'),
                icon: <Palette size={16} />,
                disabled: readOnly || !colors[path],
                onSelect: () => store.dispatch(t('assets.step.color'), (d) => setFolderColor(d, path, null)),
              },
              { id: 'sep', separator: true as const },
              {
                id: 'reveal',
                label: t('assets.reveal'),
                icon: <FolderOpen size={16} />,
                onSelect: () => void reveal(path),
              },
              {
                id: 'delete',
                label: t('assets.delete'),
                icon: <Trash size={16} />,
                danger: true,
                disabled: readOnly,
                onSelect: () => remove(path, true),
              },
            ]),
      ],
    });

  const emptyMenu = (): MenuEntry[] => [
    {
      id: 'new',
      label: t('assets.newFolder'),
      icon: <FolderPlus size={16} />,
      disabled: readOnly,
      onSelect: () => newFolder(),
    },
    { id: 'sep', separator: true },
    { id: 'upload', label: t('assets.upload'), icon: <Upload size={16} />, disabled: readOnly, onSelect: upload },
    {
      id: 'uploadFolder',
      label: t('assets.uploadFolder'),
      icon: <FolderUp size={16} />,
      disabled: readOnly,
      onSelect: uploadFolder,
    },
    { id: 'sep2', separator: true },
    { id: 'reveal', label: t('assets.reveal'), icon: <FolderOpen size={16} />, onSelect: () => void reveal(current) },
  ];

  const reveal = async (path: string) => {
    try {
      await platform().revealInExplorer(await platform().joinPath(dir, ...path.split('/')));
    } catch (e) {
      toast({ kind: 'error', text: errorText(e) });
    }
  };

  const main = useRef<HTMLDivElement>(null);
  const drop = useFileDrop(main, {
    disabled: readOnly,
    onPaths: (paths) => void importPaths(paths, current),
    onFiles: (files) => void importFiles(files, current),
  });

  const file = selected ? (entries ?? []).find((e) => e.path === selected && e.kind === 'file') : undefined;

  return (
    <div className="assets" data-tour="assets">
      <nav
        className="assets-tree"
        aria-label={t('assets.folders')}
        onContextMenu={(m) => {
          if (m.defaultPrevented) return;
          m.preventDefault();
          folderMenu(ROOT, m.clientX, m.clientY);
        }}
      >
        <FolderRow
          path={ROOT}
          label={t('module.assets')}
          depth={0}
          current={current}
          color={null}
          readOnly={readOnly}
          onOpen={setFolder}
          onMenu={folderMenu}
          target={into(ROOT)}
          onDropPaths={(paths) => void importPaths(paths, ROOT)}
          onDropFiles={(files) => void importFiles(files, ROOT)}
        />
        {treeFolders.map((path) => (
          <FolderRow
            key={path}
            path={path}
            label={baseName(path)}
            depth={path.split('/').length - 1}
            current={current}
            color={colors[path] ?? null}
            readOnly={readOnly}
            onOpen={setFolder}
            onMenu={folderMenu}
            target={into(path)}
            onDropPaths={(paths) => void importPaths(paths, path)}
            onDropFiles={(files) => void importFiles(files, path)}
          />
        ))}
      </nav>

      <div className="assets-main">
        <header className="world-bar">
          <nav className="assets-crumbs" aria-label={t('assets.path')}>
            {current.split('/').map((part, i, all) => {
              const path = all.slice(0, i + 1).join('/');
              return (
                <Crumb key={path} target={into(path)} onClick={() => setFolder(path)}>
                  {i === 0 ? t('module.assets') : part}
                </Crumb>
              );
            })}
          </nav>
          <input
            className="input world-search"
            type="search"
            value={query}
            placeholder={t('assets.search')}
            aria-label={t('assets.search')}
            onChange={(e) => setQuery(e.target.value)}
          />
          {!readOnly && (
            <>
              <IconButton
                size="sm"
                label={t('assets.newFolder')}
                icon={<FolderPlus size={16} />}
                onClick={() => newFolder()}
              />
              <Button size="sm" variant="ghost" icon={<FolderUp size={14} />} onClick={uploadFolder}>
                {t('assets.uploadFolder')}
              </Button>
              <Button size="sm" variant="primary" icon={<Upload size={14} />} onClick={upload}>
                {t('assets.upload')}
              </Button>
            </>
          )}
          {busy && <Spinner />}
        </header>
        <div
          ref={main}
          className={['assets-content', drop.over && 'assets-content-over'].filter(Boolean).join(' ')}
          {...drop.dropProps}
          // Right click on an empty place: a new folder here, files or a folder from the disk (0.7.3).
          onContextMenu={(m) => {
            if (m.defaultPrevented || (m.target as HTMLElement).closest('.asset-item')) return;
            m.preventDefault();
            setMenu({ x: m.clientX, y: m.clientY, entries: emptyMenu() });
          }}
        >
          {entries === null ? (
            <Spinner />
          ) : shown.length === 0 ? (
            <EmptyState
              title={query ? t('assets.nothingFound') : t('assets.empty')}
              text={query ? '' : t('assets.emptyHint')}
            />
          ) : (
            <div className="assets-grid">
              {shown.map((e) =>
                e.kind === 'folder' ? (
                  <FolderTile
                    key={e.path}
                    path={e.path}
                    color={colors[e.path] ?? null}
                    readOnly={readOnly}
                    target={into(e.path)}
                    onOpen={() => {
                      setFolder(e.path);
                      setQuery('');
                    }}
                    onMenu={folderMenu}
                  />
                ) : (
                  <button
                    key={e.path}
                    type="button"
                    className={['asset-item', selected === e.path && 'asset-item-selected'].filter(Boolean).join(' ')}
                    title={e.path}
                    onPointerDown={readOnly ? undefined : (p) => startAssetDrag(e.path, false, p)}
                    onClick={() => setSelected(e.path)}
                    onDoubleClick={() => openFile(e.path)}
                    onContextMenu={(m) => {
                      m.preventDefault();
                      fileMenu(e.path, m.clientX, m.clientY);
                    }}
                  >
                    <Thumb project={project} path={e.path} size={88} />
                    <span className="asset-name">{baseName(e.path)}</span>
                    <span className="asset-meta muted">
                      {formatBytes(e.size)}
                      {counts.get(e.path) ? ` · ${t('assets.usedTimes', { count: counts.get(e.path)! })}` : ''}
                    </span>
                  </button>
                ),
              )}
            </div>
          )}
        </div>
      </div>

      {file && (
        <AssetDetails
          project={project}
          entry={file}
          folders={[ROOT, ...folders]}
          onClose={() => setSelected(null)}
          onRename={() => rename(file.path)}
          onMove={(to) => void move(file.path, `${to}/${baseName(file.path)}`)}
          onDelete={() => remove(file.path, false)}
          onReveal={() => void reveal(file.path)}
        />
      )}
      {menu && (
        <Menu entries={menu.entries} x={menu.x} y={menu.y} label={t('assets.folders')} onClose={() => setMenu(null)} />
      )}
      <PromptDialog request={prompt} onClose={() => setPrompt(null)} />
    </div>
  );
}

function FolderRow({
  path,
  label,
  depth,
  current,
  color,
  readOnly,
  onOpen,
  onMenu,
  target,
  onDropPaths,
  onDropFiles,
}: {
  path: string;
  label: string;
  depth: number;
  current: string;
  color: string | null;
  readOnly: boolean;
  onOpen: (path: string) => void;
  onMenu: (path: string, x: number, y: number) => void;
  /** Files and folders of the library dropped here move into this folder. */
  target: AssetDropTarget;
  onDropPaths: (paths: string[]) => void;
  onDropFiles: (files: File[]) => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const drop = useFileDrop(ref, { disabled: readOnly, onPaths: onDropPaths, onFiles: onDropFiles });
  const movingOver = useAssetDropTarget(ref, target);
  return (
    <button
      ref={ref}
      type="button"
      className={['schema-item', (movingOver || drop.over) && 'assets-tree-over'].filter(Boolean).join(' ')}
      aria-current={current === path ? 'true' : undefined}
      style={{ paddingLeft: 8 + depth * 16 }}
      onClick={() => onOpen(path)}
      onPointerDown={readOnly || path === ROOT ? undefined : (e) => startAssetDrag(path, true, e)}
      onContextMenu={(e) => {
        e.preventDefault();
        onMenu(path, e.clientX, e.clientY);
      }}
      {...drop.dropProps}
    >
      {current === path ? (
        <FolderOpen size={14} aria-hidden="true" style={{ color: color ?? undefined }} />
      ) : (
        <Folder size={14} aria-hidden="true" style={{ color: color ?? undefined }} />
      )}
      {label}
    </button>
  );
}

/** A folder among the files: opens on a click, is dragged, takes files and folders dropped on it. */
function FolderTile({
  path,
  color,
  readOnly,
  target,
  onOpen,
  onMenu,
}: {
  path: string;
  color: string | null;
  readOnly: boolean;
  target: AssetDropTarget;
  onOpen: () => void;
  onMenu: (path: string, x: number, y: number) => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const over = useAssetDropTarget(ref, target);
  return (
    <button
      ref={ref}
      type="button"
      className={['asset-item', 'asset-item-folder', over && 'asset-drop-over'].filter(Boolean).join(' ')}
      onClick={onOpen}
      onPointerDown={readOnly ? undefined : (e) => startAssetDrag(path, true, e)}
      onContextMenu={(m) => {
        m.preventDefault();
        onMenu(path, m.clientX, m.clientY);
      }}
    >
      <span className="asset-thumb" style={{ color: color ?? undefined }}>
        <Folder size={40} aria-hidden="true" />
      </span>
      <span className="asset-name">{baseName(path)}</span>
    </button>
  );
}

/** A folder of the path above the files: opens it, takes files and folders dropped on it. */
function Crumb({ target, onClick, children }: { target: AssetDropTarget; onClick: () => void; children: ReactNode }) {
  const ref = useRef<HTMLButtonElement>(null);
  const over = useAssetDropTarget(ref, target);
  return (
    <button
      ref={ref}
      type="button"
      className={['story-crumb-btn', over && 'asset-drop-over'].filter(Boolean).join(' ')}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function usageText(u: AssetUse): string {
  switch (u.kind) {
    case 'cover':
      return t('assets.use.cover');
    case 'entity':
      return t('assets.use.entity', { name: u.name || t('story.untitled') });
    case 'field':
      return t('assets.use.field', { name: u.name || t('story.untitled'), field: u.field });
    case 'chapter':
      return t('assets.use.chapter', { title: u.title || t('story.untitled') });
    case 'document':
      return t('assets.use.document', { name: u.name });
    case 'map':
      return t('assets.use.map');
    case 'task':
      return t('assets.use.task', { name: u.name || t('story.untitled') });
  }
}

function AssetDetails({
  project,
  entry,
  folders,
  onClose,
  onRename,
  onMove,
  onDelete,
  onReveal,
}: {
  project: OpenProject;
  entry: AssetEntry;
  folders: string[];
  onClose: () => void;
  onRename: () => void;
  onMove: (folder: string) => void;
  onDelete: () => void;
  onReveal: () => void;
}) {
  const { readOnly, dir } = project;
  const data = useStore(project.store, (s) => s);
  const uses = assetUses(data, entry.path);
  const go = (u: AssetUse) => {
    if (u.kind === 'entity' || u.kind === 'field') openEntity(u.entity);
    else if (u.kind === 'chapter') revealInStory({ graph: u.graph, node: u.node, highlight: [u.node] });
    else if (u.kind === 'document') openDocument(u.doc);
    else if (u.kind === 'map') openMap(u.node);
    else if (u.kind === 'task') openTask(u.task);
  };
  const row = (label: string, value: ReactNode) => (
    <div className="asset-prop">
      <span className="muted small">{label}</span>
      <span>{value}</span>
    </div>
  );
  return (
    <aside className="world-panel asset-panel" aria-label={baseName(entry.path)}>
      <header className="world-panel-head">
        <strong className="asset-panel-title">{baseName(entry.path)}</strong>
        <IconButton size="sm" label={t('world.closeCard')} icon={<X size={16} />} onClick={onClose} />
      </header>
      <div className="world-panel-body">
        <Thumb project={project} path={entry.path} size={240} />
        {row(t('assets.size'), formatBytes(entry.size))}
        {entry.modifiedMs > 0 && row(t('assets.modified'), formatDate(entry.modifiedMs))}
        <div className="field">
          <label className="field-label" htmlFor="asset-folder">
            {t('assets.folder')}
          </label>
          <select
            id="asset-folder"
            className="input select"
            value={parentOf(entry.path)}
            disabled={readOnly}
            onChange={(e) => onMove(e.target.value)}
          >
            {folders.map((f) => (
              <option key={f} value={f}>
                {f === 'assets' ? t('module.assets') : f.slice('assets/'.length)}
              </option>
            ))}
          </select>
        </div>
        <div className="insp-actions">
          <Button
            size="sm"
            icon={<ExternalLink size={14} />}
            onClick={() =>
              void platform()
                .openAsset(dir, entry.path)
                .catch((e) => toast({ kind: 'error', text: errorText(e) }))
            }
          >
            {t('assets.open')}
          </Button>
          <Button size="sm" variant="ghost" icon={<FolderOpen size={14} />} onClick={onReveal}>
            {t('assets.reveal')}
          </Button>
          {!readOnly && (
            <>
              <Button size="sm" variant="ghost" icon={<Pencil size={14} />} onClick={onRename}>
                {t('assets.rename')}
              </Button>
              <Button size="sm" variant="danger" icon={<Trash size={14} />} onClick={onDelete}>
                {t('assets.delete')}
              </Button>
            </>
          )}
        </div>
        <section className="insp-section">
          <h3 className="insp-heading">{t('world.uses')}</h3>
          {uses.length === 0 && <p className="muted small">{t('assets.notUsed')}</p>}
          {uses.map((u, i) => (
            <button key={i} type="button" className="var-use world-use" onClick={() => go(u)}>
              <span className="var-use-what">{usageText(u)}</span>
            </button>
          ))}
        </section>
      </div>
    </aside>
  );
}
