import { describe, expect, it } from 'vitest';
import { linksIn } from './links';
import { parseMarkdown, writeMarkdown } from './markdown';

describe('links read from the text of a document', () => {
  it('a link in a table cell, written with "\\|", leads to its object (0.7.4)', () => {
    const table = '| Герой | Место |\n| --- | --- |\n| [[ent:tut-nika\\|Ника]] | [[doc:d-1\\|Остров\\|docs]] |\n';
    expect(linksIn(table)).toEqual([
      { kind: 'ent', ref: 'tut-nika' },
      { kind: 'doc', ref: 'd-1', place: 'docs' },
    ]);
    // What the editor writes for a link in a table is read back the same way.
    const written = writeMarkdown(parseMarkdown(table)).text;
    expect(linksIn(written).map((l) => l.ref)).toEqual(['tut-nika', 'd-1']);
    expect(linksIn('[[ent:mira|Мира|map:n-1]] и [[asset:assets/a.png]]')).toEqual([
      { kind: 'ent', ref: 'mira', place: 'map:n-1' },
      { kind: 'asset', ref: 'assets/a.png' },
    ]);
  });
});
