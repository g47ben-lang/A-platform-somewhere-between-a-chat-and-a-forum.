import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../AppContext';
import { supabase } from '../supabase';
import type { Channel, MemberRole, MemberStatus, Profile } from '../types';
import { errorText, ROLE_LABEL, STATUS_LABEL, timeAgo } from '../lib/format';
import Avatar from '../components/Avatar';
import { useFeedback } from '../components/Feedback';
import Icon from '../components/Icon';

export default function AdminPage() {
  const { profiles, channels, me, reloadProfiles, reloadChannels } = useApp();
  const { confirm, toast } = useFeedback();
  const [tab, setTab] = useState<'members' | 'spaces'>('members');
  const [filter, setFilter] = useState('');

  const all = [...profiles.values()];
  const pending = all.filter((p) => p.status === 'pending').sort((a, b) => a.created_at.localeCompare(b.created_at));
  const others = all.filter((p) => p.status !== 'pending' && p.display_name.includes(filter.trim()));

  async function updateProfile(p: Profile, patch: { status?: MemberStatus; role?: MemberRole }) {
    if (p.id === me?.id) {
      const ok = await confirm({ title: 'שינוי ההרשאות שלך', body: 'ייתכן שתאבד/י את הגישה לדף הניהול.', confirmLabel: 'המשך', danger: true });
      if (!ok) return;
    }
    const { error } = await supabase.from('profiles').update(patch).eq('id', p.id);
    if (error) toast(errorText(error), 'error');
    reloadProfiles();
  }

  async function ban(p: Profile) {
    const ok = await confirm({ title: `חסימת ${p.display_name}`, body: 'החבר/ה יאבד/ו גישה לכל תוכן הקהילה עד לביטול החסימה.', confirmLabel: 'חסימה', danger: true });
    if (ok) updateProfile(p, { status: 'banned' });
  }

  async function approveAll() {
    const ok = await confirm({ title: `אישור ${pending.length} ממתינים`, confirmLabel: 'אישור כולם' });
    if (!ok) return;
    const { error } = await supabase.from('profiles').update({ status: 'active' }).in('id', pending.map((p) => p.id));
    if (error) toast(errorText(error), 'error');
    else toast('כל הממתינים אושרו');
    reloadProfiles();
  }

  return (
    <div className="pane scroll-pane">
      <div className="page">
        <header className="page-head">
          <h1>ניהול הקהילה</h1>
        </header>
        <div className="tabs" role="tablist">
          <button className={tab === 'members' ? 'on' : ''} onClick={() => setTab('members')} role="tab">
            <Icon name="group" size={20} /> חברים
            {pending.length > 0 && <span className="badge-count">{pending.length}</span>}
          </button>
          <button className={tab === 'spaces' ? 'on' : ''} onClick={() => setTab('spaces')} role="tab">
            <Icon name="forum" size={20} /> מרחבים
          </button>
        </div>

        {tab === 'members' && (
          <>
            <section className="card-section">
              <div className="section-head">
                <h2>ממתינים לאישור ({pending.length})</h2>
                {pending.length > 1 && <button className="btn tonal small" onClick={approveAll}>אישור כולם</button>}
              </div>
              {pending.length === 0 ? (
                <div className="empty-inline small"><Icon name="check" /><span>אין בקשות הצטרפות ממתינות.</span></div>
              ) : (
                <ul className="list">
                  {pending.map((p) => (
                    <li key={p.id} className="list-row static">
                      <Avatar id={p.id} name={p.display_name} size={40} />
                      <div className="list-main">
                        <div className="list-title">{p.display_name}</div>
                        <div className="list-sub">נרשם/ה {timeAgo(p.created_at)}</div>
                      </div>
                      <div className="row gap">
                        <button className="btn text danger" onClick={() => updateProfile(p, { status: 'banned' })}>דחייה</button>
                        <button className="btn filled small" onClick={() => updateProfile(p, { status: 'active' })}>אישור</button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="card-section">
              <div className="section-head">
                <h2>כל החברים ({others.length})</h2>
                <div className="field-search compact">
                  <Icon name="search" />
                  <input placeholder="סינון לפי שם" value={filter} onChange={(e) => setFilter(e.target.value)} />
                </div>
              </div>
              <ul className="list">
                {others.map((p) => (
                  <li key={p.id} className={`list-row static ${p.status === 'banned' ? 'muted-row' : ''}`}>
                    <Avatar id={p.id} name={p.display_name} size={40} />
                    <div className="list-main">
                      <Link to={`/u/${p.id}`} className="list-title">{p.display_name}</Link>
                      <div className="list-sub">{STATUS_LABEL[p.status]}</div>
                    </div>
                    <div className="row gap">
                      <select value={p.role} onChange={(e) => updateProfile(p, { role: e.target.value as MemberRole })} aria-label="תפקיד">
                        {(Object.keys(ROLE_LABEL) as MemberRole[]).map((r) => (
                          <option key={r} value={r}>{ROLE_LABEL[r]}</option>
                        ))}
                      </select>
                      {p.status === 'banned' ? (
                        <button className="btn text" onClick={() => updateProfile(p, { status: 'active' })}>ביטול חסימה</button>
                      ) : (
                        <button className="btn text danger" onClick={() => ban(p)}>חסימה</button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}

        {tab === 'spaces' && (
          <>
            {channels.map((c) => (
              <SpaceEditor key={c.id} space={c} onChange={reloadChannels} />
            ))}
            <SpaceEditor onChange={reloadChannels} nextPosition={channels.length} />
          </>
        )}
      </div>
    </div>
  );
}

function SpaceEditor({ space, onChange, nextPosition = 0 }: { space?: Channel; onChange: () => void; nextPosition?: number }) {
  const { confirm, toast } = useFeedback();
  const [name, setName] = useState(space?.name ?? '');
  const [description, setDescription] = useState(space?.description ?? '');
  const [position, setPosition] = useState(space?.position ?? nextPosition);
  const [adminOnly, setAdminOnly] = useState(space?.admin_only_post ?? false);

  async function save(e: FormEvent) {
    e.preventDefault();
    const row = { name: name.trim(), description: description.trim() || null, position, admin_only_post: adminOnly };
    const { error } = space ? await supabase.from('channels').update(row).eq('id', space.id) : await supabase.from('channels').insert(row);
    if (error) return toast(errorText(error), 'error');
    toast(space ? 'המרחב עודכן' : 'המרחב נוצר');
    if (!space) {
      setName('');
      setDescription('');
      setAdminOnly(false);
    }
    onChange();
  }

  async function remove() {
    if (!space) return;
    const ok = await confirm({ title: `מחיקת המרחב "${space.name}"`, body: 'כל השרשורים וההודעות במרחב יימחקו לצמיתות.', confirmLabel: 'מחיקה', danger: true });
    if (!ok) return;
    const { error } = await supabase.from('channels').delete().eq('id', space.id);
    if (error) toast(errorText(error), 'error');
    onChange();
  }

  return (
    <form className="settings-card" onSubmit={save}>
      <h2>{space ? space.name : 'מרחב חדש'}</h2>
      <div className="grid-2">
        <label className="field">
          <span>שם</span>
          <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={60} />
        </label>
        <label className="field">
          <span>סדר בתפריט</span>
          <input type="number" value={position} onChange={(e) => setPosition(Number(e.target.value))} />
        </label>
      </div>
      <label className="field">
        <span>תיאור</span>
        <input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} />
      </label>
      <label className="switch-row">
        <span>
          <strong>מרחב הודעות</strong>
          <span className="muted small">רק מנהלים ומנחים יכולים לפתוח בו שרשורים. כולם יכולים להגיב.</span>
        </span>
        <input type="checkbox" className="switch" checked={adminOnly} onChange={(e) => setAdminOnly(e.target.checked)} />
      </label>
      <div className="form-actions">
        {space && <button type="button" className="btn text danger" onClick={remove}>מחיקת המרחב</button>}
        <button className="btn filled">{space ? 'שמירה' : 'יצירת מרחב'}</button>
      </div>
    </form>
  );
}
