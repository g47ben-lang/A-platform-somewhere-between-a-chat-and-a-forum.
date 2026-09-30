import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useApp } from '../AppContext';
import { supabase, SITE_NAME } from '../supabase';
import Avatar from './Avatar';

export default function Layout() {
  const { me, channels, online, isAdmin, profiles } = useApp();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const pendingCount = isAdmin ? [...profiles.values()].filter((p) => p.status === 'pending').length : 0;

  useEffect(() => setOpen(false), [location.pathname]);

  return (
    <div className={`shell ${open ? 'drawer-open' : ''}`}>
      <aside className="sidebar">
        <div className="brand">
          <NavLink to="/">💬 {SITE_NAME}</NavLink>
        </div>
        <nav className="nav">
          <NavLink to="/" end className="nav-item">🏠 ראשי</NavLink>
          <NavLink to="/search" className="nav-item">🔎 חיפוש</NavLink>
          <NavLink to="/members" className="nav-item">
            👥 חברים <span className="pill online">{online.size} מחוברים</span>
          </NavLink>
          {isAdmin && (
            <NavLink to="/admin" className="nav-item">
              ⚙️ ניהול {pendingCount > 0 && <span className="pill alert">{pendingCount}</span>}
            </NavLink>
          )}
        </nav>
        <div className="nav-heading">ערוצים</div>
        <nav className="nav channels">
          {channels.map((c) => (
            <NavLink key={c.id} to={`/c/${c.id}`} className="nav-item">
              <span className="hash">{c.admin_only_post ? '📢' : '#'}</span> {c.name}
            </NavLink>
          ))}
        </nav>
        {me && (
          <div className="me-box">
            <NavLink to="/profile" className="me-link">
              <Avatar id={me.id} name={me.display_name} size={32} online />
              <span>{me.display_name}</span>
            </NavLink>
            <button className="btn ghost small" onClick={() => supabase.auth.signOut()}>יציאה</button>
          </div>
        )}
      </aside>
      <div className="backdrop" onClick={() => setOpen(false)} />
      <main className="main">
        <header className="mobile-bar">
          <button className="icon-btn" onClick={() => setOpen(true)} aria-label="תפריט">☰</button>
          <span>{SITE_NAME}</span>
        </header>
        <Outlet />
      </main>
    </div>
  );
}
