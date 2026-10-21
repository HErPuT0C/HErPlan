// One open document (F5-02, F5-03): its name, the formatting bar and the text. The text is TipTap with its own
// undo (Ctrl+Z in the text never "comes back"); every pause in typing writes the document through the
// self-checking Markdown save. Links to project objects open with a click, where the link leads (0.5).

import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react';
import {
  AtSign,
  Bold,
  Code,
  FileText,
  Heading1,
  Heading2,
  Heading3,
  Image as ImageIcon,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Minus,
  Pilcrow,
  Quote,
  Redo2,
  Strikethrough,
  Table as TableIcon,
  Underline,
  Undo2,
  FileDown,
  Palette,
  Type,
  Check,
  ExternalLink,
  SquareCheck,
  Trash,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useStore } from '../../core/useStore';
import { documentExtensions, parseMarkdown, TEXT_COLORS, writeMarkdown, type LinkKind } from '../../documents/markdown';
import { documentsLinkingTo } from '../../documents/links';
import { asDocument, docName, listDocuments, renameDocument, setBody } from '../../documents/model';
import { searchKey } from '../../canvas/ops';
import { graphTitle } from '../../story/flow';
import { listEntities } from '../../story/entities';
import { allGraphs, asStory } from '../../story/model';
import { typesFile } from '../../world/schema';
import { typeName } from '../world/typeNames';
import { mentionExtension, type MentionItem } from './mention';
import { getLocale, t, type MessageKey } from '../../i18n';
import { openDocument, openTask } from '../../state/navigation';
import { tasksLinkingTo } from '../../tasks/model';
import { onFlushEdits } from '../../state/pendingEdits';
import type { OpenProject } from '../../state/project';
import { IconButton, Menu, toast, type MenuEntry } from '../components';
import { PromptDialog, type PromptRequest } from '../canvas/PromptDialog';
import { AssetPicker } from '../world/AssetPicker';
import { useFileDrop } from '../useFileDrop';
import { attach, attachmentContent } from './attachments';
import { exportPdf } from './exportDocs';
import { openLink, placeLabel } from './places';
import { linkTarget, placeKey, placesOf } from '../../documents/places';
import { platform } from '../../platform';
import { InsertPicker } from './InsertPicker';

const COLOR_NAMES: Record<string, MessageKey> = {
  red: 'docs.color.red',
  orange: 'docs.color.orange',
  green: 'docs.color.green',
  blue: 'docs.color.blue',
  violet: 'docs.color.violet',
  grey: 'docs.color.grey',
};

/** Files of the assets by project folder, offered by "@". */
const assetFiles = new Map<string, string[]>();

/** A pause in typing this long writes the document. */
const SAVE_DELAY_MS = 400;

export function DocumentView({ project, id }: { project: OpenProject; id: string }) {
  const { store, readOnly } = project;
  const raw = useStore(store, (s) => s.documents[id]);
  const doc = useMemo(() => asDocument(raw), [raw]);
  const written = useRef(doc?.body ?? '');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const save = (editor: Editor) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const out = writeMarkdown(editor.getJSON());
    if (!out.exact) console.warn('document written with a difference on reading back', id);
    if (out.text === written.current) return;
    written.current = out.text;
    // Typing has its own undo in the editor; the project's undo steps keep the latest text (store.refreshHistory).
    store.dispatch(t('docs.step.edit'), (d) => setBody(d, id, out.text), { history: false });
    store.refreshHistory(['documents', id, 'body']);
  };

  // Files of the assets, for "@" (listed when a document opens).
  useEffect(() => {
    void platform()
      .listAssets(project.dir)
      .then((list) =>
        assetFiles.set(
          project.dir,
          list.filter((f) => f.kind === 'file').map((f) => f.path),
        ),
      )
      .catch(() => undefined);
  }, [project.dir]);

  // "@" offers cards, documents, story nodes and files by name.
  const mentionItems = (query: string): MentionItem[] => {
    const data = store.getState();
    const schema = typesFile(data);
    const q = searchKey(query.trim());
    const all: MentionItem[] = [
      ...listEntities(data).map((e) => ({
        kind: 'ent' as const,
        ref: e.id,
        label: e.name || t('story.untitled'),
        hint: typeName(schema.types.find((x) => x.id === e.type)),
      })),
      ...listDocuments(data)
        .filter((d) => d.id !== id)
        .map((d) => ({ kind: 'doc' as const, ref: d.id, label: docName(d.path), hint: t('docs.kind.doc') })),
      ...allGraphs(data)
        .filter((g) => g.kind === 'story' || g.kind === 'chapter')
        .flatMap((g) =>
          g.nodes
            .filter((n) => n.kind !== 'sticker' && asStory(n).title)
            .map((n) => ({
              kind: 'node' as const,
              ref: `${g.id}/${n.id}`,
              label: asStory(n).title,
              hint: graphTitle(data, g.id),
            })),
        ),
      ...(assetFiles.get(project.dir) ?? []).map((path) => ({
        kind: 'asset' as const,
        ref: path,
        label: path.slice(path.lastIndexOf('/') + 1),
        hint: t('docs.kind.asset'),
      })),
    ];
    const hits = all.filter((x) => !q || searchKey(x.label).includes(q));
    return [
      ...hits.filter((x) => searchKey(x.label).startsWith(q)),
      ...hits.filter((x) => !searchKey(x.label).startsWith(q)),
    ];
  };

  const [linkMenu, setLinkMenu] = useState<{ x: number; y: number; pos: number } | null>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const editorRef = useRef<Editor | null>(null);

  /** Copies the files into the attachments and puts them into the text at `at` (or where the cursor is). */
  const attachHere = async (source: Parameters<typeof attach>[1], at: number | null) => {
    const copied = await attach(project, source);
    const ed = editorRef.current;
    if (!copied.length || !ed || ed.isDestroyed) return;
    assetFiles.set(project.dir, [...(assetFiles.get(project.dir) ?? []), ...copied]);
    // Dropped on a paragraph or a heading: the files go after it rather than cut it in two, or in place of
    // it when it is empty.
    const $at = at === null ? null : ed.state.doc.resolve(at);
    const block = !!$at && $at.parent.isTextblock && $at.depth > 0;
    const where = !$at
      ? ed.state.selection.to
      : block && $at.parent.content.size === 0
        ? { from: $at.before(), to: $at.after() }
        : block
          ? $at.after()
          : $at.pos;
    ed.chain().focus().insertContentAt(where, attachmentContent(copied)).run();
  };
  // Files from the explorer (desktop build): the platform tells where they were dropped.
  const drop = useFileDrop(scroll, {
    disabled: readOnly,
    onPaths: (paths, point) => {
      const ed = editorRef.current;
      const at = ed && !ed.isDestroyed ? (ed.view.posAtCoords({ left: point.x, top: point.y })?.pos ?? null) : null;
      void attachHere({ paths }, at);
    },
    onFiles: (files) => void attachHere({ files }, null),
  });

  const editor = useEditor({
    extensions: documentExtensions([mentionExtension(mentionItems, t('docs.insert.none'))]),
    content: parseMarkdown(doc?.body ?? ''),
    editable: !readOnly,
    editorProps: {
      attributes: {
        class: 'doc-text',
        spellcheck: 'true',
        lang: getLocale(),
        'aria-label': t('docs.text'),
      },
      // Files dropped or pasted into the text go into the assets ("Document attachments") and into the text.
      handleDrop: (view, event) => {
        const files = [...(event.dataTransfer?.files ?? [])];
        if (!files.length || readOnly) return false;
        const at = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos ?? null;
        void attachHere({ files }, at);
        return true;
      },
      handlePaste: (_view, event) => {
        const data = event.clipboardData;
        const files = [...(data?.files ?? [])];
        // Text from Word or a browser may come with a picture of itself: the text wins.
        if (!files.length || readOnly || data?.getData('text/html') || data?.getData('text/plain')) return false;
        void attachHere({ files }, null);
        return true;
      },
      handleDOMEvents: {
        // A click on a link to a project object opens it where the link leads (0.5: a plain click, as the
        // owner expected; Ctrl+click still works). A web link is text to edit: Ctrl+click opens it.
        click: (_view, e) => {
          const target = e.target as HTMLElement;
          const el = target.closest<HTMLElement>('[data-link]');
          if (el) {
            const [kind, ...rest] = (el.dataset.link ?? '').split(':');
            openLink(store.getState(), kind as LinkKind, rest.join(':'), el.dataset.place ?? '');
            e.preventDefault();
            return true;
          }
          const a = target.closest<HTMLAnchorElement>('a[href]');
          if (a && (e.ctrlKey || e.metaKey)) {
            void platform()
              .openUrl(a.href)
              .catch(() => undefined);
            e.preventDefault();
            return true;
          }
          return false;
        },
        mouseover: (_view, e) => {
          const a = (e.target as HTMLElement).closest<HTMLAnchorElement>('a[href]');
          if (a) a.title = `${a.getAttribute('href')} — ${t('docs.link.webHint')}`;
          return false;
        },
        // Right click on a link: open it, choose where it leads, or take it out.
        contextmenu: (view, e) => {
          const el = (e.target as HTMLElement).closest<HTMLElement>('[data-link]');
          if (!el) return false;
          e.preventDefault();
          const pos = view.posAtDOM(el, 0);
          setLinkMenu({ x: e.clientX, y: e.clientY, pos });
          return true;
        },
      },
    },
    onUpdate: ({ editor: ed }) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => save(ed), SAVE_DELAY_MS);
    },
    onBlur: ({ editor: ed }) => save(ed),
  });

  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  // Ctrl+S, exports and closing the project take the text typed just now.
  useEffect(
    () =>
      onFlushEdits(() => {
        if (timer.current && editor && !editor.isDestroyed) save(editor);
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editor],
  );

  // Written when the document closes (another document opened, the tab closed).
  useEffect(
    () => () => {
      if (timer.current && editor && !editor.isDestroyed) save(editor);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editor],
  );

  // The file changed from elsewhere (undo of a step that replaced the document): show the new text.
  useEffect(() => {
    if (!editor || !doc || doc.body === written.current) return;
    written.current = doc.body;
    editor.commands.setContent(parseMarkdown(doc.body), { emitUpdate: false });
  }, [editor, doc]);

  if (!doc) return null;
  return (
    <div className="doc-view">
      <header className="doc-head">
        <NameField
          key={doc.path}
          value={docName(doc.path)}
          readOnly={readOnly}
          onCommit={(name) => store.dispatch(t('docs.step.rename'), (d) => renameDocument(d, id, name))}
        />
        <IconButton
          size="sm"
          label={t('docs.export.pdf')}
          icon={<FileDown size={16} />}
          onClick={() => void exportPdf(project, id)}
        />
      </header>
      {editor && !readOnly && <Toolbar project={project} editor={editor} doc={id} />}
      <div
        ref={scroll}
        className={['doc-scroll', drop.over && 'doc-scroll-over'].filter(Boolean).join(' ')}
        onClick={(e) => e.target === e.currentTarget && editor?.commands.focus('end')}
        {...drop.dropProps}
        // Drops on the text itself are the editor's (handleDrop); this takes those beside it.
        onDrop={(e) => {
          if (!e.defaultPrevented) drop.dropProps.onDrop(e);
        }}
      >
        <EditorContent editor={editor} className="doc-page" />
        <Backlinks project={project} id={id} />
      </div>
      {linkMenu && editor && (
        <LinkMenu
          project={project}
          editor={editor}
          {...linkMenu}
          readOnly={readOnly}
          onClose={() => setLinkMenu(null)}
        />
      )}
    </div>
  );
}

/** The menu of a link to a project object: open it, choose which of the object's places it leads to, remove it. */
function LinkMenu({
  project,
  editor,
  x,
  y,
  pos,
  readOnly,
  onClose,
}: {
  project: OpenProject;
  editor: Editor;
  x: number;
  y: number;
  pos: number;
  readOnly: boolean;
  onClose: () => void;
}) {
  const node = editor.state.doc.nodeAt(pos);
  if (!node || node.type.name !== 'objectLink') return null;
  const { kind, ref, place } = node.attrs as { kind: LinkKind; ref: string; place: string };
  const data = project.store.getState();
  const places = placesOf(data, kind, ref);
  const current = placeKey(linkTarget(data, kind, ref, place));
  const setPlace = (next: string) =>
    editor
      .chain()
      .command(({ tr }) => {
        tr.setNodeMarkup(pos, undefined, { ...node.attrs, place: next });
        return true;
      })
      .run();
  const entries: MenuEntry[] = [
    {
      id: 'open',
      label: t('docs.link.open'),
      icon: <ExternalLink size={16} />,
      onSelect: () => openLink(data, kind, ref, place),
    },
    ...(places.length > 1
      ? [
          { id: 'sep1', separator: true as const },
          { id: 'title', label: t('docs.place.title'), disabled: true, onSelect: () => undefined },
          ...places.map((p, i) => ({
            id: `p:${placeKey(p)}`,
            label: i === 0 ? `${placeLabel(data, p)} (${t('docs.place.own')})` : placeLabel(data, p),
            icon: placeKey(p) === current ? <Check size={16} /> : <span />,
            disabled: readOnly,
            onSelect: () => void setPlace(i === 0 ? '' : placeKey(p)),
          })),
        ]
      : []),
    ...(readOnly
      ? []
      : [
          { id: 'sep2', separator: true as const },
          {
            id: 'remove',
            label: t('docs.link.remove'),
            icon: <Trash size={16} />,
            danger: true,
            onSelect: () =>
              editor
                .chain()
                .focus()
                .deleteRange({ from: pos, to: pos + node.nodeSize })
                .run(),
          },
        ]),
  ];
  return <Menu entries={entries} x={x} y={y} label={t('docs.place.title')} onClose={onClose} />;
}

function NameField({
  value,
  readOnly,
  onCommit,
}: {
  value: string;
  readOnly: boolean;
  onCommit: (name: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const commit = () => {
    if (draft.trim() && draft.trim() !== value) onCommit(draft.trim());
    else setDraft(value);
  };
  return (
    <input
      className="input doc-name"
      value={draft}
      disabled={readOnly}
      aria-label={t('docs.name')}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          setDraft(value);
          requestAnimationFrame(() => (e.target as HTMLInputElement).blur());
        }
      }}
    />
  );
}

function Toolbar({ project, editor, doc }: { project: OpenProject; editor: Editor; doc: string }) {
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      underline: e.isActive('underline'),
      strike: e.isActive('strike'),
      code: e.isActive('code'),
      link: e.isActive('link'),
      h1: e.isActive('heading', { level: 1 }),
      h2: e.isActive('heading', { level: 2 }),
      h3: e.isActive('heading', { level: 3 }),
      bullet: e.isActive('bulletList'),
      ordered: e.isActive('orderedList'),
      quote: e.isActive('blockquote'),
      table: e.isActive('table'),
      color: (e.getAttributes('textColor').color as string | undefined) ?? null,
      font: (e.getAttributes('textFont').font as string | undefined) ?? null,
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  });
  const [picker, setPicker] = useState(false);
  const [images, setImages] = useState(false);
  const [prompt, setPrompt] = useState<PromptRequest | null>(null);
  const [tableMenu, setTableMenu] = useState<{ x: number; y: number } | null>(null);
  const [styleMenu, setStyleMenu] = useState<{ x: number; y: number; entries: MenuEntry[] } | null>(null);
  const openMenu = (e: { currentTarget: HTMLElement }, entries: MenuEntry[]) => {
    const r = e.currentTarget.getBoundingClientRect();
    setStyleMenu({ x: r.left, y: r.bottom + 4, entries });
  };
  const colorEntries: MenuEntry[] = [
    ...Object.entries(TEXT_COLORS).map(([name, value]) => ({
      id: name,
      label: t(COLOR_NAMES[name] ?? 'docs.color.none'),
      icon: <span className="doc-swatch" style={{ background: value }} />,
      onSelect: () => chain().setMark('textColor', { color: name }).run(),
    })),
    { id: 'sep', separator: true },
    { id: 'none', label: t('docs.color.none'), onSelect: () => chain().unsetMark('textColor').run() },
  ];
  const fontEntries: MenuEntry[] = [
    { id: 'default', label: t('docs.font.default'), onSelect: () => chain().unsetMark('textFont').run() },
    { id: 'serif', label: t('docs.font.serif'), onSelect: () => chain().setMark('textFont', { font: 'serif' }).run() },
    { id: 'mono', label: t('docs.font.mono'), onSelect: () => chain().setMark('textFont', { font: 'mono' }).run() },
  ];
  const chain = () => editor.chain().focus();

  const button = (label: string, icon: ReactNode, active: boolean, run: () => void, disabled = false) => (
    <IconButton
      size="sm"
      label={label}
      icon={icon}
      pressed={active}
      className={active ? 'doc-tool-on' : undefined}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={run}
    />
  );

  const link = () => {
    const current = String(editor.getAttributes('link').href ?? '');
    setPrompt({
      title: t('docs.link'),
      label: t('docs.linkUrl'),
      value: current || 'https://',
      allowEmpty: true,
      onSubmit: (href) => {
        const url = href.trim();
        if (!url || url === 'https://') chain().extendMarkRange('link').unsetLink().run();
        else chain().extendMarkRange('link').setLink({ href: url }).run();
      },
    });
  };

  const tableEntries: MenuEntry[] = state.table
    ? [
        { id: 'row', label: t('docs.table.rowAfter'), onSelect: () => chain().addRowAfter().run() },
        { id: 'col', label: t('docs.table.colAfter'), onSelect: () => chain().addColumnAfter().run() },
        { id: 'delRow', label: t('docs.table.deleteRow'), onSelect: () => chain().deleteRow().run() },
        { id: 'delCol', label: t('docs.table.deleteCol'), onSelect: () => chain().deleteColumn().run() },
        { id: 'sep', separator: true },
        { id: 'del', label: t('docs.table.delete'), danger: true, onSelect: () => chain().deleteTable().run() },
      ]
    : [];

  return (
    <div className="doc-toolbar" role="toolbar" aria-label={t('docs.toolbar')}>
      {button(t('docs.undo'), <Undo2 size={16} />, false, () => chain().undo().run(), !state.canUndo)}
      {button(t('docs.redo'), <Redo2 size={16} />, false, () => chain().redo().run(), !state.canRedo)}
      <span className="doc-tool-sep" />
      {button(t('docs.paragraph'), <Pilcrow size={16} />, false, () => chain().setParagraph().run())}
      {button(t('docs.h1'), <Heading1 size={16} />, state.h1, () => chain().toggleHeading({ level: 1 }).run())}
      {button(t('docs.h2'), <Heading2 size={16} />, state.h2, () => chain().toggleHeading({ level: 2 }).run())}
      {button(t('docs.h3'), <Heading3 size={16} />, state.h3, () => chain().toggleHeading({ level: 3 }).run())}
      <span className="doc-tool-sep" />
      {button(t('docs.bold'), <Bold size={16} />, state.bold, () => chain().toggleBold().run())}
      {button(t('docs.italic'), <Italic size={16} />, state.italic, () => chain().toggleItalic().run())}
      {button(t('docs.underline'), <Underline size={16} />, state.underline, () =>
        chain().toggleMark('underline').run(),
      )}
      {button(t('docs.strike'), <Strikethrough size={16} />, state.strike, () => chain().toggleStrike().run())}
      {button(t('docs.code'), <Code size={16} />, state.code, () => chain().toggleCode().run())}
      {button(t('docs.link'), <LinkIcon size={16} />, state.link, link)}
      <IconButton
        size="sm"
        label={t('docs.color')}
        icon={<Palette size={16} style={state.color ? { color: TEXT_COLORS[state.color] } : undefined} />}
        pressed={!!state.color}
        onMouseDown={(e) => e.preventDefault()}
        onClick={(e) => openMenu(e, colorEntries)}
      />
      <IconButton
        size="sm"
        label={t('docs.font')}
        icon={<Type size={16} />}
        pressed={!!state.font}
        className={state.font ? 'doc-tool-on' : undefined}
        onMouseDown={(e) => e.preventDefault()}
        onClick={(e) => openMenu(e, fontEntries)}
      />
      <span className="doc-tool-sep" />
      {button(t('docs.bullet'), <List size={16} />, state.bullet, () => chain().toggleBulletList().run())}
      {button(t('docs.ordered'), <ListOrdered size={16} />, state.ordered, () => chain().toggleOrderedList().run())}
      {button(t('docs.quote'), <Quote size={16} />, state.quote, () => chain().toggleBlockquote().run())}
      {button(t('docs.rule'), <Minus size={16} />, false, () => chain().setHorizontalRule().run())}
      <IconButton
        size="sm"
        label={state.table ? t('docs.table.menu') : t('docs.table.insert')}
        icon={<TableIcon size={16} />}
        className={state.table ? 'doc-tool-on' : undefined}
        onMouseDown={(e) => e.preventDefault()}
        onClick={(e) => {
          if (!state.table) return chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
          const r = e.currentTarget.getBoundingClientRect();
          setTableMenu({ x: r.left, y: r.bottom + 4 });
        }}
      />
      {button(t('docs.image'), <ImageIcon size={16} />, false, () => setImages(true))}
      <span className="doc-tool-sep" />
      {button(t('docs.insert.object'), <AtSign size={16} />, false, () => setPicker(true))}

      {picker && (
        <InsertPicker
          project={project}
          except={doc}
          onPick={(content) => chain().insertContent(content).insertContent(' ').run()}
          onClose={() => setPicker(false)}
        />
      )}
      {images && (
        <AssetPicker
          project={project}
          title={t('docs.image')}
          onPick={(src) => {
            chain()
              .setImage({
                src,
                alt:
                  src
                    .split('/')
                    .pop()
                    ?.replace(/\.[^.]+$/, '') ?? '',
              })
              .run();
            toast({ kind: 'success', text: t('docs.imageAdded') }, 1500);
          }}
          onClose={() => setImages(false)}
        />
      )}
      {styleMenu && (
        <Menu
          entries={styleMenu.entries}
          x={styleMenu.x}
          y={styleMenu.y}
          label={t('docs.toolbar')}
          onClose={() => setStyleMenu(null)}
        />
      )}
      {tableMenu && (
        <Menu
          entries={tableEntries}
          x={tableMenu.x}
          y={tableMenu.y}
          label={t('docs.table.menu')}
          onClose={() => setTableMenu(null)}
        />
      )}
      <PromptDialog request={prompt} onClose={() => setPrompt(null)} />
    </div>
  );
}

/** Documents and tasks that link to this one (F5-04, F6-04). */
function Backlinks({ project, id }: { project: OpenProject; id: string }) {
  const documents = useStore(project.store, (s) => s.documents);
  const boards = useStore(project.store, (s) => s.boards);
  const from = useMemo(() => documentsLinkingTo({ documents }, 'doc', id), [documents, id]);
  const tasks = useMemo(() => tasksLinkingTo({ boards }, 'document', id), [boards, id]);
  if (!from.length && !tasks.length) return null;
  return (
    <section className="doc-backlinks doc-page" aria-label={t('docs.backlinks')}>
      <h3 className="insp-heading">{t('docs.backlinks')}</h3>
      {from.map(({ doc }) => (
        <button key={doc.id} type="button" className="entity-link doc-backlink" onClick={() => openDocument(doc.id)}>
          <FileText size={13} aria-hidden="true" /> {docName(doc.path)}
        </button>
      ))}
      {tasks.map(({ task, board }) => (
        <button key={task.id} type="button" className="entity-link doc-backlink" onClick={() => openTask(task.id)}>
          <SquareCheck size={13} aria-hidden="true" /> {t('docs.backlinkTask', { name: task.title, board: board.name })}
        </button>
      ))}
    </section>
  );
}
