import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useApp } from '../AppContext';
import { supabase, SITE_NAME } from '../supabase';
import type { Conversation } from '../types';
import Avatar, { SpaceTile } from './Avatar';
import Icon from './Icon';
import NewChatDialog from './NewChatDialog';

export function useConversationTitle() {
  const { nameOf } = useApp();
  return (c: Conversation) => (c.other_id ? nameOf(c.other_id) : 'משתמש אנונימי');
}

export default function Layout() {
  const { me, channels, conversations, online, isAdmin, profiles } = useApp();
  const [drawer, setDrawer] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [newChat, setNewChat] = useState(false);
  const [menu, setMenu] = useState(false);
  const [q, setQ] = useState('');
  const location = useLocation();
  const navigate = useNavigate();
  const convTitle = useConversationTitle();
  const menuRef = useRef<HTMLDivElement>(null);

  const pendingCount = isAdmin ? [...profiles.values()].filter((p) => p.status === 'pending').length : 0;
  const unreadTotal = conversations.reduce((n, c) => n + c.unread, 0);

  useEffect(() => {
    setDrawer(false);
    setMenu(false);
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
              <button className="menu-item" onClick={() => supabase.auth.signOut()}><Icon name="logout" /> התנתקות</button>
            </div>
          )}
        </div>
      </header>

      <aside className="sidebar">
        <button className="new-chat" onClick={() => setNewChat(true)}>
          <Icon name="edit" />
          <span>צ'אט חדש</span>
        </button>

        <nav className="nav">
          <NavLink to="/" end className="nav-item">
            <Icon name="home" />
            <span className="nav-label">דף הבית</span>
          </NavLink>
          <NavLink to="/members" className="nav-item">
            <Icon name="group" />
            <span className="nav-label">חברי הקהילה</span>
            <span className="nav-meta">{online.size > 0 ? `${online.size} מחוברים` : ''}</span>
          </NavLink>
          {isAdmin && (
            <NavLink to="/admin" className="nav-item">
              <Icon name="admin_panel_settings" />
              <span className="nav-label">ניהול</span>
              {pendingCount > 0 && <span className="badge-count">{pendingCount}</span>}
            </NavLink>
          )}
        </nav>

        <div className="nav-section">
          <div className="nav-heading">
            <span>צ'אט</span>
            <button className="icon-btn small" onClick={() => setNewChat(true)} aria-label="צ'אט חדש" title="צ'אט חדש">
              <Icon name="add" size={20} />
            </button>
          </div>
          {conversations.length === 0 && <div className="nav-empty">אין עדיין שיחות</div>}
          {conversations.map((c) => (
            <NavLink key={c.id} to={`/dm/${c.id}`} className={`nav-item ${c.unread > 0 ? 'unread' : ''}`}>
              <Avatar id={c.other_id} name={convTitle(c)} size={24} anonymous={!c.other_id} online={!!c.other_id && online.has(c.other_id)} />
              <span className="nav-label">{convTitle(c)}</span>
              {c.i_am_hidden && (
                <span className="nav-hint" title="את/ה בעילום שם בשיחה הזו">
                  <Icon name="visibility_off" size={12} /> אנונימי
                </span>
              )}
              {c.unread > 0 && <span className="badge-count">{c.unread}</span>}
            </NavLink>
          ))}
        </div>

        <div className="nav-section">
          <div className="nav-heading"><span>מרחבים</span></div>
          {channels.map((c) => (
            <NavLink key={c.id} to={`/space/${c.id}`} className="nav-item">
              <SpaceTile name={c.name} size={24} announce={c.admin_only_post} />
              <span className="nav-label">{c.name}</span>
            </NavLink>
          ))}
        </div>
      </aside>

      <div className="scrim drawer-scrim" onClick={() => setDrawer(false)} />

      <main className="main">
        <Outlet />
      </main>

      {newChat && <NewChatDialog onClose={() => setNewChat(false)} />}
    </div>
  );
}
