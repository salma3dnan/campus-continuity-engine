import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import AuthScreen from './AuthScreen';
import {
  approvePlan, clearToken, createIncident, generatePlans, getAccount, getAudit,
  getBuildings, getImpacts, getIncidents, getOverview, getPlans, getRooms,
  getSessions, getToken, type Account
} from './api';
import type {
  AuditEvent, Building, ClassSession, Impact, Incident, Overview, Proposal,
  Rejection, Room, Tab
} from './types';

const nav: { tab: Tab; label: string; glyph: string }[] = [
  { tab: 'schedule', label: 'Timetable', glyph: '▦' },
  { tab: 'incidents', label: 'Disruptions', glyph: '!' },
  { tab: 'recovery', label: 'Recovery plans', glyph: '↗' },
  { tab: 'rooms', label: 'Rooms & resources', glyph: '⌂' },
  { tab: 'audit', label: 'Activity', glyph: '≡' }
];
const facilityTime = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kuala_Lumpur', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
});
const fullDate = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kuala_Lumpur', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
});
const shortDate = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kuala_Lumpur', day: 'numeric', month: 'short', year: 'numeric'
});
const hours = Array.from({ length: 10 }, (_, i) => i + 8);
const baseline = (name: string) => /^[ABCD] ·/.test(name);
const automatedTest = (name: string) =>
  /^(Browser verified|Stale approval evidence|Block stale proposal)/.test(name);
const kindName: Record<Incident['kind'], string> = {
  closure: 'Space closure', network: 'Network outage', equipment: 'Equipment issue'
};
function localDay(iso: string) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kuala_Lumpur', day: '2-digit', month: '2-digit', year: 'numeric'
  }).formatToParts(new Date(iso));
  const part = (type: string) => parts.find(item => item.type === type)?.value ?? '';
  return part('year') + '-' + part('month') + '-' + part('day');
}
function addDays(date: string, amount: number) {
  const base = new Date(date + 'T12:00:00Z');
  base.setUTCDate(base.getUTCDate() + amount);
  return base.toISOString().slice(0, 10);
}
function minutesAtCampus(iso: string) {
  const parts = facilityTime.formatToParts(new Date(iso));
  const p = (type: string) => Number(parts.find(x => x.type === type)?.value ?? '0');
  return p('hour') * 60 + p('minute');
}
function dayAtCampus(iso: string) { return shortDate.format(new Date(iso)); }
function timeAtCampus(iso: string) { return facilityTime.format(new Date(iso)); }
function formatWindow(start: string, end: string) {
  return dayAtCampus(start) + ' · ' + timeAtCampus(start) + '–' + timeAtCampus(end);
}
function labelForAudit(action: string) {
  if (action === 'recovery_approved') return 'Recovery approved';
  if (action === 'recovery_generated') return 'Recovery options generated';
  if (action === 'disruption_created') return 'Disruption recorded';
  return action.replaceAll('_', ' ');
}

export default function App() {
  const [mode, setMode] = useState<'checking' | 'auth' | 'workspace'>('checking');
  const [profile, setProfile] = useState<Account | null>(null);
  const [tab, setTab] = useState<Tab>('schedule');
  const [overview, setOverview] = useState<Overview | null>(null);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [sessions, setSessions] = useState<ClassSession[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [day, setDay] = useState('2027-02-09');
  const [buildingFilter, setBuildingFilter] = useState<string>('initial');
  const [roomFilter, setRoomFilter] = useState('');
  const [focus, setFocus] = useState<ClassSession | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [impacts, setImpacts] = useState<Impact[]>([]);
  const [impactFetch, setImpactFetch] = useState<{ id: number | null; phase: 'idle' | 'loading' | 'ready' | 'error' }>({ id: null, phase: 'idle' });
  const [plans, setPlans] = useState<Proposal[]>([]);
  const [rejected, setRejected] = useState<Record<string, Rejection[]>>({});
  const [planMessage, setPlanMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [showIncidentForm, setShowIncidentForm] = useState(false);
  const [draft, setDraft] = useState({
    title: '', kind: 'closure' as Incident['kind'], scope: 'room',
    room_id: '', building_id: '', equipment_kind: 'projector', quantity_lost: 1,
    start_at: '2027-02-17T08:00', end_at: '2027-02-17T12:00'
  });

  const isAdmin = profile?.role === 'admin';
  const isGuest = profile === null;

  useEffect(() => {
    if (!getToken()) { setMode('auth'); return; }
    getAccount().then(account => {
      setProfile(account);
      setMode('workspace');
    }).catch(() => {
      clearToken();
      setProfile(null);
      setMode('auth');
    });
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [summary, buildingsData, roomsData, sessionsData, incidentsData, auditData] = await Promise.all([
        getOverview(), getBuildings(), getRooms(), getSessions(), getIncidents(), getAudit()
      ]);
      setOverview(summary); setBuildings(buildingsData); setRooms(roomsData);
      setSessions(sessionsData); setIncidents(incidentsData); setAudit(auditData);
      setDay(previous => previous || (sessionsData.length ? localDay(sessionsData[0].start_at) : '2027-02-09'));
      setBuildingFilter(previous => previous === 'initial' && buildingsData.length ? String(buildingsData[0].id) : previous);
      setSelectedId(previous => previous ?? (incidentsData.find(item => baseline(item.title))?.id ?? incidentsData[0]?.id ?? null));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load campus data');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (mode === 'workspace') void refresh();
  }, [mode, refresh]);

  useEffect(() => {
    if (mode !== 'workspace' || selectedId === null) return;
    let active = true;
    setImpactFetch({ id: selectedId, phase: 'loading' });
    Promise.all([getImpacts(selectedId), getPlans(selectedId)]).then(([affected, saved]) => {
      if (!active) return;
      setImpacts(affected);
      setPlans(saved);
      setRejected(saved[0]?.details.rejected ?? {});
      setPlanMessage('');
      setImpactFetch({ id: selectedId, phase: 'ready' });
    }).catch(cause => {
      if (!active) return;
      setImpacts([]); setPlans([]);
      setImpactFetch({ id: selectedId, phase: 'error' });
      setError('Could not load recovery information: ' + String(cause));
    });
    return () => { active = false; };
  }, [mode, selectedId]);

  const roomsShown = useMemo(() => rooms.filter(room =>
    (buildingFilter === 'all' || room.building_id === Number(buildingFilter)) &&
    (!roomFilter || room.code.toLowerCase().includes(roomFilter.toLowerCase()))
  ), [rooms, buildingFilter, roomFilter]);
  const dateSessions = useMemo(() => sessions.filter(session => localDay(session.start_at) === day),
    [sessions, day]);
  const hiddenTestIncidents = incidents.filter(item => automatedTest(item.title));
  const operationalIncidents = incidents.filter(item => !automatedTest(item.title));
  const selectedIncident = incidents.find(item => item.id === selectedId);
  const impactLoading = selectedId !== null && (impactFetch.id !== selectedId || impactFetch.phase === 'loading' || impactFetch.phase === 'idle');
  const impactFailed = selectedId !== null && impactFetch.id === selectedId && impactFetch.phase === 'error';
  const roomById = (id: number | null) => rooms.find(item => item.id === id);
  const buildingById = (id: number | null) => buildings.find(item => item.id === id);
  const activeRoomCount = roomsShown.length;

  function enterAs(account: Account) {
    setProfile(account); setError(''); setNotice(''); setTab('schedule'); setImpactFetch({id:null,phase:'idle'}); setMode('workspace');
  }
  function explore() {
    clearToken(); setProfile(null); setError(''); setNotice('');
    setTab('schedule'); setImpactFetch({id:null,phase:'idle'}); setMode('workspace');
  }
  function exit() {
    clearToken(); setProfile(null); setError(''); setNotice('');
    setMode('auth'); setTab('schedule'); setImpactFetch({id:null,phase:'idle'});
  }
  function reviewIncident(id: number) {
    if (id !== selectedId) {
      setSelectedId(id);
      setPlans([]); setImpacts([]); setRejected({}); setPlanMessage('');
      setImpactFetch({ id, phase: 'loading' });
    }
    setTab('recovery'); setError(''); setNotice('');
  }
  async function makePlans() {
    if (!isAdmin || selectedId === null) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const data = await generatePlans(selectedId);
      setImpacts(data.impacts); setPlans(data.plans);
      setRejected(data.rejected); setPlanMessage(data.message);
      setNotice(data.plans.length
        ? 'Recovery options are ready. Review the room changes before approval.'
        : 'No complete recovery is possible with current resources.');
      await refresh();
    } catch (cause) { setError(String(cause)); }
    finally { setBusy(false); }
  }
  async function approve(id: number) {
    if (!isAdmin) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await approvePlan(id);
      setNotice('Plan #' + id + ' approved. ' + result.changes.length +
        ' room assignment(s) updated. Session times are unchanged.');
      await refresh();
      if (selectedId !== null) {
        const [updatedImpact, updatedPlans] = await Promise.all([getImpacts(selectedId), getPlans(selectedId)]);
        setImpacts(updatedImpact); setPlans(updatedPlans);
      }
    } catch (cause) { setError('Approval rejected: ' + String(cause)); }
    finally { setBusy(false); }
  }
  async function createDisruption(event: FormEvent) {
    event.preventDefault(); if (!isAdmin) return;
    setBusy(true); setError(''); setNotice('');
    try {
      if (draft.start_at >= draft.end_at) throw new Error('End time must be after start time.');
      const roomTarget = draft.kind === 'equipment' || draft.scope === 'room';
      const payload = {
        title: draft.title, kind: draft.kind,
        room_id: roomTarget ? Number(draft.room_id) || null : null,
        building_id: roomTarget ? null : Number(draft.building_id) || null,
        equipment_kind: draft.kind === 'equipment' ? draft.equipment_kind : null,
        quantity_lost: draft.kind === 'equipment' ? Number(draft.quantity_lost) : null,
        start_at: new Date(draft.start_at + '+08:00').toISOString(),
        end_at: new Date(draft.end_at + '+08:00').toISOString()
      };
      const created = await createIncident(payload);
      setShowIncidentForm(false); await refresh();
      reviewIncident(created.id);
      setNotice('Disruption recorded. The affected sessions are shown below.');
    } catch (cause) { setError(String(cause)); }
    finally { setBusy(false); }
  }

  if (mode === 'checking') return <div className="boot-screen">Checking your session…</div>;
  if (mode === 'auth') return <AuthScreen onAuthenticated={enterAs} onExplore={explore}/>;

  return <div className="workspace">
    <aside className="sidebar">
      <div className="identity">
        <span className="identity-mark">C</span>
        <div className="identity-title"><strong>Campus Continuity</strong><small>OPERATIONS</small></div>
      </div>
      <div className="sidebar-section">WORKSPACE</div>
      <nav aria-label="Main navigation" className="sidebar-nav">
        {nav.map(item => <button key={item.tab} className={'nav-link ' + (tab === item.tab ? 'active' : '')}
          onClick={() => { setTab(item.tab); setError(''); setNotice(''); }}>
          <span className="nav-glyph" aria-hidden="true">{item.glyph}</span>
          <span>{item.label}</span>
          {item.tab === 'incidents' && overview?.affected_sessions ? <i className="nav-count">{overview.affected_sessions}</i> : null}
        </button>)}
      </nav>
      <div className="sidebar-bottom">
        <span className="status-dot"/><div><strong>Local demo workspace</strong><small>Illustrative university data</small></div>
      </div>
    </aside>
    <div className="workspace-content">
      <header className="workspace-topbar">
        <span className="header-title">Academic operations <span className="header-divider">/</span> <b>{nav.find(item => item.tab === tab)?.label}</b></span>
        <div className="header-right">
          <span className="sample-indicator">SAMPLE DATA</span>
          <button className="account-control" onClick={exit} title="Sign out or return to login">
            <span className="account-circle">{profile?.username.charAt(0).toUpperCase() ?? 'G'}</span>
            <span className="account-text"><strong>{profile?.username ?? 'Demo visitor'}</strong><small>{isAdmin ? 'Administrator' : profile ? 'Staff · read-only' : 'Guest · read-only'}</small></span>
            <span className="account-arrow">↗</span>
          </button>
        </div>
      </header>
      <main className="page">
        {error && <div role="alert" className="alert-bar"><b>Something needs attention.</b> {error}<button aria-label="Dismiss error" onClick={() => setError('')}>×</button></div>}
        {notice && <div role="status" className="notice-bar">{notice}<button aria-label="Dismiss notice" onClick={() => setNotice('')}>×</button></div>}
        {loading && <div className="loading-bar">Updating campus records…</div>}
        {tab === 'schedule' && <section className="screen">
          <div className="page-heading"><div><div className="eyebrow">CAMPUS SCHEDULING</div>
            <h1>Timetable</h1><p>See what is happening in each room, at a glance.</p></div>
            <button className="button secondary" onClick={() => void refresh()} disabled={busy}>Refresh schedule</button>
          </div>
          <div className="calendar-toolbar">
            <div className="date-navigation">
              <button aria-label="Previous day" onClick={() => setDay(addDays(day, -1))}>‹</button>
              <button aria-label="Next day" onClick={() => setDay(addDays(day, 1))}>›</button>
              <div><strong>{fullDate.format(new Date(day + 'T12:00:00+08:00'))}</strong><small>Malaysia time</small></div>
              <input aria-label="Choose date" type="date" value={day} onChange={e => setDay(e.target.value)}/>
            </div>
            <div className="toolbar-right">
              <label><span>Building</span><select aria-label="Filter building" value={buildingFilter} onChange={e => setBuildingFilter(e.target.value)}>
                <option value="all">All buildings</option>{buildings.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select></label>
              <label><span>Room</span><input aria-label="Search rooms" value={roomFilter} onChange={e => setRoomFilter(e.target.value)}
                placeholder="Search room"/></label>
            </div>
          </div>
          <div className="calendar-summary">
            <div><span className="status-dot"/><strong>{dateSessions.length} sessions</strong> scheduled on this day</div>
            <span>{activeRoomCount} rooms displayed · Click a class to inspect its assignment</span>
          </div>
          {roomsShown.length ? <div className="calendar-scroll">
            <div className="timetable-grid" style={{ gridTemplateColumns: '74px repeat(' + roomsShown.length + ', minmax(190px, 1fr))',
              minWidth: (roomsShown.length * 190 + 74) + 'px' }}>
              <div className="time-heading">TIME</div>
              {roomsShown.map(room => <div className="room-heading" key={room.id}><strong>{room.code}</strong>
                <small>{buildingById(room.building_id)?.name ?? 'Campus'} · {room.capacity} seats</small></div>)}
              <div className="time-column">{hours.map(hour => <div className="time-marker" key={hour}>{String(hour).padStart(2, '0')}:00</div>)}</div>
              {roomsShown.map(room => <div className="room-timeline" key={room.id}>
                {dateSessions.filter(s => s.room_id === room.id).map(s => {
                  const begin = minutesAtCampus(s.start_at);
                  const finish = minutesAtCampus(s.end_at);
                  const top = (begin - 480) * 1.12;
                  const height = Math.max(30, (finish - begin) * 1.12 - 4);
                  return <button key={s.id} onClick={() => setFocus(s)} className={'class-block ' + (s.recovered ? 'recovered' : '')}
                    style={{ top: Math.max(0, top) + 'px', height: height + 'px' }}>
                    <b>{s.title}</b><small>{timeAtCampus(s.start_at)} – {timeAtCampus(s.end_at)}</small>
                    <small>{s.code} · {s.attendees} people</small>
                  </button>;
                })}
              </div>)}
            </div>
          </div> : <div className="empty-panel">No rooms match those filters. Try another building or room code.</div>}
          <div className="calendar-legend"><span><i className="legend-swatch booked"/>Scheduled</span>
            <span><i className="legend-swatch moved"/>Recovered · room reassigned</span>
            <span>Times are never changed by the recovery engine.</span></div>
          <div className="bottom-context">
            <div><strong>When a room becomes unavailable</strong>
              <p>Record the issue, review affected classes, and compare conflict-free recovery options before changing the schedule.</p></div>
            <button className="text-action" onClick={() => setTab('incidents')}>View disruptions →</button>
          </div>
        </section>}
        {tab === 'incidents' && <section className="screen">
          <div className="page-heading"><div><div className="eyebrow">EXCEPTIONS</div>
            <h1>Disruptions</h1><p>Identify the problem first. Recovery options come next.</p></div>
            {isAdmin && <button className="button primary" onClick={() => setShowIncidentForm(!showIncidentForm)}>
              {showIncidentForm ? 'Cancel' : '+ Report disruption'}</button>}
          </div>
          {!isAdmin && <div className="helper-band">Browsing in read-only mode. Sign in as administrator to report or resolve disruptions.</div>}
          {showIncidentForm && isAdmin && <form onSubmit={createDisruption} className="form-surface">
            <div className="section-title"><h2>Report a disruption</h2><span>Step 1 of 2 · Describe the problem</span></div>
            <div className="form-grid">
              <label className="full-field">Title<input required minLength={4} maxLength={180} value={draft.title}
                placeholder="e.g. Network switch failure" onChange={e => setDraft({...draft,title:e.target.value})}/></label>
              <label>Problem type<select value={draft.kind} onChange={e => setDraft({...draft,kind:e.target.value as Incident['kind']})}>
                <option value="closure">Room or building closure</option><option value="network">Network outage</option>
                <option value="equipment">Equipment unavailable</option></select></label>
              {draft.kind !== 'equipment' && <label>Scope<select value={draft.scope} onChange={e => setDraft({...draft,scope:e.target.value})}>
                <option value="room">One room</option><option value="building">Entire building</option></select></label>}
              {(draft.kind === 'equipment' || draft.scope === 'room')
                ? <label>Room<select required value={draft.room_id} onChange={e => setDraft({...draft,room_id:e.target.value})}>
                  <option value="">Select room</option>{rooms.map(r => <option key={r.id} value={r.id}>{r.code}</option>)}</select></label>
                : <label>Building<select required value={draft.building_id} onChange={e => setDraft({...draft,building_id:e.target.value})}>
                  <option value="">Select building</option>{buildings.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>}
              {draft.kind === 'equipment' && <>
                <label>Equipment<input required value={draft.equipment_kind}
                  onChange={e => setDraft({...draft,equipment_kind:e.target.value})}/></label>
                <label>Quantity lost<input type="number" min={1} required value={draft.quantity_lost}
                  onChange={e => setDraft({...draft,quantity_lost:Number(e.target.value)})}/></label></>}
              <label>Starts (Malaysia time)<input required type="datetime-local" value={draft.start_at}
                onChange={e => setDraft({...draft,start_at:e.target.value})}/></label>
              <label>Ends (Malaysia time)<input required type="datetime-local" value={draft.end_at}
                onChange={e => setDraft({...draft,end_at:e.target.value})}/></label>
            </div>
            <div className="form-footer"><span>Sessions will not be moved without explicit approval.</span>
              <button className="button primary" disabled={busy} type="submit">{busy ? 'Saving…' : 'Record and review →'}</button></div>
          </form>}
          <div className="content-surface">
            <div className="section-title"><div><h2>Campus cases</h2><p>Use these representative issues to demonstrate the recovery workflow.</p></div>
              <span className="small-count">{operationalIncidents.length} cases</span></div>
            {operationalIncidents.map(item => <div className="incident-row" key={item.id}>
              <div className="incident-icon">{item.kind === 'closure' ? '×' : item.kind === 'network' ? '≈' : '◈'}</div>
              <div className="incident-description"><strong>{item.title}</strong>
                <span>{kindName[item.kind]} · {item.room_id ? roomById(item.room_id)?.code : buildingById(item.building_id)?.name}
                  {' · '}{formatWindow(item.start_at,item.end_at)}</span></div>
              <span className="status-chip amber">{item.status}</span>
              <button className="button outline small" onClick={() => reviewIncident(item.id)}>Review →</button>
            </div>)}
          </div>
          {hiddenTestIncidents.length > 0 && <details className="test-history">
            <summary>Browser test history ({hiddenTestIncidents.length}) — kept for audit, hidden from the main queue</summary>
            {hiddenTestIncidents.map(item => <div className="test-item" key={item.id}><span>{item.title}</span>
              <button className="text-action" onClick={() => reviewIncident(item.id)}>Inspect</button></div>)}
          </details>}
        </section>}
        {tab === 'recovery' && <section className="screen">
          <div className="page-heading"><div><div className="eyebrow">DECISION SUPPORT</div><h1>Recovery plans</h1>
            <p>Move rooms, not class times. All hard constraints are checked before a plan can be approved.</p></div></div>
          <div className="recovery-selector">
            <div><label htmlFor="recovery-incident">SELECT DISRUPTION</label>
              <select id="recovery-incident" value={selectedId ?? ''} onChange={e => reviewIncident(Number(e.target.value))}>
                {incidents.filter(i => !automatedTest(i.title)).concat(incidents.filter(i => automatedTest(i.title)))
                  .map(i => <option value={i.id} key={i.id}>{i.title}</option>)}
              </select>
              {selectedIncident && <p>{kindName[selectedIncident.kind]} · {formatWindow(selectedIncident.start_at, selectedIncident.end_at)}</p>}
            </div>
            <button className="button primary" disabled={!isAdmin || busy || impactLoading || impactFailed || !impacts.length}
              onClick={() => void makePlans()}>{busy ? 'Working…' : 'Find available rooms'}</button>
          </div>
          {!isAdmin && <div className="helper-band">
            {isGuest ? 'Explore available recovery decisions in read-only mode. Sign in as administrator to generate or approve new plans.'
              : 'Staff accounts are read-only. An administrator must approve schedule changes.'}</div>}
          <div className="workflow-steps"><span className="step active"><i>1</i> Review affected classes</span>
            <span className="step-line"/><span className="step"><i>2</i> Compare options</span>
            <span className="step-line"/><span className="step"><i>3</i> Approve change</span></div>
          <div className="content-surface impact-surface">
            <div className="section-title"><div><h2>Classes that need a new room</h2>
              <p>The engine checks which requirements are actually affected, not merely which rooms are nearby.</p></div>
              <span className="small-count">{impactLoading ? 'Checking…' : impactFailed ? 'Unavailable' : impacts.length + ' affected'}</span></div>
            {impactLoading ? <div className="empty-panel" role="status">Checking affected classes and saved recovery plans…</div>
              : impactFailed ? <div className="empty-panel">Recovery information could not be loaded. Please select this incident again or refresh the page.</div>
              : impacts.length ? impacts.map(item => <div className="impact-row" key={item.session_id}>
              <div className="impact-number">{item.code}</div>
              <div className="impact-main"><strong>{item.title}</strong><small>{item.original_room} · {timeAtCampus(item.start_at)}–{timeAtCampus(item.end_at)}</small></div>
              <div className="impact-reason">{item.reason}</div>
            </div>) : <div className="empty-panel">No classes currently need reassignment for this incident. It may already have been recovered.</div>}
          </div>
          <div className="section-title results-heading"><div><h2>Room alternatives</h2>
            <p>Only feasible plans covering every affected class can be approved.</p></div>
            <span className="small-count">{impactLoading ? 'Loading…' : impactFailed ? 'Unavailable' : plans.length + ' saved plans'}</span></div>
          {planMessage && <div className={'result-note ' + (plans.length ? 'success' : '')}>{planMessage}</div>}
          {impactLoading ? <div className="content-surface empty-results"><p role="status">Loading saved recovery plans…</p></div>
            : impactFailed ? <div className="content-surface empty-results"><p>Could not load saved recovery plans. Please try again.</p></div>
            : plans.length ? <div className="plan-list">
            {plans.map((plan, index) => <article key={plan.id} className={'plan-surface ' + (index === 0 ? 'preferred' : '')}>
              <div className="plan-top">
                <div><small className="eyebrow">{index === 0 ? 'HIGHEST RANKED OPTION' : 'ALTERNATIVE ' + (index + 1)}</small>
                  <h3>Plan #{plan.id}</h3></div>
                <div className="plan-top-right"><span className={'status-chip ' + (plan.status === 'approved' ? 'green' : '')}>{plan.status}</span>
                  <span className="plan-score">{plan.score} <small>preference points</small></span></div>
              </div>
              <div className="change-table">
                <div className="change-header"><span>CLASS</span><span>BEFORE</span><span>AFTER</span></div>
                {plan.details.explanations.map(change => <div className="change-row" key={change.session_id}>
                  <strong>{change.code}</strong>
                  <span>{change.old_room}</span>
                  <b>{change.new_room}</b>
                </div>)}
              </div>
              <div className="plan-bottom">
                <details><summary>Why these rooms? View scores and rejections</summary>
                  {plan.details.explanations.map(change => <div className="explanation" key={change.session_id}>
                    <strong>{change.code}: {change.new_room} · {change.score.total} points</strong>
                    <p>Same building: {change.score.same_building} · Capacity fit: {change.score.unused_capacity} · Resource fit: {change.score.excess_equipment}</p>
                    {(plan.details.rejected[String(change.session_id)] ?? []).map(r => <p key={r.room_id}>
                      <b>{r.room}</b>: {r.reasons.join('; ')}</p>)}
                  </div>)}</details>
                <button className="button primary" disabled={!isAdmin || busy || plan.status !== 'pending'}
                  onClick={() => void approve(plan.id)}>{plan.status === 'approved' ? 'Approved ✓' :
                    plan.status === 'pending' ? 'Approve this plan' : 'Plan ' + plan.status}</button>
              </div>
            </article>)}
          </div> : <div className="content-surface empty-results"><p>{impacts.length ? 'No plans stored. Use “Find available rooms” to check the current options.' : 'Choose an active disruption to inspect its impact.'}</p></div>}
          {!plans.length && planMessage && impacts.length > 0 && <div className="content-surface">
            <div className="section-title"><h2>Why alternatives were rejected</h2></div>
            {impacts.map(item => <div className="rejection-group" key={item.session_id}>
              <strong>{item.code} · {item.title}</strong>
              {(rejected[String(item.session_id)] ?? []).map(option => <p key={option.room_id}>
                <b>{option.room}</b>: {option.reasons.join('; ')}</p>)}
            </div>)}
          </div>}
        </section>}
        {tab === 'rooms' && <section className="screen">
          <div className="page-heading"><div><div className="eyebrow">FACILITIES</div><h1>Rooms & resources</h1>
            <p>Review capacity and equipment before moving a class.</p></div></div>
          <div className="content-surface room-list">
            <div className="section-title"><h2>Space inventory</h2><span className="small-count">{rooms.length} rooms</span></div>
            <div className="table-overflow"><table><thead><tr><th>ROOM</th><th>BUILDING</th><th>CAPACITY</th><th>NETWORK</th><th>EQUIPMENT</th></tr></thead>
              <tbody>{rooms.map(room => <tr key={room.id}>
                <td><strong>{room.code}</strong></td><td>{buildingById(room.building_id)?.name}</td>
                <td>{room.capacity} people</td><td>{room.network ? 'Available' : 'Not installed'}</td>
                <td>{Object.entries(room.equipment).map(([name, number]) => name + ' × ' + number).join(', ') || '—'}</td>
              </tr>)}</tbody></table></div>
          </div>
        </section>}
        {tab === 'audit' && <section className="screen">
          <div className="page-heading"><div><div className="eyebrow">ACCOUNTABILITY</div><h1>Activity</h1>
            <p>Record of disruptions, recovery decisions and schedule approvals.</p></div></div>
          <div className="content-surface activity-list">
            <div className="section-title"><h2>Recent actions</h2><span className="small-count">{audit.length} records</span></div>
            {audit.map(event => <div className="activity-item" key={event.id}>
              <div className="activity-dot"/>
              <div><strong>{labelForAudit(event.action)}</strong><p>{formatWindow(event.occurred_at, event.occurred_at)}
                {event.incident_id ? ' · Incident #' + event.incident_id : ''}
                {event.proposal_id ? ' · Plan #' + event.proposal_id : ''}</p>
                <details><summary>View stored details</summary><pre>{JSON.stringify(event.details, null, 2)}</pre></details></div>
            </div>)}
            {!audit.length && <div className="empty-panel">No recorded activity yet.</div>}
          </div>
        </section>}
        <footer className="site-footer"><span>Campus Continuity · University scheduling demonstration</span>
          <span>All times in Malaysia (MYT) · Synthetic data</span></footer>
      </main>
    </div>
    {focus && <div className="modal-backdrop" onClick={() => setFocus(null)}>
      <div className="session-dialog" role="dialog" aria-modal="true" aria-label="Class details"
        onClick={event => event.stopPropagation()}>
        <button className="modal-close" aria-label="Close class details" onClick={() => setFocus(null)}>×</button>
        <span className="eyebrow">CLASS DETAILS</span><h2>{focus.title}</h2><p className="subdued">{focus.code}</p>
        <dl className="detail-grid"><div><dt>Scheduled time</dt><dd>{formatWindow(focus.start_at, focus.end_at)}</dd></div>
          <div><dt>Current room</dt><dd>{focus.room}</dd></div>
          <div><dt>Students</dt><dd>{focus.attendees}</dd></div>
          <div><dt>Network required</dt><dd>{focus.needs_network ? 'Yes' : 'No'}</dd></div>
          {focus.recovered && <div><dt>Previous room</dt><dd>{focus.original_room}</dd></div>}
        </dl>
        {focus.recovered && <div className="helper-band">This class was reassigned by an approved recovery plan.</div>}
        <button className="button secondary" onClick={() => setFocus(null)}>Close</button>
      </div>
    </div>}
  </div>;
}
