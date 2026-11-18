import { useCallback, useEffect, useState } from 'react';
import {
  approvePlan, clearToken, createIncident, generatePlans, getAudit, getBuildings,
  getImpacts, getIncidents, getOverview, getPlans, getRooms, getSessions, getToken, login
} from './api';
import type { AuditEvent, Building, ClassSession, Impact, Incident, Overview, Proposal, Rejection, Room, Tab } from './types';

const navigation: { tab: Tab; icon: string; title: string }[] = [
  { tab: 'overview', icon: '◫', title: 'Dashboard' },
  { tab: 'schedule', icon: '▦', title: 'Schedule' },
  { tab: 'rooms', icon: '⌂', title: 'Resources' },
  { tab: 'incidents', icon: '⚑', title: 'Disruptions' },
  { tab: 'recovery', icon: '↗', title: 'Recovery planning' },
  { tab: 'audit', icon: '☷', title: 'Audit history' }
];
const fmt = (value: string) => new Intl.DateTimeFormat('en-MY', {
  timeZone: 'Asia/Kuala_Lumpur', month: 'short', day: 'numeric', year: 'numeric',
  hour: '2-digit', minute: '2-digit', hour12: true
}).format(new Date(value));
const kindLabel: Record<Incident['kind'], string> = {
  closure: 'Room closure', network: 'Network outage', equipment: 'Equipment unavailable'
};

export default function App() {
  const [tab, setTab] = useState<Tab>('overview');
  const [overview, setOverview] = useState<Overview | null>(null);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [sessions, setSessions] = useState<ClassSession[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [impacts, setImpacts] = useState<Impact[]>([]);
  const [plans, setPlans] = useState<Proposal[]>([]);
  const [planMessage, setPlanMessage] = useState('');
  const [rejectedOptions, setRejectedOptions] = useState<Record<string, Rejection[]>>({});
  const [loggedIn, setLoggedIn] = useState(Boolean(getToken()));
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [draft, setDraft] = useState({
    title: '', kind: 'closure' as Incident['kind'], location: 'room',
    room_id: '', building_id: '', equipment_kind: 'projector', quantity_lost: 1,
    start_at: '2027-02-17T08:00', end_at: '2027-02-17T12:00'
  });
  const roomName = (id: number | null) => rooms.find(r => r.id === id)?.code ?? '—';
  const buildingName = (id: number | null) => buildings.find(b => b.id === id)?.name ?? '—';
  const selected = incidents.find(i => i.id === selectedId);

  const refresh = useCallback(async () => {
    try {
      const [o, b, r, s, i, a] = await Promise.all([
        getOverview(), getBuildings(), getRooms(), getSessions(), getIncidents(), getAudit()
      ]);
      setOverview(o); setBuildings(b); setRooms(r); setSessions(s); setIncidents(i); setAudit(a);
      setSelectedId(prev => prev ?? (i.length ? i[i.length - 1].id : null));
    } catch (e) { setError('Cannot load application data: ' + String(e)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (!selectedId) { setImpacts([]); setPlans([]); setRejectedOptions({}); return; }
    let active = true;
    Promise.all([getImpacts(selectedId), getPlans(selectedId)]).then(([impact, options]) => {
      if (active) { setImpacts(impact); setPlans(options); setPlanMessage(''); setRejectedOptions(options[0]?.details.rejected ?? {}); }
    }).catch(e => { if (active) setError(String(e)); });
    return () => { active = false; };
  }, [selectedId]);

  async function signIn(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      await login(username.trim(), password);
      setLoggedIn(true); setPassword(''); setNotice('Administrator authenticated. Recovery actions are available.');
    } catch (err) { setError(String(err)); }
    finally { setBusy(false); }
  }
  function signOut() {
    clearToken(); setLoggedIn(false); setNotice('Signed out. Read-only data remains visible.');
  }
  async function generate() {
    if (!selectedId || !loggedIn) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await generatePlans(selectedId);
      setPlans(result.plans); setImpacts(result.impacts); setPlanMessage(result.message);
      setRejectedOptions(result.rejected);
      setNotice(result.plans.length
        ? result.plans.length + ' complete recovery plan(s) generated and stored.'
        : 'No complete plan could be generated. Review rejection reasons below.');
      await refresh();
    } catch (err) { setError(String(err)); }
    finally { setBusy(false); }
  }
  async function approve(id: number) {
    if (!loggedIn) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await approvePlan(id);
      setNotice('Plan #' + id + ' approved: ' + result.changes.length + ' room assignment(s) updated atomically.');
      await refresh();
      if (selectedId) {
        setImpacts(await getImpacts(selectedId));
        setPlans(await getPlans(selectedId));
      }
    } catch (err) { setError('Approval rejected: ' + String(err)); }
    finally { setBusy(false); }
  }
  async function submitIncident(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      if (new Date(draft.start_at) >= new Date(draft.end_at)) {
        throw new Error('End time must be later than start time');
      }
      const equipment = draft.kind === 'equipment';
      const location = equipment ? 'room' : draft.location;
      const payload = {
        title: draft.title, kind: draft.kind,
        room_id: location === 'room' ? Number(draft.room_id) || null : null,
        building_id: location === 'building' ? Number(draft.building_id) || null : null,
        equipment_kind: equipment ? draft.equipment_kind : null,
        quantity_lost: equipment ? Number(draft.quantity_lost) : null,
        start_at: new Date(draft.start_at).toISOString(),
        end_at: new Date(draft.end_at).toISOString()
      };
      const item = await createIncident(payload);
      setNotice('Disruption recorded. You can now inspect its impact and generate recovery plans.');
      setShowForm(false); await refresh(); setSelectedId(item.id); setTab('recovery');
    } catch (err) { setError(String(err)); }
    finally { setBusy(false); }
  }
  const statusPill = (status: string) => (
    <span className={'pill ' + (status === 'approved' ? 'good' : status === 'active' ? 'alert' : '')}>{status}</span>
  );
  const incidentTable = (items: Incident[]) => (
    <div className="table-scroll"><table>
      <thead><tr><th>Disruption</th><th>Type</th><th>Target</th><th>Window (MYT)</th><th>Status</th><th></th></tr></thead>
      <tbody>{items.map(i => <tr key={i.id}>
        <td><b>{i.title}</b><small>INC-{String(i.id).padStart(3, '0')}</small></td>
        <td>{kindLabel[i.kind]}</td><td>{i.room_id ? roomName(i.room_id) : buildingName(i.building_id)}</td>
        <td>{fmt(i.start_at)}<small>to {fmt(i.end_at)}</small></td><td>{statusPill(i.status)}</td>
        <td><button className="text-button" onClick={() => {setSelectedId(i.id);setTab('recovery');}}>Inspect →</button></td>
      </tr>)}</tbody>
    </table>{!items.length && <div className="empty">No incidents recorded.</div>}</div>
  );
  return <div className="app">
    <aside className="sidebar">
      <div className="logo"><span className="logo-mark">C<span>↗</span></span>
        <div><strong>CONTINUITY</strong><small>CAMPUS OPERATIONS</small></div></div>
      <div className="nav-label">WORKSPACE</div>
      <nav aria-label="Main navigation">{navigation.map(n =>
        <button key={n.tab} className={'nav-item ' + (tab === n.tab ? 'selected' : '')}
          onClick={() => setTab(n.tab)}><span className="nav-icon">{n.icon}</span>{n.title}</button>)}</nav>
      <div className="sidebar-bottom"><span className="system-dot"></span>
        <div><b>LOCAL DEMO</b><small>Constraint-based recovery · v1.0</small></div></div>
    </aside>
    <main className="main">
      <header className="topbar">
        <div><div className="eyebrow">ACADEMIC OPERATIONS / CONTROL CENTRE</div>
          <h1>Campus Continuity Engine</h1><p>Resolve disruptions before they become scheduling conflicts.</p></div>
        <div className="auth">
          {loggedIn ? <div className="signed-in"><span className="avatar">A</span><div><b>Administrator</b><small>Authorized access</small></div>
            <button className="subtle" onClick={signOut}>Sign out</button></div>
            : <form onSubmit={signIn} className="login-form">
              <input aria-label="Admin username" placeholder="Admin username" value={username}
                onChange={e => setUsername(e.target.value)} required/>
              <input aria-label="Password" placeholder="Password" type="password" value={password}
                onChange={e => setPassword(e.target.value)} required/>
              <button disabled={busy} className="primary" type="submit">Sign in</button></form>}
        </div>
      </header>
      {error && <div role="alert" className="banner error"><b>Action needs attention</b><span>{error}</span><button onClick={() => setError('')}>×</button></div>}
      {notice && <div role="status" className="banner success"><span>{notice}</span><button onClick={() => setNotice('')}>×</button></div>}
      {loading && <div className="loading">Loading live campus data…</div>}
      {tab === 'overview' && <section>
        <div className="section-heading"><div><div className="kicker">OPERATIONS OVERVIEW</div><h2>Campus at a glance</h2>
          <p>A clear view of impact, available recovery decisions, and operational progress.</p></div>
          <button className="secondary" onClick={() => void refresh()} disabled={busy}>↻ Refresh data</button></div>
        <div className="metrics">
          {[
            ['Active incidents', overview?.active_disruptions ?? '—', 'Open operational disruptions', 'orange'],
            ['Affected sessions', overview?.affected_sessions ?? '—', 'Classes requiring review', 'red'],
            ['Pending proposals', overview?.pending_proposals ?? '—', 'Ready for administrator decision', 'blue'],
            ['Approved recoveries', overview?.approved_recoveries ?? '—', 'Schedule corrections recorded', 'green'],
          ].map(([label, num, caption, tone]) => <div className={'metric ' + tone} key={label}>
            <span>{label}</span><strong>{num}</strong><small>{caption}</small></div>)}</div>
        <div className="panel"><div className="panel-header"><div><h3>Incident queue</h3>
          <p>Each disruption is linked to stored sessions and resources.</p></div>
          <button className="text-button" onClick={() => setTab('incidents')}>All disruptions →</button></div>
          {incidentTable(incidents.slice(0, 5))}</div>
        <div className="info-strip"><b>How recovery works</b><span>Detect impact → Validate alternatives → Rank complete plans → Approve atomically → Audit every change</span></div>
      </section>}
      {tab === 'schedule' && <section>
        <div className="section-heading"><div><div className="kicker">RESOURCE PLANNING</div><h2>Class schedule</h2>
          <p>{sessions.length} dated sessions. Every recovery preserves the original class time.</p></div></div>
        <div className="panel"><div className="table-scroll"><table>
          <thead><tr><th>Course / Session</th><th>Campus date & time (MYT)</th><th>Participants</th><th>Assigned room</th><th>Network</th><th>State</th></tr></thead>
          <tbody>{sessions.map(s => <tr key={s.id}>
            <td><b>{s.title}</b><small>{s.code}</small></td>
            <td>{fmt(s.start_at)}<small>Ends {fmt(s.end_at)}</small></td><td>{s.attendees}</td>
            <td><b>{s.room}</b>{s.recovered && <small>Previously {s.original_room}</small>}</td>
            <td>{s.needs_network ? 'Required' : 'Not required'}</td>
            <td>{s.recovered ? <span className="pill good">Recovered</span> : <span className="pill">Scheduled</span>}</td>
          </tr>)}</tbody>
        </table></div></div></section>}
      {tab === 'rooms' && <section><div className="section-heading"><div><div className="kicker">CAMPUS ASSETS</div><h2>Rooms & capabilities</h2>
        <p>Capacity, available equipment inventory, and network capability inform every recommendation.</p></div></div>
        <div className="rooms-grid">{rooms.map(room => <article className="room-card" key={room.id}>
          <div className="room-head"><b>{room.code}</b><span className="pill">{buildingName(room.building_id)}</span></div>
          <strong>{room.capacity} seats</strong><p>Network: {room.network ? '✓ Available' : 'Not installed'}</p>
          <div className="equipment">{Object.entries(room.equipment).map(([kind, count]) =>
            <span key={kind}>{kind} × {count}</span>)}</div>
        </article>)}</div></section>}
      {tab === 'incidents' && <section>
        <div className="section-heading"><div><div className="kicker">INCIDENT MANAGEMENT</div><h2>Disruptions</h2>
          <p>Record a problem once. The impact engine determines which classes are truly affected.</p></div>
          <button className="primary" disabled={!loggedIn || busy} onClick={() => setShowForm(!showForm)}>
            {showForm ? 'Close form' : '+ Report disruption'}</button></div>
        {!loggedIn && <div className="info-strip">Administrator sign-in is required to create incidents or approve recovery plans.</div>}
        {showForm && <form className="panel incident-form" onSubmit={submitIncident}>
          <h3>New operational disruption</h3>
          <div className="form-grid">
            <label className="wide">Incident title<input value={draft.title} minLength={4} maxLength={180} required
              onChange={e => setDraft({...draft, title: e.target.value})} placeholder="e.g. Network switch outage"/></label>
            <label>Disruption type<select value={draft.kind} onChange={e => setDraft({...draft, kind: e.target.value as Incident['kind']})}>
              <option value="closure">Room / building closure</option><option value="network">Network outage</option>
              <option value="equipment">Equipment unavailability</option></select></label>
            {draft.kind !== 'equipment' && <label>Target type<select value={draft.location}
              onChange={e => setDraft({...draft, location:e.target.value})}>
              <option value="room">Room</option><option value="building">Building</option></select></label>}
            {(draft.kind === 'equipment' || draft.location === 'room') ?
              <label>Target room<select required value={draft.room_id} onChange={e => setDraft({...draft,room_id:e.target.value})}>
                <option value="">Choose a room</option>{rooms.map(r => <option key={r.id} value={r.id}>{r.code}</option>)}</select></label> :
              <label>Target building<select required value={draft.building_id} onChange={e => setDraft({...draft,building_id:e.target.value})}>
                <option value="">Choose a building</option>{buildings.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>}
            {draft.kind === 'equipment' && <>
              <label>Equipment type<input required value={draft.equipment_kind}
                onChange={e => setDraft({...draft,equipment_kind:e.target.value})}/></label>
              <label>Quantity lost<input type="number" min="1" required value={draft.quantity_lost}
                onChange={e => setDraft({...draft,quantity_lost:Number(e.target.value)})}/></label></>}
            <label>Start (campus local time)<input type="datetime-local" required value={draft.start_at}
              onChange={e => setDraft({...draft,start_at:e.target.value})}/></label>
            <label>End (campus local time)<input type="datetime-local" required value={draft.end_at}
              onChange={e => setDraft({...draft,end_at:e.target.value})}/></label>
          </div><div className="form-actions"><button disabled={busy || !loggedIn} className="primary">Save disruption</button></div>
        </form>}
        <div className="panel"><div className="panel-header"><h3>All incidents</h3><span className="pill">{incidents.length} recorded</span></div>
          {incidentTable(incidents)}</div></section>}
      {tab === 'recovery' && <section>
        <div className="section-heading"><div><div className="kicker">DECISION SUPPORT</div><h2>Recovery planning</h2>
          <p>Evaluate hard constraints, compare scored plans, and apply a safe schedule correction.</p></div></div>
        <div className="panel selection-panel"><div><label htmlFor="incident-choice">Select a disruption</label>
          <select id="incident-choice" value={selectedId ?? ''} onChange={e => setSelectedId(Number(e.target.value))}>
            {incidents.slice().sort((a,b) => a.id - b.id).map(i => <option key={i.id} value={i.id}>{i.title}</option>)}</select></div>
          <button className="primary" onClick={() => void generate()} disabled={busy || !loggedIn || !selected || !impacts.length}>
            {busy ? 'Processing…' : '↗ Generate recovery plans'}</button></div>
        {!loggedIn && <div className="info-strip">Sign in as administrator to generate or approve a plan. Impact findings remain visible.</div>}
        {selected && <div className="incident-summary">
          <span className="pill alert">{kindLabel[selected.kind]}</span>
          <b>{selected.room_id ? roomName(selected.room_id) : buildingName(selected.building_id)}</b>
          <span>{fmt(selected.start_at)} — {fmt(selected.end_at)}</span></div>}
        <div className="panel"><div className="panel-header"><div><h3>Verified impact</h3>
          <p>Only sessions whose functional requirements are affected are included.</p></div>
          <span className="count">{impacts.length} affected</span></div>
          {!impacts.length ? <div className="empty">No currently affected sessions. The incident may already have been recovered.</div> :
            <div className="impact-list">{impacts.map(i => <div className="impact-item" key={i.session_id}>
              <div><strong>{i.title}</strong><small>{i.code} · {i.original_room} · {fmt(i.start_at)}</small></div>
              <span>{i.reason}</span></div>)}</div>}</div>
        <div className="panel"><div className="panel-header"><div><h3>Ranked recovery alternatives</h3>
          <p>Only complete multi-session assignments are presented as feasible plans.</p></div>
          <span className="pill">{plans.length} stored</span></div>
          {planMessage && <div className="inline-message">{planMessage}</div>}
          {!plans.length ? <div className="empty">No plans stored. Generate alternatives for an active incident.</div> :
          <div className="plan-grid">{plans.map((p, idx) =>
            <article key={p.id} className={'plan-card ' + (p.status === 'approved' ? 'approved-plan' : '')}>
              <div className="plan-title"><div><span className="eyebrow">OPTION {idx+1} · PLAN #{p.id}</span>
                <h4>{idx === 0 ? 'Recommended alternative' : 'Feasible alternative'}</h4></div>
                {statusPill(p.status)}</div>
              <div className="score-line"><strong>{p.score}</strong><span>total preference score</span></div>
              <div className="assignment-list">{p.details.explanations.map(a =>
                <div className="assignment" key={a.session_id}><div><b>{a.code}</b>
                  <small>{a.old_room} → <strong>{a.new_room}</strong></small></div>
                  <span className="score-chip">+{a.score.total}</span></div>)}</div>
              <details><summary>Score breakdown & rejected rooms</summary>
                {p.details.explanations.map(a => <div className="rejection-block" key={a.session_id}>
                  <b>{a.code}: same building {a.score.same_building >= 0 ? '+' : ''}{a.score.same_building},
                    spare capacity {a.score.unused_capacity}, excess equipment {a.score.excess_equipment}</b>
                  {(p.details.rejected[String(a.session_id)] ?? []).map(r =>
                    <p key={r.room_id}><strong>{r.room}</strong>: {r.reasons.join('; ')}</p>)}
                </div>)}</details>
              <button className="primary full" onClick={() => void approve(p.id)}
                disabled={busy || !loggedIn || p.status !== 'pending'}>
                {p.status === 'approved' ? '✓ Recovery approved' : p.status === 'pending' ? 'Approve & update schedule' : 'Plan ' + p.status}
              </button>
            </article>)}</div>}</div>
        {plans.length === 0 && impacts.length > 0 && planMessage && <div className="panel">
          <div className="panel-header"><div><h3>Why no complete plan exists</h3>
            <p>No partial assignment will be applied. Every hard-constraint rejection is shown below.</p></div></div>
          {impacts.map(impact => <div className="rejection-block no-solution-reasons" key={impact.session_id}>
            <strong>{impact.code} · {impact.title}</strong>
            {(rejectedOptions[String(impact.session_id)] ?? []).map(option => <p key={option.room_id}>
              <b>{option.room}</b>: {option.reasons.join('; ')}
            </p>)}
            {!(rejectedOptions[String(impact.session_id)] ?? []).length &&
              <p>No compatible replacement was found for this session.</p>}
          </div>)}
        </div>}
      </section>}
      {tab === 'audit' && <section><div className="section-heading"><div><div className="kicker">ACCOUNTABILITY</div><h2>Decision audit trail</h2>
        <p>Trace incident submissions, plan generation and approved room changes.</p></div></div>
        <div className="panel"><div className="table-scroll"><table>
          <thead><tr><th>Event</th><th>Time (MYT)</th><th>Incident</th><th>Proposal</th><th>Recorded details</th></tr></thead>
          <tbody>{audit.map(a => <tr key={a.id}><td><b>{a.action.replaceAll('_',' ')}</b></td>
            <td>{fmt(a.occurred_at)}</td><td>{a.incident_id ?? '—'}</td>
            <td>{a.proposal_id ?? '—'}</td>
            <td><code>{JSON.stringify(a.details).slice(0, 220)}</code></td></tr>)}</tbody>
        </table></div>{!audit.length && <div className="empty">No events yet.</div>}</div></section>}
      <footer><span>Campus Continuity Engine · Synthetic university demonstration</span><span>All times displayed in Asia/Kuala_Lumpur</span></footer>
    </main>
  </div>;
}
