import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { getSocket } from '../socket';
import { useGame } from '../useGame';
import Clock from '../components/Clock';
import Leaderboard from '../components/Leaderboard';

// Projector view for the auditorium: big timer + live top 10.
export default function Screen() {
  const { state, getElapsed } = useGame();
  const [topStudents, setTopStudents] = useState([]);
  const [topFaculty, setTopFaculty] = useState([]);
  useEffect(() => {
    api.get('/admin/overview').then((r) => { setTopStudents(r.data.topStudents); setTopFaculty(r.data.topFaculty); });
    const s = getSocket();
    const on = (p) => { setTopStudents(p.topStudents); setTopFaculty(p.topFaculty); };
    s.on('leaderboard:update', on);
    return () => s.off('leaderboard:update', on);
  }, []);
  return (
    <div className="screen">
      <div className="row between">
        <h1>❤️ {state?.eventName || 'Heart Puzzle Challenge'}</h1>
        <Link to="/admin" className="link">← Dashboard</Link>
      </div>
      <div className="center"><Clock state={state} getElapsed={getElapsed} className="huge" /><p className="muted">{state?.status?.toUpperCase()}</p></div>
      <div className="split"><div><h2>Top students</h2><Leaderboard rows={topStudents} big /></div><div><h2>Top faculty</h2><Leaderboard rows={topFaculty} big /></div></div>
    </div>
  );
}
