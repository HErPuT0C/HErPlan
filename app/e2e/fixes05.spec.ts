import { expect, test, type Page } from '@playwright/test';
import { allFiles } from '../src/core/project/files';
import { sampleProject } from '../src/story/sample';

// 0.5.0, the owner's fixes: templates on the documents' start page, links that open where they lead, files
// dropped into a document, the assets' right-click menu, fields and blocks set up from the card, catalogs of
// tags in the database itself.

async function openSample(page: Page, module: RegExp) {
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
  await page.getByRole('button', { name: module }).first().click();
  return { errors };
}

const shot = (page: Page, name: string) =>
  process.env.HERPLAN_SHOTS ? page.screenshot({ path: `${process.env.HERPLAN_SHOTS}/${name}.png` }) : null;

async function fileText(page: Page, suffix: string): Promise<string | null> {
  return page.evaluate((end) => {
    const fs = JSON.parse(localStorage.getItem('herplan.web.fs.v1') ?? '{}') as { files: Record<string, string> };
    const path = Object.keys(fs.files).find((p) => p.endsWith(end));
    return path ? fs.files[path] : null;
  }, suffix);
}

async function assetPaths(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const fs = JSON.parse(localStorage.getItem('herplan.web.fs.v1') ?? '{}') as { files: Record<string, string> };
    return Object.keys(fs.files)
      .filter((p) => p.includes('/assets/'))
      .map((p) => p.slice(p.indexOf('/assets/') + 1));
  });
}

/** Drops a picture and a text file from "outside" onto the document's text (an HTML5 drop in the web build). */
async function dropFiles(page: Page) {
  const text = page.getByLabel('Текст документа');
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const transfer = await page.evaluateHandle((b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const d = new DataTransfer();
    d.items.add(new File([bytes], 'карта мира.png', { type: 'image/png' }));
    d.items.add(new File(['заметки'], 'заметки.txt', { type: 'text/plain' }));
    return d;
  }, png);
  const box = (await text.boundingBox())!;
  await text.dispatchEvent('drop', { dataTransfer: transfer, clientX: box.x + 30, clientY: box.y + 12 });
}

test('documents: templates on the start page, links that open where they lead, files dropped in', async ({ page }) => {
  const { errors } = await openSample(page, /Документы/);
  // No document yet: the templates are right in the middle.
  const gallery = page.getByRole('region', { name: 'Начать с шаблона' });
  await expect(gallery.getByRole('button')).toHaveCount(5);
  await shot(page, 'f1-start');
  await gallery.getByRole('button', { name: /Питч для издателя/ }).click();
  await expect(page.getByLabel('Название документа')).toHaveValue('Питч для издателя');

  // A link to a card that leads to the story canvas, not to the database.
  const text = page.getByLabel('Текст документа');
  await text.click();
  await page.keyboard.press('Control+Home');
  await page.getByRole('button', { name: /Ссылка на карточку, документ/ }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByPlaceholder('Поиск').fill('Мира');
  await dialog.getByRole('option', { name: /^Мира/ }).first().click();
  await expect(dialog.getByText('Или вставить значение поля')).toBeVisible();
  await dialog.getByRole('option', { name: /Холст сценария: «Мира»/ }).click();
  const link = page.locator('.doc-text .doc-link', { hasText: 'Мира' });
  await expect(link).toHaveAttribute('data-place', 'story:g-ch1/a-who');
  await page.keyboard.press('Control+S');
  await expect
    .poll(() => fileText(page, '/documents/Питч для издателя.md'))
    .toContain('[[ent:ent-mira|Мира|story:g-ch1/a-who]]');

  // A plain click opens it there.
  await link.click();
  await expect(page.getByRole('tab', { name: /Сценарий/ })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('tab', { name: 'Документы' }).click();
  // The right-click menu leads it elsewhere: back to the card in the database.
  await page.locator('.doc-text .doc-link', { hasText: 'Мира' }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: /Карточка «Мира» в базе данных/ }).click();
  await expect(page.locator('.doc-text .doc-link', { hasText: 'Мира' })).not.toHaveAttribute('data-place');
  await page.locator('.doc-text .doc-link', { hasText: 'Мира' }).click();
  await expect(page.getByRole('tab', { name: 'База данных' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.world-panel .world-name')).toHaveValue('Мира');

  // Files dropped from outside: into the text and into the assets' "Document attachments".
  await page.getByRole('tab', { name: 'Документы' }).click();
  await dropFiles(page);
  await expect(page.locator('.doc-text .doc-link', { hasText: 'заметки.txt' })).toBeVisible();
  await expect(page.locator('.doc-text img.doc-image')).toHaveCount(1);
  expect(await assetPaths(page)).toEqual(
    expect.arrayContaining(['assets/Вложения в документы/карта мира.png', 'assets/Вложения в документы/заметки.txt']),
  );
  await page.keyboard.press('Control+S');
  await expect
    .poll(() => fileText(page, '/documents/Питч для издателя.md'))
    .toContain('![карта мира](<assets/Вложения в документы/карта мира.png>)');
  await shot(page, 'f2-dropped');
  // A link to a file opens it in the assets.
  await page.locator('.doc-text .doc-link', { hasText: 'заметки.txt' }).click();
  await expect(page.getByRole('tab', { name: 'Ресурсы' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('complementary', { name: 'заметки.txt' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('assets: the right-click menu moves a file to another folder, and the document follows', async ({ page }) => {
  const { errors } = await openSample(page, /Документы/);
  await page
    .getByRole('region', { name: 'Начать с шаблона' })
    .getByRole('button', { name: /Пустой документ/ })
    .click();
  await page.getByLabel('Текст документа').click();
  await dropFiles(page);
  await expect(page.locator('.doc-text img.doc-image')).toHaveCount(1);
  await page.keyboard.press('Control+S');

  await page.getByRole('tab', { name: 'Дом' }).click();
  await page
    .getByRole('button', { name: /Ресурсы/ })
    .first()
    .click();
  await page.getByRole('navigation', { name: 'Папки' }).getByRole('button', { name: 'Вложения в документы' }).click();
  await page.locator('.asset-item', { hasText: 'карта мира.png' }).click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'Переименовать' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Удалить' })).toBeVisible();
  await shot(page, 'f3-asset-menu');
  await page.getByRole('menuitem', { name: 'Переместить в…' }).click();
  await page.getByRole('menuitem', { name: 'Ресурсы' }).click();
  await expect.poll(() => assetPaths(page)).toContain('assets/карта мира.png');
  await page.keyboard.press('Control+S');
  await expect
    .poll(() => fileText(page, '/documents/Без названия.md'))
    .toContain('![карта мира](<assets/карта мира.png>)');
  expect(errors).toEqual([]);
});

test('the card: a field of its own, a field of the type taken off it, blocks hidden and shown again', async ({
  page,
}) => {
  const { errors } = await openSample(page, /База данных/);
  await page.locator('.world-card', { hasText: 'Мира' }).first().click();
  const panel = page.locator('.world-panel');

  // A field of this card only.
  await panel.getByRole('button', { name: 'Добавить поле…' }).click();
  let dialog = page.getByRole('dialog', { name: 'Новое поле' });
  await dialog.getByLabel('Название поля').fill('Прозвище');
  await dialog.getByRole('button', { name: 'Добавить', exact: true }).click();
  await panel.getByRole('textbox', { name: 'Прозвище' }).fill('Травка');
  await expect(panel.getByRole('heading', { name: 'Поля этой карточки' })).toBeVisible();

  // A field for every character, taken off this card.
  await panel.getByRole('button', { name: 'Добавить поле…' }).click();
  dialog = page.getByRole('dialog', { name: 'Новое поле' });
  await dialog.getByLabel('Название поля').fill('Здоровье');
  await dialog.getByLabel('Вид поля').selectOption({ label: 'Число' });
  await dialog.getByRole('radio', { name: /Всем карточкам типа «Персонаж»/ }).check();
  await dialog.getByRole('button', { name: 'Добавить', exact: true }).click();
  await expect(panel.getByRole('spinbutton', { name: 'Здоровье' })).toBeVisible();
  await panel.getByRole('button', { name: 'Поле «Здоровье»' }).click();
  await page.getByRole('menuitem', { name: 'Убрать из этой карточки' }).click();
  await expect(panel.getByRole('spinbutton', { name: 'Здоровье' })).toHaveCount(0);

  // A block hidden on this card.
  await panel.getByRole('button', { name: 'Блок «Связи»' }).click();
  await page.getByRole('menuitem', { name: 'Скрыть в этой карточке' }).click();
  await expect(panel.getByRole('heading', { name: 'Связи' })).toHaveCount(0);
  const hidden = panel.getByRole('region', { name: 'Скрыто в этой карточке' });
  await expect(hidden.getByRole('button')).toHaveText(['Связи', 'Здоровье']);
  await shot(page, 'f4-card');

  // Boris still has everything, and "Health" too.
  await page.locator('.world-card', { hasText: 'Борис' }).first().click();
  await expect(panel.getByRole('spinbutton', { name: 'Здоровье' })).toBeVisible();
  await expect(panel.getByRole('textbox', { name: 'Прозвище' })).toHaveCount(0);
  await expect(panel.getByRole('heading', { name: 'Связи' })).toBeVisible();

  // Back on Mira, both come back with a click.
  await page.locator('.world-card', { hasText: 'Мира' }).first().click();
  await hidden.getByRole('button', { name: 'Связи' }).click();
  await hidden.getByRole('button', { name: 'Здоровье' }).click();
  await expect(panel.getByRole('heading', { name: 'Связи' })).toBeVisible();
  await expect(panel.getByRole('spinbutton', { name: 'Здоровье' })).toBeVisible();
  await expect(hidden).toHaveCount(0);

  await page.keyboard.press('Control+S');
  await expect
    .poll(async () =>
      (JSON.parse((await fileText(page, '/ent-mira.json')) ?? '{}') as { fields?: { label: string }[] }).fields?.map(
        (f) => f.label,
      ),
    )
    .toEqual(['Прозвище']);
  expect(errors).toEqual([]);
});

test('catalogs in the database: a tags field gets its catalog and tags with descriptions from the card', async ({
  page,
}) => {
  const { errors } = await openSample(page, /База данных/);
  await page.locator('.world-card', { hasText: 'Мира' }).first().click();
  const panel = page.locator('.world-panel');
  await panel.getByRole('button', { name: 'Добавить поле…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Новое поле' });
  await dialog.getByLabel('Название поля').fill('Черты');
  await dialog.getByLabel('Вид поля').selectOption({ label: 'Теги из справочника' });
  await dialog.getByRole('radio', { name: /Всем карточкам типа «Персонаж»/ }).check();
  await dialog.getByRole('button', { name: 'Добавить', exact: true }).click();

  // The field came with its catalog: a tag is made right here and asks for its description.
  const add = panel.getByRole('combobox', { name: 'Добавить тег…' });
  await add.fill('ловкий');
  await add.press('Enter');
  await page.keyboard.type('уклоняется от первой атаки');
  await page.keyboard.press('Escape');
  await expect(panel.locator('.world-notes')).toContainText(/ловкий\s*— уклоняется от первой атаки/);

  // The catalog is in the database's list, and its page shows who carries each tag.
  const nav = page.getByRole('navigation', { name: 'Типы' });
  await expect(nav.getByRole('button', { name: /Черты/ })).toBeVisible();
  await panel.getByRole('button', { name: 'Открыть справочник «Черты»' }).click();
  const tag = page.locator('.world-catalog .schema-tag').first();
  await expect(tag.getByLabel('Тег', { exact: true })).toHaveValue('ловкий');
  await expect(tag.getByRole('button', { name: 'Мира' })).toBeVisible();
  await shot(page, 'f5-catalog');
  // Boris gets the tag from the list; the description is the same.
  await nav.getByRole('button', { name: /Персонаж/ }).click();
  await page.locator('.world-card', { hasText: 'Борис' }).first().click();
  await panel.getByRole('combobox', { name: 'Добавить тег…' }).click();
  await page.getByRole('option', { name: /ловкий/ }).click();
  await expect(panel.locator('.world-notes')).toContainText('уклоняется от первой атаки');
  expect(errors).toEqual([]);
});
