import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type SessionRow = {
  id: number; code: string; title: string; room: string;
  room_id: number; start_at: string; end_at: string; recovered: boolean;
};
type IncidentRow = { id: number; title: string };
type PlanRow = {
  id: number;
  assignments: { session_id: number; new_room_id: number }[];
};

const settings = Object.fromEntries(
  readFileSync(resolve(process.cwd(), '..', '.env'), 'utf8').split(/\r?\n/)
    .filter(line => line && !line.startsWith('#') && line.includes('='))
    .map(line => {
      const at = line.indexOf('=');
      return [line.slice(0, at), line.slice(at + 1)];
    })
);

test.describe.configure({ mode: 'serial' });

async function signIn(page: Page) {
  await page.goto('/');
  await expect(page.getByText('Campus at a glance')).toBeVisible();
  await page.getByPlaceholder('Admin username').fill(settings.DEMO_ADMIN_USERNAME);
  await page.getByPlaceholder('Password').fill(settings.DEMO_ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Authorized access')).toBeVisible();
}
async function apiToken(page: Page) {
  const token = await page.evaluate(() => localStorage.getItem('campus-continuity-demo-token'));
  expect(token).toBeTruthy();
  return { Authorization: 'Bearer ' + token };
}
function localTime(iso: string) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date(iso));
  const part = (type: string) => parts.find(x => x.type === type)?.value ?? '';
  return part('year') + '-' + part('month') + '-' + part('day') +
    'T' + part('hour') + ':' + part('minute');
}
async function createIncidentInUI(page: Page, row: SessionRow, title: string) {
  await page.getByRole('button', { name: /Disruptions/ }).click();
  await page.getByRole('button', { name: '+ Report disruption' }).click();
  await page.getByPlaceholder('e.g. Network switch outage').fill(title);
  await page.getByLabel('Target room').selectOption({ label: row.room });
  await page.getByLabel('Start (campus local time)').fill(localTime(row.start_at));
  await page.getByLabel('End (campus local time)').fill(localTime(row.end_at));
  await page.getByRole('button', { name: 'Save disruption' }).click();
  await expect(page.getByRole('heading', { name: 'Recovery planning' })).toBeVisible();
  await expect(page.getByLabel('Select a disruption').locator('option:checked')).toHaveText(title);
}
async function findNewIncident(page: Page, title: string) {
  const response = await page.request.get('/api/disruptions');
  expect(response.ok()).toBeTruthy();
  const incidents = await response.json() as IncidentRow[];
  const incident = incidents.find(i => i.title === title);
  expect(incident).toBeDefined();
  return incident!.id;
}
async function generateAndRead(page: Page, id: number) {
  await page.getByRole('button', { name: /Generate recovery plans/ }).click();
  // Wait for the API mutation to finish before reading persisted proposals.
  await expect(page.getByText(/complete recovery plan\(s\) generated and stored/)).toBeVisible();
  const response = await page.request.get('/api/disruptions/' + id + '/recovery-plans');
  expect(response.ok()).toBeTruthy();
  return await response.json() as PlanRow[];
}

test('A: login, report closure, detect impact, approve and verify changed schedule', async ({ page }) => {
  await signIn(page);
  await page.screenshot({ path: '../docs/screenshots/dashboard.png', fullPage: true });
  const sessions = await (await page.request.get('/api/sessions')).json() as SessionRow[];
  const target = sessions.find(s => s.code === 'EX-11' && !s.recovered)
    ?? sessions.find(s => s.code.startsWith('EX-') && !s.recovered);
  expect(target).toBeDefined();
  if (!target) return;
  const title = 'Browser verified room closure ' + Date.now();
  await createIncidentInUI(page, target, title);
  await expect(page.getByText(target.code).first()).toBeVisible();
  await page.screenshot({ path: '../docs/screenshots/recovery-impact.png', fullPage: true });
  const incidentId = await findNewIncident(page, title);
  const plans = await generateAndRead(page, incidentId);
  expect(plans.length).toBeGreaterThan(0);
  expect(plans[0].assignments).toHaveLength(1);
  await expect(page.getByText('Recommended alternative')).toBeVisible();
  await page.screenshot({ path: '../docs/screenshots/ranked-recovery.png', fullPage: true });
  await page.getByRole('button', { name: 'Approve & update schedule' }).first().click();
  await expect(page.getByText(/approved: 1 room assignment/)).toBeVisible();
  await page.getByRole('button', { name: /Schedule/ }).click();
  const row = page.getByRole('row').filter({ hasText: target.code });
  await expect(row.getByText('Recovered')).toBeVisible();
  await expect(row.getByText('Previously ' + target.room)).toBeVisible();
  await page.screenshot({ path: '../docs/screenshots/recovered-schedule.png', fullPage: true });
  if (plans.length > 1) {
    const response = await page.request.post('/api/recovery-plans/' + plans[1].id + '/approve', {
      headers: await apiToken(page)
    });
    expect(response.status()).toBe(409);
  }
});

test('B: network outage impacts only dependent sessions and solves room competition', async ({ page }) => {
  await signIn(page);
  const incidents = await (await page.request.get('/api/disruptions')).json() as IncidentRow[];
  const incident = incidents.find(i => i.title.startsWith('B ·'));
  expect(incident).toBeDefined();
  if (!incident) return;
  await page.getByRole('button', { name: 'Recovery planning' }).click();
  await page.getByLabel('Select a disruption').selectOption(String(incident.id));
  await expect(page.getByText('B-DB').first()).toBeVisible();
  await expect(page.getByText('B-NET').first()).toBeVisible();
  const plans = await generateAndRead(page, incident.id);
  expect(plans[0].assignments).toHaveLength(2);
  expect(new Set(plans[0].assignments.map(a => a.new_room_id)).size).toBe(2);
  await page.screenshot({ path: '../docs/screenshots/multi-session-network.png', fullPage: true });
});

test('C: equipment shortage exposes constraint-level room rejection explanations', async ({ page }) => {
  await signIn(page);
  const incidents = await (await page.request.get('/api/disruptions')).json() as IncidentRow[];
  const incident = incidents.find(i => i.title.startsWith('C ·'));
  expect(incident).toBeDefined();
  if (!incident) return;
  await page.getByRole('button', { name: 'Recovery planning' }).click();
  await page.getByLabel('Select a disruption').selectOption(String(incident.id));
  await expect(page.getByText('C-GRAPH').first()).toBeVisible();
  const plans = await generateAndRead(page, incident.id);
  expect(plans.length).toBeGreaterThan(0);
  await page.locator('summary').first().click();
  await expect(page.getByText(/Insufficient projector/i).first()).toBeVisible();
  await page.screenshot({ path: '../docs/screenshots/equipment-rejections.png', fullPage: true });
});

test('D: explain when no complete recovery can satisfy hard constraints', async ({ page }) => {
  await signIn(page);
  const incidents = await (await page.request.get('/api/disruptions')).json() as IncidentRow[];
  const incident = incidents.find(i => i.title.startsWith('D ·'));
  expect(incident).toBeDefined();
  if (!incident) return;
  await page.getByRole('button', { name: 'Recovery planning' }).click();
  await page.getByLabel('Select a disruption').selectOption(String(incident.id));
  await expect(page.getByText('D-CEREMONY').first()).toBeVisible();
  await page.getByRole('button', { name: /Generate recovery plans/ }).click();
  await expect(page.getByText(/no feasible replacement room/i)).toBeVisible();
  await expect(page.getByText('No plans stored. Generate alternatives for an active incident.')).toBeVisible();
  await page.screenshot({ path: '../docs/screenshots/no-feasible-plan.png', fullPage: true });
});

test('E: a newly closed replacement room makes an earlier proposal stale', async ({ page }) => {
  await signIn(page);
  const sessions = await (await page.request.get('/api/sessions')).json() as SessionRow[];
  const target = sessions.find(s => s.code === 'EX-12' && !s.recovered)
    ?? sessions.find(s => s.code.startsWith('EX-') && s.code !== 'EX-01' && !s.recovered);
  expect(target).toBeDefined();
  if (!target) return;
  const title = 'Stale approval evidence ' + Date.now();
  await createIncidentInUI(page, target, title);
  const incidentId = await findNewIncident(page, title);
  const plans = await generateAndRead(page, incidentId);
  expect(plans.length).toBeGreaterThan(0);
  // Bind the blocker to the exact plan displayed by the UI approval button.
  // A persistence query may return a different plan order than POST generation.
  const topPlanLabel = await page.locator('.plan-card').first().locator('.eyebrow').innerText();
  const match = /PLAN #(\d+)/.exec(topPlanLabel);
  expect(match).not.toBeNull();
  const displayedPlanId = Number(match![1]);
  const displayedPlan = plans.find(p => p.id === displayedPlanId);
  expect(displayedPlan).toBeDefined();
  const replacementRoom = displayedPlan!.assignments[0].new_room_id;
  const headers = await apiToken(page);
  const blocker = await page.request.post('/api/disruptions', {
    headers,
    data: {
      title: 'Block stale proposal ' + Date.now(),
      kind: 'closure', room_id: replacementRoom, building_id: null,
      start_at: target.start_at, end_at: target.end_at
    }
  });
  expect(blocker.status()).toBe(201);
  await page.getByRole('button', { name: 'Approve & update schedule' }).first().click();
  await expect(page.getByText(/Approval rejected: Error: 409/)).toBeVisible();
  const all = await (await page.request.get('/api/sessions')).json() as SessionRow[];
  expect(all.find(s => s.id === target.id)?.room_id).toBe(target.room_id);
  await page.screenshot({ path: '../docs/screenshots/stale-approval.png', fullPage: true });
});
