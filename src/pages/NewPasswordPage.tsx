import { useState, type FormEvent } from 'react';
import { useApp } from '../AppContext';
import { supabase } from '../supabase';

export default function NewPasswordPage() {
  const { endRecovery } = useApp();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) setError(error.message);
    else endRecovery();
  }

  return (
    <div className="center-screen">
      <form className="card narrow auth" onSubmit={submit}>
        <h1>בחירת סיסמה חדשה</h1>
        <label>
          סיסמה חדשה
          <input type="password" dir="ltr" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} autoComplete="new-password" />
        </label>
        {error && <div className="error">{error}</div>}
        <button className="btn primary" disabled={busy}>שמירה</button>
      </form>
    </div>
  );
}
