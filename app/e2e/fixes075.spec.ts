import { expect, test, type Page } from '@playwright/test';

// 0.7.5 on the tutorial project: the description box keeps the card's width and wraps its lines again; several
// files and folders of the assets picked at once — with the mouse (Ctrl, Shift, a frame) and the keyboard — and
// put in the Recycle Bin or moved together.

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

const tile = (page: Page, name: string) => page.locator('.asset-item', { hasText: name });
const picked = (page: Page) => page.locator('.asset-item-selected .asset-name');

test('the description box keeps the width of the card and wraps long text (0.7.5)', async ({ page }) => {
  const { errors } = await openTutorial(page);
  await openModule(page, 'База данных');
  await page.locator('.world-card', { hasText: 'Ника' }).click();
  const panel = page.locator('.world-panel');
  await panel.getByRole('textbox', { name: 'Описание', exact: true }).click({ position: { x: 4, y: 4 } });
  const box = panel.locator('textarea.world-long').first();
  await box.fill('');
  const empty = (await box.boundingBox())!;
  expect(empty.width).toBeGreaterThan(300);
  await box.fill('Очень длинное описание без переносов, которое раньше раздувало окно вширь. '.repeat(6));
  const long = (await box.boundingBox())!;
  expect(Math.abs(long.width - empty.width)).toBeLessThan(2);
  expect(long.height).toBeGreaterThan(empty.height + 40);
  expect(await box.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  expect(errors).toEqual([]);
});

test('assets: several picked with Ctrl, Shift, the keyboard and a frame; deleted and moved together', async ({
  page,
}) => {
  const { errors } = await openTutorial(page);
  page.on('dialog', (d) => void d.accept());
  await openModule(page, 'Ресурсы');
  await tile(page, 'Портреты').dblclick();
  await expect(tile(page, 'nika.svg')).toBeVisible();

  // Mouse: a click, Shift+click a run, Ctrl+click takes one away.
  await tile(page, 'nika.svg').click();
  await tile(page, 'suhar.svg').click({ modifiers: ['Shift'] });
  await expect(picked(page)).toHaveText(['nika.svg', 'ortega.svg', 'suhar.svg']);
  await tile(page, 'ortega.svg').click({ modifiers: ['Control'] });
  await expect(picked(page)).toHaveText(['nika.svg', 'suhar.svg']);
  await expect(page.locator('.assets-picked')).toContainText('Выбрано: 2');

  // Keyboard: arrows move, Ctrl or Shift with them stretch; Ctrl+A; Escape.
  await tile(page, 'yan.svg').click();
  await page.keyboard.press('Control+ArrowLeft');
  await page.keyboard.press('Shift+ArrowLeft');
  await expect(picked(page)).toHaveText(['suhar.svg', 'vela.svg', 'yan.svg']);
  await page.keyboard.press('ArrowLeft');
  await expect(picked(page)).toHaveText(['ortega.svg']);
  await page.keyboard.press('Control+a');
  await expect(picked(page)).toHaveCount(5);
  await page.keyboard.press('Escape');
  await expect(picked(page)).toHaveCount(0);

  // A frame from an empty place over the first two.
  const content = (await page.locator('.assets-content').boundingBox())!;
  const second = (await tile(page, 'ortega.svg').boundingBox())!;
  await page.mouse.move(content.x + content.width - 10, content.y + content.height - 10);
  await page.mouse.down();
  await page.mouse.move(second.x + second.width / 2, second.y + 10, { steps: 8 });
  await expect(page.locator('.assets-frame')).toBeVisible();
  await page.mouse.up();
  await expect(picked(page)).toContainText(['ortega.svg']);
  // A click on an empty place lets go.
  await page.mouse.click(content.x + content.width - 10, content.y + content.height - 10);
  await expect(picked(page)).toHaveCount(0);

  // Two dragged together onto the folder above them.
  await tile(page, 'nika.svg').click();
  await tile(page, 'yan.svg').click({ modifiers: ['Control'] });
  const from = (await tile(page, 'yan.svg').boundingBox())!;
  const to = (await page.locator('.assets-crumbs').getByRole('button', { name: 'Ресурсы' }).boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + 40, from.y + 40, { steps: 4 });
  await expect(page.locator('.asset-drag-ghost')).toContainText('и ещё 1');
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect(tile(page, 'nika.svg')).toHaveCount(0);
  await expect(tile(page, 'yan.svg')).toHaveCount(0);

  // Delete: the picked ones to the Recycle Bin at once.
  await tile(page, 'ortega.svg').click();
  await tile(page, 'vela.svg').click({ modifiers: ['Control'] });
  await page.keyboard.press('Delete');
  await expect(tile(page, 'ortega.svg')).toHaveCount(0);
  await expect(tile(page, 'vela.svg')).toHaveCount(0);
  await expect(tile(page, 'suhar.svg')).toBeVisible();
  await page.locator('.assets-crumbs').getByRole('button', { name: 'Ресурсы' }).click();
  await expect(tile(page, 'nika.svg')).toBeVisible();
  await expect(tile(page, 'yan.svg')).toBeVisible();
  expect(errors).toEqual([]);
});
