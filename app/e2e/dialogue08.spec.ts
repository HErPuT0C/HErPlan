import { expect, test, type Locator, type Page } from '@playwright/test';

// 0.8: what the dialogue editor keeps for the game. A conversation gets a name in the game; a line gets a
// style, a face and an emote from the game's palette (a file the game side puts into the project), bold
// words and a pause between them; a choice gets a timer and a secret option; "give an item" has its three
// exits; a condition asks the game; the conversation is checked, and a task for Claude is copied. The tag
// description of the screenshot grows with its text.

const PALETTE = {
  styles: [
    { id: 'whisper', name: 'Шёпот', color: '#7fb2ff', hint: 'тихо' },
    { id: 'shout', name: 'Крик', color: '#ff6b5e' },
  ],
  sizes: [
    { id: 'small', name: 'мелко' },
    { id: 'big', name: 'крупно' },
  ],
  faces: [
    { id: 'neutral', name: 'Спокойный' },
    { id: 'angry', name: 'Злой' },
  ],
  emotes: [{ id: 'question', name: 'Вопрос' }],
  gestures: [{ id: 'nod', name: 'Кивок' }],
  sounds: [{ id: 'bell', name: 'Колокол' }],
};

async function newStory(page: Page, name: string) {
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
  await expect(page.getByRole('application', { name: 'Холст' })).toBeVisible();
  return { errors };
}

type Files = Record<string, string>;
const readFiles = (page: Page) =>
  page.evaluate(() => (JSON.parse(localStorage.getItem('herplan.web.fs.v1') ?? '{}') as { files: Files }).files);

/** Saves, lets `change` rewrite the files of the project as another program would, and opens it again. */
async function withFiles(page: Page, name: string, change: (dir: string, files: Files) => Files) {
  await page.keyboard.press('Control+S');
  await page.waitForTimeout(300);
  const files = await readFiles(page);
  const dir = Object.keys(files)
    .find((p) => p.endsWith('/project.json'))!
    .slice(0, -'/project.json'.length);
  const next = change(dir, files);
  // Written when the page loads next, once: the page being closed may still save its own copy of the files.
  await page.addInitScript(
    ({ f, token }) => {
      if (sessionStorage.getItem(token)) return;
      sessionStorage.setItem(token, '1');
      const fs = JSON.parse(localStorage.getItem('herplan.web.fs.v1') ?? '{}') as { files: Record<string, string> };
      fs.files = f;
      localStorage.setItem('herplan.web.fs.v1', JSON.stringify(fs));
    },
    { f: next, token: `files-${Date.now()}` },
  );
  await page.reload();
  await page.getByRole('button', { name: new RegExp(`^${name}`) }).click();
  // The project comes back with the tabs it had: the story may be open already.
  const canvas = page.getByRole('application', { name: 'Холст' });
  await expect(page.getByRole('tab', { name: 'Дом' })).toBeVisible();
  if (!(await canvas.isVisible())) {
    await page.getByRole('tab', { name: 'Дом' }).click();
    await page
      .getByRole('button', { name: /Сценарий/ })
      .first()
      .click();
  }
  await expect(canvas).toBeVisible();
  return dir;
}

const center = (b: { x: number; y: number; width: number; height: number }) => ({
  x: b.x + b.width / 2,
  y: b.y + b.height / 2,
});

/** Pulls an edge out of a port of `card` into empty space and picks the kind of the new node. */
async function pull(page: Page, card: Locator, port: string, dx: number, dy: number, kind: string, nth = 0) {
  await card.hover();
  const from = center((await card.locator(port).nth(nth).boundingBox())!);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 10 });
  await page.mouse.up();
  await page.getByRole('menuitem', { name: kind, exact: true }).click();
}

const shot = (page: Page, name: string) =>
  process.env.HERPLAN_SHOTS ? page.screenshot({ path: `${process.env.HERPLAN_SHOTS}/${name}.png` }) : null;

const graphs = async (page: Page) => {
  await page.keyboard.press('Control+S');
  await page.waitForTimeout(300);
  const files = await readFiles(page);
  return Object.entries(files)
    .filter(([p]) => p.includes('/data/graphs/'))
    .map(([path, text]) => ({
      path,
      graph: JSON.parse(text) as Record<string, unknown> & { nodes: Record<string, unknown>[] },
    }));
};

test('a conversation for the game: name, palette, the look of words, cues, timer, give, check, task (0.8)', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const { errors } = await newStory(page, 'Склеп');
  // The game side puts its palette into the project folder.
  await withFiles(page, 'Склеп', (dir, files) => ({
    ...files,
    [`${dir}/data/dialogue_palette.json`]: JSON.stringify(PALETTE),
  }));
  const inspector = page.getByRole('complementary', { name: 'Боковая панель сценария' });

  // The conversation has no name in the game yet: the task for Claude asks for one.
  await page.locator('.story-actions').getByRole('button', { name: 'Задание для Claude' }).click();
  await expect(page.getByText('Сначала дайте разговору имя в игре.')).toBeVisible();
  await expect(inspector.getByText('Палитра игры прочитана из data/dialogue_palette.json.')).toBeVisible();
  const key = inspector.getByLabel('Имя в игре');
  await inspector.getByRole('button', { name: 'Предложить имя по названию' }).click();
  await expect(key).toHaveValue('stsenariy');
  await key.fill('Скелет');
  await expect(inspector.getByRole('alert')).toContainText('Только строчные латинские буквы');
  await key.fill('skeleton_talk');
  await expect(inspector.getByRole('alert')).toHaveCount(0);

  // A dialogue with two lines.
  const start = page.locator('.cnode[data-kind="start"]');
  await pull(page, start, '.cnode-port[data-port="out"]', 120, 0, 'Диалог');
  await inspector.getByRole('button', { name: 'Добавить реплику' }).click();
  await inspector.getByRole('button', { name: 'Добавить реплику' }).click();
  await inspector.getByLabel('Реплика 1').fill('Кто потревожил мой покой?');
  await inspector.getByLabel('Реплика 2').fill('Уходи. {страх = 1}');
  const first = inspector.locator('.iline').nth(0);
  const second = inspector.locator('.iline').nth(1);
  // The counter counts what the player reads: without the effect in braces.
  await expect(second.locator('.iline-count')).toHaveText('6/100');

  // The row of the palette under the text.
  await first.getByLabel('Стиль', { exact: true }).selectOption('whisper');
  await first.getByLabel('Лицо', { exact: true }).selectOption('angry');
  await first.getByLabel('Эмоция', { exact: true }).selectOption('question');
  await expect(first.locator('.mtext-live')).toHaveCount(1);

  // Bold from the keyboard on the selected word, a pause where the caret is.
  const text = first.getByLabel('Реплика 1');
  await text.focus();
  await text.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(4, 14));
  await page.keyboard.press('Control+b');
  await text.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(14, 14));
  await page.keyboard.press('Control+p');
  await expect(first.locator('.line-preview .hl-bold')).toHaveText('потревожил');
  await expect(first.locator('.line-preview .line-cue')).toHaveAttribute('title', 'пауза 0.4 с');
  await expect(first.locator('.mtext-tick')).toHaveCount(1);
  // The marks follow the words when the text before them changes.
  await text.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(0, 0));
  await page.keyboard.type('Эй! ');
  await expect(first.locator('.line-preview .hl-bold')).toHaveText('потревожил');
  // Folded away under the line: every mark with what it says.
  await first.getByRole('button', { name: /Для игры/ }).click();
  await expect(first.locator('.tmark')).toHaveCount(2);
  await shot(page, 'd1-line');

  // The second line can be interrupted, with an exit of its own on the card.
  await second.getByRole('button', { name: /Для игры/ }).click();
  await second.getByLabel('Окно перебивания, с').fill('1.5');
  await second.getByRole('switch', { name: 'Выход «перебили»' }).check({ force: true });
  const dialogue = page.locator('.cnode[data-kind="dialogue"]');
  await expect(dialogue.locator('.cnode-port-hinted')).toHaveCount(1);
  await second.getByLabel('Заметка для перевода').fill('грубо, на «ты»');

  // A choice with a timer and a secret option; a condition asks the game.
  await pull(page, dialogue, '.cnode-port[data-port="out"]', 140, -40, 'Выбор');
  await inspector.getByRole('button', { name: 'Добавить вариант' }).click();
  await inspector.getByRole('button', { name: 'Добавить вариант' }).click();
  await inspector.getByLabel('Текст варианта 1').fill('Отдать подношение');
  await inspector.getByLabel('Таймер, с').fill('10');
  const option1 = inspector.locator('.ioption').nth(0);
  const option2 = inspector.locator('.ioption').nth(1);
  await option1.getByLabel('Показывать, если').fill('есть(корона)');
  await expect(option1.getByRole('alert')).toHaveText('В базе данных нет предмета «корона».');
  await option1.getByLabel('Показывать, если').fill('');
  await option1.getByRole('switch', { name: 'Показать один раз' }).check({ force: true });
  await option2.getByRole('switch', { name: 'Тайный вариант' }).check({ force: true });
  await option2.getByRole('button', { name: 'Действие' }).click();
  await page.getByRole('menuitem', { name: 'Событие' }).click();
  await option2.getByLabel('ключ в игре').fill('skeleton_bored');
  const choice = page.locator('.cnode[data-kind="choice"]');
  await expect(choice.locator('.cchoice-timer')).toContainText('10');

  // "Give an item": three exits.
  await pull(page, choice, '.cnode-port-typed', 120, -60, 'Отдать вещь', 0);
  const give = page.locator('.cnode[data-kind="give"]');
  await expect(give.locator('.cnode-port-typed')).toHaveCount(3);
  await expect(give).toContainText('давать нечего');
  await shot(page, 'd2-graph');

  // Check the dialogue: what the game will stumble over.
  await page.getByRole('button', { name: 'Проверить диалог' }).click();
  const problems = page.locator('.problems');
  await expect(problems.getByRole('heading', { name: 'Проверка диалога' })).toBeVisible();
  await expect(problems).toContainText('У реплики 1 в диалоге «Диалог» не указано, кто говорит.');
  await expect(problems).toContainText('нет выхода «отдал»');
  await expect(problems).not.toContainText('нет имени в игре: Claude');
  await shot(page, 'd3-check');
  // A problem of a line leads to that line.
  await problems.getByRole('button', { name: /У реплики 2 в диалоге/ }).click();
  await expect(inspector.locator('.iline')).toHaveCount(2);

  // What is in the file.
  const [{ path, graph }] = await graphs(page);
  expect(graph.key).toBe('skeleton_talk');
  const node = graph.nodes.find((n) => n.kind === 'dialogue') as {
    lines: Record<string, unknown>[];
    marks: { device: string; range: { start: number; end: number; quote: string }; props: unknown }[];
  };
  expect(node.lines[0]).toMatchObject({ style: 'whisper', face: 'angry', emote: 'question' });
  expect(node.lines[1]).toMatchObject({ interrupt: 1.5, interruptExit: true, note: 'грубо, на «ты»' });
  expect(node.marks).toMatchObject([
    { device: 'style', range: { start: 8, end: 18, quote: 'потревожил' }, props: { bold: true } },
    { device: 'cue', range: { start: 18, end: 18 }, props: { pause: 0.4 } },
  ]);
  const picked = graph.nodes.find((n) => n.kind === 'choice') as { timer: number; options: Record<string, unknown>[] };
  expect(picked.timer).toBe(10);
  expect(picked.options[0]).toMatchObject({ once: true });
  expect(picked.options[1]).toMatchObject({ secret: true, actions: [{ type: 'event', value: 'skeleton_bored' }] });

  // The task for Claude names the conversation and its file.
  await page.getByRole('application', { name: 'Холст' }).click({ position: { x: 40, y: 400 } });
  await page.locator('.story-actions').getByRole('button', { name: 'Задание для Claude' }).click();
  const file = path.slice(path.indexOf('data/graphs/'));
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    `Перенеси в игру разговор skeleton_talk (${file}): переносится впервые.`,
  );

  // The game side carried it over and could not take one thing: badges on the conversation and the node.
  const id = String(graph.id);
  const dialogueId = String((node as unknown as { id: string }).id);
  await withFiles(page, 'Склеп', (dir, files) => ({
    ...files,
    [`${dir}/data/dialogue_import.json`]: JSON.stringify({
      graphs: {
        [id]: {
          key: 'skeleton_talk',
          at: new Date(Date.now() + 1000).toISOString(),
          lines: 2,
          problems: [{ node: dialogueId, line: 'x', text: 'нет звука bell' }],
        },
      },
    }),
  }));
  await expect(page.locator('.story-bar .transfer-error')).toHaveText('ошибка');
  await expect(page.locator('.cnode[data-kind="dialogue"] .transfer-error')).toHaveAttribute('title', 'нет звука bell');
  await shot(page, 'd4-badges');
  expect(errors).toEqual([]);
});

test('transfer: "in the game" turns into "changed" after an edit, and the task says what changed (0.8)', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const { errors } = await newStory(page, 'Перенос');
  const inspector = page.getByRole('complementary', { name: 'Боковая панель сценария' });
  await inspector.getByLabel('Имя в игре').fill('gate_talk');
  const start = page.locator('.cnode[data-kind="start"]');
  await pull(page, start, '.cnode-port[data-port="out"]', 120, 0, 'Диалог');
  await inspector.getByLabel('Название').fill('Приветствие');
  await inspector.getByRole('button', { name: 'Добавить реплику' }).click();
  await inspector.getByLabel('Реплика 1').fill('Стой.');
  const [{ graph }] = await graphs(page);
  await withFiles(page, 'Перенос', (dir, files) => ({
    ...files,
    [`${dir}/data/dialogue_import.json`]: JSON.stringify({
      graphs: { [String(graph.id)]: { key: 'gate_talk', at: new Date().toISOString(), lines: 1, problems: [] } },
    }),
  }));
  await expect(page.locator('.story-bar .transfer-inGame')).toHaveText('в игре');
  await page.waitForTimeout(50);

  await page.locator('.cnode[data-kind="dialogue"]').click();
  await inspector.getByLabel('Реплика 1').fill('Стой, кто идёт?');
  await expect(page.locator('.story-bar .transfer-changed')).toHaveText('изменён');
  await expect(page.locator('.cnode[data-kind="dialogue"] .transfer-changed')).toHaveCount(1);
  // Moving the card is not an edit of the conversation: nothing new to say. The task names the line.
  await page.getByRole('application', { name: 'Холст' }).click({ position: { x: 40, y: 400 } });
  await page.locator('.story-actions').getByRole('button', { name: 'Задание для Claude' }).click();
  const [{ graph: after }] = await graphs(page);
  const line = (after.nodes.find((n) => n.kind === 'dialogue') as { lines: { id: string }[] }).lines[0].id;
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    `Перенеси в игру разговор gate_talk (data/graphs/${String(after.id)}.json): изменена реплика ${line} узла «Приветствие».`,
  );
  expect(errors).toEqual([]);
});

test('a set of lines: dialogue nodes with "when it sounds" and nothing between them (0.8)', async ({ page }) => {
  const { errors } = await newStory(page, 'Лавка');
  const canvas = page.getByRole('application', { name: 'Холст' });
  const box = (await canvas.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2 + 160, { button: 'right' });
  await page.getByRole('menuitem', { name: 'Создать узел…' }).click();
  await page.getByRole('menuitem', { name: 'Набор реплик', exact: true }).click();
  const set = page.locator('.cnode[data-kind="barks"]');
  await expect(set).toBeVisible();
  await set.click();
  await page.keyboard.press('Enter');
  await expect(page.locator('.cnode')).toHaveCount(0);
  // Only lines are made here.
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
  await page.getByRole('menuitem', { name: 'Создать узел…' }).click();
  await expect(page.getByRole('menuitem', { name: 'Выбор', exact: true })).toHaveCount(0);
  await page.getByRole('menuitem', { name: 'Диалог', exact: true }).click();
  const inspector = page.getByRole('complementary', { name: 'Боковая панель сценария' });
  await inspector.getByLabel('Когда звучит').fill('герой входит в лавку');
  await inspector.getByRole('button', { name: 'Добавить реплику' }).click();
  await inspector.getByLabel('Реплика 1').fill('Чего изволите?');
  await expect(page.locator('.cnode[data-kind="dialogue"] .cnode-port')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Пройти', exact: true })).toHaveCount(0);
  const all = await graphs(page);
  const barks = all.find((g) => g.graph.kind === 'barks')!;
  expect(barks.graph.nodes[0]).toMatchObject({ kind: 'dialogue', when: 'герой входит в лавку' });
  expect(errors).toEqual([]);
});

test('database: a character says its name in the game, voice and faces; a variable its memory (0.8)', async ({
  page,
}) => {
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
  await page
    .getByRole('button', { name: /База данных/ })
    .first()
    .click();
  await page.locator('.world-card', { hasText: 'Ника' }).click();
  const panel = page.locator('.world-panel');
  await panel.getByRole('button', { name: 'Предложить имя по названию' }).click();
  await expect(panel.getByLabel('Имя в игре')).toHaveValue('nika');
  // No palette in this project: the lists are plain text.
  await panel.getByLabel('Голос', { exact: true }).fill('girl');
  await panel.getByLabel('Высота голоса').fill('1.2');
  await panel.getByLabel('Лица', { exact: true }).fill('neutral, smile');
  await shot(page, 'd5-card');
  await page.keyboard.press('Control+S');
  await page.waitForTimeout(300);
  const files = await readFiles(page);
  const nika = Object.entries(files)
    .filter(([p]) => p.includes('/data/entities/'))
    .map(([, text]) => JSON.parse(text) as Record<string, unknown>)
    .find((e) => e.name === 'Ника')!;
  expect(nika).toMatchObject({ key: 'nika', voice: 'girl', pitch: 1.2, faces: ['neutral', 'smile'] });
  expect(errors).toEqual([]);
});

test('the description of a tag grows with its text instead of running over what is below (0.8)', async ({ page }) => {
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
  await page
    .getByRole('button', { name: /База данных/ })
    .first()
    .click();
  await page.getByRole('button', { name: /Черты/ }).first().click();
  const description = page.getByLabel('Описание тега').first();
  await description.click({ position: { x: 4, y: 4 } });
  const box = page.locator('textarea.schema-tag-description').first();
  await box.fill(
    Array.from(
      { length: 8 },
      (_, i) => `Строка ${i + 1}: длинное описание тега, которое раньше вылезало из рамки.`,
    ).join('\n'),
  );
  expect(await box.evaluate((el) => el.scrollHeight <= el.clientHeight + 1)).toBe(true);
  await box.press('Escape');
  // Read again (not being edited), it is as tall as its text too.
  const view = page.locator('.schema-tag-description.mention-view').first();
  const fits = await view.evaluate(
    (el) => el.scrollHeight <= el.clientHeight + 1 && el.getBoundingClientRect().height > 120,
  );
  expect(fits).toBe(true);
  expect(errors).toEqual([]);
});
