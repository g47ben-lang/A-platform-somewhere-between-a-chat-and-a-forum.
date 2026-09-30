import { useEffect, useState } from 'react';
import { Navigate, Route, Routes, useParams } from 'react-router-dom';
import { useApp } from './AppContext';
import { isConfigured, supabase, SITE_NAME } from './supabase';
import Layout from './components/Layout';
import Icon from './components/Icon';
import AuthPage from './pages/AuthPage';
import HomePage from './pages/HomePage';
import SpacePage from './pages/SpacePage';
import DmPage from './pages/DmPage';
import ProfilePage from './pages/ProfilePage';
import SettingsPage from './pages/SettingsPage';
import MembersPage from './pages/MembersPage';
import SearchPage from './pages/SearchPage';
import AdminPage from './pages/AdminPage';
import NewPasswordPage from './pages/NewPasswordPage';

export default function App() {
  const { session, loading, me, isAdmin, recovering } = useApp();

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

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<HomePage />} />
        <Route path="space/:spaceId" element={<SpacePage />} />
        <Route path="space/:spaceId/t/:threadId" element={<SpacePage />} />
        <Route path="dm/:convId" element={<DmPage />} />
        <Route path="u/:userId" element={<ProfilePage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="members" element={<MembersPage />} />
        <Route path="search" element={<SearchPage />} />
        <Route path="admin" element={isAdmin ? <AdminPage /> : <Navigate to="/" />} />
        {/* v1 links */}
        <Route path="c/:spaceId" element={<LegacySpace />} />
        <Route path="t/:threadId" element={<LegacyThread />} />
        <Route path="profile" element={<Navigate to="/settings" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

function LegacySpace() {
  return <Navigate to={`/space/${useParams().spaceId}`} replace />;
}

function LegacyThread() {
  const id = useParams().threadId;
  const [target, setTarget] = useState<string | null>(null);
  useEffect(() => {
    supabase.from('threads').select('channel_id').eq('id', Number(id)).maybeSingle().then(({ data }) => {
      setTarget(data ? `/space/${data.channel_id}/t/${id}` : '/');
    });
  }, [id]);
  return target ? <Navigate to={target} replace /> : null;
}
