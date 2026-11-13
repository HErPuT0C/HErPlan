import { expect, test, type Locator, type Page } from '@playwright/test';

// 0.8.1, "Редактор реплик", step 1 (on a palette of the game's shape; its pictures are made here, the game's
// own files are not in the repository): every value picked from the palette's lists — styles in their
// colours, the speaker's faces and the emotes by picture, sounds to hear; who speaks are the narrator and the
// cards with a name in the game, a line nobody speaks is marked; a value the game no longer has is red; "—
// нет —" takes the field out; the owner's file is tidied on opening (empty marks gone, a cue at the start
// moved into its field); cues stand inside the text; and the preview shakes every time it is played again.

type Files = Record<string, string>;

const LINE1 = 'Кто здесь бродит?';
const LINE2 = 'Тише. Это я.';

/** The palette: like the game's of 11.11.2026, smaller; its pictures are made by the page. */
function palette() {
  return {
    version: '2026-11-11',
    styles: [
      { id: 'normal', name: 'Обычный', color: '#e8e6de' },
      { id: 'anger', name: 'Гнев', color: '#ff7a4a', hint: 'быстро, буквы дрожат' },
    ],
    sizes: [{ id: 'big', name: 'Крупный' }],
    reveals: [{ id: 'word', name: 'Словом' }],
    effects: [{ id: 'shake', name: 'Дрожь' }],
    faces: [
      { id: 'neutral', name: 'Обычное' },
      { id: 'angry', name: 'Зол' },
      { id: 'glow', name: 'Огонёк' },
    ],
    gestures: [{ id: 'nod', name: 'Кивнул', hint: 'два коротких кивка' }],
    emotes: [
      { id: 'exclaim', name: '!', icon: { image: 'dialogue_preview/emotes.png', frame: 0, w: 13, h: 13 } },
      { id: 'question', name: '?', icon: { image: 'dialogue_preview/emotes.png', frame: 1, w: 13, h: 13 } },
    ],
    voices: [{ id: 'dlg_blip_bone', name: 'Костяной', sound: 'dialogue_preview/sounds/dlg_blip_bone.wav' }],
    sounds: [{ id: 'ui_deny', name: 'Отказ' }],
    bubbles: [{ id: 'round', name: 'Сглаженный' }],
    speakers: [
      {
        id: 'skeleton',
        name: 'Скелет',
        color: '#3fd0c0',
        bubble: 'round',
        voice: 'dlg_blip_bone',
        faces: ['neutral', 'angry'],
      },
      { id: 'narrator', name: 'Рассказчик', color: '#e8e6de', bubble: 'round', voice: 'dlg_blip_bone' },
    ],
    actions: [
      { id: 'give_item', name: 'Выдать предмет', ref: 'item' },
      { id: 'save', name: 'Сохранить игру' },
    ],
    preview: {
      text: { color: '#e8e6de', width: 190, cps: 32, pause_stop: 0.28, pause_comma: 0.12, shake_time: 0.3 },
      styles: [{ id: 'anger', props: { col: '#ff7a4a', fx: ['shake'], cps: 46, face: 'angry' } }],
      effects: [{ id: 'shake', params: { px: 1, rate: 22 } }],
      speakers: [
        {
          id: 'skeleton',
          color: '#3fd0c0',
          faces: { neutral: 'dialogue_preview/face.png', angry: 'dialogue_preview/face.png' },
          frame_w: 16,
          frame_h: 8,
          frames: 1,
        },
      ],
    },
  };
}

/** The conversation as the owner's file had it: an empty emote, two empty looks, a cue at the start. */
function talk() {
  const anchor = (id: string) => ({ kind: 'line', id });
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
        w: 300,
        h: 120,
        text: '',
        lines: [
          { id: 'l1', speaker: 'skel', text: LINE1, style: 'old_style' },
          { id: 'l2', speaker: null, text: LINE2 },
          { id: 'l3', speaker: 'narrator', text: 'Ветер.' },
        ],
        marks: [
          {
            id: 'm1',
            device: 'cue',
            anchor: anchor('l1'),
            range: { start: 4, end: 4, quote: '' },
            props: { emote: '' },
          },
          { id: 'm2', device: 'style', anchor: anchor('l1'), range: { start: 0, end: 17, quote: LINE1 }, props: {} },
          { id: 'm3', device: 'style', anchor: anchor('l1'), range: { start: 0, end: 17, quote: LINE1 }, props: {} },
          {
            id: 'm4',
            device: 'cue',
            anchor: anchor('l2'),
            range: { start: 0, end: 0, quote: '' },
            props: { emote: 'exclaim' },
          },
          {
            id: 'm5',
            device: 'cue',
            anchor: anchor('l1'),
            range: { start: 4, end: 4, quote: '' },
            props: { shake: 3 },
          },
        ],
      },
    ],
    edges: [{ id: 'e1', from: { node: 'start', port: 'out' }, to: { node: 'talk', port: 'in' } }],
  };
}

const entity = (id: string, name: string, key?: string) => ({
  id,
  type: 'character',
  name,
  description: '',
  image: null,
  order: 10,
  values: {},
  relations: [],
  ...(key ? { key } : {}),
});

async function openCrypt(page: Page) {
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
  await page.getByLabel('Название').fill('Склеп');
  await page.getByRole('button', { name: 'Создать', exact: true }).click();
  await expect(page.getByRole('button', { name: /Сценарий/ })).toBeVisible();
  // White pictures of the right sizes, made by the browser.
  const png = await page.evaluate(() => {
    const make = (w: number, h: number) => {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, w, h);
      return c.toDataURL('image/png');
    };
    return { emotes: make(26, 13), face: make(16, 8) };
  });
  const files = {
    'data/dialogue_palette.json': JSON.stringify(palette()),
    'data/dialogue_preview/emotes.png': png.emotes,
    'data/dialogue_preview/face.png': png.face,
    'data/graphs/g-talk.json': JSON.stringify(talk()),
    'data/entities/skel.json': JSON.stringify(entity('skel', 'Скелет', 'skeleton')),
    'data/entities/hero.json': JSON.stringify(entity('hero', 'Герой', 'hero')),
    'data/entities/nameless.json': JSON.stringify(entity('nameless', 'Безымянный')),
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
  await expect(inspector.locator('.iline-open')).toHaveCount(3);
  return { errors, inspector };
}

/** Opens a line in the window of a line (0.8.3: lines are edited only there); its editor. */
async function openLine(page: Page, n: number) {
  await page.getByRole('button', { name: `Открыть реплику ${n} в окне` }).click();
  await expect(page.getByRole('dialog', { name: new RegExp(`^Реплика ${n} из`) })).toBeVisible();
  // Whichever line the window shows now.
  return page.getByRole('dialog', { name: /^Реплика/ }).locator('.iline');
}

async function saved(page: Page) {
  await page.keyboard.press('Control+S');
  await page.waitForTimeout(300);
  return page.evaluate(() => {
    const fs = JSON.parse(localStorage.getItem('herplan.web.fs.v1') ?? '{}') as { files: Files };
    const path = Object.keys(fs.files).find((p) => p.endsWith('/data/graphs/g-talk.json'))!;
    return JSON.parse(fs.files[path]) as {
      nodes: { id: string; lines?: Record<string, unknown>[]; marks?: { id: string; props: unknown }[] }[];
    };
  });
}

const options = (page: Page) => page.getByRole('listbox').getByRole('option');

async function pick(page: Page, combo: Locator, name: string) {
  await combo.click();
  await page.getByRole('listbox').getByRole('option', { name, exact: true }).click();
  await expect(page.getByRole('listbox')).toHaveCount(0);
}

const shot = (page: Page, name: string) =>
  process.env.HERPLAN_SHOTS ? page.screenshot({ path: `${process.env.HERPLAN_SHOTS}/${name}.png` }) : null;

test('values from the palette: who speaks, their faces, emotes by picture, styles in colour, "— нет —" (0.8.1)', async ({
  page,
}) => {
  const { errors } = await openCrypt(page);

  // On opening, the owner's file is tidied: no empty marks, the emote at the start of line 2 is its field.
  const first = await saved(page);
  const talkNode = first.nodes.find((n) => n.id === 'talk')!;
  expect(talkNode.marks!.map((m) => m.id)).toEqual(['m5']);
  expect(talkNode.lines![1]).toMatchObject({ emote: 'exclaim' });

  // Who speaks: the narrator and the cards with a name in the game; nobody — "who speaks?".
  const l1 = await openLine(page, 1);
  await l1.getByRole('combobox', { name: 'Кто говорит?' }).click();
  await expect(options(page)).toHaveText(['— не выбран —', 'Рассказчик', 'Герой', 'Скелет']);
  await l1.getByRole('combobox', { name: 'Кто говорит?' }).click();
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await expect(l1.locator('.iline-game-speaker')).toContainText('пузырь: Сглаженный · голос: Костяной');

  // Faces: the speaker's own, by picture.
  await l1.getByRole('combobox', { name: 'Лицо', exact: true }).click();
  await expect(options(page)).toHaveText(['— нет —', 'Обычное', 'Зол']);
  await expect(page.getByRole('listbox').locator('canvas.sprite-frame[data-loaded]')).toHaveCount(2);
  await page.getByRole('option', { name: 'Зол' }).click();

  // A style the game no longer has: red, and it stays in the file until changed. Styles in their colours.
  const style = l1.getByRole('combobox', { name: 'Стиль' });
  await expect(style).toHaveClass(/palette-unknown/);
  await expect(style).toHaveAttribute('title', 'нет в игре');
  await style.click();
  await expect(page.getByRole('option', { name: 'Гнев' }).locator('span').first()).toHaveAttribute(
    'style',
    /color: rgb\(255, 122, 74\)/,
  );
  await style.click();
  await pick(page, style, 'Гнев');
  await expect(style).not.toHaveClass(/palette-unknown/);
  // Actions: the palette's own list (in the window everything is open).
  await l1.getByRole('button', { name: 'Действие' }).click();
  await expect(page.getByRole('menuitem')).toHaveText(['Выдать предмет', 'Сохранить игру']);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menuitem')).toHaveCount(0);

  // Line 2: nobody speaks it; emotes by picture; "— нет —" takes the field out of the file.
  await page.getByRole('button', { name: 'Следующая реплика' }).click();
  await expect(page.getByRole('dialog', { name: /^Реплика 2 из/ })).toBeVisible();
  await expect(l1.locator('.iline-who-missing')).toHaveText('кто говорит?');
  await l1.getByRole('combobox', { name: 'Эмоция', exact: true }).click();
  await expect(page.getByRole('listbox').locator('canvas.sprite-frame[data-loaded]')).toHaveCount(2);
  await shot(page, 'l1-emotes');
  await page.getByRole('option', { name: '— нет —' }).click();

  // Line 3, the narrator: no faces (grey).
  await page.getByRole('button', { name: 'Следующая реплика' }).click();
  await expect(page.getByRole('dialog', { name: /^Реплика 3 из/ })).toBeVisible();
  await expect(l1.getByRole('combobox', { name: 'Лицо', exact: true })).toBeDisabled();
  await expect(l1.getByRole('combobox', { name: 'Лицо', exact: true })).toHaveAttribute(
    'title',
    'этому персонажу лица не нарисованы',
  );
  await page.getByRole('dialog').getByRole('button', { name: 'Закрыть' }).first().click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  const after = (await saved(page)).nodes.find((n) => n.id === 'talk')!;
  expect(after.lines![0]).toMatchObject({ face: 'angry', style: 'anger' });
  expect(after.lines![1].emote).toBeUndefined();
  await shot(page, 'l2-line');
  expect(errors).toEqual([]);
});

test('cues stand inside the text; at its start the fields open; the preview shakes every time (0.8.1)', async ({
  page,
}) => {
  const { errors } = await openCrypt(page);
  const l1 = await openLine(page, 1);
  const text = l1.getByRole('textbox', { name: 'Реплика 1', exact: true });

  // "+ mark" at the start of the line: pause and sound are not offered; an emote opens the field's list.
  await text.focus();
  await text.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(0, 0));
  await page.keyboard.press('Control+m');
  await expect(page.getByRole('menuitem', { name: 'пауза' })).toBeDisabled();
  await page.getByRole('menuitem', { name: /эмоция с начала реплики/ }).click();
  await expect(page.getByRole('listbox', { name: 'Эмоция' })).toBeVisible();
  await page.getByRole('option', { name: '?' }).click();
  await expect(l1.getByRole('combobox', { name: 'Эмоция', exact: true })).toHaveAttribute('data-value', 'question');

  // Inside the text: an emote is picked from the list before it exists (no empty cue is made).
  await text.focus();
  await text.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(10, 10));
  await page.keyboard.press('Control+m');
  await page.getByRole('menuitem', { name: 'эмоция', exact: true }).click();
  await page.getByRole('menuitem', { name: '!', exact: true }).click();
  const marks = (await saved(page)).nodes.find((n) => n.id === 'talk')!.marks!;
  expect(marks.map((m) => m.props)).toEqual([{ shake: 3 }, { emote: 'exclaim' }]);

  // The preview: the shake at "здесь" shows on the first play and again after "again", and again.
  // In the window of the line, over its fields.
  const dialog = page.getByRole('dialog', { name: /^Реплика 1 из/ });
  // It has played since the window opened: from the start again, three times.
  const box = dialog.locator('.typing-box');
  /** Watches the text box for a shake (its offset) for a while; true when it shook. "Again" makes a new box. */
  const shakes = () =>
    dialog.evaluate(
      (el) =>
        new Promise<boolean>((resolve) => {
          const shook = () => el.querySelector('.typing-box[data-shake]') !== null;
          if (shook()) return resolve(true);
          const seen = new MutationObserver(() => {
            if (shook()) {
              seen.disconnect();
              resolve(true);
            }
          });
          seen.observe(el, { attributes: true, subtree: true, childList: true });
          setTimeout(() => {
            seen.disconnect();
            resolve(false);
          }, 2500);
        }),
    );
  for (let round = 0; round < 3; round++) {
    await expect(box).toHaveAttribute('data-done', '');
    const watch = shakes();
    await dialog.getByRole('button', { name: 'Сначала' }).click();
    expect(await watch).toBe(true);
  }
  await shot(page, 'l3-preview');
  expect(errors).toEqual([]);
});
