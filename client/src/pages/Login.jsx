import { useState } from "react";
import { Link, useNavigate, Navigate } from "react-router-dom";
import { api, errMsg } from "../api";
import { useAuth } from "../auth";

export default function Login() {
  const { user, signIn } = useAuth();
  const nav = useNavigate();
  const [f, setF] = useState({ email: "", password: "" });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  if (user) return <Navigate to="/" replace />;

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const { data } = await api.post("/auth/login", f);
      signIn(data);
      nav("/");
    } catch (ex) {
      setErr(errMsg(ex));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="card narrow">
      <img src="/heart-plus.svg" alt="" />
      <h1>Heart Puzzle Challenge</h1>
      <form onSubmit={submit}>
        <label>
          Email
          <input
            type="email"
            required
            autoComplete="email"
            value={f.email}
            onChange={(e) => setF({ ...f, email: e.target.value })}
          />
        </label>
        <label>
          Password
          <input
            type="password"
            required
            autoComplete="current-password"
            value={f.password}
            onChange={(e) => setF({ ...f, password: e.target.value })}
          />
        </label>
        {err && <p className="error">{err}</p>}
        <button className="btn" disabled={busy}>
          {busy ? "Signing in…" : "Log in"}
        </button>
      </form>
      <p className="muted">
        New here? <Link to="/register">Register</Link>
      </p>
    </main>
  );
}
