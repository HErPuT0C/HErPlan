import { expect, test, type Page } from '@playwright/test';
import JSZip from 'jszip';

// The owner's list for 0.7.4, on the tutorial project: a picture of the map's list shown when pointed at,
// "@" in a description, an emoji as a label's symbol, and documents — a heading made of the selected words,
// A4 sheets with page breaks, Word export.

async function openTutorial(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem(
      'herplan.web.settings.v1',
      JSON.stringify({ locale: 'ru', canvasHintsOpen: false, tourSeen: true }),
    );
  });
  await page.reload();
  await page.getByRole('button', { name: 'Учебный проект', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Учебный проект: Последний фонарь' }).first()).toBeVisible();
  return { errors };
}

async function openModule(page: Page, name: string) {
  await page.getByRole('tab', { name: 'Дом' }).click();
  await page
    .getByRole('button', { name: new RegExp(name) })
    .first()
    .click();
}

async function fileText(page: Page, suffix: string): Promise<string | null> {
  return page.evaluate((end) => {
    const fs = JSON.parse(localStorage.getItem('herplan.web.fs.v1') ?? '{}') as { files: Record<string, string> };
    const path = Object.keys(fs.files).find((p) => p.endsWith(end));
    return path ? fs.files[path] : null;
  }, suffix);
}

const shot = (page: Page, name: string) =>
  process.env.HERPLAN_SHOTS ? page.screenshot({ path: `${process.env.HERPLAN_SHOTS}/${name}.png` }) : null;

test('the map shows a picture pointed at in its list; a label takes an emoji as its symbol', async ({ page }) => {
  const { errors } = await openTutorial(page);
  await openModule(page, 'Карта проекта');
  const objects = page.getByRole('navigation', { name: 'Объекты проекта' });
  await objects.getByRole('searchbox').fill('портреты');
  await objects.getByRole('button', { name: /nika\.svg/ }).hover();
  await expect(page.locator('.map-preview img')).toBeVisible();
  await expect(page.locator('.map-preview')).toContainText('Портреты/nika.svg');
  await shot(page, 'g1-map-preview');
  await page.mouse.move(5, 5);
  await expect(page.locator('.map-preview')).toHaveCount(0);

  await openModule(page, 'Задачи');
  await page.getByRole('button', { name: 'Метки', exact: true }).click();
  const symbol = page.getByRole('dialog', { name: 'Метки проекта' }).getByLabel('Символ').first();
  await symbol.fill('👨‍💻👍🏽 и ещё');
  await expect(symbol).toHaveValue('👨‍💻👍🏽');
  expect(errors).toEqual([]);
});

test('"@" in a description offers cards and tags, fewer with each letter; Enter puts the whole name', async ({
  page,
}) => {
  const { errors } = await openTutorial(page);
  await openModule(page, 'База данных');
  await page.locator('.world-card', { hasText: 'Ника' }).click();
  const panel = page.locator('.world-panel');
  await panel.getByRole('textbox', { name: 'Описание', exact: true }).click({ position: { x: 4, y: 4 } });
  const box = panel.locator('textarea.world-long').first();
  await box.press('Control+End');
  await box.pressSequentially(' Дружит с @');
  const options = page.getByRole('listbox', { name: 'Упомянуть' });
  await expect(options.getByRole('option')).toHaveCount(8);
  await box.pressSequentially('ве');
  await expect(options.getByRole('option').first()).toContainText('Вела');
  await shot(page, 'g2-mention-options');
  await box.press('Enter');
  await expect(box).toHaveValue(/Дружит с Вела $/);
  // A tag by a click.
  await box.pressSequentially('и @хитр');
  await options.getByRole('option', { name: /Хитрая/ }).click();
  await expect(box).toHaveValue(/Дружит с Вела и Хитрая $/);
  await box.press('Escape');
  await expect(panel.getByRole('textbox', { name: 'Описание', exact: true }).locator('.mention-link')).toHaveText([
    'Ян',
    'Смелая',
    'Вела',
    'Хитрая',
  ]);
  expect(errors).toEqual([]);
});

test('documents: a heading of the selected words, A4 sheets with a page break, Word export', async ({ page }) => {
  const { errors } = await openTutorial(page);
  await openModule(page, 'Документы');
  await page.getByRole('navigation', { name: 'Документы' }).getByRole('button', { name: 'Новый документ' }).click();
  await page.getByRole('menuitem', { name: 'Пустой документ' }).click();
  await page.getByLabel('Название документа').fill('Листы');
  await page.getByLabel('Название документа').press('Enter');
  const text = page.getByLabel('Текст документа');
  await text.click();
  await page.keyboard.type('Первое второе третье слово');
  // "второе" selected, as a double click selects it.
  await page.keyboard.press('Home');
  for (let i = 0; i < 7; i++) await page.keyboard.press('ArrowRight');
  for (let i = 0; i < 7; i++) await page.keyboard.press('Shift+ArrowRight');
  await page.getByRole('button', { name: 'Заголовок 1' }).click();
  await expect(page.locator('.doc-text h1')).toHaveText('второе');
  await expect(page.locator('.doc-text > p').first()).toHaveText('Первое');
  await expect(page.locator('.doc-text > p').nth(1)).toHaveText('третье слово');

  // A page break: what follows starts the second sheet; typing goes on after the break.
  await page.locator('.doc-text > p').nth(1).click();
  await page.keyboard.press('End');
  await page.keyboard.press('Control+Enter');
  await page.keyboard.type('Вторая страница');
  await expect(page.locator('.doc-text .doc-page-break')).toHaveCount(1);
  const second = page.locator('.doc-text p').filter({ hasText: 'Вторая страница' });
  await expect(second).toHaveCount(1);
  const sheet = (await page.locator('.doc-text').boundingBox())!;
  const top = (await second.boundingBox())!.y - sheet.y;
  // The second sheet's text starts 1123 + 24 + 76 px from the top of the first.
  expect(top).toBeGreaterThanOrEqual(1223 - 2);
  expect(top).toBeLessThan(1223 + 40);
  await page.locator('.doc-scroll').evaluate((el) => (el.scrollTop = 900));
  await shot(page, 'g3-sheets');

  // Word.
  page.on('dialog', (d) => void d.accept(d.defaultValue()));
  await page.getByRole('button', { name: 'Документ в Word (.docx)…' }).click();
  await expect(page.getByText(/Документ Word сохранён/)).toBeVisible({ timeout: 20_000 });
  expect(await fileText(page, '/Documents/HErPlan/Листы.docx')).toMatch(/^data:application\/octet-stream;base64,UEsDB/);

  // A document with an SVG picture: the picture is drawn into PNG and put in.
  await page.getByRole('navigation', { name: 'Документы' }).getByRole('button', { name: 'Остров Гряда' }).click();
  await page.getByRole('button', { name: 'Документ в Word (.docx)…' }).click();
  await expect.poll(() => fileText(page, 'Остров Гряда.docx'), { timeout: 20_000 }).not.toBeNull();
  const data = (await fileText(page, 'Остров Гряда.docx'))!;
  const zip = await JSZip.loadAsync(Buffer.from(data.slice(data.indexOf(',') + 1), 'base64'));
  expect(Object.keys(zip.files).some((f) => /^word\/media\/.+\.png$/.test(f))).toBe(true);
  const xml = (await zip.file('word/document.xml')?.async('string')) ?? '';
  expect(xml).toContain('Остров Гряда');
  expect(errors).toEqual([]);
});
