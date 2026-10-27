// The document as A4 sheets (0.7.4), as in Word: the text is laid out on pages of A4 with margins, a gap
// between them. A piece of text that would cross the bottom of a page goes to the next one — a paragraph, a
// heading, a picture, one item of a list or a paragraph of a quote (lists and quotes are cut between their
// items); a piece taller than a page stays where it is and runs over. A page break sends what follows it to
// the next page. The sheets are a background of the text; the space before a piece moved to the next page is
// a widget, not part of the text.

import { Extension } from '@tiptap/core';
import type { Node as PmNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';

/** A4 at 96 pixels per inch, margins of 2 cm, a gap of 24 pixels between sheets. */
export const PAGE = { width: 794, height: 1123, margin: 76, gap: 24 } as const;
export const PITCH = PAGE.height + PAGE.gap;
const CONTENT = PAGE.height - 2 * PAGE.margin;
/** Margins collapse a little differently around a gap: a piece is let end this close to the bottom only. */
const SAFE = 8;

export interface Piece {
  /** Where a gap before this piece goes (before the list item when the piece starts it). */
  gapPos: number;
  /** Top and bottom in the text as laid out without any gaps, from the top of the first sheet. */
  top: number;
  bottom: number;
  /** A page break: the piece after it starts a page. */
  pageBreak: boolean;
}

export interface Layout {
  /** Gaps to put before pieces: position and height. */
  gaps: { pos: number; height: number }[];
  pages: number;
}

/**
 * Lays pieces out on pages (pure, tested): each piece moves down by the gaps before it; one that would end
 * below its page's text area, or starts in the bottom margin or between sheets, or follows a page break, gets
 * a gap that brings it to the top of the next page's text.
 */
export function layoutPages(pieces: readonly Piece[]): Layout {
  const gaps: Layout['gaps'] = [];
  let shift = 0;
  let bottom: number = PAGE.margin;
  pieces.forEach((p, i) => {
    let top = p.top + shift;
    const page = Math.floor(top / PITCH);
    const textTop = page * PITCH + PAGE.margin;
    const textBottom = page * PITCH + PAGE.height - PAGE.margin;
    const height = p.bottom - p.top;
    const crosses = top + height > textBottom - SAFE && top > textTop + 1 && height <= CONTENT;
    if (i > 0 && (pieces[i - 1].pageBreak || crosses || top > textBottom)) {
      const next = (page + 1) * PITCH + PAGE.margin;
      const gap = next - top;
      gaps.push({ pos: p.gapPos, height: gap });
      shift += gap;
      top = next;
    }
    bottom = Math.max(bottom, top + height);
  });
  return { gaps, pages: Math.max(1, Math.floor((bottom + PAGE.margin) / PITCH) + 1) };
}

/** Containers cut between their children: lists, their items, quotes. */
const CUT = new Set(['bulletList', 'orderedList', 'listItem', 'blockquote']);

/** The pieces of the document: leaves under lists and quotes, other blocks whole. */
function pieces(doc: PmNode): { pos: number; gapPos: number; pageBreak: boolean }[] {
  const out: { pos: number; gapPos: number; pageBreak: boolean }[] = [];
  const walk = (node: PmNode, pos: number, gapPos: number) => {
    if (!CUT.has(node.type.name) || !node.childCount) {
      out.push({ pos, gapPos, pageBreak: node.type.name === 'pageBreak' });
      return;
    }
    node.forEach((child, offset, index) => {
      const at = pos + 1 + offset;
      // The first child starts where its container starts: a gap goes before the container (a list item
      // keeps its number with its text).
      walk(child, at, index === 0 ? gapPos : at);
    });
  };
  doc.forEach((node, pos) => walk(node, pos, pos));
  return out;
}

interface PagesState {
  layout: Layout;
  decorations: DecorationSet;
}

const key = new PluginKey<PagesState>('pages');

function gapWidget(height: number): HTMLElement {
  const el = document.createElement('div');
  el.className = 'doc-page-gap';
  el.contentEditable = 'false';
  el.style.height = `${height}px`;
  el.setAttribute('aria-hidden', 'true');
  return el;
}

function decorationsFor(state: EditorState, layout: Layout): DecorationSet {
  return DecorationSet.create(
    state.doc,
    layout.gaps.map((g) =>
      Decoration.widget(g.pos, () => gapWidget(g.height), {
        side: -1,
        key: `gap-${g.pos}-${Math.round(g.height)}`,
        ignoreSelection: true,
      }),
    ),
  );
}

/** The pieces as laid out without the gaps: the gaps are hidden for the moment of measuring. */
function measure(view: EditorView): Piece[] {
  const holder = view.dom.parentElement;
  holder?.classList.add('doc-measuring');
  const origin = view.dom.getBoundingClientRect().top;
  const out: Piece[] = [];
  for (const p of pieces(view.state.doc)) {
    const dom = view.nodeDOM(p.pos);
    if (!(dom instanceof HTMLElement)) continue;
    const r = dom.getBoundingClientRect();
    out.push({ gapPos: p.gapPos, top: r.top - origin, bottom: r.bottom - origin, pageBreak: p.pageBreak });
  }
  holder?.classList.remove('doc-measuring');
  return out;
}

const sameLayout = (a: Layout, b: Layout) =>
  a.pages === b.pages &&
  a.gaps.length === b.gaps.length &&
  a.gaps.every((g, i) => g.pos === b.gaps[i].pos && Math.abs(g.height - b.gaps[i].height) < 1);

/** The pages of the editor: gaps before pieces that go to the next page, and the number of sheets. */
export const Pages = Extension.create({
  name: 'pages',
  addProseMirrorPlugins() {
    return [
      new Plugin<PagesState>({
        key,
        state: {
          init: (_, state): PagesState => ({
            layout: { gaps: [], pages: 1 },
            decorations: DecorationSet.create(state.doc, []),
          }),
          apply: (tr, value, _old, state) => {
            const layout = tr.getMeta(key) as Layout | undefined;
            if (layout) return { layout, decorations: decorationsFor(state, layout) };
            return { layout: value.layout, decorations: value.decorations.map(tr.mapping, tr.doc) };
          },
        },
        props: {
          decorations: (state) => key.getState(state)?.decorations,
        },
        view: (view) => {
          let frame = 0;
          const run = () => {
            frame = 0;
            if (view.isDestroyed) return;
            const next = layoutPages(measure(view));
            const current = key.getState(view.state)?.layout;
            (view.dom as HTMLElement).style.minHeight = `${next.pages * PITCH - PAGE.gap}px`;
            if (current && sameLayout(current, next)) return;
            view.dispatch(view.state.tr.setMeta(key, next).setMeta('addToHistory', false));
          };
          const schedule = () => {
            if (!frame) frame = requestAnimationFrame(run);
          };
          // Pictures change the height of the text when they load; so does a narrower window.
          const onLoad = () => schedule();
          view.dom.addEventListener('load', onLoad, true);
          const resize = new ResizeObserver(schedule);
          resize.observe(view.dom);
          schedule();
          return {
            update: (v, prev) => {
              if (v.state.doc !== prev.doc) schedule();
            },
            destroy: () => {
              cancelAnimationFrame(frame);
              resize.disconnect();
              view.dom.removeEventListener('load', onLoad, true);
            },
          };
        },
      }),
    ];
  },
});
