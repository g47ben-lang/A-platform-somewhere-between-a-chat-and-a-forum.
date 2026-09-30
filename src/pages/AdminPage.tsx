import { useState } from 'react';
import { useApp } from '../AppContext';
import { supabase } from '../supabase';
import type { MemberRole, Profile, Room } from '../types';
import { errorText, ROLE_LABEL, STATUS_LABEL, timeAgo } from '../lib/format';
import Avatar, { SpaceTile } from '../components/Avatar';
import { useFeedback } from '../components/Feedback';
import Icon from '../components/Icon';
import { useProfileCard } from '../components/ProfileCard';
import RoomDialog from '../components/RoomDialog';

type Tab = 'members' | 'anonymous' | 'rooms';
type ProfilePatch = Partial<Pick<Profile, 'status' | 'role' | 'accept_anonymous' | 'can_send_anonymous'>>;

export default function AdminPage() {
  const { profiles, rooms, me, reloadProfiles, reloadRooms, nameOf } = useApp();
  const { confirm, toast } = useFeedback();
  const openCard = useProfileCard();
  const [tab, setTab] = useState<Tab>('members');
  const [filter, setFilter] = useState('');
  const [editRoom, setEditRoom] = useState<Room | null>(null);
  const [newRoom, setNewRoom] = useState(false);

  const all = [...profiles.values()];
  const pending = all.filter((p) => p.status === 'pending').sort((a, b) => a.created_at.localeCompare(b.created_at));
  const matches = (p: Profile) => p.display_name.includes(filter.trim());
  const members = all.filter((p) => p.status !== 'pending' && matches(p));
  const active = all.filter((p) => p.status === 'active');

  async function update(ids: string[], patch: ProfilePatch) {
    const { error } = await supabase.from('profiles').update(patch).in('id', ids);
    if (error) toast(errorText(error), 'error');
    await reloadProfiles();
    return !error;
  }

  async function updateOne(p: Profile, patch: ProfilePatch) {
    if (p.id === me?.id && (patch.role || patch.status)) {
      const ok = await confirm({ title: 'שינוי ההרשאות שלך', body: 'ייתכן שתאבד את הגישה לדף הניהול.', confirmLabel: 'המשך', danger: true });
      if (!ok) return;
    }
    update([p.id], patch);
  }

  async function ban(p: Profile) {
    const ok = await confirm({ title: `חסימת ${p.display_name}`, body: 'החבר יאבד גישה לכל תוכן הקהילה עד לביטול החסימה.', confirmLabel: 'חסימה', danger: true });
    if (ok) updateOne(p, { status: 'banned' });
  }

  async function approveAll() {
    const ok = await confirm({ title: `אישור ${pending.length} ממתינים`, confirmLabel: 'אישור כולם' });
    if (ok && (await update(pending.map((p) => p.id), { status: 'active' }))) toast('כל הממתינים אושרו');
  }

  async function bulkAnon(field: 'can_send_anonymous' | 'accept_anonymous', value: boolean) {
    const what = field === 'can_send_anonymous' ? 'שליחת הודעות אנונימיות' : 'קבלת הודעות אנונימיות';
    const ok = await confirm({ title: `${value ? 'הפעלת' : 'חסימת'} ${what} לכולם`, body: `ההגדרה תחול על כל ${active.length} החברים הפעילים. אפשר לשנות אחר כך לכל אחד בנפרד.`, confirmLabel: 'החלה על כולם', danger: !value });
    if (ok && (await update(active.map((p) => p.id), { [field]: value }))) toast('ההגדרה עודכנה לכולם');
  }

  async function deleteRoom(r: Room) {
    const ok = await confirm({ title: `מחיקת החדר "${r.name}"`, body: 'כל ההודעות בחדר יימחקו לצמיתות.', confirmLabel: 'מחיקה', danger: true });
    if (!ok) return;
    const { error } = await supabase.from('channels').delete().eq('id', r.id);
    if (error) toast(errorText(error), 'error');
    else toast('החדר נמחק');
    reloadRooms();
  }

  const sendCount = active.filter((p) => p.can_send_anonymous).length;
  const receiveCount = active.filter((p) => p.accept_anonymous).length;

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
          <button className={tab === 'anonymous' ? 'on' : ''} onClick={() => setTab('anonymous')} role="tab">
            <Icon name="visibility_off" size={20} /> הודעות אנונימיות
          </button>
          <button className={tab === 'rooms' ? 'on' : ''} onClick={() => setTab('rooms')} role="tab">
            <Icon name="forum" size={20} /> חדרים
          </button>
        </div>

        {tab !== 'rooms' && (
          <div className="toolbar">
            <div className="field-search">
              <Icon name="search" />
              <input placeholder="סינון לפי שם" value={filter} onChange={(e) => setFilter(e.target.value)} />
            </div>
          </div>
        )}

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
                  {pending.filter(matches).map((p) => (
                    <li key={p.id} className="list-row static">
                      <Avatar id={p.id} name={p.display_name} size={40} />
                      <div className="list-main">
                        <div className="list-title">{p.display_name}</div>
                        <div className="list-sub">נרשם {timeAgo(p.created_at)}</div>
                      </div>
                      <div className="row gap">
                        <button className="btn text danger" onClick={() => updateOne(p, { status: 'banned' })}>דחייה</button>
                        <button className="btn filled small" onClick={() => updateOne(p, { status: 'active' })}>אישור</button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="card-section">
              <div className="section-head"><h2>כל החברים ({members.length})</h2></div>
              <ul className="list">
                {members.map((p) => (
                  <li key={p.id} className={`list-row static ${p.status === 'banned' ? 'muted-row' : ''}`}>
                    <button className="avatar-link" onClick={(e) => openCard(p.id, e.currentTarget)}>
                      <Avatar id={p.id} name={p.display_name} size={40} />
                    </button>
                    <div className="list-main">
                      <div className="list-title">{p.display_name}</div>
                      <div className="list-sub">{STATUS_LABEL[p.status]}</div>
                    </div>
                    <div className="row gap">
                      <select value={p.role} onChange={(e) => updateOne(p, { role: e.target.value as MemberRole })} aria-label="תפקיד">
                        {(Object.keys(ROLE_LABEL) as MemberRole[]).map((r) => (
                          <option key={r} value={r}>{ROLE_LABEL[r]}</option>
                        ))}
                      </select>
                      {p.status === 'banned' ? (
                        <button className="btn text" onClick={() => updateOne(p, { status: 'active' })}>ביטול חסימה</button>
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

        {tab === 'anonymous' && (
          <>
            <div className="info-card">
              <Icon name="shield_person" size={22} />
              <div>
                <strong>מי יכול לשלוח ולמי אפשר לשלוח הודעות אנונימיות</strong>
                <p className="muted small">
                  "שליחה" מאפשרת לכתוב בעילום שם בחדרים, בצ'אט אישי ובפרופילים. "קבלה" מאפשרת לקבל הודעות אישיות ופרסומים בפרופיל בעילום שם.
                  חברים לא יכולים לשנות את ההגדרות האלה בעצמם. שינוי חל מיד, גם על שיחות אנונימיות שכבר פתוחות.
                </p>
              </div>
            </div>
            <div className="bulk-grid">
              <div className="bulk-card">
                <div><strong>שליחה בעילום שם</strong><div className="muted small">{sendCount} מתוך {active.length} מורשים</div></div>
                <div className="row gap">
                  <button className="btn text small" onClick={() => bulkAnon('can_send_anonymous', true)}>לאפשר לכולם</button>
                  <button className="btn text small danger" onClick={() => bulkAnon('can_send_anonymous', false)}>לחסום לכולם</button>
                </div>
              </div>
              <div className="bulk-card">
                <div><strong>קבלת הודעות אנונימיות</strong><div className="muted small">{receiveCount} מתוך {active.length} מקבלים</div></div>
                <div className="row gap">
                  <button className="btn text small" onClick={() => bulkAnon('accept_anonymous', true)}>לאפשר לכולם</button>
                  <button className="btn text small danger" onClick={() => bulkAnon('accept_anonymous', false)}>לחסום לכולם</button>
                </div>
              </div>
            </div>
            <div className="perm-table" role="table">
              <div className="perm-head" role="row">
                <span role="columnheader">חבר</span>
                <span role="columnheader">יכול לשלוח</span>
                <span role="columnheader">אפשר לשלוח אליו</span>
              </div>
              {active.filter(matches).map((p) => (
                <div className="perm-line" role="row" key={p.id}>
                  <span className="perm-name" role="cell">
                    <Avatar id={p.id} name={p.display_name} size={28} />
                    {p.display_name}
                  </span>
                  <span role="cell">
                    <input type="checkbox" className="switch" checked={p.can_send_anonymous} aria-label={`${p.display_name} יכול לשלוח בעילום שם`}
                      onChange={(e) => update([p.id], { can_send_anonymous: e.target.checked })} />
                  </span>
                  <span role="cell">
                    <input type="checkbox" className="switch" checked={p.accept_anonymous} aria-label={`אפשר לשלוח ל${p.display_name} בעילום שם`}
                      onChange={(e) => update([p.id], { accept_anonymous: e.target.checked })} />
                  </span>
                </div>
              ))}
            </div>
          </>
        )}

        {tab === 'rooms' && (
          <section className="card-section">
            <div className="section-head">
              <h2>חדרים ({rooms.length})</h2>
              <button className="btn tonal small" onClick={() => setNewRoom(true)}><Icon name="add" size={18} /> חדר חדש</button>
            </div>
            <ul className="list">
              {rooms.map((r) => (
                <li key={r.id} className="list-row static">
                  <SpaceTile name={r.name} size={36} announce={r.admin_only_post} />
                  <div className="list-main">
                    <div className="list-title">
                      {r.name}
                      {r.is_main && <span className="role-tag">ראשי</span>}
                      {r.admin_only_post && <span className="role-tag">הודעות</span>}
                    </div>
                    <div className="list-sub">
                      {r.description ?? 'ללא תיאור'}
                      {r.created_by && ` · נפתח על ידי ${nameOf(r.created_by)}`}
                      {` · פעילות אחרונה ${timeAgo(r.last_message_at)}`}
                    </div>
                  </div>
                  <div className="row gap">
                    <button className="btn text" onClick={() => setEditRoom(r)}>עריכה</button>
                    {!r.is_main && <button className="btn text danger" onClick={() => deleteRoom(r)}>מחיקה</button>}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
      {editRoom && <RoomDialog room={editRoom} onClose={() => setEditRoom(null)} />}
      {newRoom && <RoomDialog onClose={() => setNewRoom(false)} />}
    </div>
  );
}
