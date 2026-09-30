import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../AppContext';
import { supabase } from '../supabase';
import { levelFor, ROLE_LABEL } from '../lib/format';
import type { MemberStats } from '../types';
import Avatar from '../components/Avatar';
import Icon from '../components/Icon';

type Sort = 'reputation' | 'name' | 'online';

export default function MembersPage() {
  const { profiles, online } = useApp();
  const [filter, setFilter] = useState('');
  const [sort, setSort] = useState<Sort>('reputation');
  const [stats, setStats] = useState<Map<string, MemberStats>>(new Map());

  useEffect(() => {
    supabase.rpc('member_stats').then(({ data }) => {
      if (data) setStats(new Map((data as MemberStats[]).map((s) => [s.id, s])));
    });
  }, []);

  const rep = (id: string) => stats.get(id)?.reputation ?? 0;
  const list = [...profiles.values()]
    .filter((p) => p.status === 'active' && p.display_name.includes(filter.trim()))
    .sort((a, b) => {
      if (sort === 'reputation') return rep(b.id) - rep(a.id) || a.display_name.localeCompare(b.display_name, 'he');
      if (sort === 'online') return Number(online.has(b.id)) - Number(online.has(a.id)) || a.display_name.localeCompare(b.display_name, 'he');
      return a.display_name.localeCompare(b.display_name, 'he');
    });

  return (
    <div className="pane scroll-pane">
      <div className="page">
        <header className="page-head">
          <h1>חברי הקהילה</h1>
          <p className="muted">{list.length} חברים · {online.size} מחוברים עכשיו</p>
        </header>
        <div className="toolbar">
          <div className="field-search">
            <Icon name="search" />
            <input placeholder="חיפוש לפי שם" value={filter} onChange={(e) => setFilter(e.target.value)} />
          </div>
          <div className="segmented" role="tablist">
            {([['reputation', 'מוניטין'], ['online', 'מחוברים'], ['name', 'שם']] as const).map(([k, label]) => (
              <button key={k} className={sort === k ? 'on' : ''} onClick={() => setSort(k)} role="tab" aria-selected={sort === k}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <ul className="list">
          {list.map((p, i) => (
            <li key={p.id}>
              <Link to={`/u/${p.id}`} className="list-row">
                {sort === 'reputation' && <span className="rank">{i + 1}</span>}
                <Avatar id={p.id} name={p.display_name} size={40} online={online.has(p.id)} />
                <div className="list-main">
                  <div className="list-title">
                    {p.display_name}
                    {p.role !== 'member' && <span className="role-tag">{ROLE_LABEL[p.role]}</span>}
                  </div>
                  <div className="list-sub">{p.bio || levelFor(rep(p.id)).name}</div>
                </div>
                <div className="list-end rep-pill" title="מוניטין">
                  <Icon name="workspace_premium" size={16} filled />
                  {rep(p.id)}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
