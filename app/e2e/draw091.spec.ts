import { expect, test, type Page } from '@playwright/test';

// 0.9.1: text in the drawing window as in a plain graphics editor — a font, a size, bold and italic; a word
// coloured apart from the rest of its text; a contour, a shadow, a glow or a plate around the letters.

type Files = Record<string, string>;

async function newDrawing(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.setViewportSize({ width: 1400, height: 950 });
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem(
      'herplan.web.settings.v1',
      JSON.stringify({ locale: 'ru', canvasHintsOpen: false, tourSeen: true }),
    );
  });
  await page.reload();
  await page.getByRole('button', { name: 'Создать проект' }).click();
  await page.getByLabel('Название').fill('Надписи');
  await page.getByRole('button', { name: 'Создать', exact: true }).click();
  await expect(page.getByRole('button', { name: /Сценарий/ })).toBeVisible();
  await page.getByRole('button', { name: /Документы/ }).click();
  await page.getByRole('navigation', { name: 'Документы' }).getByRole('button', { name: 'Новый документ' }).click();
  await page.getByRole('menuitem', { name: 'Пустой документ' }).click();
  await page.getByLabel('Название документа').fill('Эскиз');
  await page.getByLabel('Название документа').press('Enter');
  await page.getByRole('button', { name: 'Нарисовать рисунок' }).click();
  const win = page.getByRole('dialog', { name: 'Новый рисунок' });
  await expect(win).toBeVisible();
  return { errors, win };
}

const shot = (page: Page, name: string) =>
  process.env.HERPLAN_SHOTS ? page.screenshot({ path: `${process.env.HERPLAN_SHOTS}/${name}.png` }) : null;

/** The source of the drawing saved in a PNG of the project (the "herplan-drawing" chunk). */
async function savedDrawing(page: Page, suffix: string): Promise<{ items: Record<string, unknown>[] } | null> {
  return page.evaluate((end) => {
    const fs = JSON.parse(localStorage.getItem('herplan.web.fs.v1') ?? '{}') as { files: Files };
    const url = Object.entries(fs.files).find(([p]) => p.endsWith(end))?.[1];
    if (!url) return null;
    const bin = atob(url.slice(url.indexOf(',') + 1));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const text = new TextDecoder().decode(bytes);
    const start = text.indexOf('{"v":1');
    const stop = text.lastIndexOf('}', text.lastIndexOf('IEND'));
    return start < 0 ? null : JSON.parse(text.slice(start, stop + 1));
  }, suffix);
}

test('a text with a word of its own colour and a contour, a plate on another; changed again (0.9.1)', async ({
  page,
}) => {
  const { errors, win } = await newDrawing(page);
  const sheet = win.getByRole('img', { name: 'Лист для рисования' });
  const box = (await sheet.boundingBox())!;
  const bar = win.getByRole('toolbar', { name: 'Оформление текста' });

  // The text tool, a font and a size; a click on the sheet starts a text.
  await win.getByRole('button', { name: 'Текст (T)' }).click();
  await expect(bar).toBeVisible();
  await bar.getByLabel('Шрифт').selectOption({ label: 'С засечками' });
  await bar.getByLabel('Размер текста').selectOption('48');
  await page.mouse.click(box.x + box.width * 0.1, box.y + box.height * 0.15);
  const field = win.getByLabel('Текст на рисунке');
  await expect(field).toBeFocused();
  await page.keyboard.type('Привет мир');
  // The last word selected and coloured green, with a contour; the rest stays as it was.
  for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowLeft');
  await win.getByRole('button', { name: '#2f9e44', exact: true }).first().click();
  await shot(page, 't0-selected');
  await bar.getByRole('button', { name: 'Контур', exact: true }).click();
  await expect(bar.getByRole('group', { name: 'Цвет обводки' })).toBeVisible();
  await bar.getByRole('group', { name: 'Цвет обводки' }).getByRole('button', { name: '#1f1f1f' }).click();
  await expect(field).toBeFocused();
  // Enter goes to a new line; Ctrl+B makes the whole text bold.
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('второй');
  await page.keyboard.press('Control+b');
  await shot(page, 't1-typing');
  await page.keyboard.press('Escape');
  await expect(field).toHaveCount(0);
  await expect(sheet).toHaveAttribute('data-items', '1');

  // A second text on a plate, its look picked before typing.
  await bar.getByRole('button', { name: 'Плашка' }).click();
  await page.mouse.click(box.x + box.width * 0.1, box.y + box.height * 0.65);
  await page.keyboard.type('На плашке');
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveAttribute('data-items', '2');
  await shot(page, 't2-two-texts');

  // The arrow picks a text; a look from the bar goes on all of it; a double click opens it for changing.
  await win.getByRole('button', { name: 'Выбрать и двигать (V)' }).click();
  await page.mouse.click(box.x + box.width * 0.1 + 20, box.y + box.height * 0.65 + 20);
  await bar.getByRole('button', { name: 'Свечение' }).click();
  await page.mouse.dblclick(box.x + box.width * 0.1 + 20, box.y + box.height * 0.65 + 20);
  await expect(field).toHaveValue('На плашке');
  await page.keyboard.type('!');
  await page.keyboard.press('Escape');
  await win.getByRole('button', { name: 'Сохранить' }).click();
  await expect(win).toHaveCount(0);
  await expect(page.locator('.ProseMirror img.doc-image')).toHaveCount(1);
  await shot(page, 't3-in-document');

  const d = await savedDrawing(page, '/assets/Рисунки/Рисунок.png');
  expect(d?.items).toEqual([
    expect.objectContaining({
      kind: 'text',
      text: 'Привет мир\nвторой',
      font: 'serif',
      size: 48,
      bold: true,
      // What was typed after the green word goes on in its style.
      runs: [
        { text: 'Привет ', color: '#e03131' },
        { text: 'мир\nвторой', color: '#2f9e44', look: { kind: 'outline', color: '#1f1f1f' } },
      ],
    }),
    expect.objectContaining({
      kind: 'text',
      text: 'На плашке!',
      look: expect.objectContaining({ kind: 'glow' }),
    }),
  ]);
  expect(errors).toEqual([]);
});
