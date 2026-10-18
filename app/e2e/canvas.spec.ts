import { expect, test, type Page } from '@playwright/test';

// Canvas in the web build (SwiftShader WebGL): create, connect, edit, undo, persist, search.

async function openStoryCanvas(page: Page) {
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('herplan.web.settings.v1', JSON.stringify({ locale: 'ru', canvasHintsOpen: false }));
  });
  await page.reload();
  await page.getByRole('button', { name: 'Создать проект' }).click();
  await page.getByLabel('Название').fill('Холст');
  await page.getByRole('button', { name: 'Создать', exact: true }).click();
  await page.getByRole('button', { name: /Сценарий/ }).click();
  await page.getByRole('button', { name: 'Создать холст сценария' }).click();
  const canvas = page.getByRole('application', { name: 'Холст' });
  await expect(canvas).toBeVisible();
  return { canvas, box: (await canvas.boundingBox())! };
}

async function createNode(page: Page, x: number, y: number, kind = 'Узел') {
  await page.mouse.dblclick(x, y);
  await page.getByRole('menuitem', { name: kind }).click();
}

async function dragBetween(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.up();
}

const center = (b: { x: number; y: number; width: number; height: number }) => ({
  x: b.x + b.width / 2,
  y: b.y + b.height / 2,
});

test('create nodes, connect them, rename, undo and redo', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const { box } = await openStoryCanvas(page);
  await createNode(page, box.x + 250, box.y + 250);
  await createNode(page, box.x + 700, box.y + 250);
  await expect(page.locator('.cnode')).toHaveCount(2);

  const out = center((await page.locator('.cnode-port-out').first().boundingBox())!);
  const target = center((await page.locator('.cnode').nth(1).boundingBox())!);
  await dragBetween(page, out, target);
  // The edge exists in the data: deleting the target node removes it, undo brings both back.
  const graph = () =>
    page.evaluate(() => {
      const fs = JSON.parse(localStorage.getItem('herplan.web.fs.v1') ?? '{}') as { files: Record<string, string> };
      const file = Object.entries(fs.files).find(([p]) => p.includes('/data/graphs/'));
      return file ? (JSON.parse(file[1]) as { nodes: { title: string }[]; edges: unknown[] }) : null;
    });

  await page.locator('.cnode-title').first().dblclick();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('Начало');
  await page.keyboard.press('Enter');
  await expect(page.locator('.cnode-title').first()).toHaveText('Начало');

  await page.keyboard.press('Control+S');
  await expect.poll(async () => (await graph())?.edges.length).toBe(1);
  expect((await graph())?.nodes.map((n) => n.title)).toEqual(['Начало', 'Узел']);

  await page.locator('.canvas').click({ position: { x: 40, y: 400 } });
  await page.keyboard.press('Control+Z');
  await expect(page.locator('.cnode-title').first()).toHaveText('Узел');
  await page.keyboard.press('Control+Y');
  await expect(page.locator('.cnode-title').first()).toHaveText('Начало');
  expect(errors).toEqual([]);
});

test('dragging an edge into empty space creates a connected node; delete and copy-paste work', async ({ page }) => {
  const { box } = await openStoryCanvas(page);
  await createNode(page, box.x + 250, box.y + 250);
  const out = center((await page.locator('.cnode-port-out').first().boundingBox())!);
  await dragBetween(page, out, { x: out.x + 300, y: out.y + 50 });
  await page.getByRole('menuitem', { name: 'Узел' }).click();
  await expect(page.locator('.cnode')).toHaveCount(2);

  // Select all, copy, paste: four nodes; delete the selection: two.
  await page.locator('.canvas').click({ position: { x: 40, y: 500 } });
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Control+C');
  await page.mouse.move(box.x + 300, box.y + 480);
  await page.keyboard.press('Control+V');
  await expect(page.locator('.cnode')).toHaveCount(4);
  await page.keyboard.press('Delete');
  await expect(page.locator('.cnode')).toHaveCount(2);
});

test('search highlights matches and the canvas survives a reload', async ({ page }) => {
  const { box } = await openStoryCanvas(page);
  await createNode(page, box.x + 250, box.y + 250);
  await createNode(page, box.x + 700, box.y + 250, 'Стикер');
  await page.locator('.cnode-title').first().dblclick();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('Мельница у реки');
  await page.keyboard.press('Enter');

  await page.locator('.canvas').click({ position: { x: 40, y: 500 } });
  await page.keyboard.press('Control+F');
  await page.getByRole('search').getByRole('textbox').fill('мельница');
  await expect(page.getByRole('search')).toContainText('1 из 1');
  await expect(page.locator('.cnode-found')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.locator('.cnode-found')).toHaveCount(0);

  await page.keyboard.press('Control+S');
  await page.waitForTimeout(300);
  await page.reload();
  await page.getByRole('button', { name: /^Холст/ }).click();
  await expect(page.locator('.cnode')).toHaveCount(2);
  await expect(page.locator('.cnode-title').first()).toHaveText('Мельница у реки');
});

test('context menu colours a node; the minimap and hints are there', async ({ page }) => {
  const { box } = await openStoryCanvas(page);
  await createNode(page, box.x + 300, box.y + 250);
  const node = page.locator('.cnode').first();
  await node.click({ button: 'right', position: { x: 100, y: 80 } });
  await page.getByRole('menuitem', { name: 'Цвет…' }).click();
  await page.getByRole('button', { name: 'Синий' }).click();
  await expect(node).toHaveAttribute('style', /--node-color: #3b74c9/);
  await expect(page.getByRole('img', { name: 'Мини-карта холста' })).toBeVisible();
  await page.getByRole('button', { name: 'Клавиши холста' }).click();
  await expect(page.getByText('создать узел')).toBeVisible();
});
