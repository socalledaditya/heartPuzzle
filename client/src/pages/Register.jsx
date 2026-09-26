import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, errMsg } from '../api';
import { useAuth } from '../auth';

export default function Register() {
  const nav = useNavigate();
  const { signIn } = useAuth();
  const [f, setF] = useState({ name: '', email: '', rollNo: '', password: '', participantType: 'student' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const isStudent = f.participantType === 'student';

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      const { data } = await api.post('/auth/register', { ...f, rollNo: isStudent ? f.rollNo : '' });
      signIn(data);
      nav('/');
    } catch (ex) { setErr(errMsg(ex)); } finally { setBusy(false); }
  }

  return (
    <main className="card narrow">
      <h1>Register</h1>
      <form onSubmit={submit}>
        <label>I am registering as
          <div className="segmented">
            <button type="button" className={isStudent ? 'on' : ''} onClick={() => setF({ ...f, participantType: 'student' })}>Student</button>
            <button type="button" className={!isStudent ? 'on' : ''} onClick={() => setF({ ...f, participantType: 'faculty' })}>Faculty</button>
          </div>
        </label>
        <label>Full name<input required minLength={2} autoComplete="name" value={f.name} onChange={set('name')} /></label>
        <label>College email<input type="email" required autoComplete="email" value={f.email} onChange={set('email')} /></label>
        {isStudent && (
          <label>Roll / Enrolment no.<input required value={f.rollNo} onChange={set('rollNo')} /></label>
        )}
        <label>Password (min 8)<input type="password" required minLength={8} autoComplete="new-password" value={f.password} onChange={set('password')} /></label>
        {err && <p className="error">{err}</p>}
        <button className="btn" disabled={busy}>{busy ? 'Creating account…' : 'Register'}</button>
      </form>
      <p className="muted">Already registered? <Link to="/login">Log in</Link></p>
    </main>
  );
}
