import { expect, test, type Page } from '@playwright/test';
import { allFiles } from '../src/core/project/files';
import { sampleProject } from '../src/story/sample';

// Documents (0.4, F5): folders and the trash, the editor, embeds that follow the project, the Markdown file.

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
  await page.getByRole('button', { name: /Документы/ }).click();
  await expect(page.getByRole('navigation', { name: 'Документы' })).toBeVisible();
  return { errors };
}

const shot = (page: Page, name: string) =>
  process.env.HERPLAN_SHOTS ? page.screenshot({ path: `${process.env.HERPLAN_SHOTS}/${name}.png` }) : null;

/** Text of a project file in the web build's storage. */
/** "New document" → an empty one. */
async function newDoc(page: Page, name: string) {
  await page.getByRole('navigation', { name: 'Документы' }).getByRole('button', { name: 'Новый документ' }).click();
  await page.getByRole('menuitem', { name: 'Пустой документ' }).click();
  await page.getByLabel('Название документа').fill(name);
  await page.getByLabel('Название документа').press('Enter');
}

async function fileText(page: Page, suffix: string): Promise<string | null> {
  return page.evaluate((end) => {
    const fs = JSON.parse(localStorage.getItem('herplan.web.fs.v1') ?? '{}') as { files: Record<string, string> };
    const path = Object.keys(fs.files).find((p) => p.endsWith(end));
    return path ? fs.files[path] : null;
  }, suffix);
}

test('a document: typed with formatting, a link to a card that follows its name, saved as Markdown', async ({
  page,
}) => {
  const { errors } = await openSample(page);
  await newDoc(page, 'Диздок');
  const text = page.getByLabel('Текст документа');
  await text.click();
  await page.keyboard.type('Мельница');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Героиня — ');
  // A link to a card from the toolbar.
  await page.getByRole('button', { name: 'Ссылка на карточку' }).click();
  await page.getByRole('dialog').getByPlaceholder('Поиск').fill('Мира');
  await page.getByRole('dialog').getByRole('option', { name: /Мира/ }).click();
  await page.keyboard.type('пришла ');
  await page.keyboard.press('Control+B');
  await page.keyboard.type('рано');
  await page.keyboard.press('Control+B');
  // The first line becomes a heading.
  await page.getByText('Мельница', { exact: true }).click();
  await page.getByRole('button', { name: 'Заголовок 1' }).click();
  await expect(page.locator('.doc-text h1')).toHaveText('Мельница');
  await expect(page.locator('.doc-text .doc-link')).toHaveText('Мира');
  await shot(page, 'd1-editor');

  await page.keyboard.press('Control+S');
  await expect.poll(() => fileText(page, '/documents/Диздок.md')).toContain('[[ent:ent-mira|Мира]] пришла **рано**');
  const file = (await fileText(page, '/documents/Диздок.md'))!;
  expect(file).toMatch(/^---\nherplan-id: \S+\n---\n# Мельница\n/);

  // The card renamed in the database: the document shows the new name, and the file follows on the next save.
  await page.getByRole('tab', { name: 'Дом' }).click();
  await page
    .getByRole('button', { name: /База данных/ })
    .first()
    .click();
  await page.locator('.world-card', { hasText: 'Мира' }).first().click();
  await page.locator('.world-panel').getByLabel('Имя', { exact: true }).fill('Мирослава');
  await page.getByRole('tab', { name: 'Документы' }).click();
  await expect(page.locator('.doc-text .doc-link')).toHaveText('Мирослава');
  expect(errors).toEqual([]);
});

test('folders, moving, the trash and restoring', async ({ page }) => {
  const { errors } = await openSample(page);
  await page.getByRole('button', { name: 'Новая папка' }).click();
  await page.getByRole('dialog').getByLabel('Название папки').fill('Мир');
  await page.getByRole('dialog').getByRole('button', { name: 'Сохранить' }).click();
  await newDoc(page, 'Локации');
  await page.getByLabel('Текст документа').click();
  await page.keyboard.type('Мельница у реки');
  // Moved into the folder from its menu.
  const tree = page.getByRole('navigation', { name: 'Документы' });
  await tree.getByRole('button', { name: 'Локации' }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Переместить в…' }).click();
  await page.getByRole('menuitem', { name: 'Мир' }).click();
  await page.keyboard.press('Control+S');
  await expect.poll(() => fileText(page, '/documents/Мир/Локации.md')).toContain('Мельница у реки');
  expect(await fileText(page, '/documents/Локации.md')).toBeNull();

  // To the trash and back.
  await tree.getByRole('button', { name: 'Локации' }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'В корзину' }).click();
  await expect(tree.getByRole('button', { name: 'Локации' })).toHaveCount(0);
  await tree.getByRole('button', { name: /Корзина/ }).click();
  await shot(page, 'd2-trash');
  await page.getByRole('button', { name: 'Восстановить' }).click();
  await expect(page.getByLabel('Текст документа')).toContainText('Мельница у реки');
  await expect(tree.getByRole('button', { name: 'Локации' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('"@" puts a link while typing; backlinks and "where used" lead to the document', async ({ page }) => {
  const { errors } = await openSample(page);
  const tree = page.getByRole('navigation', { name: 'Документы' });
  // The plan: a document to be linked to.
  await newDoc(page, 'План');
  // The diary links to the plan and to Mira with "@".
  await newDoc(page, 'Дневник');
  await page.getByLabel('Текст документа').click();
  await page.keyboard.type('Встретил @Мир');
  await expect(page.locator('.doc-suggest-item').first()).toContainText('Мира');
  await shot(page, 'd3-mention');
  await page.keyboard.press('Enter');
  await page.keyboard.type('и прочёл @План');
  await page.keyboard.press('Enter');
  await expect(page.locator('.doc-text .doc-link')).toHaveText(['Мира', 'План']);

  // The plan shows who links to it.
  await tree.getByRole('button', { name: 'План' }).click();
  await expect(page.getByRole('region', { name: 'Ссылаются на этот документ' })).toContainText('Дневник');
  // Mira's card says the diary mentions her, and leads there.
  await page.getByRole('tab', { name: 'Дом' }).click();
  await page
    .getByRole('button', { name: /База данных/ })
    .first()
    .click();
  await page.locator('.world-card', { hasText: 'Мира' }).first().click();
  await page
    .locator('.world-panel')
    .getByRole('button', { name: /Документ «Дневник»/ })
    .click();
  await expect(page.getByLabel('Название документа')).toHaveValue('Дневник');
  expect(errors).toEqual([]);
});

test('a document from a template; a document saved as a template of our own', async ({ page }) => {
  const { errors } = await openSample(page);
  const tree = page.getByRole('navigation', { name: 'Документы' });
  await tree.getByRole('button', { name: 'Новый документ' }).click();
  await page.getByRole('menuitem', { name: 'Диздок (GDD)' }).click();
  await expect(page.getByLabel('Название документа')).toHaveValue('Диздок (GDD)');
  await expect(page.locator('.doc-text h2', { hasText: 'Игровой цикл' })).toBeVisible();
  await expect(page.locator('.doc-text table')).toBeVisible();
  await shot(page, 'd4-template');

  await tree.getByRole('button', { name: 'Диздок (GDD)' }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Сохранить как шаблон…' }).click();
  await page.getByRole('dialog').getByLabel('Название шаблона').fill('Наш диздок');
  await page.getByRole('dialog').getByRole('button', { name: 'Сохранить' }).click();
  await tree.getByRole('button', { name: 'Новый документ' }).click();
  await page.getByRole('menuitem', { name: 'Наш диздок' }).click();
  await expect(page.getByLabel('Название документа')).toHaveValue('Наш диздок');
  await expect(page.locator('.doc-text h2', { hasText: 'Игровой цикл' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('exports: a document to PDF, all documents and cards to Markdown for Obsidian', async ({ page }) => {
  const { errors } = await openSample(page);
  await newDoc(page, 'Диздок');
  await page.getByLabel('Текст документа').click();
  await page.keyboard.type('Героиня — @Мира');
  await page.keyboard.press('Enter');
  // The save dialogs of the web build are prompts: the default path is accepted.
  page.on('dialog', (d) => void d.accept(d.defaultValue()));
  await page.getByRole('button', { name: 'Документ в PDF…' }).click();
  await expect(page.getByText(/PDF сохранён/)).toBeVisible({ timeout: 20_000 });
  expect(await fileText(page, '/Documents/HErPlan/Диздок.pdf')).toMatch(
    /^data:application\/octet-stream;base64,JVBERi0/,
  );

  await page.getByRole('button', { name: 'Все документы в Markdown (Obsidian)…' }).click();
  await expect(page.getByText(/Markdown сохранён/)).toBeVisible();
  expect(await fileText(page, 'Пример — Markdown/Диздок.md')).toContain('Героиня — [[Карточки/Персонаж/Мира|Мира]]');
  expect(await fileText(page, 'Пример — Markdown/Карточки/Персонаж/Мира.md')).toContain('# Мира');
  expect(errors).toEqual([]);
});
