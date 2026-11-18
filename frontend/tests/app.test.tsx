import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
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
describe('app integration', () => {
  it('renders API summary and sessions', async () => {
    render(<App />);
    expect(await screen.findByText('Campus Continuity Engine')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Schedule/i }));
    expect(await screen.findByText('Sample Course')).toBeTruthy();
  });
  it('logs in and retains a bearer token on success', async () => {
    vi.stubGlobal('fetch', vi.fn((input: string) =>
      input === '/api/auth/login'
        ? respond({ access_token: 'test-token', username: 'admin' })
        : respond(fixtures[input] ?? [])
    ));
    render(<App />);
    fireEvent.change(screen.getByPlaceholderText('Admin username'), { target: { value: 'admin' } });
    fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: 'demo-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(localStorage.getItem('campus-continuity-demo-token')).toBe('test-token'));
  });
  it('shows authentication failure without claiming login', async () => {
    vi.stubGlobal('fetch', vi.fn((input: string) =>
      input === '/api/auth/login' ? respond({ detail: 'Invalid username or password' }, false, 401)
        : respond(fixtures[input] ?? [])
    ));
    render(<App />);
    fireEvent.change(screen.getByPlaceholderText('Admin username'), { target: { value: 'wrong' } });
    fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText(/401: Invalid username or password/)).toBeTruthy();
    expect(localStorage.getItem('campus-continuity-demo-token')).toBeNull();
  });
});
