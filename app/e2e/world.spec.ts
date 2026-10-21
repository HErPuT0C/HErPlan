import { expect, test, type Page } from '@playwright/test';
import { allFiles } from '../src/core/project/files';
import { sampleProject } from '../src/story/sample';

// The world database (0.3, F4): types and fields, property sets, relations seen from both sides, pictures,
// manual order kept after a restart, "where used" leading into the story.

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
  await page.getByRole('button', { name: /База данных/ }).click();
  await expect(page.getByRole('navigation', { name: 'Типы' })).toBeVisible();
  return { errors };
}

const shot = (page: Page, name: string) =>
  process.env.HERPLAN_SHOTS ? page.screenshot({ path: `${process.env.HERPLAN_SHOTS}/${name}.png` }) : null;

const card = (page: Page, name: string) => page.locator('.world-card', { hasText: name }).first();

test('a type of our own with a property set; a field added to the set appears everywhere', async ({ page }) => {
  const { errors } = await openSample(page);
  await shot(page, 'w1-cards');
  await page.getByRole('button', { name: 'Типы и поля…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Типы и поля' });
  // "Weapon", a subtype of "Item".
  await dialog.getByRole('button', { name: 'Предмет', exact: true }).click();
  await dialog.getByRole('button', { name: 'Подтип' }).click();
  await dialog.getByLabel('Название типа').fill('Оружие');
  // A property set used by items and weapons.
  await dialog.getByRole('button', { name: 'Набор', exact: true }).click();
  await dialog.getByLabel('Название набора').fill('Бой');
  await dialog.getByRole('button', { name: 'Предмет', exact: true }).click();
  await dialog.getByRole('checkbox', { name: 'Бой' }).check();
  await dialog.getByRole('button', { name: 'Бой' }).click();
  await dialog.getByRole('combobox', { name: 'Вид поля' }).last().selectOption('number');
  await dialog.getByRole('button', { name: 'Поле', exact: true }).click();
  await dialog.getByLabel('Название поля').last().fill('Урон');
  await shot(page, 'w2-schema');
  await page.keyboard.press('Escape');

  // A weapon card has the field through its parent type.
  await page
    .getByRole('navigation', { name: 'Типы' })
    .getByRole('button', { name: /Оружие/ })
    .click();
  await page.getByRole('button', { name: 'Оружие', exact: true }).click();
  const panel = page.locator('.world-panel');
  await panel.getByLabel('Имя', { exact: true }).fill('Меч');
  await expect(panel.getByRole('spinbutton', { name: 'Урон' })).toBeVisible();
  await panel.getByRole('spinbutton', { name: 'Урон' }).fill('12');
  // And so does the key, an ordinary item.
  await page.getByRole('navigation', { name: 'Типы' }).getByRole('button', { name: /Все/ }).click();
  await card(page, 'Ключ').click();
  await expect(panel.getByRole('spinbutton', { name: 'Урон' })).toBeVisible();
  await shot(page, 'w3-panel');
  expect(errors).toEqual([]);
});

test('one relation, seen from both sides with its own label', async ({ page }) => {
  const { errors } = await openSample(page);
  await card(page, 'Борис').click();
  const panel = page.locator('.world-panel');
  await panel.getByRole('combobox', { name: 'С кем…' }).selectOption({ label: 'Мира' });
  await panel.getByRole('combobox', { name: /Кто это для этой карточки/ }).fill('жена');
  await expect(panel.getByRole('combobox', { name: /Подпись с другой стороны/ })).toHaveValue('муж');
  await panel.getByRole('button', { name: 'Связать' }).click();
  await expect(panel.locator('.world-relation-label')).toHaveValue('жена');
  await panel.locator('.world-relation .entity-link').click();
  await expect(panel.getByLabel('Имя', { exact: true })).toHaveValue('Мира');
  await expect(panel.locator('.world-relation-label')).toHaveValue('муж');
  await shot(page, 'w4-relation');
  expect(errors).toEqual([]);
});

test('manual order survives a restart; "where used" leads into the story', async ({ page }) => {
  const { errors } = await openSample(page);
  const boris = card(page, 'Борис');
  const mira = card(page, 'Мира');
  await boris.dragTo(mira);
  const names = () => page.locator('.world-group').first().locator('.world-card-name').allTextContents();
  await expect.poll(names).toEqual(['Борис', 'Мира']);
  await page.keyboard.press('Control+S');
  await page.waitForTimeout(800);
  await page.reload();
  await page
    .getByRole('button', { name: /Пример/ })
    .first()
    .click();
  await expect(page.getByRole('tab', { name: 'База данных' })).toHaveAttribute('aria-selected', 'true');
  await expect.poll(names).toEqual(['Борис', 'Мира']);

  await card(page, 'Мира').click();
  await page
    .locator('.world-panel')
    .getByRole('button', { name: /Узел «Мира»/ })
    .click();
  await expect(page.locator('.story-crumb-btn', { hasText: 'Глава 1. Мельница' })).toBeVisible();
  expect(errors).toEqual([]);
});

/** A 1×1 PNG, as the bytes of a dropped or pasted picture. */
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';

test('a portrait: pasted from the clipboard, dropped as a file, picked from the assets', async ({ page }) => {
  const { errors } = await openSample(page);
  const panel = page.locator('.world-panel');
  const image = panel.locator('.image-field');

  // Paste a screenshot onto Mira's picture.
  await card(page, 'Мира').click();
  await image.locator('button').evaluate((el, b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const data = new DataTransfer();
    data.items.add(new File([bytes], 'image.png', { type: 'image/png' }));
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, PNG);
  await expect(image.locator('img')).toBeVisible();
  await expect(card(page, 'Мира').locator('img')).toBeVisible();

  // Drop a file onto Boris's picture (the web build gets HTML5 drops).
  await card(page, 'Борис').click();
  await image.evaluate((el, b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const data = new DataTransfer();
    data.items.add(new File([bytes], 'boris.png', { type: 'image/png' }));
    for (const type of ['dragover', 'drop']) {
      el.dispatchEvent(new DragEvent(type, { dataTransfer: data, bubbles: true, cancelable: true }));
    }
  }, PNG);
  await expect(image.locator('img')).toBeVisible();

  // The mill takes Boris's picture from the assets.
  await card(page, 'Мельница').click();
  await image.locator('button').click();
  await page.getByRole('menuitem', { name: 'Из ресурсов проекта…' }).click();
  await page
    .getByRole('dialog', { name: 'Картинка' })
    .getByRole('button', { name: /boris\.png/ })
    .click();
  await expect(image.locator('img')).toBeVisible();
  await shot(page, 'w5-pictures');
  expect(errors).toEqual([]);
});

test('a pair of relation labels of our own is offered on both sides', async ({ page }) => {
  const { errors } = await openSample(page);
  await page.getByRole('button', { name: 'Типы и поля…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Типы и поля' });
  await dialog.getByRole('button', { name: 'Подписи связей' }).click();
  await dialog.getByLabel('Подпись (например, «должник»)').fill('должник');
  await dialog.getByLabel('С другой стороны (например, «кредитор»)').fill('кредитор');
  await dialog.getByRole('button', { name: 'Добавить пару' }).click();
  await expect(dialog).toContainText('должник');
  await page.keyboard.press('Escape');

  await card(page, 'Борис').click();
  const panel = page.locator('.world-panel');
  await panel.getByRole('combobox', { name: 'С кем…' }).selectOption({ label: 'Мира' });
  await panel.getByRole('combobox', { name: /Кто это для этой карточки/ }).fill('кредитор');
  await expect(panel.getByRole('combobox', { name: /Подпись с другой стороны/ })).toHaveValue('должник');
  expect(errors).toEqual([]);
});

test('a catalog of tags with descriptions; tags put on a card from the field, a new one made there', async ({
  page,
}) => {
  const { errors } = await openSample(page);
  await page.getByRole('button', { name: 'Типы и поля…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Типы и поля' });
  await dialog.getByRole('button', { name: 'Справочник', exact: true }).click();
  await dialog.getByLabel('Название справочника').fill('Черты');
  await dialog.getByLabel('Добавить тег').fill('ловкий');
  await dialog.getByRole('button', { name: 'Добавить тег' }).click();
  await dialog.getByLabel('Описание тега').fill('уклоняется от первой атаки');
  // "Character" gets a field with tags from the catalog.
  await dialog.getByRole('button', { name: 'Персонаж', exact: true }).click();
  await dialog.getByRole('combobox', { name: 'Вид поля' }).last().selectOption('tags');
  await dialog.getByRole('button', { name: 'Поле', exact: true }).click();
  await dialog.getByLabel('Название поля').last().fill('Черты');
  await dialog.getByRole('combobox', { name: 'Справочник' }).selectOption({ label: 'Черты' });
  await page.keyboard.press('Escape');

  await card(page, 'Мира').click();
  const panel = page.locator('.world-panel');
  const add = panel.getByRole('combobox', { name: 'Добавить тег…' });
  await add.click();
  await page.getByRole('option', { name: /ловкий/ }).click();
  await expect(panel.locator('.world-tag', { hasText: 'ловкий' })).toBeVisible();
  await expect(panel.locator('.world-notes')).toContainText('уклоняется от первой атаки');
  // A tag that is not in the catalog yet: typed and made with Enter.
  await add.fill('самостоятельный');
  await add.press('Enter');
  await expect(panel.locator('.world-tag', { hasText: 'самостоятельный' })).toBeVisible();
  await shot(page, 'w6-tags');

  // The new tag is in the catalog too, and it says how many cards carry it.
  await page.getByRole('button', { name: 'Типы и поля…' }).click();
  await dialog.getByRole('button', { name: 'Черты', exact: true }).click();
  await expect(dialog.getByLabel('Тег', { exact: true }).nth(1)).toHaveValue('самостоятельный');
  await expect(dialog.locator('.schema-tag').first()).toContainText('у 1 карточки');
  await shot(page, 'w7-catalog');
  expect(errors).toEqual([]);
});

test('a type hides card blocks it does not need', async ({ page }) => {
  const { errors } = await openSample(page);
  await page.getByRole('button', { name: 'Типы и поля…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Типы и поля' });
  await dialog.getByRole('button', { name: 'Предмет', exact: true }).click();
  const blocks = dialog.locator('[data-card-blocks]');
  await blocks.getByRole('checkbox', { name: 'Связи' }).uncheck();
  await blocks.getByRole('checkbox', { name: 'Переменные карточки' }).uncheck();
  await blocks.getByRole('checkbox', { name: 'Картинка' }).uncheck();
  await page.keyboard.press('Escape');

  await card(page, 'Ключ').click();
  const panel = page.locator('.world-panel');
  await expect(panel.getByLabel('Описание', { exact: true })).toBeVisible();
  await expect(panel.getByRole('heading', { name: 'Связи' })).toHaveCount(0);
  await expect(panel.getByRole('heading', { name: 'Переменные карточки' })).toHaveCount(0);
  await expect(panel.getByRole('heading', { name: 'Где используется' })).toBeVisible();
  // A character still shows everything.
  await card(page, 'Мира').click();
  await expect(panel.getByRole('heading', { name: 'Связи' })).toBeVisible();
  await shot(page, 'w8-blocks');
  expect(errors).toEqual([]);
});

test('a list of links shows the descriptions of the cards and makes a new card in place', async ({ page }) => {
  const { errors } = await openSample(page);
  await page.getByRole('button', { name: 'Типы и поля…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Типы и поля' });
  await dialog.getByRole('button', { name: 'Персонаж', exact: true }).click();
  await dialog.getByRole('combobox', { name: 'Вид поля' }).last().selectOption('refList');
  await dialog.getByRole('button', { name: 'Поле', exact: true }).click();
  await dialog.getByLabel('Название поля').last().fill('Вещи');
  await dialog.getByRole('combobox', { name: 'На кого ссылается' }).last().selectOption({ label: 'Предмет' });
  await page.keyboard.press('Escape');

  await card(page, 'Мира').click();
  const panel = page.locator('.world-panel');
  const add = panel.locator('[data-field^="value:"]', { hasText: 'Вещи' }).getByRole('combobox');
  await add.fill('Фонарь');
  await add.press('Enter');
  await expect(panel.locator('.chip', { hasText: 'Фонарь' })).toBeVisible();
  await expect(card(page, 'Фонарь')).toBeVisible();
  expect(errors).toEqual([]);
});

test('a yes/no field low in a long card does not shift the whole window (0.6 fix)', async ({ page }) => {
  const { errors } = await openSample(page);
  await page.setViewportSize({ width: 1366, height: 600 });
  await card(page, 'Мира').click();
  const panel = page.locator('.world-panel');
  for (const name of ['Сила', 'Ловкость', 'Ум', 'Харизма', 'Удача', 'Скорость', 'Защита', 'Опыт']) {
    await panel.getByRole('button', { name: 'Добавить поле…' }).click();
    await page.getByRole('dialog').getByLabel('Название поля').fill(name);
    await page.getByRole('dialog').getByRole('button', { name: 'Добавить', exact: true }).click();
  }
  await panel.getByRole('button', { name: 'Добавить поле…' }).click();
  await page.getByRole('dialog').getByLabel('Название поля').fill('Напарник');
  await page.getByRole('dialog').getByLabel('Вид поля').selectOption({ label: 'Да/нет' });
  await page.getByRole('dialog').getByRole('button', { name: 'Добавить', exact: true }).click();
  await page.locator('.world-panel-body').evaluate((e) => e.scrollTo(0, e.scrollHeight));
  await panel.locator('.switch', { hasText: 'Напарник' }).click();
  await expect(panel.getByRole('switch', { name: 'Напарник' })).toBeChecked();
  // The window did not scroll: the header and the tabs are where they were, nothing sticks out below.
  expect(
    await page.evaluate(() => [document.scrollingElement!.scrollTop, document.scrollingElement!.scrollHeight]),
  ).toEqual([0, 600]);
  await expect(page.getByRole('tab', { name: 'База данных' })).toBeInViewport();
  expect(errors).toEqual([]);
});
