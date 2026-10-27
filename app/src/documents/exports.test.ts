import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import type { JsonObject } from '../core/project/types';
import { sampleProject } from '../story/sample';
import { obsidianExport } from './exportMarkdown';
import { fieldText, linkLabel } from './lookups';
import { parseMarkdown } from './markdown';
import { addDocument } from './model';
import { renderDocx, type DocxInput } from './docx';
import { pdfDefinition, renderPdf, type PdfInput } from './pdf';
import JSZip from 'jszip';

const words = {
  cards: 'Карточки',
  fields: 'Поля',
  relations: 'Связи',
  untitled: 'Без названия',
  typeName: (id: string) => ({ character: 'Персонаж', location: 'Локация', item: 'Предмет' })[id] ?? id,
};

describe('Markdown export for Obsidian (F5-08)', () => {
  it('links become Obsidian links, fields their values, story nodes their titles; cards become notes', () => {
    let plan = '';
    const data = produce(sampleProject(), (d) => {
      plan = addDocument(d, 'Мир', 'План', '# План\n');
      addDocument(
        d,
        '',
        'Диздок',
        `**[[ent:ent-mira|старое имя]]** идёт на <em><span data-link="ent:ent-boris">Борис</span></em>, см. [[doc:${plan}|План]] и [[node:g-ch1/a-meet|узел]]. Имя: {{ent:ent-mira.name}}\n`,
      );
      (d.entities['ent-mira'] as JsonObject).description = 'Травница';
    });
    const files = obsidianExport(data, words);
    const text = (path: string) => files.find((f) => f.path === path)?.text ?? '';
    expect(files.map((f) => f.path)).toEqual(
      expect.arrayContaining(['Диздок.md', 'Мир/План.md', 'Карточки/Персонаж/Мира.md', 'Карточки/Локация/Мельница.md']),
    );
    const doc = text('Диздок.md');
    expect(doc).toContain('**[[Карточки/Персонаж/Мира|Мира]]**');
    expect(doc).toContain('<em>[[Карточки/Персонаж/Борис|Борис]]</em>');
    expect(doc).toContain('[[Мир/План|План]]');
    expect(doc).toContain('Имя: Мира');
    expect(doc).not.toMatch(/\[\[(ent|doc|node):|\{\{ent:/);
    expect(text('Карточки/Персонаж/Мира.md')).toMatch(/^# Мира\n\n\*Персонаж\*\n\nТравница\n/);
  });
});

describe('PDF of a document (F5-07)', () => {
  const data = sampleProject();
  const input = (markdown: string): PdfInput => ({
    title: 'Диздок',
    doc: parseMarkdown(markdown),
    words: { contents: 'Содержание', page: (p, n) => `Страница ${p} из ${n}` },
    images: new Map(),
    label: (kind, ref) => linkLabel(data, kind, ref),
    field: (entity, field) => fieldText(data, entity, field),
  });

  it('lists headings in the contents only when there are several; links print what they show now', () => {
    const one = pdfDefinition(input('# Один\n\nтекст [[ent:ent-mira|старое]]\n'));
    expect(JSON.stringify(one.content)).not.toContain('"toc"');
    expect(JSON.stringify(one.content)).toContain('"text":"Мира"');
    const two = pdfDefinition(input('# Один\n\n## Два\n\nтекст\n\n![карта](assets/нет.png)\n'));
    const content = two.content as Record<string, unknown>[];
    expect(content[0]).toHaveProperty('toc');
    // A picture that could not be read is left out instead of breaking the PDF.
    expect(JSON.stringify(content)).not.toContain('image');
  });

  it('a page break starts a new page; one at the very end leaves no empty page (0.7.4)', async () => {
    const def = pdfDefinition(input('# Один\n\nтекст\n\n<!-- pagebreak -->\n\n# Два\n\n<!-- pagebreak -->\n'));
    const breaks = (def.content as Record<string, unknown>[]).filter((b) => b.pageBreak === 'after');
    expect(breaks).toHaveLength(1);
    const bytes = await renderPdf(input('Раз\n\n<!-- pagebreak -->\n\nДва\n\n<!-- pagebreak -->\n\nТри\n'));
    const pages = new TextDecoder('latin1').decode(bytes).match(/\/Type \/Page\b/g) ?? [];
    expect(pages).toHaveLength(3);
  }, 30_000);

  it('draws a real PDF with Cyrillic text, a table and a list', async () => {
    const bytes = await renderPdf(
      input(
        '# Мельница\n\n## Герои\n\n| Кто | Роль |\n| --- | --- |\n| Мира | Травница |\n\n- раз\n- два\n\n> Цитата\n',
      ),
    );
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
    expect(bytes.length).toBeGreaterThan(5000);
  }, 30_000);
});

describe('Word of a document (0.7.4)', () => {
  const data = sampleProject();
  // A one-pixel PNG.
  const png = Uint8Array.from(
    atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=='),
    (c) => c.charCodeAt(0),
  );
  const input = (markdown: string): DocxInput => ({
    title: 'Диздок',
    doc: parseMarkdown(markdown),
    page: ['Страница ', ' из ', ''],
    pictures: new Map([['assets/a.png', { data: png, type: 'png', width: 1, height: 1 }]]),
    label: (kind, ref) => linkLabel(data, kind, ref),
    field: (entity, field) => fieldText(data, entity, field),
  });

  it('headings Word knows, formatting, lists, a table, a picture, a web link, page breaks; links print their names', async () => {
    const md = [
      '# Мельница',
      '**Жирный** и *курсив*, <u>подчёркнутый</u>, ~~зачёркнутый~~, `код`, [сайт](https://example.com) и [[ent:ent-mira|старое]]: {{ent:ent-mira.name}}',
      '- раз\n- два\n  1. вложенный',
      '| Кто | Роль |\n| --- | --- |\n| Мира | Травница |',
      '![карта](assets/a.png)',
      '<!-- pagebreak -->',
      '## Вторая страница',
      '> Цитата',
      '<!-- pagebreak -->',
    ].join('\n\n');
    const bytes = await renderDocx(input(md));
    expect(new TextDecoder().decode(bytes.slice(0, 2))).toBe('PK');
    const xml = (await (await JSZip.loadAsync(bytes)).file('word/document.xml')?.async('string')) ?? '';
    expect(xml).toContain('w:val="Heading1"');
    expect(xml).toContain('w:val="Heading2"');
    expect(xml).toContain('<w:b/>');
    expect(xml).toContain('<w:i/>');
    expect(xml).toContain('<w:strike/>');
    expect(xml).toContain('Consolas');
    expect(xml).toContain('Мира');
    expect(xml).not.toContain('старое');
    expect(xml).toContain('<w:tbl>');
    expect(xml).toContain('<w:numPr>');
    expect(xml).toContain('<w:drawing>');
    expect(xml).toContain('w:hyperlink');
    // One page break: the one at the very end is left out.
    expect(xml.match(/w:type="page"/g)).toHaveLength(1);
  });
});
