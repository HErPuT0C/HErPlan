import { expect, test, type Page } from '@playwright/test';
import { allFiles } from '../src/core/project/files';
import { sampleProject } from '../src/story/sample';

// Plot devices laid over lines, options and words (0.3): highlighted words on cards, the text menu with
// Chekhov's gun and the butterfly effect, links dragged from a mark, the comment of an option.

/** Creates a project in the web build and replaces its data with the reference sample (story/sample.ts). */
async function openSample(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('herplan.web.settings.v1', JSON.stringify({ locale: 'ru', canvasHintsOpen: false }));
  });
  await page.reload();
  await page.getByRole('button', { name: 'Создать проект' }).click();
  await page.getByLabel('Название').fill('Пример');
  await page.getByRole('button', { name: 'Создать', exact: true }).click();
  await expect(page.getByRole('button', { name: /Сценарий/ })).toBeVisible();
  const files = allFiles(sampleProject()).filter((f) => f.path !== 'project.json');
  await page.evaluate((sample) => {
    const fs = JSON.parse(localStorage.getItem('herplan.web.fs.v1') ?? '{}') as { files: Record<string, string> };
    const meta = Object.keys(fs.files).find((p) => p.endsWith('/project.json'))!;
    const dir = meta.slice(0, -'/project.json'.length);
    for (const p of Object.keys(fs.files)) if (p.startsWith(`${dir}/data/`)) delete fs.files[p];
    for (const f of sample) fs.files[`${dir}/${f.path}`] = f.text;
    localStorage.setItem('herplan.web.fs.v1', JSON.stringify(fs));
  }, files);
  await page.reload();
  await page
    .getByRole('button', { name: /Пример/ })
    .first()
    .click();
  await page.getByRole('button', { name: /Сценарий/ }).click();
  const canvas = page.getByRole('application', { name: 'Холст' });
  await expect(canvas).toBeVisible();
  return { canvas, errors };
}

const center = (b: { x: number; y: number; width: number; height: number }) => ({
  x: b.x + b.width / 2,
  y: b.y + b.height / 2,
});

async function openChapter(page: Page, title: string) {
  const card = page.locator('.cnode', { hasText: title }).first();
  await card.locator('.cnode-head').click();
  await page.keyboard.press('Enter');
  await expect(page.locator('.story-crumb-btn', { hasText: title })).toBeVisible();
}

/** Finds a node with the canvas search: the view zooms to a readable level around it. */
async function goTo(page: Page, title: string) {
  await page.getByRole('application', { name: 'Холст' }).focus();
  await page.keyboard.press('Control+f');
  const search = page.getByRole('textbox', { name: 'Поиск по холсту (Ctrl+F)' });
  await search.fill(title);
  await search.press('Enter');
  await search.press('Escape');
  await expect(page.locator('.cnode', { hasText: title }).first()).toBeVisible();
}

const shot = (page: Page, name: string) =>
  process.env.HERPLAN_SHOTS ? page.screenshot({ path: `${process.env.HERPLAN_SHOTS}/${name}.png` }) : null;

test('marked words on a card: click opens the mark, dragging links it to a node', async ({ page }) => {
  const { errors } = await openSample(page);
  await openChapter(page, 'Глава 1. Мельница');
  await goTo(page, 'Встреча');
  const meet = page.locator('.cnode', { hasText: 'Встреча' }).first();
  const rifle = meet.locator('.cmark-gun', { hasText: 'старое ружьё' });
  await expect(rifle).toBeVisible();
  await shot(page, 'chapter1');

  await rifle.click();
  const mark = page.locator('.imark-gun');
  await expect(mark).toContainText('Реплика 2 · «старое ружьё»');
  await expect(mark).toContainText('Глава 3. Замок › Выстрел');
  await shot(page, 'mark-inspector');

  // Drag from the words to another card: one more place where the gun fires.
  const bags = page.locator('.cnode', { hasText: 'Мешки' }).first();
  const from = center((await rifle.boundingBox())!);
  const to = center((await bags.boundingBox())!);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await shot(page, 'dragging');
  await page.mouse.up();
  await expect(mark).toContainText('Глава 1. Мельница › Мешки');
  await expect(bags.locator('.cland-gun')).toBeVisible();
  await shot(page, 'linked');
  expect(errors).toEqual([]);
});

test('selected words get a device from the text menu; options take a comment', async ({ page }) => {
  const { errors } = await openSample(page);
  await openChapter(page, 'Глава 1. Мельница');
  await goTo(page, 'Встреча');
  await page.locator('.cnode', { hasText: 'Встреча' }).first().locator('.cnode-head').click();
  const line = page.getByLabel('Реплика 1');
  await line.focus();
  // Select "пришёл" in "Ты пришёл." and open the context menu on it.
  await line.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(3, 9));
  // A right click on the selected words keeps them selected.
  await line.click({ button: 'right', position: { x: 55, y: 14 } });
  const menu = page.getByRole('menu', { name: 'Текст' });
  for (const item of ['Вырезать', 'Копировать', 'Вставить', 'Выделить всё', 'Чеховское ружьё', 'Эффект бабочки']) {
    await expect(menu.getByRole('menuitem', { name: item })).toBeVisible();
  }
  await shot(page, 'text-menu');
  await menu.getByRole('menuitem', { name: 'Эффект бабочки' }).click();
  await expect(page.locator('.imark-butterfly')).toContainText('Реплика 1 · «пришёл»');
  await expect(page.locator('.cnode', { hasText: 'Встреча' }).first().locator('.cmark-butterfly')).toHaveText('пришёл');

  // A comment on an option, with a variable changed in it.
  await goTo(page, 'Что ответить Мире?');
  await page.locator('.cnode', { hasText: 'Что ответить Мире?' }).first().locator('.cnode-head').click();
  await page.getByLabel('Комментарий к варианту').first().fill('Мира рада: {доверие += 1}');
  await expect(page.locator('.mtext-mirror .hl-effect').first()).toHaveText('{доверие += 1}');
  await shot(page, 'option-note');
  expect(errors).toEqual([]);
});
