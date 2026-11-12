import { expect, test, type Page } from '@playwright/test';

// 0.8.2, "Редактор реплик" step 2 (on a palette of the game's shape whose font is made here; the game's own
// files are not in the repository): the line is drawn as the game draws it — a bubble over the speaker, the
// game's letters in rows of the bubble's width — and played with the controls of 6.1: Space finishes it,
// the time slider shows any moment, the speed, "again" from the first line; a double click on a line opens
// it in a big window with ← →, where the fields of the line are edited and their lists open.

type Files = Record<string, string>;

const CHARS = ' !?.,—АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдежзийклмнопрстуфхцчшщъыьэюяЁё▼';
const LINE1 = 'Кто здесь бродит? Стой, я сторожу этот склеп уже триста лет!';
const LINE2 = 'Тише. Это я.';

function palette() {
  const chars = [...CHARS];
  return {
    version: '2026-11-11',
    styles: [
      { id: 'normal', name: 'Обычный', color: '#e8e6de' },
      { id: 'shout', name: 'Крик', color: '#e8e6de' },
      { id: 'anger', name: 'Гнев', color: '#ff7a4a' },
    ],
    bubbles: [{ id: 'round', name: 'Сглаженный' }],
    voices: [{ id: 'dlg_blip', name: 'Обычный' }],
    speakers: [
      { id: 'skeleton', name: 'Скелет', color: '#3fd0c0', bubble: 'round', voice: 'dlg_blip' },
      { id: 'narrator', name: 'Рассказчик', color: '#e8e6de', bubble: 'round', voice: 'dlg_blip' },
    ],
    preview: {
      font: {
        image: 'dialogue_preview/font.png',
        cell_h: 11,
        line_h: 11,
        cap_top: 2,
        cap_h: 7,
        chars: CHARS,
        xs: chars.map((_, i) => i * 6),
        ws: chars.map((c) => (c === ' ' ? 3 : 5)),
      },
      text: { color: '#e8e6de', width: 190, cps: 32, pause_stop: 0.28, pause_comma: 0.12, shake_time: 0.14 },
      styles: [
        { id: 'shout', props: { bold: true, reveal: 'word', fx: ['punch'], cps: 24, shake: 2 } },
        { id: 'anger', props: { col: '#ff7a4a', fx: ['shake'], cps: 46 } },
      ],
      effects: [
        { id: 'shake', params: { px: 1, rate: 22 } },
        { id: 'punch', params: { px: 3, time: 0.1 } },
      ],
      bubble: {
        fill: '#100e14',
        alpha: 0.94,
        min_w: 28,
        frame_w: 24,
        frame_h: 24,
        tail_w: 9,
        tail_h: 5,
        shapes: [{ id: 'round', frame: 0, m: 10, pad_x: 7, pad_y: 5 }],
      },
      speakers: [{ id: 'skeleton', color: '#3fd0c0', bubble: 'round', voice: 'dlg_blip', voice_pitch: 1 }],
    },
  };
}

function talk() {
  return {
    id: 'g-talk',
    kind: 'story',
    name: 'Сценарий',
    key: 'crypt_talk',
    parent: null,
    groups: [],
    nodes: [
      { id: 'start', kind: 'start', title: 'Начало', x: 0, y: 0, w: 160, h: 64, text: '' },
      {
        id: 'talk',
        kind: 'dialogue',
        title: 'В склепе',
        x: 240,
        y: 0,
        w: 320,
        h: 120,
        text: '',
        lines: [
          { id: 'l1', speaker: 'skel', text: LINE1, style: 'anger' },
          { id: 'l2', speaker: 'narrator', text: LINE2 },
        ],
      },
    ],
    edges: [{ id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'talk', port: 'in' } }],
  };
}

async function openCrypt(page: Page) {
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
  await page.getByLabel('Название').fill('Склеп');
  await page.getByRole('button', { name: 'Создать', exact: true }).click();
  await expect(page.getByRole('button', { name: /Сценарий/ })).toBeVisible();
  // The font: white cells of the right size, made by the browser.
  const font = await page.evaluate(
    (n) => {
      const c = document.createElement('canvas');
      c.width = n * 6;
      c.height = 11;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#fff';
      for (let i = 0; i < n; i++) ctx.fillRect(i * 6, 2, 5, 7);
      return c.toDataURL('image/png');
    },
    [...CHARS].length,
  );
  const entity = {
    id: 'skel',
    type: 'character',
    name: 'Скелет',
    description: '',
    image: null,
    order: 10,
    values: {},
    relations: [],
    key: 'skeleton',
  };
  const files = {
    'data/dialogue_palette.json': JSON.stringify(palette()),
    'data/dialogue_preview/font.png': font,
    'data/graphs/g-talk.json': JSON.stringify(talk()),
    'data/entities/skel.json': JSON.stringify(entity),
  };
  await page.evaluate((add) => {
    const fs = JSON.parse(localStorage.getItem('herplan.web.fs.v1') ?? '{}') as { files: Files };
    const dir = Object.keys(fs.files)
      .find((p) => p.endsWith('/project.json'))!
      .slice(0, -'/project.json'.length);
    for (const [p, text] of Object.entries(add)) fs.files[`${dir}/${p}`] = text;
    localStorage.setItem('herplan.web.fs.v1', JSON.stringify(fs));
  }, files);
  await page.reload();
  await page
    .getByRole('button', { name: /^Склеп/ })
    .first()
    .click();
  await page
    .getByRole('button', { name: /Сценарий/ })
    .first()
    .click();
  await expect(page.getByRole('application', { name: 'Холст' })).toBeVisible();
  await page.locator('.cnode[data-kind="dialogue"]').click();
  const inspector = page.getByRole('complementary', { name: 'Боковая панель сценария' });
  await expect(inspector.locator('.iline')).toHaveCount(2);
  return { errors, inspector };
}

const shot = (page: Page, name: string) =>
  process.env.HERPLAN_SHOTS ? page.screenshot({ path: `${process.env.HERPLAN_SHOTS}/${name}.png` }) : null;

test('the scene in the game font: a bubble, rows of its width, Space, the time slider, speed, again (0.8.2)', async ({
  page,
}) => {
  const { errors, inspector } = await openCrypt(page);
  await inspector.getByRole('button', { name: 'Просмотр реплик', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: /Как в игре/ });
  const scene = dialog.locator('canvas.game-scene');
  await expect(scene).toBeVisible();
  // The whole line in the game's letters: two rows in a bubble of 190 + 2 × 7 at most.
  await expect(scene).toHaveAttribute('data-rows', '2');
  const [w] = (await scene.getAttribute('data-bubble'))!.split('x').map(Number);
  expect(w).toBeLessThanOrEqual(204);
  expect(w).toBeGreaterThan(150);
  expect(Number(await scene.getAttribute('data-out'))).toBeLessThan(LINE1.length);
  // Space finishes the line (the scene has the keys, not the window's "close").
  await page.keyboard.press(' ');
  // At once, not by itself later: the line takes over a second.
  await expect(scene).toHaveAttribute('data-done', '', { timeout: 300 });
  await expect(scene).toHaveAttribute('data-out', String(LINE1.length));
  await shot(page, 's1-done');

  // The time slider: a moment, the letters out by then; the playing stops there.
  const slider = dialog.getByRole('slider', { name: 'Время' });
  await slider.fill('0.2');
  await expect(dialog.getByRole('button', { name: 'Дальше' })).toBeVisible();
  // 46 letters a second in anger: ten letters by 0.2 s (one pause aside).
  const out = Number(await scene.getAttribute('data-out'));
  expect(out).toBeGreaterThan(4);
  expect(out).toBeLessThan(14);
  await page.waitForTimeout(300);
  expect(Number(await scene.getAttribute('data-out'))).toBe(out);

  // The speed is remembered; ×2 types twice as fast.
  await dialog.getByRole('button', { name: '×2' }).click();
  await expect(dialog.getByRole('button', { name: '×2' })).toHaveAttribute('aria-pressed', 'true');

  // To the narrator: his bubble has no tail and stands at the bottom; "again" goes back to the first line.
  await dialog.getByRole('button', { name: 'Дальше' }).click();
  // Space on a button of the preview is "next" too: the line is out, then the next one.
  await page.keyboard.press(' ');
  await expect(scene).toHaveAttribute('data-done', '');
  await page.keyboard.press(' ');
  await expect(dialog.locator('.typing-position')).toHaveText('реплика 2 из 2');
  await expect(dialog.locator('.typing-speaker')).toHaveText('Рассказчик');
  await dialog.getByRole('button', { name: 'Сначала' }).click();
  await expect(dialog.locator('.typing-position')).toHaveText('реплика 1 из 2');
  await expect(dialog.getByRole('button', { name: '×2' })).toHaveAttribute('aria-pressed', 'true');
  expect(errors).toEqual([]);
});

test('the window of a line: a double click opens it, ← → go through the lines, its fields edit the line (0.8.2)', async ({
  page,
}) => {
  const { errors, inspector } = await openCrypt(page);
  await page.locator('.cline[data-line="l1"]').dblclick();
  let win = page.getByRole('dialog', { name: /Реплика 1 из 2/ });
  await expect(win).toBeVisible();
  await expect(win.locator('canvas.game-scene')).toBeVisible();
  await expect(win.getByRole('textbox', { name: 'Реплика 1', exact: true })).toHaveValue(LINE1);
  await shot(page, 's2-window');

  // The style from the list inside the window (the list opens over it, not behind).
  await win.getByRole('combobox', { name: 'Стиль' }).click();
  await page.getByRole('listbox', { name: 'Стиль' }).getByRole('option', { name: 'Крик' }).click();
  await expect(win.getByRole('combobox', { name: 'Стиль' })).toHaveAttribute('data-value', 'shout');
  await expect(inspector.locator('.iline').first().getByRole('combobox', { name: 'Стиль' })).toHaveAttribute(
    'data-value',
    'shout',
  );

  // → the next line, ← back; the whole node plays from the first line.
  await page.keyboard.press('ArrowRight');
  win = page.getByRole('dialog', { name: /Реплика 2 из 2/ });
  await expect(win).toBeVisible();
  await expect(win.getByRole('textbox', { name: 'Реплика 2', exact: true })).toHaveValue(LINE2);
  await win.getByRole('button', { name: 'Предыдущая реплика' }).click();
  win = page.getByRole('dialog', { name: /Реплика 1 из 2/ });
  await expect(win).toBeVisible();
  await win.getByRole('button', { name: 'Весь узел' }).click();
  await expect(win.locator('.typing-position')).toHaveText('реплика 1 из 2');
  await page.keyboard.press(' ');
  await page.keyboard.press(' ');
  await expect(win.locator('.typing-position')).toHaveText('реплика 2 из 2');

  // The "open" button beside a line in the side panel; Escape closes.
  await page.keyboard.press('Escape');
  await expect(win).toHaveCount(0);
  await inspector.locator('.iline').nth(1).getByRole('button', { name: 'Развернуть реплику' }).click();
  await expect(page.getByRole('dialog', { name: /Реплика 2 из 2/ })).toBeVisible();
  expect(errors).toEqual([]);
});
