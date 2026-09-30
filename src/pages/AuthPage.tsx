import { useState, type FormEvent } from 'react';
import { appUrl, supabase, SITE_NAME } from '../supabase';

type Mode = 'login' | 'signup' | 'reset';

export default function AuthPage() {
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setInfo('');
    try {
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { display_name: name.trim() }, emailRedirectTo: appUrl() },
        });
        if (error) throw error;
        if (!data.session) setInfo('נשלח אליך מייל לאימות הכתובת. אחרי האימות אפשר להתחבר.');
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: appUrl() });
        if (error) throw error;
        setInfo('אם הכתובת רשומה, נשלח אליה קישור לאיפוס סיסמה.');
      }
    } catch (err) {
      setError(translateError((err as Error).message));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="center-screen">
      <form className="card narrow auth" onSubmit={submit}>
        <h1>💬 {SITE_NAME}</h1>
        <div className="tabs">
          <button type="button" className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>התחברות</button>
          <button type="button" className={mode === 'signup' ? 'active' : ''} onClick={() => setMode('signup')}>הרשמה</button>
        </div>
        {mode === 'signup' && (
          <label>
            שם תצוגה
            <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={40} autoComplete="name" />
          </label>
        )}
        <label>
          אימייל
          <input type="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
        </label>
        {mode !== 'reset' && (
          <label>
            סיסמה
            <input
              type="password"
              dir="ltr"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            />
          </label>
        )}
        {error && <div className="error">{error}</div>}
        {info && <div className="info">{info}</div>}
        <button className="btn primary" disabled={busy}>
          {mode === 'login' ? 'כניסה' : mode === 'signup' ? 'יצירת חשבון' : 'שליחת קישור איפוס'}
        </button>
        {mode === 'login' && (
          <button type="button" className="link" onClick={() => setMode('reset')}>שכחתי סיסמה</button>
        )}
        {mode === 'reset' && (
          <button type="button" className="link" onClick={() => setMode('login')}>חזרה להתחברות</button>
        )}
        {mode === 'signup' && <p className="muted small">אחרי ההרשמה, מנהל/ת הקהילה יאשרו את החשבון.</p>}
      </form>
    </div>
  );
}

function translateError(msg: string): string {
  if (/Invalid login credentials/i.test(msg)) return 'אימייל או סיסמה שגויים';
  if (/already registered/i.test(msg)) return 'כתובת האימייל כבר רשומה';
  if (/Email not confirmed/i.test(msg)) return 'יש לאשר קודם את כתובת האימייל (בדקו את תיבת הדואר)';
  if (/Password should be/i.test(msg)) return 'הסיסמה חייבת להכיל לפחות 6 תווים';
  if (/rate limit/i.test(msg)) return 'יותר מדי ניסיונות, נסו שוב בעוד כמה דקות';
  return msg;
}
