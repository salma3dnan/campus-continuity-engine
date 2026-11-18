import { test, expect } from '@playwright/test';

test('legacy duplicate proposals appear as three distinct current options with honest tie labels', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Explore sample timetable/ }).click();
  await page.getByRole('button', { name: /Disruptions/ }).click();
  await page.locator('.incident-row').filter({ hasText: 'Building A network outage' })
    .getByRole('button', { name: /Review/ }).click();
  await expect(page.getByText('2 affected')).toBeVisible();
  const response = await page.request.get('/api/disruptions/2/recovery-plans');
  expect(response.ok()).toBeTruthy();
  const plans = await response.json() as Array<{
    score: number; assignments: Array<{ session_id: number; new_room_id: number }>
  }>;
  expect(plans.length).toBeGreaterThan(1);
  expect(plans.length).toBeLessThanOrEqual(3);
  expect(new Set(plans.map(p => p.assignments
    .map(a => a.session_id + ':' + a.new_room_id).join('|'))).size).toBe(plans.length);
  await expect(page.locator('.plan-surface')).toHaveCount(plans.length);
  if (plans[0].score === plans[1].score) {
    await expect(page.getByText('TIED · RANK 1')).toHaveCount(2);
  }
  await page.locator('.plan-surface').first().locator('summary').click();
  await expect(page.getByText(/Unused-seat penalty/).first()).toBeVisible();
  await expect(page.getByText(/not a percentage/).first()).toBeVisible();
  await page.screenshot({ path: '../docs/screenshots/portfolio-ranked-options.png', fullPage: true });
});

test('audit shows actual class and room names, timestamp and safe public actor label', async ({ page }) => {
  const auditResponse = await page.request.get('/api/audit-events');
  expect(auditResponse.ok()).toBeTruthy();
  const events = await auditResponse.json() as Array<{
    action: string; actor_display: string; changes: Array<{
      session_title: string; from_room: string; to_room: string
    }>
  }>;
  const approved = events.find(event => event.action === 'recovery_approved' &&
    event.changes.length > 0);
  expect(approved).toBeDefined();
  expect(approved?.actor_display).toBe('Administrator');
  await page.goto('/');
  await page.getByRole('button', { name: /Explore sample timetable/ }).click();
  await page.getByRole('button', { name: /Activity/ }).click();
  const firstApproval = page.locator('.activity-item').filter({ hasText: 'Recovery approved' }).first();
  await expect(firstApproval).toBeVisible();
  await expect(firstApproval.locator('.audit-change')).toHaveCount(
    approved!.changes.length
  );
  await expect(firstApproval).toContainText(approved!.changes[0].session_title);
  await expect(firstApproval).toContainText(approved!.changes[0].from_room);
  await expect(firstApproval).toContainText(approved!.changes[0].to_room);
  await expect(firstApproval).toContainText('By Administrator');
  await expect(firstApproval).not.toContainText('–05:03');
  await page.getByRole('button', { name: 'Approvals only' }).click();
  await expect(page.locator('.activity-item')).toHaveCount(
    Math.min(events.filter(item => item.action === 'recovery_approved').length, 10)
  );
  await expect(page.getByText('Recovery options generated')).toHaveCount(0);
  await page.screenshot({ path: '../docs/screenshots/portfolio-audit-history.png', fullPage: true });
});
