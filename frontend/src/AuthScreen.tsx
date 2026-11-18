import { useState, type FormEvent } from 'react';
import { login, register, type Account } from './api';

type Props = {
  onAuthenticated: (account: Account) => void;
  onExplore: () => void;
};

export default function AuthScreen({ onAuthenticated, onExplore }: Props) {
  const [screen, setScreen] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  function changeScreen(next: 'login' | 'register') {
    setScreen(next);
    setError('');
    setPassword('');
    setConfirm('');
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    if (screen === 'register' && password !== confirm) {
      setError('Your passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      const account = screen === 'register'
        ? await register(email.trim(), password)
        : await login(email.trim(), password);
      onAuthenticated(account);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to sign in.');
    } finally {
      setBusy(false);
    }
  }

  return <div className="auth-page">
    <div className="auth-layout">
      <div className="auth-information">
        <div className="identity large-identity">
          <span className="identity-mark">C</span>
          <div className="identity-title"><strong>Campus Continuity</strong><small>ACADEMIC OPERATIONS</small></div>
        </div>
        <div className="auth-intro">
          <span className="eyebrow">THE CAMPUS OPERATIONS WORKSPACE</span>
          <h1>Keep classes moving, even when rooms cannot.</h1>
          <p>See your teaching schedule, assess disruptions, and find a clear path to recovery—without double-booking classrooms.</p>
        </div>
        <div className="auth-mini-calendar" aria-hidden="true">
          <div className="mini-top"><b>Room schedule</b><span>Tuesday, 9 February</span></div>
          <div className="mini-grid">
            <div className="mini-label">09:00</div><div className="mini-booking blue"><b>Operating Systems</b><small>Computer Lab 1</small></div><div className="mini-slot"/>
            <div className="mini-label">11:00</div><div className="mini-slot"/><div className="mini-booking mint"><b>Networking Lab</b><small>Computer Lab 2</small></div>
            <div className="mini-label">13:00</div><div className="mini-slot"/><div className="mini-slot"/>
          </div>
          <div className="mini-foot"><span className="status-dot"/><span>Schedule checked against live room availability</span></div>
        </div>
        <div className="auth-information-foot">Portfolio demonstration · Synthetic university records</div>
      </div>
      <section className="auth-panel" aria-labelledby="auth-title">
        <div className="auth-panel-top"><span className="auth-tag">LOCAL CAMPUS DEMO</span></div>
        <div className="auth-panel-inner">
          <div className="auth-heading">
            <h2 id="auth-title">{screen === 'login' ? 'Welcome back' : 'Create a staff account'}</h2>
            <p>{screen === 'login'
              ? 'Sign in to your campus workspace.'
              : 'Staff accounts can explore schedules and recovery decisions. Administrator approval remains restricted.'}</p>
          </div>
          <form className="auth-fields" onSubmit={submit}>
            <label htmlFor="account-id">{screen === 'login' ? 'Email or administrator username' : 'Work email'}</label>
            <input id="account-id" autoComplete="username"
              type={screen === 'register' ? 'email' : 'text'}
              required placeholder={screen === 'register' ? 'name@university.edu' : 'Email or admin username'}
              value={email} onChange={e => setEmail(e.target.value)} />
            <label htmlFor="account-password">Password</label>
            <input id="account-password" autoComplete={screen === 'register' ? 'new-password' : 'current-password'}
              type="password" required minLength={screen === 'register' ? 12 : undefined}
              placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} />
            {screen === 'register' && <>
              <p className="field-hint">At least 12 characters. Staff accounts cannot approve schedule changes.</p>
              <label htmlFor="account-confirm">Confirm password</label>
              <input id="account-confirm" type="password" autoComplete="new-password"
                placeholder="Confirm password" required value={confirm} onChange={e => setConfirm(e.target.value)} />
            </>}
            {error && <div className="form-error" role="alert">{error}</div>}
            <button className="button primary auth-submit" type="submit" disabled={busy}>
              {busy ? 'Please wait…' : screen === 'login' ? 'Sign in' : 'Create account'}
            </button>
          </form>
          <p className="auth-toggle">{screen === 'login' ? 'New to the workspace?' : 'Already registered?'}{' '}
            <button className="text-action" type="button"
              onClick={() => changeScreen(screen === 'login' ? 'register' : 'login')}>
              {screen === 'login' ? 'Create a staff account' : 'Sign in'}
            </button>
          </p>
          <div className="auth-separator"><span>or</span></div>
          <button className="button secondary guest-button" onClick={onExplore}>
            Explore sample timetable <span>→</span>
          </button>
          <p className="guest-note">Explore without an account. Changes to the schedule require an administrator.</p>
        </div>
        <div className="auth-panel-foot">For the seeded administrator account, use the username and password configured in your local .env file.</div>
      </section>
    </div>
  </div>;
}
