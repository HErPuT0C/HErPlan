import { describe, expect, it } from 'vitest';
import { layoutPages, PAGE, PITCH, type Piece } from './pages';

/** Pieces one after another from the top of the first page's text, with a space between them. */
function stack(heights: number[], extra: (i: number) => Partial<Piece> = () => ({})): Piece[] {
  let y = PAGE.margin;
  return heights.map((h, i) => {
    const p: Piece = { gapPos: i * 10, top: y, bottom: y + h, pageBreak: false, ...extra(i) };
    y += h + 10;
    return p;
  });
}

/** Where each piece ends up with the gaps put in. */
function placed(pieces: Piece[]) {
  const layout = layoutPages(pieces);
  const at = new Map(layout.gaps.map((g) => [g.pos, g.height]));
  let shift = 0;
  const out = pieces.map((p) => {
    const gap = at.get(p.gapPos);
    if (gap !== undefined) shift += gap;
    const top = p.top + shift;
    return { top, bottom: p.bottom + shift, page: Math.floor(top / PITCH), moved: gap !== undefined };
  });
  return { out, ...layout };
}

describe('the document as A4 sheets (0.7.4)', () => {
  it('puts every piece inside the text area of its page; one that would cross the bottom goes to the next', () => {
    const { out, pages, gaps } = placed(stack(Array.from({ length: 60 }, (_, i) => 20 + ((i * 37) % 120))));
    for (const b of out) {
      expect(b.top).toBeGreaterThanOrEqual(b.page * PITCH + PAGE.margin - 0.001);
      expect(b.bottom).toBeLessThanOrEqual(b.page * PITCH + PAGE.height - PAGE.margin + 0.001);
    }
    expect(gaps).toHaveLength(pages - 1);
    // A moved piece starts right at the top of its page's text.
    for (const b of out.filter((x) => x.moved)) expect(b.top).toBeCloseTo(b.page * PITCH + PAGE.margin, 5);
  });

  it('a page break sends what follows to the next page; a piece taller than a page stays and runs over', () => {
    const { out } = placed(stack([50, 20, 50, 50], (i) => ({ pageBreak: i === 1 })));
    expect(out.map((b) => b.page)).toEqual([0, 0, 1, 1]);
    const tall = placed(stack([500, 2000, 50]));
    expect(tall.out[1].moved).toBe(false);
    expect(tall.out[2].page).toBe(2);
  });

  it('one short piece is one page; the count follows the text', () => {
    expect(layoutPages(stack([30])).pages).toBe(1);
    expect(layoutPages([]).pages).toBe(1);
    expect(layoutPages(stack(Array.from({ length: 30 }, () => 100))).pages).toBe(4);
  });
});
