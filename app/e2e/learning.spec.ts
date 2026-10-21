import { expect, test, type Page } from '@playwright/test';

// The first start (0.7): the welcome offers the tour on the tutorial project; the tour goes through the parts
// of the application; the tutorial project has a story, cards, documents, tasks and a map; the tour can be taken
// again from the settings.

const shot = (page: Page, name: string) =>
  process.env.HERPLAN_SHOTS ? page.screenshot({ path: `${process.env.HERPLAN_SHOTS}/${name}.png` }) : null;

async function firstStart(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('herplan.web.settings.v1', JSON.stringify({ locale: 'ru' }));
  });
  await page.reload();
  return { errors };
}

test('the first start offers the tour; the tour shows the parts of the tutorial project and ends', async ({ page }) => {
  const { errors } = await firstStart(page);
  const welcome = page.getByRole('dialog', { name: 'Добро пожаловать в HErPlan' });
  await expect(welcome).toBeVisible();
  await shot(page, 'l1-welcome');
  await welcome.getByRole('button', { name: 'Пройти тур' }).click();

  const tour = page.getByRole('dialog', { name: 'Добро пожаловать в HErPlan' });
  await expect(page.getByText('Шаг 1 из 17')).toBeVisible();
  await expect(tour).toContainText('учебный проект «Последний фонарь»');
  // Through every step; each lit part is on screen.
  const lit: string[] = [];
  for (let step = 1; step < 17; step++) {
    await page.getByRole('button', { name: 'Далее' }).click();
    await expect(page.getByText(`Шаг ${step + 1} из 17`)).toBeVisible();
    const card = page.locator('.tour-card');
    lit.push((await card.getAttribute('data-tour-step')) ?? '');
    if (step === 3) await expect(page.getByRole('tab', { name: 'Сценарий' })).toHaveAttribute('aria-selected', 'true');
    if (step === 7) {
      await expect(page.locator('.tour-spot')).toBeVisible();
      await expect(page.getByRole('tab', { name: 'База данных' })).toHaveAttribute('aria-selected', 'true');
      await shot(page, 'l2-tour-world');
    }
  }
  expect(lit).toEqual([
    'save',
    'tabs',
    'story',
    'play',
    'checks',
    'variables',
    'world',
    'docs',
    'tasks',
    'map',
    'assets',
    'search',
    'history',
    'export',
    'settings',
    'finish',
  ]);
  await page.getByRole('button', { name: 'Начать работу' }).click();
  await expect(page.locator('.tour')).toHaveCount(0);

  // The tutorial project: a document, cards, a board, the map.
  await expect(page.getByRole('heading', { name: 'Учебный проект: Последний фонарь' })).toBeVisible();
  await page.getByRole('tab', { name: 'Документы' }).click();
  await expect(page.getByRole('navigation', { name: 'Документы' })).toContainText('Начните здесь');
  await page.getByRole('tab', { name: 'База данных' }).click();
  await expect(page.locator('.world-card', { hasText: 'Ника' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Типы' })).toContainText('Черты');
  await page.getByRole('tab', { name: 'Задачи' }).click();
  await expect(page.getByRole('region', { name: 'В работе' }).locator('.task-card')).toHaveCount(2);
  await page.getByRole('tab', { name: 'Карта проекта' }).click();
  await expect(page.locator('.map-ref', { hasText: 'Глава 1. Туман' })).toBeVisible();
  await page.getByRole('tab', { name: 'Ресурсы' }).click();
  await expect(page.getByRole('navigation', { name: 'Папки' })).toContainText('Портреты');

  // The tour again, from the settings: Escape ends it.
  await page.getByRole('button', { name: 'Настройки' }).click();
  await page.getByRole('tab', { name: 'Обучение' }).click();
  await page.getByRole('button', { name: 'Пройти тур' }).click();
  await expect(page.getByText('Шаг 1 из 17')).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByText('Шаг 2 из 17')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.tour')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('"Not now" does not offer the tour again; the tutorial project opens from the start screen', async ({ page }) => {
  const { errors } = await firstStart(page);
  await page
    .getByRole('dialog', { name: 'Добро пожаловать в HErPlan' })
    .getByRole('button', { name: 'Не сейчас' })
    .click();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Недавние проекты' })).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Добро пожаловать в HErPlan' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Учебный проект', exact: true }).click();
  await expect(page.getByRole('button', { name: /Сценарий/ })).toBeVisible();
  await expect(page.locator('.tour')).toHaveCount(0);
  // A second copy gets a free name.
  await page.getByRole('button', { name: 'Закрыть проект' }).click();
  await page.getByRole('button', { name: 'Учебный проект', exact: true }).click();
  await expect(page.getByText(/Последний фонарь \(2\)/).first()).toBeVisible();
  expect(errors).toEqual([]);
});
