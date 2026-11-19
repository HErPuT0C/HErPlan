import { expect, test, type Page } from '@playwright/test';

// 0.9: drawing. In documents: a new drawing goes into the text; a picture of the text is drawn on as a copy
// beside it (the picture itself stays as it was), and the copy opens again with what was drawn on it.

type Files = Record<string, string>;

async function newProject(page: Page) {
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
  await page.getByLabel('Название').fill('Рисунки');
  await page.getByRole('button', { name: 'Создать', exact: true }).click();
  await expect(page.getByRole('button', { name: /Сценарий/ })).toBeVisible();
  // A picture of the project, made by the browser: a green field.
  const picture = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 300;
    c.height = 200;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#2f9e44';
    ctx.fillRect(0, 0, 300, 200);
    return c.toDataURL('image/png');
  });
  await page.evaluate((png) => {
    const fs = JSON.parse(localStorage.getItem('herplan.web.fs.v1') ?? '{}') as { files: Files };
    const dir = Object.keys(fs.files)
      .find((p) => p.endsWith('/project.json'))!
      .slice(0, -'/project.json'.length);
    fs.files[`${dir}/assets/Картинки/лес.png`] = png;
    localStorage.setItem('herplan.web.fs.v1', JSON.stringify(fs));
  }, picture);
  await page.reload();
  await page
    .getByRole('button', { name: /^Рисунки/ })
    .first()
    .click();
  return { errors };
}

/** The stored files whose path ends so. */
async function stored(page: Page, suffix: string): Promise<string[]> {
  return page.evaluate((end) => {
    const fs = JSON.parse(localStorage.getItem('herplan.web.fs.v1') ?? '{}') as { files: Files };
    return Object.entries(fs.files)
      .filter(([p]) => p.endsWith(end))
      .map(([, v]) => v);
  }, suffix);
}

/** Does a stored PNG carry the source of a drawing (the "herplan-drawing" chunk)? */
const carriesDrawing = (dataUrl: string) => atob(dataUrl.slice(dataUrl.indexOf(',') + 1)).includes('herplan-drawing');

const shot = (page: Page, name: string) =>
  process.env.HERPLAN_SHOTS ? page.screenshot({ path: `${process.env.HERPLAN_SHOTS}/${name}.png` }) : null;

/** Draws a stroke on the sheet from one point to another (fractions of its size). */
async function stroke(page: Page, from: [number, number], to: [number, number]) {
  const sheet = page.getByRole('img', { name: 'Лист для рисования' });
  const box = (await sheet.boundingBox())!;
  await page.mouse.move(box.x + box.width * from[0], box.y + box.height * from[1]);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * ((from[0] + to[0]) / 2), box.y + box.height * ((from[1] + to[1]) / 2), {
    steps: 5,
  });
  await page.mouse.move(box.x + box.width * to[0], box.y + box.height * to[1], { steps: 5 });
  await page.mouse.up();
}

test('a document: a new drawing goes into the text; a picture is drawn on as a copy, and opens again (0.9)', async ({
  page,
}) => {
  const { errors } = await newProject(page);
  await page.getByRole('button', { name: /Документы/ }).click();
  await page.getByRole('navigation', { name: 'Документы' }).getByRole('button', { name: 'Новый документ' }).click();
  await page.getByRole('menuitem', { name: 'Пустой документ' }).click();
  await page.getByLabel('Название документа').fill('Эскизы');
  await page.getByLabel('Название документа').press('Enter');

  // A new drawing: a stroke and a box, saved into the text.
  await page.getByRole('button', { name: 'Нарисовать рисунок' }).click();
  let win = page.getByRole('dialog', { name: 'Новый рисунок' });
  await expect(win).toBeVisible();
  const sheet = win.getByRole('img', { name: 'Лист для рисования' });
  await stroke(page, [0.1, 0.1], [0.4, 0.5]);
  await win.getByRole('button', { name: 'Прямоугольник (R)' }).click();
  await stroke(page, [0.5, 0.5], [0.8, 0.8]);
  await expect(sheet).toHaveAttribute('data-items', '2');
  // Ctrl+Z takes the box back, Ctrl+Y brings it again.
  await page.keyboard.press('Control+z');
  await expect(sheet).toHaveAttribute('data-items', '1');
  await page.keyboard.press('Control+y');
  await expect(sheet).toHaveAttribute('data-items', '2');
  await shot(page, 'd1-new');
  await win.getByRole('button', { name: 'Сохранить' }).click();
  await expect(win).toHaveCount(0);
  const editor = page.locator('.ProseMirror');
  await expect(editor.locator('img.doc-image')).toHaveCount(1);
  await page.keyboard.press('Control+S');
  await expect
    .poll(async () => (await stored(page, '/Эскизы.md'))[0] ?? '')
    .toContain('![Рисунок](assets/Рисунки/Рисунок.png)');
  const [made] = await stored(page, '/assets/Рисунки/Рисунок.png');
  expect(carriesDrawing(made)).toBe(true);

  // A picture of the project put into the text and drawn on: a copy beside it, in the text in its place.
  await page.getByRole('button', { name: 'Картинка' }).first().click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /лес\.png/ })
    .click();
  await expect(editor.locator('img.doc-image')).toHaveCount(2);
  const forest = editor.locator('.doc-image-wrap').nth(1);
  await forest.hover();
  await forest.getByRole('button', { name: 'Нарисовать на картинке' }).click();
  win = page.getByRole('dialog', { name: 'Рисуем на картинке «лес»' });
  await expect(win).toBeVisible();
  await expect(win).toContainText('Сохранится копией рядом с картинкой: «лес (рисунок).png»');
  await win.getByRole('button', { name: 'Овал (O)' }).click();
  await stroke(page, [0.2, 0.2], [0.7, 0.7]);
  await shot(page, 'd2-picture');
  await win.getByRole('button', { name: 'Сохранить' }).click();
  await expect(win).toHaveCount(0);
  await page.keyboard.press('Control+S');
  await expect
    .poll(async () => (await stored(page, '/Эскизы.md'))[0] ?? '')
    .toContain('(<assets/Картинки/лес (рисунок).png>)');
  const [copy] = await stored(page, '/assets/Картинки/лес (рисунок).png');
  expect(carriesDrawing(copy)).toBe(true);
  // The picture itself is as it was.
  const [original] = await stored(page, '/assets/Картинки/лес.png');
  expect(carriesDrawing(original)).toBe(false);

  // The copy opens again with the oval: it can still be moved or erased.
  await forest.hover();
  await forest.getByRole('button', { name: 'Нарисовать на картинке' }).click();
  win = page.getByRole('dialog', { name: 'Рисунок «лес (рисунок)»' });
  await expect(win.getByRole('img', { name: 'Лист для рисования' })).toHaveAttribute('data-items', '1');
  await win.getByRole('button', { name: 'Отмена' }).click();
  await expect(win).toHaveCount(0);
  expect(errors).toEqual([]);
});
