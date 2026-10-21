// Documents (F5-02, F5-05): folders and documents on the left, the open document on the right; deleted
// documents wait in the trash until it is emptied. Documents are Markdown files under documents/; the editor
// writes them through the self-checking save (documents/markdown.ts).

import {
  ChevronDown,
  ChevronRight,
  Download,
  FilePlus,
  FileText,
  Folder,
  FolderInput,
  FolderOpen,
  FolderPlus,
  LayoutTemplate,
  Pencil,
  RotateCcw,
  Trash,
  Trash2,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { searchKey } from '../../canvas/ops';
import { useStore } from '../../core/useStore';
import {
  addDocument,
  addFolder,
  deleteFolder,
  deleteForever,
  docFolder,
  docName,
  documentFolders,
  listDocuments,
  moveDocument,
  moveFolder,
  renameDocument,
  restoreDocument,
  trashDocument,
  type DocumentFile,
} from '../../documents/model';
import {
  builtInTemplates,
  deleteTemplate,
  ownTemplates,
  saveTemplate,
  type DocumentTemplate,
} from '../../documents/templates';
import { formatDate, getLocale, t } from '../../i18n';
import type { OpenProject } from '../../state/project';
import { Button, EmptyState, IconButton, Menu, toast, type MenuEntry } from '../components';
import { PromptDialog, type PromptRequest } from '../canvas/PromptDialog';
import { usePointerDrag } from '../usePointerDrag';
import { DocumentView } from './DocumentView';
import { exportMarkdown } from './exportDocs';
import { useEmbedLookup } from './embedLookup';
import './documents.css';

const TRASH = '\u0000trash';

export function DocumentsEditor({
  project,
  doc,
  onDoc,
}: {
  project: OpenProject;
  doc: string | null;
  onDoc: (id: string | null) => void;
}) {
  useEmbedLookup(project);
  const { store, readOnly } = project;
  const documents = useStore(store, (s) => s.documents);
  const documentMeta = useStore(store, (s) => s.documentMeta);
  const live = useMemo(() => listDocuments({ documents }), [documents]);
  const trash = useMemo(() => listDocuments({ documents }, true), [documents]);
  const folders = useMemo(() => documentFolders({ documents, documentMeta }), [documents, documentMeta]);
  const [query, setQuery] = useState('');
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<{ x: number; y: number; entries: MenuEntry[] } | null>(null);
  const [prompt, setPrompt] = useState<PromptRequest | null>(null);
  const change = (label: string, recipe: Parameters<typeof store.dispatch>[1]) =>
    !readOnly && store.dispatch(label, recipe);

  const open = live.find((d) => d.id === doc) ? doc : null;
  const showTrash = doc === TRASH;

  const create = (folder: string, template?: DocumentTemplate) => {
    let id = '';
    change(t('docs.step.create'), (d) => {
      id = addDocument(d, folder, template?.name ?? t('docs.newName'), template?.body ?? '');
    });
    if (id) onDoc(id);
    if (folder) setClosed((s) => new Set([...s].filter((f) => f !== folder && !folder.startsWith(`${f}/`))));
  };
  // "New document": empty, from one of our templates or from the designer's own.
  const own = ownTemplates({ documentMeta });
  const templateMenu = (folder: string, x: number, y: number) =>
    setMenu({
      x,
      y,
      entries: [
        { id: 'empty', label: t('docs.template.empty'), icon: <FilePlus size={16} />, onSelect: () => create(folder) },
        { id: 'sep1', separator: true },
        ...builtInTemplates(getLocale()).map((tpl) => ({
          id: `b:${tpl.id}`,
          label: tpl.name,
          icon: <LayoutTemplate size={16} />,
          onSelect: () => create(folder, tpl),
        })),
        ...(own.length ? [{ id: 'sep2', separator: true as const }] : []),
        ...own.map((tpl) => ({
          id: `o:${tpl.id}`,
          label: tpl.name,
          icon: <FileText size={16} />,
          onSelect: () => create(folder, tpl),
        })),
        ...(own.length
          ? [
              {
                id: 'forget',
                label: t('docs.template.delete'),
                icon: <Trash size={16} />,
                onSelect: () =>
                  setMenu({
                    x,
                    y,
                    entries: own.map((tpl) => ({
                      id: `d:${tpl.id}`,
                      label: tpl.name,
                      danger: true,
                      onSelect: () => change(t('docs.step.template'), (d) => deleteTemplate(d, tpl.id)),
                    })),
                  }),
              },
            ]
          : []),
      ],
    });
  const asTemplate = (d: DocumentFile) =>
    setPrompt({
      title: t('docs.template.save'),
      label: t('docs.template.name'),
      value: docName(d.path),
      onSubmit: (name) => {
        change(t('docs.step.template'), (x) => void saveTemplate(x, name, d.body));
        toast({ kind: 'success', text: t('docs.template.saved', { name }) }, 2000);
      },
    });
  const newFolder = (parent: string) =>
    setPrompt({
      title: t('docs.newFolder'),
      label: t('docs.folderName'),
      value: t('docs.newFolderName'),
      onSubmit: (name) => change(t('docs.step.folder'), (d) => void addFolder(d, parent, name)),
    });
  const rename = (d: DocumentFile) =>
    setPrompt({
      title: t('docs.rename'),
      label: t('docs.name'),
      value: docName(d.path),
      onSubmit: (name) => change(t('docs.step.rename'), (x) => renameDocument(x, d.id, name)),
    });
  const renameFolder = (folder: string) =>
    setPrompt({
      title: t('docs.renameFolder'),
      label: t('docs.folderName'),
      value: docName(folder),
      onSubmit: (name) => {
        const parent = docFolder(folder);
        const to = parent ? `${parent}/${name.trim()}` : name.trim();
        change(t('docs.step.folder'), (d) => moveFolder(d, folder, to));
      },
    });
  const toTrash = (d: DocumentFile) => {
    change(t('docs.step.trash'), (x) => trashDocument(x, d.id));
    if (open === d.id) onDoc(null);
  };
  const removeFolder = (folder: string) => {
    const inside = live.filter((d) => d.path.startsWith(`${folder}/`)).length;
    if (inside && !window.confirm(t('docs.deleteFolderUsed', { count: inside }))) return;
    change(t('docs.step.deleteFolder'), (d) => deleteFolder(d, folder));
    if (open && live.find((d) => d.id === open)?.path.startsWith(`${folder}/`)) onDoc(null);
  };
  const moveTo = (id: string, folder: string) => change(t('docs.step.move'), (d) => moveDocument(d, id, folder));

  const moveMenu = (d: DocumentFile): MenuEntry[] => [
    { id: 'root', label: t('docs.root'), disabled: !docFolder(d.path), onSelect: () => moveTo(d.id, '') },
    ...folders.map((f) => ({
      id: `f:${f}`,
      label: `${'  '.repeat(f.split('/').length - 1)}${docName(f)}`,
      disabled: docFolder(d.path) === f,
      onSelect: () => moveTo(d.id, f),
    })),
  ];
  const docMenu = (d: DocumentFile, x: number, y: number) =>
    setMenu({
      x,
      y,
      entries: [
        {
          id: 'rename',
          label: t('docs.rename'),
          icon: <Pencil size={16} />,
          disabled: readOnly,
          onSelect: () => rename(d),
        },
        {
          id: 'move',
          label: t('docs.moveTo'),
          icon: <FolderInput size={16} />,
          disabled: readOnly,
          onSelect: () => setMenu({ x, y, entries: moveMenu(d) }),
        },
        {
          id: 'template',
          label: t('docs.template.save'),
          icon: <LayoutTemplate size={16} />,
          disabled: readOnly,
          onSelect: () => asTemplate(d),
        },
        { id: 'sep', separator: true },
        {
          id: 'trash',
          label: t('docs.toTrash'),
          icon: <Trash size={16} />,
          danger: true,
          disabled: readOnly,
          onSelect: () => toTrash(d),
        },
      ],
    });
  const folderMenu = (folder: string, x: number, y: number) =>
    setMenu({
      x,
      y,
      entries: [
        {
          id: 'doc',
          label: t('docs.newDoc'),
          icon: <FilePlus size={16} />,
          disabled: readOnly,
          onSelect: () => templateMenu(folder, x, y),
        },
        {
          id: 'folder',
          label: t('docs.newFolder'),
          icon: <FolderPlus size={16} />,
          disabled: readOnly,
          onSelect: () => newFolder(folder),
        },
        {
          id: 'rename',
          label: t('docs.renameFolder'),
          icon: <Pencil size={16} />,
          disabled: readOnly,
          onSelect: () => renameFolder(folder),
        },
        { id: 'sep', separator: true },
        {
          id: 'delete',
          label: t('docs.deleteFolder'),
          icon: <Trash size={16} />,
          danger: true,
          disabled: readOnly,
          onSelect: () => removeFolder(folder),
        },
      ],
    });

  // Documents dragged onto a folder (or onto the list itself: the top level) move there.
  const moving = usePointerDrag('data-doc-folder', (id, folder) => moveTo(id, folder === '/' ? '' : folder));

  const q = searchKey(query);
  const matches = (d: DocumentFile) => !q || searchKey(docName(d.path)).includes(q) || searchKey(d.body).includes(q);
  const found = q ? live.filter(matches) : null;

  const docRow = (d: DocumentFile, depth: number) => (
    <button
      key={d.id}
      type="button"
      className="schema-item docs-item"
      aria-current={open === d.id ? 'true' : undefined}
      data-doc={d.id}
      style={{ paddingLeft: 8 + depth * 16 }}
      title={d.path}
      {...(readOnly ? {} : moving.handle(d.id))}
      onClick={() => onDoc(d.id)}
      onContextMenu={(e) => {
        e.preventDefault();
        docMenu(d, e.clientX, e.clientY);
      }}
    >
      <FileText size={14} aria-hidden="true" />
      <span className="docs-item-name">{docName(d.path)}</span>
    </button>
  );

  const tree = (parent: string, depth: number): React.ReactNode[] => {
    const subfolders = folders.filter((f) => docFolder(f) === parent);
    const here = live.filter((d) => docFolder(d.path) === parent);
    return [
      ...subfolders.flatMap((f) => {
        const isClosed = closed.has(f);
        return [
          <button
            key={`f:${f}`}
            type="button"
            className={['schema-item', moving.dragged && moving.over === f && 'assets-tree-over']
              .filter(Boolean)
              .join(' ')}
            data-doc-folder={f}
            style={{ paddingLeft: 8 + depth * 16 }}
            aria-expanded={!isClosed}
            onClick={() =>
              setClosed((s) => {
                const next = new Set(s);
                if (isClosed) next.delete(f);
                else next.add(f);
                return next;
              })
            }
            onContextMenu={(e) => {
              e.preventDefault();
              folderMenu(f, e.clientX, e.clientY);
            }}
          >
            {isClosed ? <ChevronRight size={12} aria-hidden="true" /> : <ChevronDown size={12} aria-hidden="true" />}
            {isClosed ? <Folder size={14} aria-hidden="true" /> : <FolderOpen size={14} aria-hidden="true" />}
            <span className="docs-item-name">{docName(f)}</span>
          </button>,
          ...(isClosed ? [] : tree(f, depth + 1)),
        ];
      }),
      ...here.map((d) => docRow(d, depth)),
    ];
  };

  return (
    <div className="docs" data-tour="docs">
      <nav
        className={['docs-tree', moving.dragged && moving.over === '/' && 'assets-tree-over'].filter(Boolean).join(' ')}
        aria-label={t('module.documents')}
        data-doc-folder="/"
      >
        <div className="docs-tree-head">
          <input
            className="input"
            type="search"
            value={query}
            placeholder={t('docs.search')}
            aria-label={t('docs.search')}
            onChange={(e) => setQuery(e.target.value)}
          />
          {!readOnly && (
            <>
              <IconButton
                size="sm"
                label={t('docs.export.md')}
                icon={<Download size={16} />}
                onClick={() => void exportMarkdown(project)}
              />
              <IconButton
                size="sm"
                label={t('docs.newFolder')}
                icon={<FolderPlus size={16} />}
                onClick={() => newFolder('')}
              />
              <IconButton
                size="sm"
                label={t('docs.newDoc')}
                icon={<FilePlus size={16} />}
                onClick={(e) => {
                  const r = e.currentTarget.getBoundingClientRect();
                  templateMenu('', r.left, r.bottom + 4);
                }}
              />
            </>
          )}
        </div>
        <div className="docs-tree-list">
          {found ? (
            found.length ? (
              found.map((d) => docRow(d, 0))
            ) : (
              <p className="muted small">{t('docs.nothingFound')}</p>
            )
          ) : live.length === 0 && folders.length === 0 ? (
            <p className="muted small">{t('docs.none')}</p>
          ) : (
            tree('', 0)
          )}
        </div>
        <button
          type="button"
          className="schema-item docs-trash-item"
          aria-current={showTrash ? 'true' : undefined}
          onClick={() => onDoc(TRASH)}
        >
          <Trash2 size={14} aria-hidden="true" />
          <span className="docs-item-name">{t('docs.trash')}</span>
          {trash.length > 0 && <span className="muted small">{trash.length}</span>}
        </button>
      </nav>

      <div className="docs-main">
        {showTrash ? (
          <TrashView project={project} items={trash} onOpen={onDoc} />
        ) : open ? (
          <DocumentView key={open} project={project} id={open} />
        ) : (
          <div className="docs-start">
            <EmptyState
              title={live.length ? t('docs.pick') : t('docs.empty')}
              text={live.length ? '' : t('docs.emptyHint')}
            />
            {!readOnly && (
              <section className="docs-gallery" aria-label={t('docs.gallery')}>
                <h3 className="insp-heading">{t('docs.gallery')}</h3>
                <div className="docs-gallery-grid">
                  <TemplateCard
                    icon={<FilePlus size={20} />}
                    name={t('docs.template.empty')}
                    hint={t('docs.template.emptyHint')}
                    onPick={() => create('')}
                  />
                  {builtInTemplates(getLocale()).map((tpl) => (
                    <TemplateCard
                      key={tpl.id}
                      icon={<LayoutTemplate size={20} />}
                      name={tpl.name}
                      hint={tpl.hint ?? ''}
                      onPick={() => create('', tpl)}
                    />
                  ))}
                  {own.map((tpl) => (
                    <TemplateCard
                      key={tpl.id}
                      icon={<FileText size={20} />}
                      name={tpl.name}
                      hint={t('docs.template.own')}
                      onPick={() => create('', tpl)}
                    />
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </div>

      {menu && (
        <Menu entries={menu.entries} x={menu.x} y={menu.y} label={t('docs.menu')} onClose={() => setMenu(null)} />
      )}
      <PromptDialog request={prompt} onClose={() => setPrompt(null)} />
    </div>
  );
}

/** A template on the start page of the documents: a click makes a document from it. */
function TemplateCard({
  icon,
  name,
  hint,
  onPick,
}: {
  icon: React.ReactNode;
  name: string;
  hint: string;
  onPick: () => void;
}) {
  return (
    <button type="button" className="docs-template" onClick={onPick}>
      <span className="docs-template-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="docs-template-name">{name}</span>
      {hint && <span className="docs-template-hint muted small">{hint}</span>}
    </button>
  );
}

function TrashView({
  project,
  items,
  onOpen,
}: {
  project: OpenProject;
  items: DocumentFile[];
  onOpen: (id: string | null) => void;
}) {
  const { store, readOnly } = project;
  const empty = () => {
    if (!window.confirm(t('docs.emptyTrashConfirm', { count: items.length }))) return;
    store.dispatch(t('docs.step.emptyTrash'), (d) => items.forEach((x) => deleteForever(d, x.id)));
  };
  return (
    <div className="docs-trash">
      <header className="world-bar">
        <h2 className="docs-trash-title">{t('docs.trash')}</h2>
        {!readOnly && items.length > 0 && (
          <Button size="sm" variant="danger" icon={<Trash size={14} />} onClick={empty}>
            {t('docs.emptyTrash')}
          </Button>
        )}
      </header>
      {items.length === 0 ? (
        <EmptyState title={t('docs.trashEmpty')} text={t('docs.trashHint')} />
      ) : (
        <ul className="docs-trash-list">
          {items.map((d) => (
            <li key={d.id} className="docs-trash-row">
              <FileText size={14} aria-hidden="true" />
              <span className="docs-item-name">{docName(d.path)}</span>
              <span className="muted small">
                {docFolder(d.path) || t('docs.root')} · {formatDate(d.trashedAt!)}
              </span>
              {!readOnly && (
                <>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<RotateCcw size={14} />}
                    onClick={() => {
                      store.dispatch(t('docs.step.restore'), (x) => restoreDocument(x, d.id));
                      onOpen(d.id);
                    }}
                  >
                    {t('docs.restore')}
                  </Button>
                  <IconButton
                    size="sm"
                    label={t('docs.deleteForever')}
                    icon={<Trash size={14} />}
                    onClick={() => {
                      if (!window.confirm(t('docs.deleteForeverConfirm', { name: docName(d.path) }))) return;
                      store.dispatch(t('docs.step.deleteForever'), (x) => deleteForever(x, d.id));
                    }}
                  />
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
