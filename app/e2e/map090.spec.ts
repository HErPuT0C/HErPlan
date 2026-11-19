import { expect, test, type Page } from '@playwright/test';

// 0.9: diagrams and drawing on the project map — flowchart figures joined by arrows, a table typed into on the
// map, a chart from a little table of numbers, a canvas holding a drawing, and a pen that draws on the map itself.

type Files = Record<string, string>;

async function newProject(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.setViewportSize({ width: 1400, height: 950 });
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
  await page.getByLabel('Название').fill('Схемы');
  await page.getByRole('button', { name: 'Создать', exact: true }).click();
  await expect(page.getByRole('button', { name: /Сценарий/ })).toBeVisible();
  await page
    .getByRole('button', { name: /Карта проекта/ })
    .first()
    .click();
  await expect(page.locator('.map-tools')).toBeVisible();
  return { errors };
}

const shot = (page: Page, name: string) =>
  process.env.HERPLAN_SHOTS ? page.screenshot({ path: `${process.env.HERPLAN_SHOTS}/${name}.png` }) : null;

/** The map graph as stored (after an autosave). */
async function storedMap(page: Page): Promise<{ nodes: Record<string, unknown>[]; edges: unknown[] } | null> {
  return page.evaluate(() => {
    const fs = JSON.parse(localStorage.getItem('herplan.web.fs.v1') ?? '{}') as { files: Files };
    for (const [path, text] of Object.entries(fs.files)) {
      if (!path.includes('/data/graphs/')) continue;
      const g = JSON.parse(text) as { kind: string; nodes: Record<string, unknown>[]; edges: unknown[] };
      if (g.kind === 'projectMap') return g;
    }
    return null;
  });
}

async function stored(page: Page, suffix: string): Promise<string[]> {
  return page.evaluate((end) => {
    const fs = JSON.parse(localStorage.getItem('herplan.web.fs.v1') ?? '{}') as { files: Files };
    return Object.entries(fs.files)
      .filter(([p]) => p.endsWith(end))
      .map(([, v]) => v);
  }, suffix);
}

/** A point of the map canvas, from its top-left corner. */
async function at(page: Page, x: number, y: number) {
  const box = (await page.locator('.map-canvas').boundingBox())!;
  return { x: box.x + x, y: box.y + y };
}

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, steps = 10) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2 + 20, { steps });
  await page.mouse.move(to.x, to.y, { steps });
  await page.mouse.up();
}

/** "What to create?" at a point of the map: double click there, then pick the kind by name. */
async function createAt(page: Page, x: number, y: number, name: string) {
  const p = await at(page, x, y);
  await page.mouse.dblclick(p.x, p.y);
  const palette = page.getByRole('menu', { name: 'Что создать' });
  await expect(palette).toBeVisible();
  await palette.getByRole('menuitem', { name, exact: true }).click();
}

test('figures joined by an arrow, a table, a chart and a canvas on the map (0.9)', async ({ page }) => {
  const { errors } = await newProject(page);
  const tools = page.getByRole('toolbar', { name: 'Рисование и схемы' });

  // Two figures from the create menu, in its group of diagrams; their words typed in.
  const first = await at(page, 120, 120);
  await page.mouse.dblclick(first.x, first.y);
  await expect(page.getByRole('group', { name: 'Схемы и рисунки' })).toBeVisible();
  await shot(page, 'm0-palette');
  await page.keyboard.press('Escape');
  await createAt(page, 120, 120, 'Овал');
  await createAt(page, 420, 120, 'Ромб');
  const oval = page.locator('.cnode[data-kind="shape-ellipse"]');
  const diamond = page.locator('.cnode[data-kind="shape-diamond"]');
  await expect(oval).toHaveCount(1);
  await expect(diamond).toHaveCount(1);
  await oval.locator('.cshape-text').dblclick();
  await page.keyboard.type('Начало');
  await page.keyboard.press('Control+Enter');
  await expect(oval.locator('.cshape-text')).toHaveText('Начало');
  await diamond.locator('.cshape-text').dblclick();
  await page.keyboard.type('Есть ключ?');
  await page.keyboard.press('Control+Enter');
  // An arrow from the right side of the oval to the diamond.
  await oval.hover();
  const port = (await oval.locator('[data-port="out"]').boundingBox())!;
  const target = (await diamond.boundingBox())!;
  await drag(
    page,
    { x: port.x + port.width / 2, y: port.y + port.height / 2 },
    { x: target.x + target.width / 2, y: target.y + target.height / 2 },
  );

  // A table from the toolbar: cells typed in, a row added with "+", a column taken away from a cell's menu.
  await page.mouse.click((await at(page, 700, 600)).x, (await at(page, 700, 600)).y);
  await tools.getByRole('button', { name: 'Добавить: Таблица' }).click();
  const table = page.locator('.cnode[data-kind="table"]');
  await expect(table.locator('.map-cell')).toHaveCount(9);
  await table.locator('.map-cell').nth(0).dblclick();
  await page.keyboard.type('Предмет');
  await page.keyboard.press('Enter');
  await table.locator('.map-cell').nth(1).dblclick();
  await page.keyboard.type('Цена');
  await page.keyboard.press('Enter');
  await expect(table.locator('.map-cell-head').nth(0)).toHaveText('Предмет');
  await table.hover();
  await table.getByRole('button', { name: 'Добавить строку' }).click();
  await expect(table.locator('.map-cell')).toHaveCount(12);
  await table.locator('.map-cell').nth(2).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Удалить столбец' }).click();
  await expect(table.locator('.map-cell')).toHaveCount(8);
  await shot(page, 'm1-figures-table');

  await expect
    .poll(async () => {
      const g = await storedMap(page);
      return g ? [g.nodes.map((n) => n.kind).sort(), g.edges.length] : null;
    })
    .toEqual([['shape-diamond', 'shape-ellipse', 'table'], 1]);
  const saved = (await storedMap(page))!;
  expect(saved.nodes.find((n) => n.kind === 'shape-ellipse')?.title).toBe('Начало');
  expect(saved.nodes.find((n) => n.kind === 'table')?.cells).toEqual([
    ['Предмет', 'Цена'],
    ['', ''],
    ['', ''],
    ['', ''],
  ]);

  // A chart: its data in a window, drawn as a pie.
  await page.locator('.map-canvas .canvas').press('Escape');
  await tools.getByRole('button', { name: 'Добавить: График' }).click();
  const chart = page.locator('.cnode[data-kind="chart"]');
  await expect(chart.locator('.map-chart-bar')).toHaveCount(4);
  await shot(page, 'm2a-chart-bars');
  await chart.locator('.map-chart').dblclick();
  const data = page.getByRole('dialog', { name: 'Данные графика «График»' });
  await expect(data).toBeVisible();
  await data.getByLabel('Значение: B, Ряд 1').fill('10');
  await data.getByRole('radio', { name: 'Круговая' }).click();
  await shot(page, 'm2-chart-data');
  await data.getByRole('button', { name: 'Сохранить' }).click();
  await expect(data).toHaveCount(0);
  await expect(chart.locator('.map-chart-slice')).toHaveCount(4);

  // A canvas: the drawing window from its card; what is drawn shows on the card and is a picture of the project.
  await page.locator('.map-canvas .canvas').press('Escape');
  await tools.getByRole('button', { name: 'Добавить: Холст' }).click();
  const canvas = page.locator('.cnode[data-kind="drawing"]');
  await canvas.getByRole('button', { name: 'Рисовать' }).click();
  const win = page.getByRole('dialog', { name: 'Новый рисунок' });
  await expect(win).toBeVisible();
  const sheet = (await win.getByRole('img', { name: 'Лист для рисования' }).boundingBox())!;
  await drag(page, { x: sheet.x + 100, y: sheet.y + 100 }, { x: sheet.x + 400, y: sheet.y + 300 });
  await win.getByRole('button', { name: 'Сохранить' }).click();
  await expect(win).toHaveCount(0);
  await expect(canvas.locator('.map-drawing img')).toHaveCount(1);
  await expect.poll(async () => (await stored(page, '/assets/Рисунки/Холст.png')).length).toBe(1);
  await shot(page, 'm3-chart-canvas');

  // A double click opens the drawing again, with what was drawn.
  await canvas.locator('.map-drawing').dblclick();
  let again = page.getByRole('dialog', { name: 'Рисунок «Холст»' });
  await expect(again.getByRole('img', { name: 'Лист для рисования' })).toHaveAttribute('data-items', '1');
  await again.getByRole('button', { name: 'Отмена' }).click();
  await expect(again).toHaveCount(0);

  // A copy of the card shares the drawing until it is drawn on: then it gets a picture of its own.
  await page.locator('.map-canvas .canvas').press('Control+d');
  const copy = page.locator('.cnode[data-kind="drawing"]').nth(1);
  await expect(copy.locator('.map-drawing img')).toHaveCount(1);
  await copy.locator('.map-drawing').dblclick();
  again = page.getByRole('dialog', { name: 'Рисунок «Холст»' });
  const sheet2 = (await again.getByRole('img', { name: 'Лист для рисования' }).boundingBox())!;
  await drag(page, { x: sheet2.x + 300, y: sheet2.y + 50 }, { x: sheet2.x + 100, y: sheet2.y + 250 });
  await again.getByRole('button', { name: 'Сохранить' }).click();
  await expect(again).toHaveCount(0);
  await expect.poll(async () => (await stored(page, '/assets/Рисунки/Холст (2).png')).length).toBe(1);
  await expect
    .poll(async () => (await storedMap(page))?.nodes.filter((n) => n.kind === 'drawing').map((n) => n.drawing))
    .toEqual(['assets/Рисунки/Холст.png', 'assets/Рисунки/Холст (2).png']);
  expect(errors).toEqual([]);
});

test('the pen draws on the map, the eraser takes strokes away, undo brings them back (0.9)', async ({ page }) => {
  const { errors } = await newProject(page);
  const tools = page.getByRole('toolbar', { name: 'Рисование и схемы' });
  const canvas = page.locator('.map-canvas .canvas');
  await createAt(page, 300, 200, 'Блок');
  await canvas.press('Escape');

  await tools.getByRole('button', { name: /^Перо/ }).click();
  await expect(canvas).toHaveAttribute('data-tool', 'pen');
  // A circle around the block, and a line elsewhere.
  const c = await at(page, 380, 240);
  await page.mouse.move(c.x + 140, c.y);
  await page.mouse.down();
  for (let k = 1; k <= 40; k++) {
    const a = (k / 40) * Math.PI * 2;
    await page.mouse.move(c.x + 140 * Math.cos(a), c.y + 90 * Math.sin(a));
  }
  await page.mouse.up();
  await drag(page, await at(page, 700, 500), await at(page, 900, 560));
  await expect(page.locator('.cnode-ink')).toHaveCount(2);
  await canvas.press('Escape');
  await expect(canvas).not.toHaveAttribute('data-tool', /.+/);

  // The block inside the circle is still reached by a click: the stroke takes clicks on its line only.
  await page.mouse.click(c.x, c.y);
  await expect(page.locator('.cnode[data-kind="shape-rect"]')).toHaveClass(/cnode-selected/);
  await shot(page, 'm4-ink');

  // The eraser across the line takes it away; Ctrl+Z puts it back.
  await tools.getByRole('button', { name: /^Ластик/ }).click();
  await drag(page, await at(page, 800, 480), await at(page, 800, 600));
  await expect(page.locator('.cnode-ink')).toHaveCount(1);
  await canvas.press('Escape');
  await canvas.press('Control+z');
  await expect(page.locator('.cnode-ink')).toHaveCount(2);

  // From afar the strokes and the figure are drawn by the GPU.
  for (let i = 0; i < 6; i++) {
    await canvas.press('Control+Minus');
    await page.waitForTimeout(250);
  }
  await expect(page.locator('.cnode-ink')).toHaveCount(0);
  await shot(page, 'm5-far');
  await expect.poll(async () => (await storedMap(page))?.nodes.filter((n) => n.kind === 'ink').length).toBe(2);
  expect(errors).toEqual([]);
});
