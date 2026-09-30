import { useState, type FormEvent } from 'react';
import { useApp } from '../AppContext';
import { supabase } from '../supabase';
import { errorText } from '../lib/format';
import Icon from '../components/Icon';
import PasswordFields, { passwordProblem } from '../components/PasswordFields';

export default function NewPasswordPage() {
  const { endRecovery } = useApp();
  const [pw, setPw] = useState({ password: '', confirm: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const problem = passwordProblem(pw.password, pw.confirm);
    if (problem) return setError(problem);
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw.password });
    setBusy(false);
    if (error) setError(errorText(error));
    else endRecovery();
  }

  return (
    <div className="auth-screen">
      <form className="auth-card" onSubmit={submit} noValidate>
        <h1 className="auth-title">בחירת סיסמה חדשה</h1>
        <p className="auth-sub">הסיסמה תחליף את הסיסמה הקודמת שלך.</p>
        <PasswordFields value={pw} onChange={setPw} />
        {error && <div className="alert error"><Icon name="error" size={18} /> {error}</div>}
        <div className="auth-actions">
          <span />
          <button className="btn filled" disabled={busy}>שמירת הסיסמה</button>
        </div>
      </form>
    </div>
  );
}
