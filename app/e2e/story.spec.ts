import { expect, test, type Locator, type Page } from '@playwright/test';

// The story editor in the web build (F3): sides and handles of the canvas, chapters, dialogue, choice,
// variables, playthrough, problems and export.

async function openStory(page: Page, name = 'Мельница') {
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
  await page.getByLabel('Название').fill(name);
  await page.getByRole('button', { name: 'Создать', exact: true }).click();
  await page.getByRole('button', { name: /Сценарий/ }).click();
  await page.getByRole('button', { name: 'Создать холст сценария' }).click();
  const canvas = page.getByRole('application', { name: 'Холст' });
  await expect(canvas).toBeVisible();
  return { canvas, box: (await canvas.boundingBox())!, errors };
}

const center = (b: { x: number; y: number; width: number; height: number }) => ({
  x: b.x + b.width / 2,
  y: b.y + b.height / 2,
});

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.up();
}

/** Pulls an edge out of a port of `card` into empty space and picks the kind of the new node. */
async function pull(page: Page, card: Locator, port: string, dx: number, dy: number, kind: string, nth = 0) {
  await card.hover();
  const from = center((await card.locator(port).nth(nth).boundingBox())!);
  await drag(page, from, { x: from.x + dx, y: from.y + dy });
  await page.getByRole('menuitem', { name: kind, exact: true }).click();
}

/** The saved graph files, after Ctrl+S. */
async function savedGraphs(page: Page) {
  await page.keyboard.press('Control+S');
  await page.waitForTimeout(200);
  return page.evaluate(() => {
    const fs = JSON.parse(localStorage.getItem('herplan.web.fs.v1') ?? '{}') as { files: Record<string, string> };
    return Object.entries(fs.files)
      .filter(([p]) => p.includes('/data/graphs/'))
      .map(
        ([, text]) =>
          JSON.parse(text) as {
            kind: string;
            nodes: {
              id: string;
              kind: string;
              title: string;
              x: number;
              w: number;
              options?: { condition: string }[];
            }[];
            edges: { from: { node: string; port: string }; to: { node: string; port: string } }[];
            groups: { w: number; h: number }[];
          },
      );
  });
}

test('a node is pulled out of the left side; a group frame resizes from its handles', async ({ page }) => {
  const { box, errors } = await openStory(page);
  const start = page.locator('.cnode[data-kind="start"]');
  await pull(page, start, '.cnode-port[data-port="in"]', -260, 40, 'Сцена');
  await expect(page.locator('.cnode')).toHaveCount(2);
  const [root] = await savedGraphs(page);
  const scene = root.nodes.find((n) => n.kind === 'scene')!;
  const first = root.nodes.find((n) => n.kind === 'start')!;
  // The new node sits on the left and the edge runs from the start's left side to its right side.
  expect(scene.x + scene.w).toBeLessThanOrEqual(first.x);
  expect(root.edges).toEqual([
    expect.objectContaining({ from: { node: first.id, port: 'in' }, to: { node: scene.id, port: 'out' } }),
  ]);

  await page.locator('.canvas').click({ position: { x: 30, y: box.height - 120 } });
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Control+G');
  await expect(page.locator('.canvas-handles .chandle')).toHaveCount(8);
  const before = (await savedGraphs(page))[0].groups[0];
  const se = center((await page.locator('.canvas-handles .chandle-se').boundingBox())!);
  await drag(page, se, { x: se.x + 100, y: se.y + 60 });
  const w = center((await page.locator('.canvas-handles .chandle-w').boundingBox())!);
  await drag(page, w, { x: w.x - 40, y: w.y });
  const after = (await savedGraphs(page))[0].groups[0];
  expect(after.w).toBeGreaterThan(before.w + 100);
  expect(after.h).toBeGreaterThan(before.h + 40);
  expect(errors).toEqual([]);
});

test('a chapter opens with Enter and the breadcrumbs lead back', async ({ page }) => {
  const { box } = await openStory(page);
  await page.mouse.dblclick(box.x + 120, box.y + 120);
  await page.getByRole('menuitem', { name: 'Глава', exact: true }).click();
  await page.getByLabel('Название', { exact: true }).fill('Глава 1. Мельница');
  await page.locator('.cnode[data-kind="chapter"]').click({ position: { x: 100, y: 100 } });
  await page.keyboard.press('Enter');
  const crumbs = page.getByRole('navigation', { name: 'Где вы в сценарии' });
  await expect(crumbs.getByRole('button')).toHaveText(['Сценарий', 'Глава 1. Мельница']);
  await expect(page.locator('.cnode[data-kind="start"]')).toHaveCount(1);
  await crumbs.getByRole('button', { name: 'Сценарий' }).click();
  await expect(page.locator('.cnode[data-kind="chapter"]')).toHaveCount(1);
  const graphs = await savedGraphs(page);
  expect(graphs.map((g) => g.kind).sort()).toEqual(['chapter', 'story']);
});

test('dialogue, choice with a condition, a variable created from it, and a playthrough', async ({ page }) => {
  const { errors } = await openStory(page);
  const start = page.locator('.cnode[data-kind="start"]');
  await pull(page, start, '.cnode-port[data-port="out"]', 120, 0, 'Диалог');
  const inspector = page.getByRole('complementary', { name: 'Боковая панель сценария' });
  await inspector.getByRole('button', { name: 'Добавить реплику' }).click();
  await inspector.getByRole('button', { name: 'Добавить реплику' }).click();
  await inspector.getByLabel('Реплика 1').fill('Ты пришёл.');
  await inspector.getByLabel('Реплика 2').fill('Мельница скрипит.');
  await expect(page.locator('.cnode[data-kind="dialogue"] .cline')).toHaveCount(2);

  const dialogue = page.locator('.cnode[data-kind="dialogue"]');
  await pull(page, dialogue, '.cnode-port[data-port="out"]', 120, 0, 'Выбор');
  await inspector.getByRole('button', { name: 'Добавить вариант' }).click();
  await inspector.getByRole('button', { name: 'Добавить вариант' }).click();
  await inspector.getByLabel('Текст варианта 1').fill('Налево');
  await inspector.getByLabel('Текст варианта 2').fill('Направо');
  const second = inspector.locator('.ioption').nth(1);
  await second.getByLabel('Показывать, если').fill('ключ');
  await expect(second.getByRole('alert')).toHaveText('Неизвестная переменная «ключ».');
  await second.getByRole('button', { name: 'Создать переменную «ключ»' }).click();
  await expect(second.getByRole('alert')).toHaveCount(0);

  // Each option has its own output: pull an end out of both.
  const choice = page.locator('.cnode[data-kind="choice"]');
  const option = '.cnode-port-typed';
  await pull(page, choice, option, 60, -90, 'Конец', 0);
  await pull(page, choice, option, 60, 120, 'Конец', 1);
  await expect(page.locator('.cnode[data-kind="end"]')).toHaveCount(2);

  await page.getByRole('button', { name: 'Пройти', exact: true }).click();
  const play = page.locator('.play');
  await expect(play.locator('.play-node')).toHaveText('Диалог');
  await expect(play.locator('.play-lines p')).toHaveCount(2);
  await play.getByRole('button', { name: 'Далее' }).click();
  await expect(play.getByRole('button', { name: 'Налево' })).toBeEnabled();
  await expect(play.getByRole('button', { name: 'Направо' })).toBeDisabled();
  // Changing the variable by hand makes the hidden option available.
  await play.getByRole('switch', { name: 'ключ' }).check({ force: true });
  await play.getByRole('button', { name: 'Направо' }).click();
  await expect(play).toContainText('Конец истории.');
  await play.getByRole('button', { name: 'Шаг назад' }).click();
  await expect(play.getByRole('button', { name: 'Направо' })).toBeEnabled();
  expect(errors).toEqual([]);
});

test('renaming a variable rewrites its conditions; "where used" leads to the node', async ({ page }) => {
  await openStory(page);
  const start = page.locator('.cnode[data-kind="start"]');
  await pull(page, start, '.cnode-port[data-port="out"]', 140, 0, 'Условие');
  const inspector = page.getByRole('complementary', { name: 'Боковая панель сценария' });
  await inspector.getByLabel('Условие', { exact: true }).fill('доверие > 2');
  await inspector.getByRole('button', { name: 'Создать переменную «доверие»' }).click();

  await page.getByRole('button', { name: 'Переменные', exact: true }).click();
  const drawer = page.getByRole('complementary', { name: 'Переменные и метки' });
  await drawer.getByRole('button', { name: /доверие/ }).click();
  await drawer.getByLabel('Имя', { exact: true }).fill('симпатия');
  await expect(drawer.getByRole('button', { name: /симпатия/ }).first()).toBeVisible();
  await drawer.getByRole('button', { name: /Условие/ }).click();
  await expect(drawer).toHaveCount(0);
  await expect(page.locator('.cnode-selected[data-kind="condition"]')).toHaveCount(1);
  await expect(inspector.getByLabel('Условие', { exact: true })).toHaveValue('симпатия > 2');
  const graphs = await savedGraphs(page);
  expect(JSON.stringify(graphs)).toContain('симпатия > 2');
});

test('problems point at the place; the story is exported as JSON', async ({ page }) => {
  const { box } = await openStory(page);
  await page.mouse.dblclick(box.x + 80, box.y + 80);
  await page.getByRole('menuitem', { name: 'Сцена', exact: true }).click();
  await page.getByLabel('Название', { exact: true }).fill('Забытая сцена');
  await page.getByRole('button', { name: /проблем/ }).click();
  const problem = page.getByRole('button', { name: /До узла «Забытая сцена» нельзя дойти/ });
  await expect(problem).toBeVisible();
  await page.locator('.canvas').click({ position: { x: 30, y: box.height - 120 } });
  await problem.click();
  await expect(page.locator('.cnode-selected')).toHaveText(/Забытая сцена/);

  page.once('dialog', (d) => void d.accept('/Documents/HErPlan/story.json'));
  await page.getByRole('button', { name: 'Экспорт JSON' }).click();
  await expect(page.getByText(/Сценарий сохранён/)).toBeVisible();
  const exported = await page.evaluate(() => {
    const fs = JSON.parse(localStorage.getItem('herplan.web.fs.v1') ?? '{}') as { files: Record<string, string> };
    return JSON.parse(fs.files['/Documents/HErPlan/story.json']) as { format: string; story: { graphs: unknown[] } };
  });
  expect(exported.format).toBe('herplan-export');
  expect(exported.story.graphs).toHaveLength(1);
});
