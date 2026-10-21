import { expect, test, type Page } from '@playwright/test';
import { allFiles } from '../src/core/project/files';
import { sampleProject } from '../src/story/sample';

// The project map (0.4, F5-01): objects dragged from the list become cards that show them; double click opens.

async function openSample(page: Page) {
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
  return { errors };
}

const shot = (page: Page, name: string) =>
  process.env.HERPLAN_SHOTS ? page.screenshot({ path: `${process.env.HERPLAN_SHOTS}/${name}.png` }) : null;

/** Drags an object of the list onto the canvas at (dx, dy) from its top-left corner. */
async function dragToMap(page: Page, name: string | RegExp, dx: number, dy: number) {
  const item = page.getByRole('navigation', { name: 'Объекты проекта' }).getByRole('button', { name });
  const box = (await page.locator('.map-canvas').boundingBox())!;
  const from = (await item.boundingBox())!;
  await page.mouse.move(from.x + 20, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + 60, from.y + 20, { steps: 4 });
  await page.mouse.move(box.x + dx, box.y + dy, { steps: 8 });
  await page.mouse.up();
}

test('chapters, cards and documents dragged onto the map; a double click opens them', async ({ page }) => {
  const { errors } = await openSample(page);
  // A document to put on the map.
  await page
    .getByRole('button', { name: /Документы/ })
    .first()
    .click();
  await page.getByRole('navigation', { name: 'Документы' }).getByRole('button', { name: 'Новый документ' }).click();
  await page.getByRole('menuitem', { name: 'Пустой документ' }).click();
  await page.getByLabel('Название документа').fill('План');
  await page.getByLabel('Название документа').press('Enter');

  await page.getByRole('tab', { name: 'Дом' }).click();
  await page
    .getByRole('button', { name: /Карта проекта/ })
    .first()
    .click();
  await expect(page.getByRole('navigation', { name: 'Объекты проекта' })).toBeVisible();
  await dragToMap(page, 'Глава 1. Мельница', 200, 150);
  await dragToMap(page, 'Мира', 520, 150);
  await dragToMap(page, 'План', 360, 360);
  await expect(page.locator('.map-ref')).toHaveCount(3);
  await expect(page.locator('.map-ref-entity')).toContainText('Мира');
  await expect(page.locator('.map-ref-entity')).toContainText('Персонаж');
  await expect(page.locator('.map-ref-document')).toContainText('План');
  await shot(page, 'm1-map');

  // A card renamed in the database shows its new name on the map.
  await page.locator('.map-ref-entity').dblclick();
  await expect(page.locator('.world-panel').getByLabel('Имя', { exact: true })).toHaveValue('Мира');
  await page.locator('.world-panel').getByLabel('Имя', { exact: true }).fill('Мирослава');
  await page.getByRole('tab', { name: 'Карта проекта' }).click();
  await expect(page.locator('.map-ref-entity')).toContainText('Мирослава');
  // The chapter opens in the story.
  await page.locator('.map-ref-chapter').dblclick();
  await expect(page.locator('.story-crumb-btn', { hasText: 'Глава 1. Мельница' })).toBeVisible();
  expect(errors).toEqual([]);
});
