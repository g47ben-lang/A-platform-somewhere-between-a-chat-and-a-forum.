import { useEffect, useState } from 'react';
import { supabase } from '../supabase';
import { errorText } from '../lib/format';

interface Stats {
  members: number;
  pending: number;
  muted: number;
  messages_today: number;
  messages_week: number;
  dms_week: number;
  writers_today: number;
  writers_week: number;
  new_members_week: number;
  open_reports: number;
  per_day: { day: string; count: number }[];
  top_rooms: { name: string; count: number }[];
}

/** Admin: activity at a glance (counts only; private chats are never read). */
export default function AdminStats() {
  const [s, setS] = useState<Stats | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    supabase.rpc('admin_stats').then(({ data, error }) => (error ? setErr(errorText(error)) : setS(data as Stats)));
  }, []);

  if (err) return <div className="alert error">{err}</div>;
  if (!s) return <div className="spinner" />;
  const max = Math.max(1, ...s.per_day.map((d) => d.count));
  const topMax = Math.max(1, ...s.top_rooms.map((r) => r.count));
  const tiles: [string, number, string?][] = [
    ['חברים פעילים', s.members, s.new_members_week ? `+${s.new_members_week} השבוע` : undefined],
    ['כתבו היום', s.writers_today, `${s.writers_week} השבוע`],
    ['הודעות היום', s.messages_today, `${s.messages_week} השבוע`],
    ['הודעות אישיות השבוע', s.dms_week],
    ['ממתינים לאישור', s.pending],
    ['דיווחים פתוחים', s.open_reports, s.muted ? `${s.muted} מושתקים` : undefined],
  ];

  return (
    <div className="stats">
      <div className="stat-tiles">
        {tiles.map(([label, n, sub]) => (
          <div key={label} className="stat-tile">
            <span className="stat-num">{n.toLocaleString('he-IL')}</span>
            <span className="stat-label">{label}</span>
            {sub && <span className="stat-sub">{sub}</span>}
          </div>
        ))}
      </div>

      <section className="card-section">
        <div className="section-head"><h2>הודעות בשבועיים האחרונים</h2></div>
        <div className="bars" role="img" aria-label="הודעות לפי יום">
          {s.per_day.map((d) => (
            <div key={d.day} className="bar-col" title={`${new Date(d.day).toLocaleDateString('he-IL', { weekday: 'short', day: 'numeric', month: 'numeric' })}: ${d.count}`}>
              <span className="bar-val">{d.count || ''}</span>
              <div className="bar" style={{ height: `${(d.count / max) * 100}%` }} />
              <span className="bar-day">{new Date(d.day).toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' })}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="card-section">
        <div className="section-head"><h2>החדרים הפעילים השבוע</h2></div>
        {s.top_rooms.length === 0 ? (
          <p className="muted small">עוד אין הודעות השבוע.</p>
        ) : (
          <ul className="hbars">
            {s.top_rooms.map((r) => (
              <li key={r.name}>
                <span className="hbar-name">{r.name}</span>
                <span className="hbar-track"><span className="hbar" style={{ width: `${(r.count / topMax) * 100}%` }} /></span>
                <span className="hbar-num">{r.count}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
