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

export default function App() {
  const { session, loading, me, isAdmin, recovering, schemaOutdated } = useApp();

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
  if (!session) return <AuthPage />;
  if (recovering) return <NewPasswordPage />;

  if (!me || me.status !== 'active') {
    const banned = me?.status === 'banned';
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <span className={`status-icon ${banned ? 'bad' : ''}`}>
            <Icon name={banned ? 'block' : 'shield_person'} size={32} />
          </span>
          <h1 className="auth-title">{banned ? 'הגישה לחשבון חסומה' : 'החשבון ממתין לאישור'}</h1>
          <p className="auth-sub">
            {banned
              ? 'החשבון הושעה על ידי מנהלי הקהילה.'
              : `שלום ${me?.display_name ?? ''}, בקשת ההצטרפות התקבלה. ברגע שמנהל/ת יאשרו אותה, הדף ייפתח אוטומטית.`}
          </p>
          <div className="auth-actions">
            <span />
            <button className="btn outlined" onClick={() => supabase.auth.signOut()}>התנתקות</button>
          </div>
        </div>
      </div>
    );
  }

  if (schemaOutdated) {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <span className="status-icon"><Icon name="settings" size={32} /></span>
          <h1 className="auth-title">המערכת בעדכון</h1>
          <p className="auth-sub">
            {isAdmin
              ? 'יש להריץ את הקובץ supabase/schema.sql המעודכן ב-Supabase (SQL Editor ← Run) ואז לרענן את הדף.'
              : 'האתר מתעדכן כרגע. נסו שוב בעוד כמה דקות.'}
          </p>
          <div className="auth-actions">
            <span />
            <button className="btn filled" onClick={() => window.location.reload()}>רענון</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<RoomPage />} />
        <Route path="room/:roomId" element={<RoomPage />} />
        <Route path="dm/:convId" element={<DmPage />} />
        <Route path="u/:userId" element={<ProfilePage />} />
        <Route path="settings" element={<SettingsPage />} />
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
