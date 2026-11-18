import type {
  AuditEvent, Building, ClassSession, Impact, Incident, Overview, Proposal, Rejection, Room
} from './types';

export type Account = { username: string; role: 'admin' | 'staff' };
export type SessionResult = Account & { access_token: string; token_type: string };

const STORAGE_KEY = 'campus-continuity-demo-token';
export const getToken = () => localStorage.getItem(STORAGE_KEY);
export const clearToken = () => localStorage.removeItem(STORAGE_KEY);

export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  let response: Response;
  try {
    response = await fetch('/api' + path, {
      ...options,
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
        ...(options.headers ?? {})
      }
    });
  } catch {
    throw new Error('Cannot connect to the campus server. Check that the local services are running.');
  }
  if (!response.ok) {
    let message = 'The request could not be completed.';
    try {
      const payload = await response.json() as { detail?: string | { msg: string }[] };
      message = typeof payload.detail === 'string'
        ? payload.detail
        : Array.isArray(payload.detail) ? payload.detail.map(x => x.msg).join('; ') : message;
    } catch { /* retain generic error */ }
    throw new Error(response.status + ': ' + message);
  }
  return response.json() as Promise<T>;
}

export async function login(username: string, password: string) {
  const result = await request<SessionResult>('/auth/login', {
    method: 'POST', body: JSON.stringify({ username, password })
  });
  localStorage.setItem(STORAGE_KEY, result.access_token);
  return { username: result.username, role: result.role };
}

export async function register(username: string, password: string) {
  const result = await request<SessionResult>('/auth/register', {
    method: 'POST', body: JSON.stringify({ username, password })
  });
  localStorage.setItem(STORAGE_KEY, result.access_token);
  return { username: result.username, role: result.role };
}

export const getAccount = () => request<Account>('/auth/me');
export const getOverview = () => request<Overview>('/overview');
export const getBuildings = () => request<Building[]>('/buildings');
export const getRooms = () => request<Room[]>('/rooms');
export const getSessions = () => request<ClassSession[]>('/sessions');
export const getIncidents = () => request<Incident[]>('/disruptions');
export const getImpacts = (id: number) => request<Impact[]>('/disruptions/' + id + '/impacts');
export const getPlans = (id: number) => request<Proposal[]>('/disruptions/' + id + '/recovery-plans');
export const generatePlans = (id: number) =>
  request<{ impacts: Impact[]; plans: Proposal[]; message: string; rejected: Record<string, Rejection[]> }>(
    '/disruptions/' + id + '/recovery-plans', { method: 'POST' });
export const approvePlan = (id: number) =>
  request<{ status: string; changes: { session_id: number; from_room: number; to_room: number }[] }>(
    '/recovery-plans/' + id + '/approve', { method: 'POST' });
export const createIncident = (payload: object) =>
  request<Incident>('/disruptions', { method: 'POST', body: JSON.stringify(payload) });
export const getAudit = () => request<AuditEvent[]>('/audit-events');
