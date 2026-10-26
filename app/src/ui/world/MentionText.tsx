// A description that links the names in it (0.7.3): read, it shows the names of cards and tags of the
// project as links (a click opens the card or the catalog); a click anywhere else, or Tab into it, turns it
// into the plain text box with the caret where the click was. The text itself stays plain.

import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { useStore } from '../../core/useStore';
import { t } from '../../i18n';
import { openCatalog, openEntity } from '../../state/navigation';
import type { OpenProject } from '../../state/project';
import { findMentions, mentionIndex, mentionTargets, type MentionTarget } from '../../world/mentions';

/** The names to look for, made again only when cards or catalogs change. */
export function useMentionIndex(project: OpenProject) {
  const entities = useStore(project.store, (s) => s.entities);
  const types = useStore(project.store, (s) => s.types);
  return useMemo(() => mentionIndex(mentionTargets({ entities, types })), [entities, types]);
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
  const index = useMentionIndex(project);
  const [editing, setEditing] = useState(autoFocus && !readOnly);
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
  if (editing)
    return (
      <textarea
        ref={box}
        id={id}
        className={classes}
        value={value}
        rows={rows}
        placeholder={placeholder}
        aria-label={label}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => {
          setEditing(false);
          onDone?.();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') box.current?.blur();
        }}
      />
    );

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
