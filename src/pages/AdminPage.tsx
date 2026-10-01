import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useApp } from '../AppContext';
import { supabase } from '../supabase';
import type { MemberRole, Message, Profile, Room } from '../types';
import { removeFile, useSignedUrl } from '../lib/media';
import { errorText, OWNER_LABEL, ROLE_CHOICES, ROLE_LABEL, STATUS_LABEL, timeAgo } from '../lib/format';
import Avatar, { SpaceTile } from '../components/Avatar';
import { useFeedback } from '../components/Feedback';
import Icon from '../components/Icon';
import { useProfileCard } from '../components/ProfileCard';
import RoomDialog from '../components/RoomDialog';
import PreapprovedAdmin from '../components/PreapprovedAdmin';
import RosterAdmin from '../components/RosterAdmin';
import OwnerTools from '../components/OwnerTools';
import FeedbackAdmin from '../components/FeedbackAdmin';
import AdminStats from '../components/AdminStats';
import GuestViewAdmin from '../components/GuestViewAdmin';
import AiKeysAdmin from '../components/AiKeysAdmin';
import SenderReports from '../components/SenderReports';
import MemberKeysAdmin from '../components/MemberKeys';
import ClaudeKeyAdmin from '../components/ClaudeKeyAdmin';
import AiPromptsAdmin from '../components/AiPromptsAdmin';
import ModerationPage from './ModerationPage';

type Tab = 'members' | 'preapproved' | 'anonymous' | 'rooms' | 'media' | 'owner' | 'feedback' | 'stats' | 'guest' | 'ai' | 'sender' | 'moderation' | 'prompts';
type ProfilePatch = Partial<Pick<Profile, 'status' | 'role' | 'accept_anonymous' | 'can_send_anonymous' | 'join_seen'>>;

export default function AdminPage() {
  const { profiles, rooms, me, reloadProfiles, reloadRooms, nameOf, isOwner, ownerId, guestUntil } = useApp();
  const showOwnerTab = isOwner || !ownerId;
  const { confirm, toast } = useFeedback();
  const openCard = useProfileCard();
  const [params] = useSearchParams();
  const [tab, setTab] = useState<Tab>(() => (params.get('tab') as Tab | null) ?? 'members');
  const [filter, setFilter] = useState('');
  const [editRoom, setEditRoom] = useState<Room | null>(null);
  const [newRoom, setNewRoom] = useState(false);
  // Open reports (badge on the "פיקוח" tab).
  const [openReports, setOpenReports] = useState(0);
  useEffect(() => {
    supabase.rpc('report_list').then(({ data }) => setOpenReports(((data as unknown[]) ?? []).length));
  }, [tab]);
  // Owner: new reports from בוט.
  const [botAlerts, setBotAlerts] = useState(0);
  useEffect(() => {
    if (isOwner) supabase.rpc('bot_alert_count').then(({ data }) => setBotAlerts((data as number) ?? 0));
  }, [isOwner, tab]);

  const all = [...profiles.values()];
  const pending = all.filter((p) => p.status === 'pending').sort((a, b) => a.created_at.localeCompare(b.created_at));
  const matches = (p: Profile) => p.display_name.includes(filter.trim());
  const members = all.filter((p) => p.status !== 'pending' && matches(p));
  const active = all.filter((p) => p.status === 'active');
  const newJoins = all
    .filter((p) => p.joined_via === 'roster' && !p.join_seen && p.status === 'active')
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const newJoinKey = newJoins.map((p) => p.id).join(',');
  const [matchedName, setMatchedName] = useState<Record<string, string>>({});

  // Which roster name each new member matched, so the admin can compare.
  useEffect(() => {
    if (!newJoinKey) return;
    supabase
      .from('roster')
      .select('name, claimed_by')
      .in('claimed_by', newJoinKey.split(','))
      .then(({ data }) => setMatchedName(Object.fromEntries((data ?? []).map((r) => [r.claimed_by as string, r.name as string]))));
  }, [newJoinKey]);

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

  // Removal is not a ban: he goes back to the waiting list, keeps his account and messages, and can be let in again.
  async function remove(p: Profile) {
    const ok = await confirm({
      title: `הסרת ${p.display_name} מהקבוצה`,
      body: 'הוא יאבד גישה מיד, אבל לא ייחסם: החשבון וההודעות שלו נשמרים, והוא יופיע ברשימת הממתינים. כדי להחזיר אותו לוחצים שם "אישור".',
      confirmLabel: 'הסרה',
      danger: true,
    });
    if (ok && (await update([p.id], { status: 'pending' }))) toast(`${p.display_name} הוסר מהקבוצה`);
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
            {pending.length + newJoins.length > 0 && <span className="badge-count">{pending.length + newJoins.length}</span>}
          </button>
          <button className={tab === 'moderation' ? 'on' : ''} onClick={() => setTab('moderation')} role="tab">
            <Icon name="flag" size={20} /> פיקוח
            {openReports > 0 && <span className="badge-count">{openReports}</span>}
          </button>
          <button className={tab === 'anonymous' ? 'on' : ''} onClick={() => setTab('anonymous')} role="tab">
            <Icon name="visibility_off" size={20} /> הודעות אנונימיות
          </button>
          <button className={tab === 'rooms' ? 'on' : ''} onClick={() => setTab('rooms')} role="tab">
            <Icon name="forum" size={20} /> חדרים
          </button>
          <button className={tab === 'media' ? 'on' : ''} onClick={() => setTab('media')} role="tab">
            <Icon name="add_photo_alternate" size={20} /> מדיה
          </button>
          <button className={tab === 'preapproved' ? 'on' : ''} onClick={() => setTab('preapproved')} role="tab">
            <Icon name="check" size={20} /> אישור מראש
          </button>
          {isOwner && (
            <button className={tab === 'sender' ? 'on' : ''} onClick={() => setTab('sender')} role="tab">
              <Icon name="flag" size={20} /> בוט מדווח
              {botAlerts > 0 && <span className="badge-count">{botAlerts}</span>}
            </button>
          )}
          {isOwner && (
            <button className={tab === 'prompts' ? 'on' : ''} onClick={() => setTab('prompts')} role="tab">
              <Icon name="edit" size={20} /> פקודות ל-AI
            </button>
          )}
          {isOwner && (
            <button className={tab === 'ai' ? 'on' : ''} onClick={() => setTab('ai')} role="tab">
              <Icon name="smart_toy" size={20} /> בוט (AI)
            </button>
          )}
          {isOwner && (
            <button className={tab === 'guest' ? 'on' : ''} onClick={() => setTab('guest')} role="tab">
              <Icon name="visibility" size={20} /> צפייה ללא התחברות
              {guestUntil && <span className="badge-count">פתוח</span>}
            </button>
          )}
          <button className={tab === 'stats' ? 'on' : ''} onClick={() => setTab('stats')} role="tab">
            <Icon name="bar_chart" size={20} /> סטטיסטיקה
          </button>
          <button className={tab === 'feedback' ? 'on' : ''} onClick={() => setTab('feedback')} role="tab">
            <Icon name="mail" size={20} /> פניות
          </button>
          {showOwnerTab && (
            <button className={tab === 'owner' ? 'on' : ''} onClick={() => setTab('owner')} role="tab">
              <Icon name="shield_person" size={20} /> {OWNER_LABEL}
            </button>
          )}
        </div>

        {(tab === 'members' || tab === 'anonymous') && (
          <div className="toolbar">
            <div className="field-search">
              <Icon name="search" />
              <input placeholder="סינון לפי שם" value={filter} onChange={(e) => setFilter(e.target.value)} />
            </div>
          </div>
        )}

        {tab === 'members' && (
          <>
            {newJoins.length > 0 && (
              <section className="card-section">
                <div className="section-head">
                  <h2>הצטרפו אוטומטית לפי רשימת השמות ({newJoins.length})</h2>
                  {newJoins.length > 1 && (
                    <button className="btn tonal small" onClick={() => update(newJoins.map((p) => p.id), { join_seen: true })}>
                      כולם תקינים
                    </button>
                  )}
                </div>
                <p className="muted small">נכנסו בלי המתנה כי השם שכתבו מופיע ברשימה. אם מישהו לא נראה מוכר, אפשר לחסום אותו.</p>
                <ul className="list">
                  {newJoins.map((p) => (
                    <li key={p.id} className="list-row static">
                      <button className="avatar-link" onClick={(e) => openCard(p.id, e.currentTarget)}>
                        <Avatar id={p.id} name={p.display_name} size={40} />
                      </button>
                      <div className="list-main">
                        <div className="list-title">{p.display_name}</div>
                        <div className="list-sub">
                          {matchedName[p.id] ? `ברשימה: ${matchedName[p.id]} · ` : ''}הצטרף {timeAgo(p.created_at)}
                        </div>
                      </div>
                      <div className="row gap">
                        <button className="btn text danger" onClick={() => ban(p)}>חסימה</button>
                        <button className="btn filled small" onClick={() => updateOne(p, { join_seen: true })}>תקין</button>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )}
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
                        <div className="list-sub">{p.removed_at ? `הוסר מהקבוצה ${timeAgo(p.removed_at)} · אישור יחזיר אותו` : `נרשם ${timeAgo(p.created_at)}`}</div>
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
                      <div className="list-sub">
                        {STATUS_LABEL[p.status]}
                        {p.joined_via === 'roster' ? ' · נכנס לפי רשימת השמות' : p.joined_via === 'email' ? ' · אושר מראש לפי מייל' : ''}
                      </div>
                    </div>
                    <div className="row gap">
                      {p.id === ownerId ? (
                        <span className="role-tag">{OWNER_LABEL}</span>
                      ) : (
                        <select value={p.role} onChange={(e) => updateOne(p, { role: e.target.value as MemberRole })} aria-label="תפקיד">
                          {(ROLE_CHOICES as readonly MemberRole[]).concat(ROLE_CHOICES.includes(p.role as never) ? [] : [p.role]).map((r) => (
                            <option key={r} value={r}>{ROLE_LABEL[r]}</option>
                          ))}
                        </select>
                      )}
                      {p.id === ownerId ? null : p.status === 'banned' ? (
                        <button className="btn text" onClick={() => updateOne(p, { status: 'active' })}>ביטול חסימה</button>
                      ) : (
                        <>
                          {p.id !== me?.id && <button className="btn text" onClick={() => remove(p)}>הסרה</button>}
                          <button className="btn text danger" onClick={() => ban(p)}>חסימה</button>
                        </>
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

        {tab === 'media' && <MediaAdmin />}
        {tab === 'owner' && showOwnerTab && <OwnerTools />}

        {tab === 'feedback' && <FeedbackAdmin />}

        {tab === 'stats' && <AdminStats />}
        {tab === 'guest' && isOwner && <GuestViewAdmin />}
        {tab === 'ai' && isOwner && <><AiKeysAdmin /><ClaudeKeyAdmin /><MemberKeysAdmin /></>}
        {tab === 'sender' && isOwner && <SenderReports />}
        {tab === 'prompts' && isOwner && <AiPromptsAdmin />}
        {tab === 'moderation' && <ModerationPage embedded />}

        {tab === 'preapproved' && (
          <>
            <RosterAdmin />
            <PreapprovedAdmin />
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

/** Every photo and video posted in the rooms, newest first, with one-click deletion. */
function MediaAdmin() {
  const { rooms, nameOf } = useApp();
  const { confirm, toast } = useFeedback();
  const [items, setItems] = useState<Message[] | null>(null);
  const [kind, setKind] = useState<'all' | 'video' | 'image'>('all');

  useEffect(() => {
    let q = supabase.from('messages').select('*').eq('deleted', false).not('attachment', 'is', null).order('created_at', { ascending: false }).limit(120);
    if (kind !== 'all') q = q.eq('attachment->>type', kind);
    q.then(({ data }) => setItems((data as Message[]) ?? []));
  }, [kind]);

  async function remove(m: Message) {
    const ok = await confirm({ title: m.attachment?.type === 'video' ? 'מחיקת הסרטון' : 'מחיקת התמונה', body: 'ההודעה והקובץ יימחקו לצמיתות לכל המשתתפים.', confirmLabel: 'מחיקה', danger: true });
    if (!ok) return;
    const { error } = await supabase.from('messages').update({ deleted: true }).eq('id', m.id);
    if (error) return toast(errorText(error), 'error');
    if (m.attachment) await removeFile(m.attachment.path);
    setItems((prev) => prev?.filter((x) => x.id !== m.id) ?? prev);
    toast('נמחק');
  }

  const roomLink = (id: number) => (rooms.find((r) => r.id === id)?.is_main ? '/' : `/room/${id}`);

  return (
    <section className="card-section">
      <div className="section-head">
        <h2>תמונות וסרטונים בחדרים</h2>
        <div className="segmented" role="tablist">
          {([['all', 'הכל'], ['video', 'סרטונים'], ['image', 'תמונות']] as const).map(([k, label]) => (
            <button key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)} role="tab" aria-selected={kind === k}>{label}</button>
          ))}
        </div>
      </div>
      <p className="muted small">מחיקה מסירה את ההודעה ואת הקובץ עצמו מהאחסון. שיחות אישיות אינן גלויות למנהלים ולכן אינן מופיעות כאן.</p>
      {items === null ? (
        <div className="spinner" />
      ) : items.length === 0 ? (
        <div className="empty-inline small"><span>אין קבצים להצגה.</span></div>
      ) : (
        <div className="media-grid">
          {items.map((m) => (
            <figure key={m.id} className="media-tile">
              <MediaThumb path={m.attachment!.path} video={m.attachment!.type === 'video'} />
              <figcaption>
                <Link to={`${roomLink(m.channel_id)}?m=${m.id}`} className="plain-link">
                  <strong>{m.anonymous ? 'אנונימי' : nameOf(m.author_id)}</strong>
                  <span>{rooms.find((r) => r.id === m.channel_id)?.name} · {timeAgo(m.created_at)}</span>
                </Link>
                <button className="icon-btn small danger" onClick={() => remove(m)} aria-label="מחיקה" title="מחיקה">
                  <Icon name="delete" size={18} />
                </button>
              </figcaption>
            </figure>
          ))}
        </div>
      )}
    </section>
  );
}

function MediaThumb({ path, video }: { path: string; video: boolean }) {
  const url = useSignedUrl(path);
  if (!url) return <div className="media-loading media-thumb" />;
  return video ? <video className="media-thumb" src={url} controls preload="metadata" /> : <img className="media-thumb" src={url} alt="" loading="lazy" />;
}
