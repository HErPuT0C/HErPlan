import { expect, test, type Page } from '@playwright/test';
import { allFiles } from '../src/core/project/files';
import { sampleProject } from '../src/story/sample';

// Tasks and the project-wide search (0.6, F6): boards of lists, cards dragged between lists, the task window
// with labels, a checklist and links; tasks seen from the objects they link to; Ctrl+K.

async function openSample(page: Page, module: RegExp) {
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
  await page.getByRole('button', { name: module }).first().click();
  return { errors };
}

const shot = (page: Page, name: string) =>
  process.env.HERPLAN_SHOTS ? page.screenshot({ path: `${process.env.HERPLAN_SHOTS}/${name}.png` }) : null;

async function boardFile(page: Page): Promise<{ lists: { name: string; tasks: { title: string }[] }[] } | null> {
  return page.evaluate(() => {
    const fs = JSON.parse(localStorage.getItem('herplan.web.fs.v1') ?? '{}') as { files: Record<string, string> };
    const path = Object.keys(fs.files).find((p) => p.includes('/data/boards/'));
    return path ? JSON.parse(fs.files[path]) : null;
  });
}

async function newBoard(page: Page, titles: string[]) {
  await page.getByRole('button', { name: 'Новая доска' }).last().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Сохранить' }).click();
  const todo = page.getByRole('region', { name: 'Нужно сделать' });
  await todo.getByRole('button', { name: 'Задача' }).click();
  for (const title of titles) {
    await todo.getByLabel('Задача').fill(title);
    await todo.getByLabel('Задача').press('Enter');
  }
  await todo.getByLabel('Задача').press('Escape');
  return todo;
}

/** Drags with the mouse: pointer events, as in the desktop window. */
async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 20, from.y + 20, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.up();
}

test('a board: tasks made, dragged between lists, opened; a checklist, a label, a link; the trash', async ({
  page,
}) => {
  const { errors } = await openSample(page, /Задачи/);
  const todo = await newBoard(page, ['Сценарий главы 3', 'Портрет Миры', 'Музыка мельницы']);
  await expect(todo.locator('.task-card')).toHaveText(['Сценарий главы 3', 'Портрет Миры', 'Музыка мельницы']);
  await expect(todo.locator('.tasks-count')).toHaveText('3');

  // Dragged to "Doing"; within "To do", the last one to the top.
  const doing = page.getByRole('region', { name: 'В работе' });
  const card = (await todo.locator('.task-card', { hasText: 'Портрет Миры' }).boundingBox())!;
  const column = (await doing.boundingBox())!;
  await drag(page, { x: card.x + 30, y: card.y + 10 }, { x: column.x + 60, y: column.y + 80 });
  await expect(doing.locator('.task-card')).toHaveText(['Портрет Миры']);
  const last = (await todo.locator('.task-card', { hasText: 'Музыка' }).boundingBox())!;
  const first = (await todo.locator('.task-card', { hasText: 'Сценарий' }).boundingBox())!;
  await drag(page, { x: last.x + 30, y: last.y + 10 }, { x: first.x + 30, y: first.y + 4 });
  await expect(todo.locator('.task-card')).toHaveText(['Музыка мельницы', 'Сценарий главы 3']);

  // The task window.
  await doing.locator('.task-card').click();
  const dialog = page.getByRole('dialog', { name: 'Задача' });
  await dialog.getByLabel('Описание').fill('Портрет для карточки');
  for (const item of ['Набросок', 'Цвет']) {
    await dialog.getByLabel('Новый пункт').fill(item);
    await dialog.getByLabel('Новый пункт').press('Enter');
  }
  await dialog.getByRole('checkbox', { name: 'Сделано: Набросок' }).check();
  await expect(dialog.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1');
  await dialog.getByRole('button', { name: 'Метка', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Создать метку…' }).click();
  const labels = page.getByRole('dialog', { name: 'Метки проекта' });
  await labels.getByLabel('Новая метка').fill('Арт');
  await labels.getByLabel('Новая метка').press('Enter');
  await labels.getByRole('button', { name: 'Полосы' }).click();
  await labels.getByLabel('Цвет HEX').fill('#3fb97a');
  await labels.getByLabel('Символ').fill('★');
  await labels.getByRole('button', { name: 'Закрыть' }).click();
  await expect(dialog.locator('.task-label')).toHaveText('★Арт');
  await dialog.getByRole('button', { name: 'Связать…' }).click();
  const picker = page.getByRole('dialog', { name: 'Связать задачу' });
  await picker.getByLabel('Найти объект проекта').fill('мира');
  await picker.getByRole('option', { name: /Мира.*карточка/ }).click();
  await expect(dialog.locator('.task-link')).toHaveText('Мира');
  await shot(page, 't1-task');
  await dialog.getByRole('button', { name: 'Готово' }).click();
  await expect(doing.locator('.task-card')).toContainText('1 из 2');
  await shot(page, 't2-board');

  // Saved as the board's file.
  await page.keyboard.press('Control+S');
  await expect
    .poll(async () => (await boardFile(page))?.lists.map((l) => l.tasks.map((x) => x.title)))
    .toEqual([['Музыка мельницы', 'Сценарий главы 3'], ['Портрет Миры'], []]);

  // The card of Mira shows the task; a click opens it.
  await page.getByRole('tab', { name: 'Дом' }).click();
  await page
    .getByRole('button', { name: /База данных/ })
    .first()
    .click();
  await page.locator('.world-card', { hasText: 'Мира' }).first().click();
  await page
    .locator('.world-panel')
    .getByRole('button', { name: /Задача «Портрет Миры»/ })
    .click();
  await expect(page.getByRole('dialog', { name: 'Задача' }).getByLabel('Название задачи')).toHaveValue('Портрет Миры');

  // To the trash and back to its list.
  await page.getByRole('dialog', { name: 'Задача' }).getByRole('button', { name: 'В корзину' }).click();
  await expect(doing.locator('.task-card')).toHaveCount(0);
  await page.getByRole('button', { name: 'Корзина (1)' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Вернуть' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Закрыть' }).click();
  await expect(doing.locator('.task-card')).toHaveText([/Портрет Миры/]);
  expect(errors).toEqual([]);
});

test('Ctrl+K finds anything in the project, names first; Enter opens it; a card goes to the map', async ({ page }) => {
  const { errors } = await openSample(page, /Задачи/);
  await newBoard(page, ['Портрет Миры']);
  await page.keyboard.press('Control+K');
  const search = page.getByRole('combobox', { name: 'Поиск по проекту' });
  await search.fill('мир');
  const results = page.getByRole('listbox', { name: 'Найдено' }).getByRole('option');
  await expect(results.first()).toContainText('Мира');
  await expect(results.first()).toContainText('карточка');
  await expect(page.getByRole('listbox', { name: 'Найдено' })).toContainText('Портрет Миры');
  await shot(page, 't3-search');
  await search.press('Enter');
  await expect(page.getByRole('tab', { name: 'База данных' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.world-panel .world-name')).toHaveValue('Мира');

  // A part inside a word finds the object too; a chapter goes onto the project map.
  await page.keyboard.press('Control+K');
  await search.fill('ельниц');
  const chapter = page.getByRole('option', { name: /Глава 1\. Мельница/ });
  await chapter.getByRole('button', { name: 'Добавить на карту проекта' }).click();
  await expect(page.getByRole('tab', { name: 'Карта проекта' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.map-ref', { hasText: 'Глава 1. Мельница' })).toBeVisible();
  expect(errors).toEqual([]);
});
