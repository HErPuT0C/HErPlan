import { expect, test } from '@playwright/test';

test('the app starts and shows its name', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'HErPlan' })).toBeVisible();
  await expect(page.getByText(/версия 0\.1\.0/)).toBeVisible();
  expect(errors).toEqual([]);
});
