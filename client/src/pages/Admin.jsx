import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, download, errMsg, fmt } from "../api";
import { useAuth } from "../auth";
import { useGame } from "../useGame";
import { getSocket } from "../socket";
import Clock from "../components/Clock";
import Leaderboard from "../components/Leaderboard";

export default function Admin() {
  const { logout } = useAuth();
  const { state, getElapsed } = useGame();
  const [ov, setOv] = useState(null);
  const [topStudents, setTopStudents] = useState([]);
  const [topFaculty, setTopFaculty] = useState([]);
  const [stats, setStats] = useState({});
  const [online, setOnline] = useState(0);
  const [events, setEvents] = useState([]);
  const [eventId, setEventId] = useState(null);
  const [tab, setTab] = useState("live");
  const [err, setErr] = useState("");
  const load = useCallback((selectedId = eventId) =>
      api
        .get("/admin/overview", { params: selectedId ? { eventId: selectedId } : {} })
        .then((r) => {
          setOv(r.data);
          setTopStudents(r.data.topStudents);
          setTopFaculty(r.data.topFaculty);
          setStats(r.data.stats);
          setOnline(r.data.online);
        })
        .catch((e) => setErr(errMsg(e))),
    [eventId]);
  const loadEvents = useCallback(() => api.get("/admin/events").then((r) => setEvents(r.data)).catch((e) => setErr(errMsg(e))), []);

  useEffect(() => {
    load();
    loadEvents();
    if (eventId) return;
    const s = getSocket();
    const lb = (p) => {
      setTopStudents(p.topStudents);
      setTopFaculty(p.topFaculty);
      setStats(p.stats);
    };
    const pr = (p) => setOnline(p.online);
    s.on("leaderboard:update", lb);
    s.on("presence", pr);
    return () => {
      s.off("leaderboard:update", lb);
      s.off("presence", pr);
    };
  }, [load, loadEvents, eventId]);

  async function act(a) {
    const warn = {
      end: "End the game now for everyone?",
      reset:
        "Reset? A new round starts and the current leaderboard is cleared.",
    }[a];
    if (warn && !confirm(warn)) return;
    setErr("");
    try {
      await api.post(`/admin/game/${a}`);
      load();
      loadEvents();
    } catch (e) {
      setErr(errMsg(e));
    }
  }
  async function addMinute() {
    try {
      await api.put("/admin/settings", { durationSec: ov.state.durationSec + 60 });
    } catch (e) {
      setErr(errMsg(e));
    }
  }

  const viewState = ov?.state || state;
  const st = viewState?.status;
  const historical = !!eventId;
  const selectEvent = (id) => { setEventId(id); load(id); setTab("live"); };
  const removeEvent = async (e) => {
    if (!confirm(`Delete the saved event “${e.eventName}” and all of its results and certificates? This cannot be undone.`)) return;
    try { await api.delete(`/admin/events/${e.id}`); if (eventId === e.id) { setEventId(null); load(null); } loadEvents(); } catch (ex) { setErr(errMsg(ex)); }
  };
  return (
    <div className="page wide">
      <header className="bar">
        <b> Admin</b>
        <span className={`badge ${st}`}>{st || "…"}</span>
        <Clock state={viewState} getElapsed={historical ? () => viewState?.elapsedMs || 0 : getElapsed} />
        <span>
          <Link to="/admin/screen" target="_blank" className="link">
            Projector ↗
          </Link>{" "}
          ·{" "}
          <button className="link" onClick={logout}>
            Log out
          </button>
        </span>
      </header>

      <div className="controls">
        <button
          className="btn go"
          disabled={historical || st !== "idle"}
          onClick={() => act("start")}
        >
          ▶ Start
        </button>
        <button
          className="btn"
          disabled={historical || st !== "running"}
          onClick={() => act("pause")}
        >
          ⏸ Pause
        </button>
        <button
          className="btn"
          disabled={historical || st !== "paused"}
          onClick={() => act("resume")}
        >
          ⏯ Resume
        </button>
        <button
          className="btn ghost"
          disabled={historical || (st !== "running" && st !== "paused")}
          onClick={addMinute}
        >
          +1 min
        </button>
        <button
          className="btn danger"
          disabled={historical || (st !== "running" && st !== "paused")}
          onClick={() => act("end")}
        >
          ⏹ End
        </button>
        <button className="btn ghost" disabled={historical} onClick={() => act("reset")}>
          ↺ Reset
        </button>
      </div>
      {err && <p className="error">{err}</p>}

      <nav className="tabs">
        {["live", "players", "puzzles", "settings", "events"].map((t) => (
          <button
            key={t}
            className={tab === t ? "on" : ""}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </nav>

      {tab === "live" && (
        <>
          {historical && <p className="ok">Viewing saved event: {ov?.settings?.eventName}. Select Current event in Event history to return to live controls.</p>}
          <div className="stats">
            <Stat n={stats.registered} l="Registered" />
            <Stat n={online} l="Online now" />
            <Stat n={stats.participants} l="Playing" />
            <Stat n={stats.finished} l="Finished all" />
          </div>
          <div className="split">
            <div>
              <h3>Top 10 students</h3>
              <Leaderboard rows={topStudents} />
            </div>
            <div>
              <h3>Top 10 faculty</h3>
              <Leaderboard rows={topFaculty} />
            </div>
          </div>
        </>
      )}
      {tab === "players" && <Players eventId={eventId} readOnly={historical} />}
      {tab === "puzzles" && ov && <Puzzles initial={ov.puzzles} readOnly={historical} />}
      {tab === "settings" && ov && (
        <Settings key={eventId || "current"} initial={ov.settings} onSaved={load} eventId={eventId} readOnly={historical} />
      )}
      {tab === "events" && <EventHistory events={events} selectedId={eventId} onSelect={selectEvent} onCurrent={() => { setEventId(null); load(null); setTab("live"); }} onDelete={removeEvent} />}
    </div>
  );
}

const Stat = ({ n, l }) => (
  <div className="stat">
    <b>{n ?? 0}</b>
    <span>{l}</span>
  </div>
);

function Players({ eventId, readOnly }) {
  const [rows, setRows] = useState([]);
  const [q, setQ] = useState("");
  const load = useCallback(
    () =>
      api
        .get("/admin/users", { params: { search: q, ...(eventId ? { eventId } : {}) } })
        .then((r) => setRows(r.data)),
    [q, eventId],
  );
  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);
  const ban = async (u) => {
    await api.post(`/admin/users/${u.id}/ban`, { banned: !u.banned });
    load();
  };
  const del = async (u) => {
    if (confirm(`Delete ${u.name}?`)) {
      await api.delete(`/admin/users/${u.id}`);
      load();
    }
  };
  const students = rows.filter((u) => u.participantType === "student");
  const faculty = rows.filter((u) => u.participantType === "faculty");
  return (
    <>
      <input
        placeholder="Search name / roll no / email"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <PlayerTable
        title={`Students (${students.length})`}
        rows={students}
        onBan={ban}
        onDelete={del}
        showRoll
        readOnly={readOnly}
      />
      <PlayerTable
        title={`Faculty (${faculty.length})`}
        rows={faculty}
        onBan={ban}
        onDelete={del}
        readOnly={readOnly}
      />
    </>
  );
}

function PlayerTable({ title, rows, onBan, onDelete, showRoll, readOnly }) {
  return (
    <>
      <h3 style={{ marginTop: "2rem" }}>{title}</h3>
      <div className="scroll">
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              {showRoll && <th>Roll No</th>}
              <th>Solved</th>
              <th>Time</th>
              {!readOnly && <th />}
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.id} className={u.banned ? "banned" : ""}>
                <td>
                  {u.name}
                  <br />
                  <small className="muted">{u.email}</small>
                </td>
                {showRoll && <td>{u.rollNo || "—"}</td>}
                <td>{u.solved}</td>
                <td>{u.solved ? fmt(u.totalMs) : "-"}</td>
                {!readOnly && <td className="nowrap">
                  <button className="link" onClick={() => onBan(u)}>
                    {u.banned ? "Unban" : "Ban"}
                  </button>{" "}
                  ·{" "}
                  <button className="link red" onClick={() => onDelete(u)}>
                    Delete
                  </button>
                </td>}
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={showRoll ? 5 : 4} className="muted">
                  None yet
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Puzzles({ initial, readOnly }) {
  const [rows, setRows] = useState(initial);
  const [msg, setMsg] = useState("");
  const [draft, setDraft] = useState({ title: "", grid: 3, file: null });
  const fileData = (file) => new Promise((resolve, reject) => {
    const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsDataURL(file);
  });
  const save = async (p, patch) => {
    try {
      const { data } = await api.put(`/admin/puzzles/${p._id}`, patch);
      setRows((old) => old.map((x) => (x._id === p._id ? data : x)));
      setMsg("Puzzle saved ✔");
    } catch (e) { setMsg(errMsg(e)); }
  };
  const add = async (e) => {
    e.preventDefault();
    if (!draft.file) return setMsg("Choose an image to add a puzzle.");
    try {
      const imageData = await fileData(draft.file);
      const { data } = await api.post("/admin/puzzles", { title: draft.title, grid: Number(draft.grid), imageData });
      setRows((old) => [...old, data]);
      setDraft({ title: "", grid: 3, file: null });
      e.currentTarget.reset();
      setMsg("Puzzle added ✔");
    } catch (ex) { setMsg(errMsg(ex)); }
  };
  const replaceImage = async (p, file) => {
    if (!file) return;
    try { await save(p, { imageData: await fileData(file) }); } catch (e) { setMsg(errMsg(e)); }
  };
  const remove = async (p) => {
    if (!confirm(`Delete “${p.title}”? This cannot be undone.`)) return;
    try { await api.delete(`/admin/puzzles/${p._id}`); setRows((old) => old.filter((x) => x._id !== p._id)); setMsg("Puzzle deleted."); } catch (e) { setMsg(errMsg(e)); }
  };
  return (
    <>
      {!readOnly && <form className="card puzzle-create" onSubmit={add}>
        <h3>Add a puzzle</h3>
        <label>Title<input required value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="e.g. Cardiac anatomy" /></label>
        <label>Image file (PNG, JPEG, or WebP; 5 MB max)<input required type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => setDraft({ ...draft, file: e.target.files[0] || null })} /></label>
        <label>Grid size<select value={draft.grid} onChange={(e) => setDraft({ ...draft, grid: Number(e.target.value) })}>{[2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}×{n}</option>)}</select></label>
        <button className="btn">Add puzzle</button>
      </form>}
      {msg && <p className={msg.includes("✔") ? "ok" : "error"}>{msg}</p>}
      <div className="grid-cards">
      {rows.map((p) => (
        <div className="card mini" key={p._id || p.key}>
          <img src={p.image} alt={p.title} />
          {readOnly ? <b>{p.order}. {p.title}</b> : <label>Title<input value={p.title} onChange={(e) => setRows((old) => old.map((x) => x._id === p._id ? { ...x, title: e.target.value } : x))} onBlur={() => save(p, { title: p.title })} /></label>}
          <label className="row">
            <input
              type="checkbox"
              checked={p.enabled}
              disabled={readOnly}
              onChange={(e) => save(p, { enabled: e.target.checked })}
            />{" "}
            Enabled
          </label>
          <label className="row">
            Grid{" "}
            <select
              value={p.grid}
              disabled={readOnly}
              onChange={(e) => save(p, { grid: Number(e.target.value) })}
            >
              {[2, 3, 4, 5, 6].map((n) => (
                <option key={n} value={n}>
                  {n}×{n}
                </option>
              ))}
            </select>
          </label>
          {!readOnly && <>
            <label className="row">Order <input type="number" min="1" value={p.order} onChange={(e) => setRows((old) => old.map((x) => x._id === p._id ? { ...x, order: Number(e.target.value) } : x))} onBlur={() => save(p, { order: p.order })} /></label>
            <label>Replace image<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => replaceImage(p, e.target.files[0])} /></label>
            <button type="button" className="link red" onClick={() => remove(p)}>Delete puzzle</button>
          </>}
        </div>
      ))}
      </div>
      <p className="muted">
        Changes apply to puzzles issued from now on; players mid-puzzle keep
        their current one.
      </p>
    </>
  );
}

function Settings({ initial, onSaved, eventId, readOnly }) {
  const [f, setF] = useState({
    ...initial,
    minutes: Math.round(initial.durationSec / 60),
  });
  const [msg, setMsg] = useState("");
  const set = (k) => (e) =>
    setF({
      ...f,
      [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value,
    });
  async function save(e) {
    e.preventDefault();
    const { minutes, status, session, ...rest } = f;
    try {
      await api.put("/admin/settings", {
        ...rest,
        durationSec: Math.round(Number(minutes) * 60),
      });
      setMsg("Saved ✔");
      onSaved();
    } catch (ex) {
      setMsg(errMsg(ex));
    }
  }
  const dl = (u, n) =>
    download(`${u}${eventId ? `?eventId=${eventId}` : ""}`, n).catch(() => setMsg("Nothing to download yet"));
  if (readOnly) return (
    <div className="card">
      <h3>Saved event settings</h3>
      <p><b>{initial.eventName}</b><br />{initial.collegeName}<br />{initial.eventDate}</p>
      <h3>Results &amp; certificates</h3>
      <div className="row gap wrap">
        <button type="button" className="btn ghost" onClick={() => dl("/admin/certificates.zip", "certificates.zip")}>All certificates (ZIP)</button>
        <button type="button" className="btn ghost" onClick={() => dl("/admin/export.csv", "results.csv")}>Results CSV</button>
      </div>
      {msg && <p className="error">{msg}</p>}
    </div>
  );
  return (
    <form onSubmit={save} className="card">
      <label>
        Event name
        <input value={f.eventName} onChange={set("eventName")} />
      </label>
      <label>
        College / department
        <input value={f.collegeName} onChange={set("collegeName")} />
      </label>
      <label>
        Event date (printed on certificates)
        <input
          value={f.eventDate}
          onChange={set("eventDate")}
          placeholder="25 September 2026"
        />
      </label>
      <label>
        Signatory name
        <input value={f.signatory} onChange={set("signatory")} />
      </label>
      <label>
        Signatory title
        <input value={f.signatoryTitle} onChange={set("signatoryTitle")} />
      </label>
      <label>
        Game duration (minutes)
        <input
          type="number"
          min="1"
          max="360"
          value={f.minutes}
          onChange={set("minutes")}
        />
      </label>
      <label className="row">
        <input
          type="checkbox"
          checked={f.registrationOpen}
          onChange={set("registrationOpen")}
        />{" "}
        Registration open
      </label>
      {/* <label className="row">
        <input
          type="checkbox"
          checked={f.certsEnabled}
          onChange={set("certsEnabled")}
        />{" "}
        Certificates downloadable by players
      </label> */}
      <button className="btn">Save settings</button>{" "}
      {msg && <span className="ok">{msg}</span>}
      <hr />
      <h3>Results &amp; certificates</h3>
      <div className="row gap wrap">
        <button
          type="button"
          className="btn ghost"
          onClick={() => dl("/admin/certificates.zip", "certificates.zip")}
        >
          All certificates (ZIP)
        </button>
        <button
          type="button"
          className="btn ghost"
          onClick={() => dl("/admin/export.csv", "results.csv")}
        >
          Results CSV
        </button>
        <button
          type="button"
          className="btn ghost"
          onClick={() =>
            dl(
              "/admin/certificates/sample.pdf?rank=0",
              "sample-participant.pdf",
            )
          }
        >
          Sample: participant
        </button>
        <button
          type="button"
          className="btn ghost"
          onClick={() =>
            dl("/admin/certificates/sample.pdf?rank=1", "sample-winner.pdf")
          }
        >
          Sample: winner
        </button>
      </div>
    </form>
  );
}

function EventHistory({ events, selectedId, onSelect, onCurrent, onDelete }) {
  return <div className="card">
    <div className="row between"><h3>Recent organised games</h3><button className={!selectedId ? "btn ghost" : "link"} onClick={onCurrent}>Current event</button></div>
    {!events.length && <p className="muted">No games have been started yet.</p>}
    <div className="scroll"><table className="table"><thead><tr><th>Event</th><th>Date</th><th>Status</th><th>Started</th><th /></tr></thead><tbody>
      {events.map((e) => <tr key={e.id} className={selectedId === e.id ? "top1" : ""}><td>{e.eventName}</td><td>{e.eventDate || "—"}</td><td>{e.status}</td><td>{new Date(e.startedAt).toLocaleString()}</td><td className="nowrap"><button className="link" onClick={() => onSelect(e.id)}>Load</button> · <button className="link red" onClick={() => onDelete(e)}>Delete</button></td></tr>)}
    </tbody></table></div>
  </div>;
}
