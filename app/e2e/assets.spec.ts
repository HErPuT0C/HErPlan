import { expect, test, type Page } from '@playwright/test';

// The asset library (0.3, F4-11, F4-12): files dropped in, folders, moving a file by dragging it onto a
// folder, renaming a folder keeps the pictures that use it, folder colours.

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';

async function openAssets(page: Page) {
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
  await page.getByLabel('Название').fill('Ресурсы');
  await page.getByRole('button', { name: 'Создать', exact: true }).click();
  await page
    .getByRole('button', { name: /Ресурсы/ })
    .last()
    .click();
  await expect(page.getByRole('navigation', { name: 'Папки' })).toBeVisible();
  return { errors };
}

/** Drops files (as the web build receives them) on an element. */
async function dropFiles(page: Page, selector: string, names: string[]) {
  await page.locator(selector).evaluate(
    (el, { names: list, b64 }) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const data = new DataTransfer();
      for (const name of list) data.items.add(new File([bytes], name, { type: 'image/png' }));
      for (const type of ['dragover', 'drop']) {
        el.dispatchEvent(new DragEvent(type, { dataTransfer: data, bubbles: true, cancelable: true }));
      }
    },
    { names, b64: PNG },
  );
}

const shot = (page: Page, name: string) =>
  process.env.HERPLAN_SHOTS ? page.screenshot({ path: `${process.env.HERPLAN_SHOTS}/${name}.png` }) : null;

test('files dropped in, a folder made, a file moved into it, the folder renamed and coloured', async ({ page }) => {
  const { errors } = await openAssets(page);
  await dropFiles(page, '.assets-content', ['mira.png', 'boris.png', 'mill.png']);
  await expect(page.locator('.asset-item:not(.asset-item-folder)')).toHaveCount(3);

  page.once('dialog', () => undefined);
  await page.getByRole('button', { name: 'Новая папка' }).click();
  await page.getByRole('dialog', { name: 'Новая папка' }).getByLabel('Имя').fill('Персонажи');
  await page.getByRole('button', { name: 'Сохранить' }).click();
  const tree = page.getByRole('navigation', { name: 'Папки' });
  await expect(tree.getByRole('button', { name: 'Персонажи' })).toBeVisible();

  // Drag a file onto the folder in the tree.
  await page.locator('.asset-item', { hasText: 'mira.png' }).dragTo(tree.getByRole('button', { name: 'Персонажи' }));
  await expect(page.locator('.asset-item', { hasText: 'mira.png' })).toHaveCount(0);
  await tree.getByRole('button', { name: 'Персонажи' }).click();
  await expect(page.locator('.asset-item', { hasText: 'mira.png' })).toBeVisible();

  // A colour and a new name for the folder.
  await tree.getByRole('button', { name: 'Персонажи' }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Зелёная' }).click();
  await tree.getByRole('button', { name: 'Персонажи' }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Переименовать' }).click();
  await page.getByRole('dialog', { name: 'Переименовать' }).getByLabel('Имя').fill('Герои');
  await page.getByRole('button', { name: 'Сохранить' }).click();
  await expect(tree.getByRole('button', { name: 'Герои' })).toBeVisible();
  await expect(page.locator('.asset-item', { hasText: 'mira.png' })).toBeVisible();

  await page.locator('.asset-item', { hasText: 'mira.png' }).click();
  await expect(page.getByRole('complementary', { name: 'mira.png' })).toContainText('Нигде не используется');
  await shot(page, 'a1-assets');
  expect(errors).toEqual([]);
});

test('search finds folders by name and keeps them in the tree', async ({ page }) => {
  const { errors } = await openAssets(page);
  for (const name of ['Персонажи', 'Локации']) {
    await page.getByRole('button', { name: 'Новая папка' }).click();
    await page.getByRole('dialog', { name: 'Новая папка' }).getByLabel('Имя').fill(name);
    await page.getByRole('button', { name: 'Сохранить' }).click();
  }
  const tree = page.getByRole('navigation', { name: 'Папки' });
  await tree.getByRole('button', { name: 'Персонажи' }).click();
  await dropFiles(page, '.assets-content', ['mira.png']);
  await tree.getByRole('button', { name: 'Ресурсы' }).click();

  await page.getByRole('searchbox', { name: 'Поиск папок и файлов' }).fill('перс');
  await expect(tree.getByRole('button', { name: 'Персонажи' })).toBeVisible();
  await expect(tree.getByRole('button', { name: 'Локации' })).toHaveCount(0);
  // The folder and the file inside it are found.
  await expect(page.locator('.asset-item-folder', { hasText: 'Персонажи' })).toBeVisible();
  await expect(page.locator('.asset-item', { hasText: 'mira.png' })).toBeVisible();
  await page.locator('.asset-item-folder', { hasText: 'Персонажи' }).dblclick();
  await expect(page.getByRole('searchbox', { name: 'Поиск папок и файлов' })).toHaveValue('');
  await expect(page.locator('.asset-item', { hasText: 'mira.png' })).toBeVisible();
  expect(errors).toEqual([]);
});
