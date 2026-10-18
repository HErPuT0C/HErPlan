import { expect, test, type Page } from '@playwright/test';

// The web build runs on the in-memory platform (localStorage), so a reload behaves like restarting the app.

function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  return errors;
}

async function freshStart(page: Page) {
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('herplan.web.settings.v1', JSON.stringify({ locale: 'ru' }));
  });
  await page.reload();
}

async function createProject(page: Page, name: string) {
  await page.getByRole('button', { name: 'Создать проект' }).click();
  const dialog = page.getByRole('dialog', { name: 'Новый проект' });
  await dialog.getByLabel('Название').fill(name);
  await expect(dialog.getByText(`/Documents/HErPlan/${name}`)).toBeVisible();
  await dialog.getByRole('button', { name: 'Создать', exact: true }).click();
  await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
}

test('start screen: empty state, then a new project opens in the workspace', async ({ page }) => {
  const errors = trackErrors(page);
  await freshStart(page);
  await expect(page.getByRole('heading', { name: 'Добро пожаловать' })).toBeVisible();
  await expect(page.getByText('Здесь появятся ваши проекты')).toBeVisible();
  await expect(page.getByText('HErPlan 0.1.0')).toBeVisible();

  await createProject(page, 'Мельница');
  await expect(page.getByRole('status').filter({ hasText: 'Сохранено' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Модули' })).toBeVisible();

  // Two tabs of the same editor, then back to the start screen.
  await page.getByRole('button', { name: /Сценарий/ }).click();
  await expect(page.getByText('Этот редактор появится в версии 0.2.')).toBeVisible();
  await page.getByRole('button', { name: 'Открыть редактор' }).click();
  await page.getByRole('menuitem', { name: 'Сценарий' }).click();
  await expect(page.getByRole('tab', { name: 'Сценарий 2' })).toBeVisible();
  await page.waitForTimeout(700);
  await page.getByRole('button', { name: 'Закрыть проект' }).click();

  await expect(page.getByRole('heading', { name: 'Недавние проекты' })).toBeVisible();
  await expect(page.getByText('/Documents/HErPlan/Мельница')).toBeVisible();
  expect(errors).toEqual([]);
});

test('reopening restores the project and its tabs after a restart', async ({ page }) => {
  const errors = trackErrors(page);
  await freshStart(page);
  await createProject(page, 'Мир');
  await page.getByRole('button', { name: /База данных/ }).click();
  await expect(page.getByRole('tab', { name: 'База данных' })).toHaveAttribute('aria-selected', 'true');
  await page.waitForTimeout(700);
  await page.reload();

  await page.getByRole('button', { name: /^Мир/ }).click();
  await expect(page.getByRole('tab', { name: 'База данных' })).toHaveAttribute('aria-selected', 'true');
  expect(errors).toEqual([]);
});

test('a folder that is not empty is refused when creating', async ({ page }) => {
  await freshStart(page);
  await createProject(page, 'Дубль');
  await page.getByRole('button', { name: 'Закрыть проект' }).click();
  await page.getByRole('button', { name: 'Создать проект' }).click();
  const dialog = page.getByRole('dialog', { name: 'Новый проект' });
  await dialog.getByLabel('Название').fill('Дубль');
  await expect(dialog.getByRole('alert')).toContainText('уже существует');
  await expect(dialog.getByRole('button', { name: 'Создать', exact: true })).toBeDisabled();
});

test('an empty folder named like the project is used directly, not nested', async ({ page }) => {
  await freshStart(page);
  await page.evaluate(() => {
    const fs = { files: {}, dirs: ['/Documents', '/Documents/Games', '/Documents/Games/TactiCall'] };
    localStorage.setItem('herplan.web.fs.v1', JSON.stringify(fs));
    localStorage.setItem(
      'herplan.web.settings.v1',
      JSON.stringify({ locale: 'ru', projectsDir: '/Documents/Games/TactiCall' }),
    );
  });
  await page.reload();
  await page.getByRole('button', { name: 'Создать проект' }).click();
  const dialog = page.getByRole('dialog', { name: 'Новый проект' });
  await dialog.getByLabel('Название').fill('TactiCall');
  await expect(dialog.getByText('Будет создана папка /Documents/Games/TactiCall', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Создать', exact: true }).click();
  await expect(page.getByText('/Documents/Games/TactiCall', { exact: true })).toBeVisible();
});

test('language and accent switch at once and persist', async ({ page }) => {
  await freshStart(page);
  await page.getByRole('button', { name: 'Настройки' }).click();
  const dialog = page.getByRole('dialog', { name: 'Настройки' });
  await dialog.getByLabel('Язык интерфейса').selectOption('en');
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
  await page.getByRole('tab', { name: 'Appearance' }).click();
  await page.getByRole('radio', { name: 'Indigo' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-accent', 'indigo');
  await page.waitForTimeout(500);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Welcome' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-accent', 'indigo');
});

test('version history: a labelled version is listed and can be restored', async ({ page }) => {
  const errors = trackErrors(page);
  await freshStart(page);
  await createProject(page, 'Версии');
  await page.getByRole('button', { name: 'История версий' }).click();
  const dialog = page.getByRole('dialog', { name: 'История версий' });
  await expect(dialog.getByText('Копий пока нет')).toBeVisible();
  await dialog.getByLabel('Новая версия').fill('Первая версия');
  await dialog.getByRole('button', { name: 'Сохранить версию' }).click();
  await expect(dialog.getByText('Первая версия')).toBeVisible();
  await dialog.getByRole('button', { name: 'Восстановить' }).click();
  await page
    .getByRole('dialog', { name: 'Восстановить эту копию?' })
    .getByRole('button', { name: 'Восстановить' })
    .click();
  await expect(page.getByText(/Проект восстановлен из копии/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Версии', level: 1 })).toBeVisible();
  expect(errors).toEqual([]);
});

test('component showcase renders every component', async ({ page }) => {
  const errors = trackErrors(page);
  await freshStart(page);
  await page.goto('/#/dev/components');
  await expect(page.getByRole('heading', { name: 'Витрина компонентов' })).toBeVisible();
  await page.getByRole('button', { name: 'Открыть диалог' }).click();
  await expect(page.getByRole('dialog', { name: 'Диалог' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Диалог' })).toBeHidden();
  await page.getByText('Правый клик здесь — контекстное меню').click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'Переименовать' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: 'Дублировать' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toBeHidden();
  expect(errors).toEqual([]);
});
