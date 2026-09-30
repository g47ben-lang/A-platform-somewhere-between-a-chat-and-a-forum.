import { Navigate, Route, Routes } from 'react-router-dom';
import { useApp } from './AppContext';
import { isConfigured, supabase, SITE_NAME } from './supabase';
import Layout from './components/Layout';
import AuthPage from './pages/AuthPage';
import HomePage from './pages/HomePage';
import ChannelPage from './pages/ChannelPage';
import ThreadPage from './pages/ThreadPage';
import AdminPage from './pages/AdminPage';
import ProfilePage from './pages/ProfilePage';
import SearchPage from './pages/SearchPage';
import MembersPage from './pages/MembersPage';
import NewPasswordPage from './pages/NewPasswordPage';

export default function App() {
  const { session, loading, me, isAdmin, recovering } = useApp();

  if (!isConfigured) {
    return (
      <div className="center-screen">
        <div className="card narrow">
          <h1>{SITE_NAME}</h1>
          <p>האתר עדיין לא מחובר למסד נתונים.</p>
          <p className="muted">
            יש להגדיר את <code>VITE_SUPABASE_URL</code> ו-<code>VITE_SUPABASE_ANON_KEY</code> (ראו README).
          </p>
        </div>
      </div>
    );
  }

  if (loading) return <div className="center-screen"><div className="spinner" /></div>;
  if (!session) return <AuthPage />;
  if (recovering) return <NewPasswordPage />;

  if (!me || me.status !== 'active') {
    const banned = me?.status === 'banned';
    return (
      <div className="center-screen">
        <div className="card narrow">
          <h1>{banned ? 'הגישה חסומה' : 'כמעט שם! ⏳'}</h1>
          <p>
            {banned
              ? 'החשבון שלך הושעה על ידי הנהלת הקהילה.'
              : `שלום ${me?.display_name ?? ''}, ההרשמה התקבלה. מנהל/ת יאשרו אותך בקרוב והדף ייפתח אוטומטית.`}
          </p>
          <button className="btn ghost" onClick={() => supabase.auth.signOut()}>התנתקות</button>
        </div>
      </div>
    );
  }

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<HomePage />} />
        <Route path="c/:channelId" element={<ChannelPage />} />
        <Route path="t/:threadId" element={<ThreadPage />} />
        <Route path="search" element={<SearchPage />} />
        <Route path="members" element={<MembersPage />} />
        <Route path="profile" element={<ProfilePage />} />
        <Route path="admin" element={isAdmin ? <AdminPage /> : <Navigate to="/" />} />
        <Route path="*" element={<Navigate to="/" />} />
      </Route>
    </Routes>
  );
}
