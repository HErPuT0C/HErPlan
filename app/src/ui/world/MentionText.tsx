// A description that links the names in it (0.7.3): read, it shows the names of cards and tags of the
// project as links (a click opens the card or the catalog); a click anywhere else, or Tab into it, turns it
// into the plain text box with the caret where the click was. The text itself stays plain.
// 0.7.4: "@" in the text box offers the cards and tags, fewer with each letter typed; Enter, Tab or a click
// puts the whole name in place of "@…".

import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { useStore } from '../../core/useStore';
import { t } from '../../i18n';
import { openCatalog, openEntity } from '../../state/navigation';
import type { OpenProject } from '../../state/project';
import {
  findMentions,
  mentionIndex,
  mentionOptions,
  mentionQuery,
  mentionTargets,
  type MentionTarget,
} from '../../world/mentions';
import { typesFile } from '../../world/schema';
import { typeName } from './typeNames';

/** The names to look for and to offer after "@", made again only when cards or catalogs change. */
export function useMentionIndex(project: OpenProject) {
  const entities = useStore(project.store, (s) => s.entities);
  const types = useStore(project.store, (s) => s.types);
  return useMemo(() => {
    const targets = mentionTargets({ entities, types });
    const schema = typesFile({ types });
    // What each name is, for the list after "@": the type of a card, the catalog of a tag.
    const hint = (x: MentionTarget) =>
      x.kind === 'entity'
        ? typeName(schema.types.find((ty) => ty.id === (entities[x.id] as { type?: string } | undefined)?.type))
        : t('mention.tagOf', { catalog: schema.catalogs.find((c) => c.id === x.catalog)?.name ?? '' });
    return { index: mentionIndex(targets), targets, hint };
  }, [entities, types]);
}

export function openMention(target: MentionTarget): void {
  if (target.kind === 'entity') openEntity(target.id);
  else openCatalog(target.catalog);
}

/** Where in the plain text a point of the shown text is (the shown text is the same characters). */
function offsetAt(root: HTMLElement, x: number, y: number): number | null {
  const range = document.caretRangeFromPoint?.(x, y);
  if (!range || !root.contains(range.startContainer)) return null;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let before = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node === range.startContainer) return before + range.startOffset;
    before += node.textContent?.length ?? 0;
  }
  return null;
}

export function MentionText({
  project,
  value,
  onChange,
  onDone,
  self,
  id,
  label,
  placeholder,
  rows = 2,
  className,
  autoFocus = false,
}: {
  project: OpenProject;
  value: string;
  onChange: (text: string) => void;
  /** Called when the text box is left (a tag's note goes back to one line). */
  onDone?: () => void;
  /** The card or tag the text belongs to: its own name is not a link. */
  self?: MentionTarget;
  id?: string;
  label?: string;
  placeholder?: string;
  rows?: number;
  className?: string;
  autoFocus?: boolean;
}) {
  const readOnly = project.readOnly;
  const { index, targets, hint } = useMentionIndex(project);
  const [editing, setEditing] = useState(autoFocus && !readOnly);
  const [suggest, setSuggest] = useState<{ start: number; query: string } | null>(null);
  const [active, setActive] = useState(0);
  const caret = useRef<number | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const view = useRef<HTMLDivElement>(null);
  const selfKey = self ? `${self.kind}:${self.id}` : '';
  const mentions = useMemo(
    () => findMentions(value, index, self),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [value, index, selfKey],
  );

  useEffect(() => {
    const el = box.current;
    if (!editing || !el) return;
    el.focus();
    const at = caret.current ?? el.value.length;
    el.setSelectionRange(at, at);
    caret.current = null;
  }, [editing]);

  const classes = ['input', 'textarea', className].filter(Boolean).join(' ');
  if (editing) {
    const options = suggest ? mentionOptions(targets, suggest.query, self) : [];
    const look = (el: HTMLTextAreaElement) => {
      const found = mentionQuery(el.value, el.selectionStart);
      setSuggest(found);
      if (found?.query !== suggest?.query) setActive(0);
    };
    const pick = (target: MentionTarget) => {
      const el = box.current;
      if (!el || !suggest) return;
      const end = el.selectionStart;
      const text = `${value.slice(0, suggest.start)}${target.name} ${value.slice(end)}`;
      const at = suggest.start + target.name.length + 1;
      onChange(text);
      setSuggest(null);
      requestAnimationFrame(() => box.current?.setSelectionRange(at, at));
    };
    const listId = `${id ?? 'mention'}-options`;
    return (
      <div className={['mention-edit', className && `${className}-wrap`].filter(Boolean).join(' ')}>
        <textarea
          ref={box}
          id={id}
          className={classes}
          value={value}
          rows={rows}
          placeholder={placeholder}
          aria-label={label}
          aria-autocomplete="list"
          aria-controls={options.length ? listId : undefined}
          aria-activedescendant={options.length ? `${listId}-${Math.min(active, options.length - 1)}` : undefined}
          onChange={(e) => {
            onChange(e.target.value);
            look(e.target);
          }}
          onSelect={(e) => look(e.currentTarget)}
          onBlur={() => {
            setSuggest(null);
            setEditing(false);
            onDone?.();
          }}
          onKeyDown={(e) => {
            if (options.length) {
              const keys: Record<string, () => void> = {
                ArrowDown: () => setActive((a) => (a + 1) % options.length),
                ArrowUp: () => setActive((a) => (a - 1 + options.length) % options.length),
                Enter: () => pick(options[Math.min(active, options.length - 1)]),
                Tab: () => pick(options[Math.min(active, options.length - 1)]),
                Escape: () => setSuggest(null),
              };
              const run = keys[e.key];
              if (run) {
                e.preventDefault();
                e.stopPropagation();
                run();
                return;
              }
            }
            if (e.key === 'Escape') box.current?.blur();
          }}
        />
        {options.length > 0 && (
          <ul className="mention-options" role="listbox" id={listId} aria-label={t('mention.options')}>
            {options.map((x, i) => (
              <li
                key={`${x.kind}:${x.id}`}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === Math.min(active, options.length - 1)}
                className="mention-option"
                // The text box keeps the focus.
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(x);
                }}
                onMouseEnter={() => setActive(i)}
              >
                <span className="mention-option-name">{x.name}</span>
                <span className="muted small">{hint(x)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  const edit = (e: ReactMouseEvent) => {
    if (readOnly || (e.target as HTMLElement).closest('.mention-link')) return;
    e.preventDefault();
    caret.current = view.current ? offsetAt(view.current, e.clientX, e.clientY) : null;
    setEditing(true);
  };
  const parts: ReactNode[] = [];
  let at = 0;
  for (const m of mentions) {
    if (m.start > at) parts.push(value.slice(at, m.start));
    parts.push(
      <button
        key={m.start}
        type="button"
        className={`mention-link mention-${m.target.kind}`}
        title={t(m.target.kind === 'entity' ? 'mention.openCard' : 'mention.openTag', { name: m.target.name })}
        onClick={() => openMention(m.target)}
      >
        {value.slice(m.start, m.end)}
      </button>,
    );
    at = m.end;
  }
  if (at < value.length) parts.push(value.slice(at));
  return (
    <div
      ref={view}
      id={id}
      className={`${classes} mention-view`}
      style={{ minHeight: `calc(${rows} * 1.5em + 14px)` }}
      role="textbox"
      aria-multiline="true"
      aria-readonly={readOnly || undefined}
      aria-label={label}
      tabIndex={readOnly ? -1 : 0}
      onMouseDown={edit}
      onFocus={(e) => {
        if (!readOnly && e.target === e.currentTarget) setEditing(true);
      }}
    >
      {value ? parts : <span className="mention-placeholder">{placeholder}</span>}
    </div>
  );
}
