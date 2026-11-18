import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const env = Object.fromEntries(readFileSync(resolve(process.cwd(), '..', '.env'), 'utf8')
  .split(/\r?\n/).filter(line => line && !line.startsWith('#') && line.includes('='))
  .map(line => {
    const i = line.indexOf('=');
    return [line.slice(0, i), line.slice(i + 1)];
  }));
const password = 'staff-test-password-2027';

async function signInAsAdmin(page: Page) {
  await page.goto('/');
  await page.getByPlaceholder('Email or admin username').fill(env.DEMO_ADMIN_USERNAME);
  await page.locator('#account-password').fill(env.DEMO_ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Administrator', { exact: true })).toBeVisible();
}
async function getAuth(page: Page) {
  const token = await page.evaluate(() => localStorage.getItem('campus-continuity-demo-token'));
  expect(token).toBeTruthy();
  return { Authorization: 'Bearer ' + token };
}
function malaysiaLocalTime(value: string) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date(value));
  const p = (type: string) => parts.find(x => x.type === type)?.value ?? '';
  return p('year') + '-' + p('month') + '-' + p('day') + 'T' + p('hour') + ':' + p('minute');
}

test.describe.configure({ mode: 'serial' });

test('01 auth portal has separate sign-in, registration and demo access', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Explore sample timetable/ })).toBeVisible();
  await page.screenshot({ path: '../docs/screenshots/redesign-login.png', fullPage: true });
  await page.getByRole('button', { name: 'Create a staff account' }).click();
  await expect(page.getByRole('heading', { name: 'Create a staff account' })).toBeVisible();
  await expect(page.getByLabel('Confirm password')).toBeVisible();
});

test('02 guest can browse real timetable, filter rooms and inspect class', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Explore sample timetable/ }).click();
  await expect(page.getByRole('heading', { name: 'Timetable' })).toBeVisible();
  await expect(page.getByText('Operating Systems Lab')).toBeVisible();
  await expect(page.locator('.room-heading').first()).toContainText('Academic Block');
  await page.screenshot({ path: '../docs/screenshots/redesign-timetable.png', fullPage: true });
  await page.getByRole('button', { name: /Operating Systems Lab/ }).click();
  await expect(page.getByRole('dialog', { name: 'Class details' })).toBeVisible();
  await expect(page.getByText('Current room')).toBeVisible();
  await page.getByRole('button', { name: 'Close class details' }).click();
  await page.getByLabel('Filter building').selectOption({ label: 'Innovation Centre' });
  await expect(page.getByText('B-LAB1').first()).toBeVisible();
});

test('03 new staff can register, sign back in and cannot approve plans', async ({ page }) => {
  const email = 'ui.staff.' + Date.now() + '@example.edu';
  await page.goto('/');
  await page.getByRole('button', { name: 'Create a staff account' }).click();
  await page.getByPlaceholder('name@university.edu').fill(email);
  await page.locator('#account-password').fill(password);
  await page.getByPlaceholder('Confirm password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByText('Staff · read-only')).toBeVisible();
  await page.getByRole('button', { name: /Recovery plans/ }).click();
  await expect(page.getByText(/Staff accounts are read-only/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Find available rooms' })).toBeDisabled();
  const incidents = await (await page.request.get('/api/disruptions')).json() as Array<{ id: number }>;
  const blocked = await page.request.post('/api/disruptions/' + incidents[0].id + '/recovery-plans', {
    headers: await getAuth(page)
  });
  expect(blocked.status()).toBe(403);
  await page.screenshot({ path: '../docs/screenshots/redesign-staff.png', fullPage: true });
  await page.getByRole('button', { name: /ui.staff./ }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await page.getByPlaceholder('Email or admin username').fill(email);
  await page.locator('#account-password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Staff · read-only')).toBeVisible();
});

test('04 admin evaluates competing room assignments and scoring', async ({ page }) => {
  await signInAsAdmin(page);
  await page.getByRole('button', { name: /Recovery plans/ }).click();
  const incidents = await (await page.request.get('/api/disruptions')).json() as Array<{ id: number; title: string }>;
  const network = incidents.find(i => i.title.startsWith('B ·'));
  expect(network).toBeDefined();
  await page.getByLabel('SELECT DISRUPTION').selectOption(String(network!.id));
  await expect(page.getByText('B-DB').first()).toBeVisible();
  await expect(page.getByText('B-NET').first()).toBeVisible();
  await page.getByRole('button', { name: 'Find available rooms' }).click();
  await expect(page.getByText(/Recovery options are ready/)).toBeVisible();
  await expect(page.getByRole('heading', { name: /Plan #/ }).first()).toBeVisible();
  const options: Array<{ assignments: Array<{ new_room_id: number }> }> = await (await page.request.get('/api/disruptions/' + network!.id + '/recovery-plans')).json();
  expect(options[0].assignments).toHaveLength(2);
  expect(new Set(options[0].assignments.map(a => a.new_room_id)).size).toBe(2);
  await page.screenshot({ path: '../docs/screenshots/redesign-recovery.png', fullPage: true });
});

test('05 administrator records a closure and atomically approves its replacement', async ({ page }) => {
  await signInAsAdmin(page);
  const sessions = await (await page.request.get('/api/sessions')).json() as Array<{
    code: string; room: string; room_id: number; start_at: string; end_at: string; recovered: boolean;
  }>;
  const target = sessions.find(x => x.code === 'EX-15' && !x.recovered) ??
    sessions.find(x => x.code.startsWith('EX-') && !x.recovered);
  expect(target).toBeDefined();
  if (!target) return;
  const title = 'Browser verified UI redesign ' + Date.now();
  await page.getByRole('button', { name: /Disruptions/ }).click();
  await page.getByRole('button', { name: '+ Report disruption' }).click();
  await page.getByPlaceholder('e.g. Network switch failure').fill(title);
  await page.getByRole('combobox', { name: 'Room', exact: true }).selectOption({ label: target.room });
  await page.getByLabel('Starts (Malaysia time)').fill(malaysiaLocalTime(target.start_at));
  await page.getByLabel('Ends (Malaysia time)').fill(malaysiaLocalTime(target.end_at));
  await page.getByRole('button', { name: /Record and review/ }).click();
  await expect(page.getByRole('heading', { name: 'Recovery plans' })).toBeVisible();
  await expect(page.getByText(target.code).first()).toBeVisible();
  await page.getByRole('button', { name: 'Find available rooms' }).click();
  await expect(page.getByText(/Recovery options are ready/)).toBeVisible();
  await page.getByRole('button', { name: 'Approve this plan' }).first().click();
  await expect(page.getByText(/room assignment\(s\) updated/)).toBeVisible();
  await page.getByRole('button', { name: /Timetable/ }).click();
  await page.getByLabel('Choose date').fill(malaysiaLocalTime(target.start_at).slice(0, 10));
  await page.getByLabel('Filter building').selectOption('all');
  const sessionsAfter = await (await page.request.get('/api/sessions')).json() as Array<{
    code: string; room_id: number; recovered: boolean; start_at: string; end_at: string;
  }>;
  const current = sessionsAfter.find(x => x.code === target.code);
  expect(current).toBeDefined();
  expect(current?.recovered).toBeTruthy();
  expect(current?.room_id).not.toBe(target.room_id);
  expect(current?.start_at).toBe(target.start_at);
  expect(current?.end_at).toBe(target.end_at);
  await page.screenshot({ path: '../docs/screenshots/redesign-approved.png', fullPage: true });
});

test('06 no feasible room is clearly explained without approving a partial plan', async ({ page }) => {
  await signInAsAdmin(page);
  await page.getByRole('button', { name: /Recovery plans/ }).click();
  const incidents = await (await page.request.get('/api/disruptions')).json() as Array<{ id: number; title: string }>;
  const impossible = incidents.find(i => i.title.startsWith('D ·'));
  expect(impossible).toBeDefined();
  await page.getByLabel('SELECT DISRUPTION').selectOption(String(impossible!.id));
  await expect(page.getByText('D-CEREMONY').first()).toBeVisible();
  await page.getByRole('button', { name: 'Find available rooms' }).click();
  await expect(page.getByText(/No complete recovery is possible/)).toBeVisible();
  await expect(page.getByText(/Capacity/i).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve this plan' })).toHaveCount(0);
  await page.screenshot({ path: '../docs/screenshots/redesign-no-solution.png', fullPage: true });
});
