import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import type { JsonObject } from '../core/project/types';
import { sampleProject } from '../story/sample';
import { obsidianExport } from './exportMarkdown';
import { fieldText, linkLabel } from './lookups';
import { parseMarkdown } from './markdown';
import { addDocument } from './model';
import { pdfDefinition, renderPdf, type PdfInput } from './pdf';

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
