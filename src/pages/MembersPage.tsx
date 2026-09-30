import { useState } from 'react';
import { useApp } from '../AppContext';
import { ROLE_LABEL } from '../util';
import Avatar from '../components/Avatar';

export default function MembersPage() {
  const { profiles, online } = useApp();
  const [filter, setFilter] = useState('');
  const list = [...profiles.values()]
    .filter((p) => p.status === 'active' && p.display_name.includes(filter.trim()))
    .sort((a, b) => Number(online.has(b.id)) - Number(online.has(a.id)) || a.display_name.localeCompare(b.display_name, 'he'));

  return (
    <div className="page">
      <div className="page-head">
        <h1>חברי הקהילה</h1>
        <input className="filter" placeholder="סינון לפי שם" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>
      <p className="muted">{list.length} חברים · {online.size} מחוברים עכשיו</p>
      <ul className="member-grid">
        {list.map((p) => (
          <li key={p.id}>
            <Avatar id={p.id} name={p.display_name} online={online.has(p.id)} />
            <span>{p.display_name}</span>
            {p.role !== 'member' && <span className={`badge ${p.role}`}>{ROLE_LABEL[p.role]}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
