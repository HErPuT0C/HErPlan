import { Editor } from '@tiptap/core';
import { Image } from '@tiptap/extension-image';
import { TableKit } from '@tiptap/extension-table';
import { Markdown } from '@tiptap/markdown';
import StarterKit from '@tiptap/starter-kit';
import type { EditorCheck } from '../report';
import { EntityField, EntityLink } from './embeds';
import './markdown-marks';
import { entities } from './entities';

const SAMPLE = `# Глава 1. Мельница

**[[ent:mira|Мира]]** приходит к *старой мельнице* на рассвете. Её доверие к герою: {{ent:mira.доверие}}.

## Что известно

- Мельница: [[ent:mill|Старая мельница]], угроза — {{ent:mill.угроза}}.
- Кузнец [[ent:boris|Борис]] обещал помочь.

> На стене висит ружьё. Оно ещё выстрелит.

| Персонаж | Роль |
| --- | --- |
| Мира | Травница |
| Борис | Кузнец |
`;

const MANUAL_CHECKS = [
  'Вставка из Word: заголовки, жирный, списки, таблица сохраняются',
  'Вставка из браузера (статья с картинкой и ссылками)',
  'После Ctrl+V ввод текста продолжает работать',
  'Ctrl+Z отменяет и не «возвращает» отменённое через секунду; Ctrl+Y повторяет',
  'Правый клик: «Вырезать», «Копировать», «Вставить», «Выделить всё» работают',
  'Русский ввод и подчёркивание орфографических ошибок',
  '«@» открывает выбор сущности; кнопки слева меняют имя и доверие — текст обновляется сразу',
  'Кнопки панели (заголовки, жирный, списки) подсвечиваются сразу при перемещении курсора',
];

export interface EditorPage {
  element: HTMLElement;
  activate(): void;
}

export function createEditorPage(onChecks: (checks: EditorCheck[]) => void): EditorPage {
  const element = document.createElement('section');
  element.className = 'page editor-page';
  element.innerHTML = `
    <div class="toolbar" data-id="toolbar">
      <button data-cmd="h1">H1</button><button data-cmd="h2">H2</button>
      <button data-cmd="bold"><b>Ж</b></button><button data-cmd="italic"><i>К</i></button>
      <button data-cmd="underline"><u>Ч</u></button><button data-cmd="strike"><s>З</s></button>
      <button data-cmd="bullet">• список</button><button data-cmd="ordered">1. список</button>
      <button data-cmd="quote">цитата</button><button data-cmd="table">таблица</button>
      <button data-cmd="entity">+ сущность</button><button data-cmd="field">+ поле</button>
      <button data-cmd="undo">↶</button><button data-cmd="redo">↷</button>
    </div>
    <div class="editor-layout">
      <aside class="editor-side">
        <h3>Мини-база</h3>
        <div data-id="db"></div>
        <h3>Проверки</h3>
        <ol class="checks" data-id="checks"></ol>
        <p class="muted" data-id="auto"></p>
      </aside>
      <div class="editor-host" data-id="host" spellcheck="true" lang="ru"></div>
      <aside class="editor-side">
        <h3>Markdown на диске</h3>
        <textarea readonly data-id="md"></textarea>
      </aside>
    </div>
    <div class="menu" data-id="menu" hidden></div>`;

  const host = element.querySelector<HTMLDivElement>('[data-id="host"]')!;
  const mdOut = element.querySelector<HTMLTextAreaElement>('[data-id="md"]')!;
  const menu = element.querySelector<HTMLDivElement>('[data-id="menu"]')!;
  const checksList = element.querySelector<HTMLOListElement>('[data-id="checks"]')!;
  const autoNote = element.querySelector<HTMLParagraphElement>('[data-id="auto"]')!;
  const dbHost = element.querySelector<HTMLDivElement>('[data-id="db"]')!;

  const checks: EditorCheck[] = [
    { name: 'Markdown туда-обратно без потерь (автопроверка)', ok: null, note: '' },
    ...MANUAL_CHECKS.map((name) => ({ name, ok: null as boolean | null, note: '' })),
  ];
  let editor: Editor | null = null;

  const extensions = () => [StarterKit, TableKit, Image, Markdown, EntityLink, EntityField];

  function renderChecks(): void {
    checksList.innerHTML = '';
    checks.slice(1).forEach((c, i) => {
      const li = document.createElement('li');
      li.innerHTML = `<span>${c.name}</span> <button data-v="ok">✅</button><button data-v="no">❌</button>`;
      li.classList.toggle('ok', c.ok === true);
      li.classList.toggle('no', c.ok === false);
      li.querySelectorAll('button').forEach((b) =>
        b.addEventListener('click', () => {
          checks[i + 1].ok = b.dataset.v === 'ok';
          renderChecks();
          onChecks(checks);
        }),
      );
      checksList.appendChild(li);
    });
  }

  function renderDb(): void {
    dbHost.innerHTML = '';
    for (const e of entities.items) {
      const row = document.createElement('div');
      row.className = 'db-row';
      const trust = e.fields['доверие'];
      row.innerHTML = `<span><b>${e.name}</b> · ${e.type}${trust !== undefined ? ` · доверие ${trust}` : ''}</span>`;
      const rename = document.createElement('button');
      rename.textContent = 'переименовать';
      rename.addEventListener('click', () => {
        const next = prompt('Новое имя', e.name);
        if (next) entities.update(e.id, (x) => (x.name = next));
      });
      row.appendChild(rename);
      if (trust !== undefined) {
        const plus = document.createElement('button');
        plus.textContent = 'доверие +1';
        plus.addEventListener('click', () => entities.update(e.id, (x) => (x.fields['доверие'] = Number(x.fields['доверие']) + 1)));
        row.appendChild(plus);
      }
      dbHost.appendChild(row);
    }
  }

  function updateMarkdown(): void {
    if (editor) mdOut.value = editor.getMarkdown();
  }

  function roundTripCheck(): void {
    if (!editor) return;
    const first = editor.getMarkdown();
    const probe = new Editor({ extensions: extensions(), content: first, contentType: 'markdown' });
    const second = probe.getMarkdown();
    // Formatting around embeds must survive too (a known gap in the stock Markdown extension, patched in markdown-marks.ts).
    const marked = '**[[ent:mira|Мира]]** и *{{ent:mira.доверие}}* и ~~[[ent:boris|Борис]]~~';
    probe.commands.setContent(marked, { contentType: 'markdown' });
    const marksOk = probe.getMarkdown() === marked;
    probe.destroy();
    checks[0].ok = first === second && marksOk;
    checks[0].note = first !== second ? 'текст после повторного чтения отличается' : marksOk ? '' : 'теряется форматирование вокруг вставок';
    autoNote.textContent = `Автопроверка Markdown: ${checks[0].ok ? 'совпадает ✅' : 'расхождение ❌'}`;
    onChecks(checks);
  }

  function pickEntity(kind: 'link' | 'field', at?: { left: number; top: number }): void {
    if (!editor) return;
    menu.innerHTML = '';
    const items: { label: string; run: () => void }[] = [];
    for (const e of entities.items) {
      if (kind === 'link') {
        items.push({ label: `${e.name} · ${e.type}`, run: () => editor!.chain().focus().insertContent({ type: 'entityLink', attrs: { id: e.id, label: e.name } }).insertContent(' ').run() });
      } else {
        for (const f of Object.keys(e.fields))
          items.push({ label: `${e.name}.${f}`, run: () => editor!.chain().focus().insertContent({ type: 'entityField', attrs: { id: e.id, field: f } }).run() });
      }
    }
    showMenu(items, at ?? caretPosition());
  }

  function caretPosition(): { left: number; top: number } {
    if (!editor) return { left: 100, top: 100 };
    const c = editor.view.coordsAtPos(editor.state.selection.from);
    return { left: c.left, top: c.bottom + 4 };
  }

  function showMenu(items: { label: string; run: () => void }[], at: { left: number; top: number }): void {
    menu.innerHTML = '';
    for (const item of items) {
      const b = document.createElement('button');
      b.textContent = item.label;
      b.addEventListener('mousedown', (ev) => ev.preventDefault());
      b.addEventListener('click', () => {
        menu.hidden = true;
        item.run();
      });
      menu.appendChild(b);
    }
    menu.style.left = `${at.left}px`;
    menu.style.top = `${at.top}px`;
    menu.hidden = false;
  }

  async function pasteFromClipboard(): Promise<void> {
    if (!editor) return;
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        if (item.types.includes('text/html')) {
          editor.chain().focus().insertContent(await (await item.getType('text/html')).text()).run();
          return;
        }
      }
      editor.chain().focus().insertContent(await navigator.clipboard.readText()).run();
    } catch (err) {
      alert(`Вставка через меню недоступна: ${(err as Error).message}. Ctrl+V работает всегда.`);
    }
  }

  function bindToolbar(): void {
    const run: Record<string, () => void> = {
      h1: () => editor?.chain().focus().toggleHeading({ level: 1 }).run(),
      h2: () => editor?.chain().focus().toggleHeading({ level: 2 }).run(),
      bold: () => editor?.chain().focus().toggleBold().run(),
      italic: () => editor?.chain().focus().toggleItalic().run(),
      underline: () => editor?.chain().focus().toggleUnderline().run(),
      strike: () => editor?.chain().focus().toggleStrike().run(),
      bullet: () => editor?.chain().focus().toggleBulletList().run(),
      ordered: () => editor?.chain().focus().toggleOrderedList().run(),
      quote: () => editor?.chain().focus().toggleBlockquote().run(),
      table: () => editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
      entity: () => pickEntity('link'),
      field: () => pickEntity('field'),
      undo: () => editor?.chain().focus().undo().run(),
      redo: () => editor?.chain().focus().redo().run(),
    };
    element.querySelectorAll<HTMLButtonElement>('[data-cmd]').forEach((b) => {
      b.addEventListener('mousedown', (ev) => ev.preventDefault());
      b.addEventListener('click', () => run[b.dataset.cmd!]());
    });
  }

  function syncToolbar(): void {
    if (!editor) return;
    const active: Record<string, boolean> = {
      h1: editor.isActive('heading', { level: 1 }),
      h2: editor.isActive('heading', { level: 2 }),
      bold: editor.isActive('bold'),
      italic: editor.isActive('italic'),
      underline: editor.isActive('underline'),
      strike: editor.isActive('strike'),
      bullet: editor.isActive('bulletList'),
      ordered: editor.isActive('orderedList'),
      quote: editor.isActive('blockquote'),
    };
    element.querySelectorAll<HTMLButtonElement>('[data-cmd]').forEach((b) => b.classList.toggle('active', !!active[b.dataset.cmd!]));
  }

  let started = false;
  return {
    element,
    activate() {
      if (started) return;
      started = true;
      editor = new Editor({
        element: host,
        extensions: extensions(),
        content: SAMPLE,
        contentType: 'markdown',
        editorProps: {
          handleTextInput: (_view, _from, _to, text) => {
            if (text !== '@') return false;
            pickEntity('link');
            return true;
          },
        },
        onUpdate: () => {
          updateMarkdown();
          syncToolbar();
        },
        onSelectionUpdate: syncToolbar,
        onTransaction: syncToolbar,
      });
      (window as unknown as { __herplanEditor: Editor }).__herplanEditor = editor;
      bindToolbar();
      renderDb();
      renderChecks();
      updateMarkdown();
      roundTripCheck();
      entities.subscribe(() => {
        renderDb();
        updateMarkdown();
      });
      editor.on('update', () => {
        clearTimeout((roundTripCheck as unknown as { t?: number }).t);
        (roundTripCheck as unknown as { t?: number }).t = window.setTimeout(roundTripCheck, 800);
      });

      host.addEventListener('contextmenu', (ev) => {
        ev.preventDefault();
        showMenu(
          [
            { label: 'Вырезать', run: () => document.execCommand('cut') },
            { label: 'Копировать', run: () => document.execCommand('copy') },
            { label: 'Вставить', run: () => void pasteFromClipboard() },
            { label: 'Выделить всё', run: () => editor?.chain().focus().selectAll().run() },
          ],
          { left: ev.clientX, top: ev.clientY },
        );
      });
      document.addEventListener('mousedown', (ev) => {
        if (!menu.contains(ev.target as Node)) menu.hidden = true;
      });
      document.addEventListener('keydown', (ev) => {
        if (ev.key === 'Escape') menu.hidden = true;
      });
    },
  };
}
