import { useEffect, useState } from 'react';
import { Navigate, Route, Routes, useParams } from 'react-router-dom';
import { useApp } from './AppContext';
import { isConfigured, supabase, SITE_NAME } from './supabase';
import Layout from './components/Layout';
import Icon from './components/Icon';
import AuthPage from './pages/AuthPage';
import RoomPage from './pages/RoomPage';
import DmPage from './pages/DmPage';
import ProfilePage from './pages/ProfilePage';
import SettingsPage from './pages/SettingsPage';
import SearchPage from './pages/SearchPage';
import AdminPage from './pages/AdminPage';
import NewPasswordPage from './pages/NewPasswordPage';
import StarredPage from './pages/StarredPage';
import PollsPage from './pages/PollsPage';
import ContactPage from './pages/ContactPage';
import EventsPage from './pages/EventsPage';
import FunPage from './pages/FunPage';
import ModerationPage from './pages/ModerationPage';
import TermsGate from './pages/TermsGate';
import GuestPage from './pages/GuestPage';
import BotPage from './pages/BotPage';

export default function App() {
  const { session, loading, me, isAdmin, recovering, schemaOutdated, isGuest } = useApp();
  // Guest view: visitors start on the login screen, which offers read-only entry while it is open.
  const [guestMode, setGuestMode] = useState(false);

  if (!isConfigured) {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <h1 className="auth-title">{SITE_NAME}</h1>
          <p className="auth-sub">האתר עדיין לא מחובר למסד נתונים (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).</p>
        </div>
      </div>
    );
  }

  if (loading) return <div className="auth-screen"><div className="spinner" /></div>;
  if (!session) {
    if (isGuest && guestMode) return <GuestPage onLogin={() => setGuestMode(false)} />;
    return <AuthPage onGuest={isGuest ? () => setGuestMode(true) : undefined} />;
  }
  if (recovering) return <NewPasswordPage />;

  if (!me || me.status !== 'active') {
    const banned = me?.status === 'banned';
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <span className={`status-icon ${banned ? 'bad' : ''}`}>
            <Icon name={banned ? 'block' : 'shield_person'} size={32} />
          </span>
          <h1 className="auth-title">{banned ? 'הגישה לחשבון חסומה' : me?.removed_at ? 'הוסרת מהקבוצה' : 'החשבון ממתין לאישור'}</h1>
          <p className="auth-sub">
            {banned
              ? 'החשבון הושעה על ידי מנהלי הקהילה.'
              : me?.removed_at
              ? 'מנהלי הקהילה הסירו אותך מהקבוצה. זו לא חסימה: החשבון שלך נשמר, ואם מנהל יאשר אותך שוב, הדף ייפתח אוטומטית.'
              : `שלום ${me?.display_name ?? ''}, בקשת ההצטרפות התקבלה. השם או המייל שלך לא נמצאו ברשימות המאושרות, ולכן מנהל יבדוק את הבקשה. אם היא תאושר, הדף ייפתח אוטומטית.`}
          </p>
          <div className="auth-actions">
            <span />
            <button className="btn outlined" onClick={() => supabase.auth.signOut()}>התנתקות</button>
          </div>
        </div>
      </div>
    );
  }

  if (schemaOutdated) return <SchemaOutdated detail={schemaOutdated} isAdmin={isAdmin} />;
  if (!me.terms_accepted_at) return <TermsGate />;

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<RoomPage />} />
        <Route path="room/:roomId" element={<RoomPage />} />
        <Route path="dm/:convId" element={<DmPage />} />
        <Route path="u/:userId" element={<ProfilePage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="starred" element={<StarredPage />} />
        <Route path="polls" element={<PollsPage />} />
        <Route path="polls/:pollId" element={<PollsPage />} />
        <Route path="contact" element={<ContactPage />} />
        <Route path="events" element={<EventsPage />} />
        <Route path="bot" element={<BotPage />} />
        <Route path="more" element={<FunPage />} />
        <Route path="moderation" element={isAdmin ? <ModerationPage /> : <Navigate to="/" />} />
        <Route path="fun" element={<Navigate to="/more" replace />} />
        <Route path="search" element={<SearchPage />} />
        <Route path="admin" element={isAdmin ? <AdminPage /> : <Navigate to="/" />} />
        {/* links from earlier versions */}
        <Route path="space/:roomId/*" element={<LegacyRoom />} />
        <Route path="c/:roomId" element={<LegacyRoom />} />
        <Route path="profile" element={<Navigate to="/settings" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

function LegacyRoom() {
  const { rooms } = useApp();
  const id = Number(useParams().roomId);
  const room = rooms.find((r) => r.id === id);
  if (rooms.length === 0) return null;
  return <Navigate to={room && !room.is_main ? `/room/${id}` : '/'} replace />;
}

/** Shown when the site is newer than the database. Rechecks on its own every 10 seconds. */
function SchemaOutdated({ detail, isAdmin }: { detail: string; isAdmin: boolean }) {
  const { reloadRooms, me } = useApp();
  useEffect(() => {
    const t = setInterval(reloadRooms, 10000);
    return () => clearInterval(t);
  }, [reloadRooms]);
  return (
    <div className="auth-screen">
      <div className="auth-card">
        <span className="status-icon"><Icon name="settings" size={32} /></span>
        <h1 className="auth-title">הצ'אט בעדכון כרגע</h1>
        {isAdmin ? (
          <p className="auth-sub">
            האתר עודכן, אבל מסד הנתונים עדיין בגרסה הקודמת. יש להדביק את כל הקובץ <code>supabase/schema.sql</code> העדכני
            ב-Supabase ← SQL Editor ← Run. אם מופיעה שגיאה אדומה, צלמו אותה. הדף ייפתח לבד תוך כמה שניות מסיום העדכון.
          </p>
        ) : (
          <p className="auth-sub">כנס שוב מאוחר יותר. הדף גם ייפתח לבד כשהעדכון יסתיים.</p>
        )}
        {isAdmin && <pre className="error-detail" dir="ltr">{detail}{'\n'}user: {me?.display_name} ({me?.role})</pre>}
        <div className="auth-actions">
          <span />
          <button className="btn filled" onClick={() => window.location.reload()}>רענון</button>
        </div>
      </div>
    </div>
  );
}
