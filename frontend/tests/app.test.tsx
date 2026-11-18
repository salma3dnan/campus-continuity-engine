import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from '../src/App';

const respond = (value: unknown, ok = true, status = 200) =>
  Promise.resolve({ ok, status, statusText: 'Failure', json: () => Promise.resolve(value) });

const fixtures: Record<string, unknown> = {
  '/api/overview': { active_disruptions: 1, affected_sessions: 1, pending_proposals: 0,
    approved_recoveries: 0, scheduled_sessions: 1 },
  '/api/buildings': [{ id: 1, code: 'A', name: 'Academic Block' }],
  '/api/rooms': [{ id: 1, code: 'A-01', building_id: 1, capacity: 40, network: true, equipment: {} }],
  '/api/sessions': [{ id: 1, code: 'CS101', title: 'Sample Course',
    start_at: '2027-02-09T09:00:00+08:00', end_at: '2027-02-09T11:00:00+08:00',
    room_id: 1, room: 'A-01', original_room_id: 1, original_room: 'A-01',
    attendees: 32, needs_network: true, recovered: false }],
  '/api/disruptions': [],
  '/api/audit-events': []
};

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn((input: string) => respond(fixtures[input] ?? [])));
});

describe('redesigned campus portal', () => {
  it('shows a dedicated login and account-creation path', async () => {
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Create a staff account' }));
    expect(screen.getByRole('heading', { name: 'Create a staff account' })).toBeTruthy();
    expect(screen.getByText(/Staff accounts cannot approve/)).toBeTruthy();
  });

  it('lets visitors inspect a real API-backed timetable without logging in', async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /Explore sample timetable/ }));
    expect(await screen.findByRole('heading', { name: 'Timetable' })).toBeTruthy();
    expect(await screen.findByText('Sample Course')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Sample Course/ }));
    expect(screen.getByRole('dialog', { name: 'Class details' })).toBeTruthy();
    expect(screen.getByText(/Current room/)).toBeTruthy();
  });

  it('registers a staff account and visibly limits its privileges', async () => {
    vi.stubGlobal('fetch', vi.fn((input: string) =>
      input === '/api/auth/register'
        ? respond({ username: 'student@example.edu', role: 'staff', access_token: 'staff-token' })
        : respond(fixtures[input] ?? [])
    ));
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Create a staff account' }));
    fireEvent.change(screen.getByPlaceholderText('name@university.edu'),
      { target: { value: 'student@example.edu' } });
    fireEvent.change(screen.getByPlaceholderText('Password'),
      { target: { value: 'demo-good-password-2027' } });
    fireEvent.change(screen.getByPlaceholderText('Confirm password'),
      { target: { value: 'demo-good-password-2027' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    await waitFor(() => expect(localStorage.getItem('campus-continuity-demo-token')).toBe('staff-token'));
    expect(await screen.findByText('Staff · read-only')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Disruptions/ }));
    expect(await screen.findByText(/Browsing in read-only mode/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: '+ Report disruption' })).toBeNull();
  });

  it('displays invalid credentials rather than implying successful login', async () => {
    vi.stubGlobal('fetch', vi.fn((input: string) =>
      input === '/api/auth/login'
        ? respond({ detail: 'Invalid username or password' }, false, 401)
        : respond(fixtures[input] ?? [])
    ));
    render(<App />);
    fireEvent.change(await screen.findByPlaceholderText('Email or admin username'),
      { target: { value: 'wrong@example.edu' } });
    fireEvent.change(screen.getByPlaceholderText('Password'),
      { target: { value: 'bad-password-2027' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText(/401: Invalid username or password/)).toBeTruthy();
    expect(localStorage.getItem('campus-continuity-demo-token')).toBeNull();
  });

  it('rejects mismatched password confirmation locally', async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Create a staff account' }));
    fireEvent.change(screen.getByPlaceholderText('name@university.edu'),
      { target: { value: 'staff@example.edu' } });
    fireEvent.change(screen.getByPlaceholderText('Password'),
      { target: { value: 'testing-passphrase-2027' } });
    fireEvent.change(screen.getByPlaceholderText('Confirm password'),
      { target: { value: 'not-the-same-passphrase' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText(/passwords do not match/)).toBeTruthy();
  });
});
