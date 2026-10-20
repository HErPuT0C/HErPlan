// "@" in a document (F5-04): typing "@Ми" offers cards, documents and story nodes whose names match; Enter or a
// click puts a link there. The list is plain DOM next to the caret, so it works the same in the editor's own
// view without React.

import { Extension } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import Suggestion, { type SuggestionProps } from '@tiptap/suggestion';
import type { LinkKind } from '../../documents/markdown';

export interface MentionItem {
  kind: LinkKind;
  ref: string;
  label: string;
  hint: string;
}

const KEY = new PluginKey('objectMention');

export function mentionExtension(items: (query: string) => MentionItem[], emptyText: string) {
  return Extension.create({
    name: 'objectMention',
    addProseMirrorPlugins() {
      return [
        Suggestion<MentionItem, MentionItem>({
          pluginKey: KEY,
          editor: this.editor,
          char: '@',
          allowSpaces: true,
          items: ({ query }) => items(query).slice(0, 10),
          command: ({ editor, range, props }) =>
            editor
              .chain()
              .focus()
              .insertContentAt(range, [
                { type: 'objectLink', attrs: { kind: props.kind, ref: props.ref, label: props.label } },
                { type: 'text', text: ' ' },
              ])
              .run(),
          render: () => popup(emptyText),
        }),
      ];
    },
  });
}

function popup(emptyText: string) {
  let el: HTMLDivElement | null = null;
  let props: SuggestionProps<MentionItem, MentionItem> | null = null;
  let active = 0;
  const draw = () => {
    if (!el || !props) return;
    const rect = props.clientRect?.();
    if (rect) {
      el.style.left = `${Math.round(rect.left)}px`;
      el.style.top = `${Math.round(rect.bottom + 4)}px`;
    }
    el.replaceChildren();
    if (props.items.length === 0) {
      const p = document.createElement('p');
      p.className = 'muted small doc-suggest-empty';
      p.textContent = emptyText;
      el.append(p);
      return;
    }
    props.items.forEach((item, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'doc-suggest-item';
      b.setAttribute('role', 'option');
      b.setAttribute('aria-selected', String(i === active));
      const name = document.createElement('span');
      name.textContent = item.label;
      const hint = document.createElement('span');
      hint.className = 'muted small';
      hint.textContent = item.hint;
      b.append(name, hint);
      // Chosen before the editor loses focus.
      b.addEventListener('mousedown', (e) => {
        e.preventDefault();
        props?.command(item);
      });
      el!.append(b);
    });
  };
  return {
    onStart: (p: SuggestionProps<MentionItem, MentionItem>) => {
      props = p;
      active = 0;
      el = document.createElement('div');
      el.className = 'doc-suggest';
      el.setAttribute('role', 'listbox');
      document.body.append(el);
      draw();
    },
    onUpdate: (p: SuggestionProps<MentionItem, MentionItem>) => {
      props = p;
      active = Math.min(active, Math.max(0, p.items.length - 1));
      draw();
    },
    onKeyDown: ({ event }: { event: KeyboardEvent }) => {
      if (!props) return false;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        const n = props.items.length;
        if (n) active = (active + (event.key === 'ArrowDown' ? 1 : n - 1)) % n;
        draw();
        return true;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        const item = props.items[active];
        if (item) props.command(item);
        return !!item;
      }
      if (event.key === 'Escape') {
        el?.remove();
        el = null;
        return true;
      }
      return false;
    },
    onExit: () => {
      el?.remove();
      el = null;
      props = null;
    },
  };
}
