import { expect, test, type Locator, type Page } from '@playwright/test';

// The owner's list for 0.7.3, on the tutorial project: files and folders dragged between folders of the
// assets, a file dragged from the assets into a document, onto a card's picture and onto the map (the tab
// opens while the file is held over it), a folder made from a right click on an empty place, the map found
// by folders and by what cards say, and the names of cards and tags in descriptions as links.

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

/** Opens a module from the home tab (a tab of its own). */
async function openModule(page: Page, name: string) {
  await page.getByRole('tab', { name: 'Дом' }).click();
  await page
    .getByRole('button', { name: new RegExp(name) })
    .first()
    .click();
}

const tile = (page: Page, name: string) => page.locator('.asset-item', { hasText: name });

/**
 * Drags with the mouse from one element to another; with `tab`, the file is first held over that tab's head
 * until the tab opens.
 */
async function drag(page: Page, from: Locator, to: () => Locator, tab?: string) {
  const a = (await from.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 20, a.y + a.height / 2 + 20, { steps: 4 });
  if (tab) {
    const head = (await page.getByRole('tab', { name: tab }).boundingBox())!;
    await page.mouse.move(head.x + head.width / 2, head.y + head.height / 2, { steps: 6 });
    await expect(page.getByRole('tab', { name: tab })).toHaveAttribute('aria-selected', 'true');
  }
  const b = (await to().boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 });
  await page.mouse.up();
}

const shot = (page: Page, name: string) =>
  process.env.HERPLAN_SHOTS ? page.screenshot({ path: `${process.env.HERPLAN_SHOTS}/${name}.png` }) : null;

test('assets: a folder from a right click on an empty place; files and folders dragged onto folders among the files and onto the path', async ({
  page,
}) => {
  const { errors } = await openTutorial(page);
  await openModule(page, 'Ресурсы');
  const content = page.locator('.assets-content');
  const box = (await content.boundingBox())!;
  await page.mouse.click(box.x + box.width - 20, box.y + box.height - 20, { button: 'right' });
  await page.getByRole('menuitem', { name: 'Новая папка' }).click();
  await page.getByRole('dialog', { name: 'Новая папка' }).getByLabel('Имя').fill('Арт');
  await page.getByRole('button', { name: 'Сохранить' }).click();
  await expect(tile(page, 'Арт')).toBeVisible();

  // A file onto a folder among the files, then back onto the path above.
  await drag(page, tile(page, 'cover.svg'), () => tile(page, 'Арт'));
  await expect(tile(page, 'cover.svg')).toHaveCount(0);
  await tile(page, 'Арт').click();
  await expect(tile(page, 'cover.svg')).toBeVisible();
  await shot(page, 'f1-assets-folder');
  await drag(page, tile(page, 'cover.svg'), () =>
    page.locator('.assets-crumbs').getByRole('button', { name: 'Ресурсы' }),
  );
  await expect(tile(page, 'cover.svg')).toHaveCount(0);
  await page.locator('.assets-crumbs').getByRole('button', { name: 'Ресурсы' }).click();
  await expect(tile(page, 'cover.svg')).toBeVisible();

  // A folder dragged into another one.
  await drag(page, tile(page, 'Арт'), () => tile(page, 'Места'));
  await expect(tile(page, 'Арт')).toHaveCount(0);
  const tree = page.getByRole('navigation', { name: 'Папки' });
  await expect(tree.getByRole('button', { name: 'Арт' })).toHaveAttribute('style', /padding-left: 40px/);
  expect(errors).toEqual([]);
});

test('a file from the assets into a document, onto a card picture and onto the map, through their tabs', async ({
  page,
}) => {
  const { errors } = await openTutorial(page);
  await openModule(page, 'Документы');
  await page.getByRole('navigation', { name: 'Документы' }).getByRole('button', { name: 'Начните здесь' }).click();
  const pictures = await page.locator('.doc-text img').count();
  await openModule(page, 'База данных');
  await page.locator('.world-card', { hasText: 'Ника' }).click();
  const portrait = page.locator('.world-panel .image-field img');
  const before = await portrait.getAttribute('src');
  await openModule(page, 'Карта проекта');
  await expect(page.locator('.map-ref').first()).toBeVisible();
  const onMap = await page.locator('.map-ref-asset').count();
  await openModule(page, 'Ресурсы');
  await tile(page, 'Места').click();
  await expect(page.locator('.assets-crumbs')).toContainText('Места');

  // Into the document: the picture goes into the text where it is let go.
  await drag(page, tile(page, 'lighthouse.svg'), () => page.locator('.doc-text'), 'Документы');
  await expect(page.locator('.doc-text img')).toHaveCount(pictures + 1);
  await shot(page, 'f2-into-document');

  // Onto the card's picture.
  await page.getByRole('tab', { name: 'Ресурсы' }).click();
  await drag(page, tile(page, 'island-map.svg'), () => page.locator('.world-panel .image-field'), 'База данных');
  await expect(portrait).not.toHaveAttribute('src', before ?? '');

  // Onto the map.
  await page.getByRole('tab', { name: 'Ресурсы' }).click();
  await drag(page, tile(page, 'lighthouse.svg'), () => page.locator('.map-canvas'), 'Карта проекта');
  await expect(page.locator('.map-ref-asset')).toHaveCount(onMap + 1);

  // Not a picture, or let go nowhere: nothing happens.
  await page.getByRole('tab', { name: 'Ресурсы' }).click();
  await page.keyboard.press('Escape');
  expect(errors).toEqual([]);
});

test('the map: pictures found by their folder, cards by what they say; the canvas search finds a card by its object and opens it', async ({
  page,
}) => {
  const { errors } = await openTutorial(page);
  await openModule(page, 'Карта проекта');
  const objects = page.getByRole('navigation', { name: 'Объекты проекта' });
  await objects.getByRole('searchbox').fill('портреты');
  await expect(objects.getByRole('button', { name: /nika\.svg/ })).toBeVisible();
  await expect(objects.getByRole('button', { name: /yan\.svg/ })).toBeVisible();
  // A trait (a tag on the card) finds the card.
  await objects.getByRole('searchbox').fill('смелая');
  await expect(objects.getByRole('button', { name: 'Ника' })).toBeVisible();

  // The card on the map was titled "Карточка" when it was put there; it is found by the card's name.
  await page.getByRole('application', { name: 'Холст' }).focus();
  await page.keyboard.press('Control+f');
  const search = page.getByRole('textbox', { name: 'Поиск по холсту (Ctrl+F)' });
  await search.fill('Ника');
  await expect(page.locator('.canvas-search-count')).not.toHaveText('0 из 0');
  await search.fill('учитель');
  await expect(page.locator('.canvas-search-count')).toHaveText('1 из 1');
  await search.press('Control+Enter');
  await expect(page.locator('.world-panel').getByLabel('Имя', { exact: true })).toHaveValue('Ника');
  expect(errors).toEqual([]);
});

test('names of cards and tags in a description are links; a click elsewhere edits the text', async ({ page }) => {
  const { errors } = await openTutorial(page);
  await openModule(page, 'База данных');
  await page.locator('.world-card', { hasText: 'Ника' }).click();
  const panel = page.locator('.world-panel');
  const description = panel.getByRole('textbox', { name: 'Описание', exact: true });
  await expect(description.locator('.mention-link')).toHaveText(['Ян', 'Смелая']);
  await shot(page, 'f3-mentions');

  // A click on the text (not on a name) edits it; the names follow the text as it is typed.
  await description.click({ position: { x: 4, y: 4 } });
  const box = panel.locator('textarea.world-long').first();
  await expect(box).toBeFocused();
  await box.press('End');
  await box.press('Control+End');
  await box.pressSequentially(' Вела рядом.');
  await box.press('Escape');
  await expect(description.locator('.mention-link')).toHaveText(['Ян', 'Смелая', 'Вела']);

  // A card's name opens the card; a tag's name opens its catalog.
  await description.getByRole('button', { name: 'Ян' }).click();
  await expect(panel.getByLabel('Имя', { exact: true })).toHaveValue('Ян');
  await page.locator('.world-card', { hasText: 'Ника' }).click();
  await panel.getByRole('textbox', { name: 'Описание', exact: true }).getByRole('button', { name: 'Смелая' }).click();
  await expect(page.getByLabel('Название справочника')).toHaveValue('Черты');
  expect(errors).toEqual([]);
});
