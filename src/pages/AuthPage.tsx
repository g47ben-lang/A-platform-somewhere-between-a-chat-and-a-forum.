import { useState, type FormEvent } from 'react';
import { appUrl, supabase, SITE_NAME } from '../supabase';
import { errorText } from '../lib/format';
import Icon from '../components/Icon';
import PasswordFields, { passwordProblem } from '../components/PasswordFields';

type Mode = 'login' | 'signup' | 'reset';

export default function AuthPage() {
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pw, setPw] = useState({ password: '', confirm: '' });
  const [name, setName] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  function switchMode(m: Mode) {
    setMode(m);
    setError('');
    setInfo('');
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setInfo('');
    if (mode === 'signup') {
      if (name.trim().length < 2) return setError('יש להזין שם תצוגה (לפחות 2 תווים)');
      const problem = passwordProblem(pw.password, pw.confirm);
      if (problem) return setError(problem);
      if (!agreed) return setError('יש לאשר את תקנון התוכן כדי להירשם');
    }
    setBusy(true);
    try {
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
      } else if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password: pw.password,
          options: { data: { display_name: name.trim(), terms_accepted_at: new Date().toISOString() }, emailRedirectTo: appUrl() },
        });
        if (error) throw error;
        if (!data.session) setInfo('שלחנו אליך מייל לאימות הכתובת. לאחר האימות אפשר להתחבר.');
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: appUrl() });
        if (error) throw error;
        setInfo('אם הכתובת רשומה במערכת, נשלח אליה קישור לאיפוס הסיסמה.');
      }
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const heading = mode === 'login' ? 'התחברות' : mode === 'signup' ? 'יצירת חשבון' : 'איפוס סיסמה';
  const sub =
    mode === 'login' ? `המשך אל ${SITE_NAME}` : mode === 'signup' ? 'ההצטרפות מחייבת אישור של מנהלי הקהילה' : 'נשלח אליך קישור לבחירת סיסמה חדשה';

  return (
    <div className="auth-screen">
      <form className="auth-card" onSubmit={submit} noValidate>
        <div className="auth-brand">
          <span className="brand-mark large"><Icon name="forum" filled size={30} /></span>
          <span>{SITE_NAME}</span>
        </div>
        <h1 className="auth-title">{heading}</h1>
        <p className="auth-sub">{sub}</p>

        {mode === 'signup' && (
          <label className="field">
            <span>שם מלא / שם תצוגה</span>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} autoComplete="name" required />
          </label>
        )}
        <label className="field">
          <span>כתובת אימייל</span>
          <input type="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
        </label>
        {mode === 'login' && (
          <label className="field">
            <span>סיסמה</span>
            <div className="input-with-btn">
              <input
                type={showPw ? 'text' : 'password'}
                dir="ltr"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
              <button type="button" className="icon-btn small" onClick={() => setShowPw((s) => !s)} aria-label={showPw ? 'הסתרת הסיסמה' : 'הצגת הסיסמה'}>
                <Icon name={showPw ? 'visibility_off' : 'visibility'} size={20} />
              </button>
            </div>
          </label>
        )}
        {mode === 'signup' && <PasswordFields value={pw} onChange={setPw} label="סיסמה" />}
        {mode === 'signup' && (
          <label className="terms">
            <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} required />
            <span>
              <strong>תקנון תוכן:</strong> אני מצהיר שאעלה לצ'אט רק תכנים התואמים את מדיניות נטפרי, כדי למנוע את חסימת הצ'אט.
              ידוע לי שמשתמש שיעבור על כך יוסר מהקהילה לאלתר.
            </span>
          </label>
        )}

        {error && <div className="alert error"><Icon name="error" size={18} /> {error}</div>}
        {info && <div className="alert info"><Icon name="mail" size={18} /> {info}</div>}

        <div className="auth-actions">
          {mode === 'login' && (
            <button type="button" className="btn text" onClick={() => switchMode('reset')}>שכחת סיסמה?</button>
          )}
          {mode !== 'login' && (
            <button type="button" className="btn text" onClick={() => switchMode('login')}>יש לי כבר חשבון</button>
          )}
          <button className="btn filled" disabled={busy || !email.trim()}>
            {busy ? 'רגע…' : mode === 'login' ? 'התחברות' : mode === 'signup' ? 'יצירת חשבון' : 'שליחת קישור'}
          </button>
        </div>

        {mode === 'login' && (
          <div className="auth-footer">
            עדיין אין לך חשבון?{' '}
            <button type="button" className="link" onClick={() => switchMode('signup')}>יצירת חשבון</button>
          </div>
        )}
      </form>
    </div>
  );
}
