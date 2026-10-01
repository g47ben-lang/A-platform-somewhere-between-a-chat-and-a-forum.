import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useApp } from '../AppContext';
import { supabase, SITE_NAME } from '../supabase';
import type { Conversation } from '../types';
import Avatar, { SpaceTile } from './Avatar';
import Icon from './Icon';
import NewChatDialog from './NewChatDialog';
import RoomDialog from './RoomDialog';
import { useMoreNews } from '../lib/useMoreNews';
import { MutedNotice } from './Moderation';
import { BOT_NAME } from '../pages/BotPage';

export function useConversationTitle() {
  const { nameOf } = useApp();
  return (c: Conversation) => (c.other_id ? nameOf(c.other_id) : 'משתמש אנונימי');
}

export default function Layout() {
  const { me, rooms, mainRoom, conversations, online, isAdmin, profiles, mutedRooms } = useApp();
  const news = useMoreNews(me?.id, me?.status === 'active');
  const [noticeClosed, setNoticeClosed] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [newChat, setNewChat] = useState(false);
  const [newRoom, setNewRoom] = useState(false);
  const [menu, setMenu] = useState(false);
  const [q, setQ] = useState('');
  const location = useLocation();
  // Admins: requests to the management waiting for an answer.
  const [openFeedback, setOpenFeedback] = useState(0);
  useEffect(() => {
    if (!isAdmin) return;
    const load = () => supabase.rpc('open_feedback_count').then(({ data }) => setOpenFeedback((data as number) ?? 0));
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, [isAdmin, location.pathname]);
  const navigate = useNavigate();
  const convTitle = useConversationTitle();
  const menuRef = useRef<HTMLDivElement>(null);

  const pendingCount = isAdmin ? [...profiles.values()].filter((p) => p.status === 'pending').length : 0;
  const newJoins = isAdmin ? [...profiles.values()].filter((p) => p.joined_via === 'roster' && !p.join_seen && p.status === 'active').length : 0;
  // Rooms I muted go to the bottom, without an unread count.
  const topicRooms = rooms.filter((r) => !r.is_main).sort((a, b) => Number(mutedRooms.has(a.id)) - Number(mutedRooms.has(b.id)));
  const unreadOf = (r: { id: number; unread: number }) => (mutedRooms.has(r.id) ? 0 : r.unread);
  // Owner: new reports from בוט (badge on "ניהול הקהילה").
  const { isOwner } = useApp();
  const [botAlerts, setBotAlerts] = useState(0);
  useEffect(() => {
    if (!isOwner) return;
    const load = () => supabase.rpc('bot_alert_count').then(({ data }) => setBotAlerts((data as number) ?? 0));
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, [isOwner, location.pathname]);
  // Admins: open reports (the moderation page is for admins only).
  const [openReports, setOpenReports] = useState(0);
  useEffect(() => {
    if (!isAdmin) return;
    const load = () => supabase.rpc('report_list').then(({ data }) => setOpenReports(((data as unknown[]) ?? []).length));
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, [isAdmin]);
  const unreadTotal = conversations.reduce((n, c) => n + c.unread, 0) + rooms.reduce((n, r) => n + unreadOf(r), 0);

  useEffect(() => {
    setDrawer(false);
    setMenu(false);
    if (location.pathname === '/more') news.markSeen();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  useEffect(() => {
    document.title = unreadTotal > 0 ? `(${unreadTotal}) ${SITE_NAME}` : SITE_NAME;
  }, [unreadTotal]);

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenu(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menu]);

  function search(e: FormEvent) {
    e.preventDefault();
    if (q.trim().length >= 2) navigate(`/search?q=${encodeURIComponent(q.trim())}`);
  }

  if (!me) return null;

  return (
    <div className={`app ${drawer ? 'drawer-open' : ''} ${collapsed ? 'collapsed' : ''}`}>
      <header className="topbar">
        <button
          className="icon-btn"
          aria-label="תפריט ראשי"
          onClick={() => (window.innerWidth <= 900 ? setDrawer(true) : setCollapsed((c) => !c))}
        >
          <Icon name="menu" />
          {unreadTotal > 0 && <span className="menu-dot" />}
        </button>
        <Link to="/" className="brand">
          <span className="brand-mark"><Icon name="forum" filled size={22} /></span>
          <span className="brand-name">{SITE_NAME}</span>
        </Link>
        <form className="topsearch" onSubmit={search} role="search">
          <Icon name="search" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="חיפוש בצ'אט" aria-label="חיפוש" />
        </form>
        <div className="topbar-end" ref={menuRef}>
          <Link to="/more" className="icon-btn more-btn" aria-label="עוד" title="עוד: וידויים ו'מי אמר את זה?'">
            <Icon name="interests" />
            {(news.confession || news.quiz) && <span className="menu-dot" />}
          </Link>
          <button className="avatar-btn" onClick={() => setMenu((m) => !m)} aria-label="החשבון שלי">
            <Avatar id={me.id} name={me.display_name} size={34} />
          </button>
          {menu && (
            <div className="menu account-menu">
              <div className="account-head">
                <Avatar id={me.id} name={me.display_name} size={56} />
                <div className="account-name">{me.display_name}</div>
              </div>
              <Link to={`/u/${me.id}`} className="menu-item"><Icon name="person" /> הפרופיל שלי</Link>
              <Link to="/settings" className="menu-item"><Icon name="settings" /> הגדרות</Link>
              {isAdmin && (
                <Link to="/admin" className="menu-item"><Icon name="admin_panel_settings" /> ניהול הקהילה</Link>
              )}
              <button className="menu-item" onClick={() => supabase.auth.signOut()}><Icon name="logout" /> התנתקות</button>
            </div>
          )}
        </div>
      </header>

      {(news.confession || news.quiz) && !noticeClosed && location.pathname !== '/more' && (
        <div className="more-notice" role="status">
          <Icon name="interests" size={22} />
          <div className="grow">
            <strong>{news.confession && news.quiz ? 'חדש ב"עוד"' : news.confession ? 'וידוי חדש' : 'ציטוט חדש'}</strong>
            <span className="muted small">
              {news.confession && 'מישהו העלה וידוי אנונימי. '}
              {news.quiz && 'יש ציטוט חדש ב"מי אמר את זה?", מי יודע מי כתב?'}
            </span>
          </div>
          <button className="btn tonal small" onClick={() => { setNoticeClosed(true); navigate(news.confession ? '/more' : '/more?tab=quotes'); }}>לצפייה</button>
          <button className="icon-btn small" aria-label="סגירה" onClick={() => { setNoticeClosed(true); news.markSeen(); }}><Icon name="close" size={16} /></button>
        </div>
      )}

      <MutedNotice />

      <aside className="sidebar">
        <button className="new-chat" onClick={() => setNewChat(true)}>
          <Icon name="edit" />
          <span>צ'אט חדש</span>
        </button>

        <nav className="nav">
          <NavLink to="/" end className={`nav-item ${mainRoom && mainRoom.unread > 0 ? 'unread' : ''}`}>
            <Icon name="home" />
            <span className="nav-label">הצ'אט הראשי</span>
            {mainRoom && mainRoom.unread > 0 && <span className="badge-count">{badge(mainRoom.unread)}</span>}
          </NavLink>
          <NavLink to="/starred" className="nav-item">
            <Icon name="star" />
            <span className="nav-label">מסומנות בכוכב</span>
          </NavLink>
          <NavLink to="/events" className="nav-item">
            <Icon name="calendar_month" />
            <span className="nav-label">לוח אירועים</span>
          </NavLink>
          <NavLink to="/polls" className="nav-item">
            <Icon name="ballot" />
            <span className="nav-label">סקרים</span>
          </NavLink>
          <NavLink to="/contact" className="nav-item">
            <Icon name="mail" />
            <span className="nav-label">יצירת קשר עם הניהול</span>
          </NavLink>
          {isAdmin && pendingCount > 0 && (
            <NavLink to="/admin" className="nav-item">
              <Icon name="admin_panel_settings" />
              <span className="nav-label">ממתינים לאישור</span>
              <span className="badge-count">{pendingCount}</span>
            </NavLink>
          )}
          {isAdmin && openFeedback > 0 && (
            <NavLink to="/admin?tab=feedback" className="nav-item">
              <Icon name="mail" />
              <span className="nav-label">פניות חדשות</span>
              <span className="badge-count">{openFeedback}</span>
            </NavLink>
          )}
          {isAdmin && newJoins > 0 && (
            <NavLink to="/admin" className="nav-item">
              <Icon name="person_add" />
              <span className="nav-label">הצטרפו לפי שם</span>
              <span className="badge-count">{newJoins}</span>
            </NavLink>
          )}
        </nav>

        <div className="nav-section">
          <div className="nav-heading">
            <span>חדרים</span>
            <button className="icon-btn small" onClick={() => setNewRoom(true)} aria-label="חדר חדש" title="פתיחת חדר חדש">
              <Icon name="add" size={20} />
            </button>
          </div>
          {topicRooms.length === 0 && (
            <button className="nav-empty link-like" onClick={() => setNewRoom(true)}>פתיחת חדר לנושא מסוים</button>
          )}
          {topicRooms.map((r) => (
            <NavLink key={r.id} to={`/room/${r.id}`} className={`nav-item ${unreadOf(r) > 0 ? 'unread' : ''} ${mutedRooms.has(r.id) ? 'room-muted' : ''}`}>
              <SpaceTile name={r.name} size={24} announce={r.admin_only_post} />
              <span className="nav-label">{r.name}</span>
              {mutedRooms.has(r.id) && <Icon name="notifications_off" size={16} className="muted-icon" />}
              {unreadOf(r) > 0 && <span className="badge-count">{badge(unreadOf(r))}</span>}
            </NavLink>
          ))}
        </div>

        <div className="nav-section">
          <div className="nav-heading">
            <span>צ'אט אישי</span>
            <button className="icon-btn small" onClick={() => setNewChat(true)} aria-label="צ'אט חדש" title="צ'אט חדש">
              <Icon name="add" size={20} />
            </button>
          </div>
          {conversations.length === 0 && <div className="nav-empty">לחיצה על שם של חבר פותחת שיחה אישית</div>}
          {conversations.map((c) => (
            <NavLink key={c.id} to={`/dm/${c.id}`} className={`nav-item ${c.unread > 0 ? 'unread' : ''}`}>
              <Avatar id={c.other_id} name={convTitle(c)} size={24} anonymous={!c.other_id} online={!!c.other_id && online.has(c.other_id)} />
              <span className="nav-label">{convTitle(c)}</span>
              {c.i_am_hidden && (
                <span className="nav-hint" title="אתה בעילום שם בשיחה הזו">
                  <Icon name="visibility_off" size={12} /> אנונימי
                </span>
              )}
              {c.unread > 0 && <span className="badge-count">{badge(c.unread)}</span>}
            </NavLink>
          ))}
        </div>

        {isAdmin && (
          <div className="nav-section nav-admin">
            <div className="nav-heading"><span>ניהול</span></div>
            <NavLink to="/admin" className="nav-item">
              <Icon name="admin_panel_settings" />
              <span className="nav-label">ניהול הקהילה</span>
              {botAlerts + openReports > 0 && (
                <span className="badge-count" title="דיווחים פתוחים בפיקוח ודיווחים חדשים מהבוט">{botAlerts + openReports}</span>
              )}
            </NavLink>
          </div>
        )}
      </aside>

      <div className="scrim drawer-scrim" onClick={() => setDrawer(false)} />

      <main className="main">
        <Outlet />
      </main>

      {location.pathname !== '/bot' && (
        <Link to="/bot" className="bot-fab" aria-label={`צ'אט עם ${BOT_NAME}`} title={`צ'אט עם ${BOT_NAME}`}>
          <Icon name="smart_toy" filled size={28} />
          <span className="bot-fab-label">{BOT_NAME}</span>
        </Link>
      )}

      {newChat && <NewChatDialog onClose={() => setNewChat(false)} />}
      {newRoom && <RoomDialog onClose={() => setNewRoom(false)} />}
    </div>
  );
}

const badge = (n: number) => (n > 99 ? '99+' : String(n));
