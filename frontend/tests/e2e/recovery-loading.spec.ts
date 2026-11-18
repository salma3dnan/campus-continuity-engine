import { test, expect } from '@playwright/test';

test('recovery page shows loading state then actual impact for incident B', async ({ page }) => {
  await page.route('**/api/disruptions/2/impacts', async route => {
    await new Promise(resolve => setTimeout(resolve, 1300));
    await route.continue();
  });
  await page.goto('/');
  await page.getByRole('button', { name: /Explore sample timetable/ }).click();
  await page.getByRole('button', { name: /Disruptions/ }).click();

  const incident = page.locator('.incident-row').filter({ hasText: 'Building A network outage' });
  await incident.getByRole('button', { name: /Review/ }).click();

  await expect(page.getByRole('heading', { name: 'Recovery plans' })).toBeVisible();
  await expect(page.getByText('Checking affected classes and saved recovery plans…')).toBeVisible();
  await expect(page.getByText('Checking…')).toBeVisible();
  await expect(page.getByText('Loading saved recovery plans…')).toBeVisible();

  await expect(page.getByText('2 affected')).toBeVisible({ timeout: 12000 });
  await expect(page.locator('.impact-row')).toHaveCount(2);
  await expect(page.locator('.impact-row').filter({ hasText: 'B-DB' })).toBeVisible();
  await expect(page.locator('.impact-row').filter({ hasText: 'B-NET' })).toBeVisible();
  await expect(page.locator('.impact-row').filter({ hasText: 'B-MATH' })).toHaveCount(0);
  await expect(page.locator('.plan-surface').first()).toBeVisible();
  await expect(page.getByText(/Staff accounts are read-only|Explore available recovery decisions/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Find available rooms' })).toBeDisabled();
});

test('navigating to another incident cannot briefly show stale previous impact', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Explore sample timetable/ }).click();
  await page.getByRole('button', { name: /Disruptions/ }).click();
  await page.locator('.incident-row').filter({hasText: 'Building A network outage'})
    .getByRole('button', { name: /Review/ }).click();
  await expect(page.getByText('2 affected')).toBeVisible();
  await page.getByLabel('SELECT DISRUPTION').selectOption('4');
  await expect(page.locator('.impact-row').filter({hasText: 'B-DB'})).toHaveCount(0);
  await expect(page.locator('.impact-row').filter({hasText: 'D-CEREMONY'})).toBeVisible();
  await expect(page.getByText('1 affected')).toBeVisible();
});
