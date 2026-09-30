import { useState, type FormEvent } from 'react';
import { useApp } from '../AppContext';
import { supabase } from '../supabase';
import type { Channel, MemberRole, MemberStatus, Profile } from '../types';
import { ROLE_LABEL, STATUS_LABEL, timeAgo } from '../util';
import Avatar from '../components/Avatar';

export default function AdminPage() {
  const { profiles, channels, me, reloadProfiles, reloadChannels } = useApp();
  const [tab, setTab] = useState<'members' | 'channels'>('members');
  const [filter, setFilter] = useState('');
  const [error, setError] = useState('');

  const all = [...profiles.values()];
  const pending = all.filter((p) => p.status === 'pending').sort((a, b) => a.created_at.localeCompare(b.created_at));
  const others = all.filter((p) => p.status !== 'pending' && p.display_name.includes(filter.trim()));

  async function updateProfile(p: Profile, patch: { status?: MemberStatus; role?: MemberRole }) {
    setError('');
    if (p.id === me?.id && !confirm('לשנות את ההרשאות של עצמך? ייתכן שתאבד/י גישה לניהול.')) return;
    const { error } = await supabase.from('profiles').update(patch).eq('id', p.id);
    if (error) setError(error.message);
    reloadProfiles();
  }

  async function approveAll() {
    if (!confirm(`לאשר ${pending.length} ממתינים?`)) return;
    const { error } = await supabase.from('profiles').update({ status: 'active' }).in('id', pending.map((p) => p.id));
    if (error) setError(error.message);
    reloadProfiles();
  }

  return (
    <div className="page">
      <h1>ניהול</h1>
      <div className="tabs">
        <button className={tab === 'members' ? 'active' : ''} onClick={() => setTab('members')}>
          חברים {pending.length > 0 && <span className="pill alert">{pending.length}</span>}
        </button>
        <button className={tab === 'channels' ? 'active' : ''} onClick={() => setTab('channels')}>ערוצים</button>
      </div>
      {error && <div className="error">{error}</div>}

      {tab === 'members' && (
        <>
          <div className="row between">
            <h2 className="section-title">ממתינים לאישור ({pending.length})</h2>
            {pending.length > 1 && <button className="btn ghost small" onClick={approveAll}>אישור כולם</button>}
          </div>
          {pending.length === 0 ? (
            <div className="empty">אין בקשות ממתינות</div>
          ) : (
            <ul className="admin-list">
              {pending.map((p) => (
                <li key={p.id}>
                  <Avatar id={p.id} name={p.display_name} />
                  <div className="grow">
                    <strong>{p.display_name}</strong>
                    <div className="muted small">נרשם/ה {timeAgo(p.created_at)}</div>
                  </div>
                  <button className="btn primary small" onClick={() => updateProfile(p, { status: 'active' })}>אישור</button>
                  <button className="btn ghost small danger" onClick={() => updateProfile(p, { status: 'banned' })}>דחייה</button>
                </li>
              ))}
            </ul>
          )}

          <div className="row between">
            <h2 className="section-title">כל החברים ({others.length})</h2>
            <input className="filter" placeholder="סינון לפי שם" value={filter} onChange={(e) => setFilter(e.target.value)} />
          </div>
          <ul className="admin-list">
            {others.map((p) => (
              <li key={p.id} className={p.status === 'banned' ? 'banned' : ''}>
                <Avatar id={p.id} name={p.display_name} />
                <div className="grow">
                  <strong>{p.display_name}</strong>
                  <div className="muted small">{STATUS_LABEL[p.status]}</div>
                </div>
                <select value={p.role} onChange={(e) => updateProfile(p, { role: e.target.value as MemberRole })}>
                  {(Object.keys(ROLE_LABEL) as MemberRole[]).map((r) => (
                    <option key={r} value={r}>{ROLE_LABEL[r]}</option>
                  ))}
                </select>
                {p.status === 'banned' ? (
                  <button className="btn ghost small" onClick={() => updateProfile(p, { status: 'active' })}>ביטול חסימה</button>
                ) : (
                  <button className="btn ghost small danger" onClick={() => confirm(`לחסום את ${p.display_name}?`) && updateProfile(p, { status: 'banned' })}>חסימה</button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      {tab === 'channels' && (
        <>
          {channels.map((c) => (
            <ChannelEditor key={c.id} channel={c} onChange={reloadChannels} onError={setError} />
          ))}
          <ChannelEditor onChange={reloadChannels} onError={setError} nextPosition={channels.length} />
        </>
      )}
    </div>
  );
}

function ChannelEditor({
  channel,
  onChange,
  onError,
  nextPosition = 0,
}: {
  channel?: Channel;
  onChange: () => void;
  onError: (m: string) => void;
  nextPosition?: number;
}) {
  const [name, setName] = useState(channel?.name ?? '');
  const [description, setDescription] = useState(channel?.description ?? '');
  const [position, setPosition] = useState(channel?.position ?? nextPosition);
  const [adminOnly, setAdminOnly] = useState(channel?.admin_only_post ?? false);

  async function save(e: FormEvent) {
    e.preventDefault();
    const row = { name: name.trim(), description: description.trim() || null, position, admin_only_post: adminOnly };
    const { error } = channel
      ? await supabase.from('channels').update(row).eq('id', channel.id)
      : await supabase.from('channels').insert(row);
    if (error) return onError(error.message);
    if (!channel) {
      setName('');
      setDescription('');
      setAdminOnly(false);
    }
    onChange();
  }

  async function remove() {
    if (!channel || !confirm(`למחוק את הערוץ "${channel.name}" וכל הנושאים שבו? אין דרך לשחזר.`)) return;
    const { error } = await supabase.from('channels').delete().eq('id', channel.id);
    if (error) onError(error.message);
    onChange();
  }

  return (
    <form className="card channel-editor" onSubmit={save}>
      <h3>{channel ? `# ${channel.name}` : '+ ערוץ חדש'}</h3>
      <div className="grid-2">
        <label>
          שם
          <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={60} />
        </label>
        <label>
          סדר
          <input type="number" value={position} onChange={(e) => setPosition(Number(e.target.value))} />
        </label>
      </div>
      <label>
        תיאור
        <input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} />
      </label>
      <label className="check">
        <input type="checkbox" checked={adminOnly} onChange={(e) => setAdminOnly(e.target.checked)} />
        ערוץ הודעות (רק מנהלים ומנחים פותחים נושאים)
      </label>
      <div className="row end">
        {channel && <button type="button" className="btn ghost small danger" onClick={remove}>מחיקה</button>}
        <button className="btn primary small">{channel ? 'שמירה' : 'יצירה'}</button>
      </div>
    </form>
  );
}
