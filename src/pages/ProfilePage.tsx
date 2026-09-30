import { useState, type FormEvent } from 'react';
import { useApp } from '../AppContext';
import { supabase } from '../supabase';
import { ROLE_LABEL } from '../util';
import Avatar from '../components/Avatar';

export default function ProfilePage() {
  const { me, session, reloadMe } = useApp();
  const [name, setName] = useState(me?.display_name ?? '');
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  if (!me) return null;

  async function saveName(e: FormEvent) {
    e.preventDefault();
    setMsg('');
    setErr('');
    const { error } = await supabase.from('profiles').update({ display_name: name.trim() }).eq('id', me!.id);
    if (error) setErr(error.message);
    else {
      setMsg('השם עודכן');
      reloadMe();
    }
  }

  async function savePassword(e: FormEvent) {
    e.preventDefault();
    setMsg('');
    setErr('');
    const { error } = await supabase.auth.updateUser({ password });
    if (error) setErr(error.message);
    else {
      setMsg('הסיסמה עודכנה');
      setPassword('');
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <div className="row">
          <Avatar id={me.id} name={me.display_name} size={56} />
          <div>
            <h1>{me.display_name}</h1>
            <p className="muted" dir="ltr">{session?.user.email}</p>
            <span className={`badge ${me.role}`}>{ROLE_LABEL[me.role]}</span>
          </div>
        </div>
      </div>
      {msg && <div className="info">{msg}</div>}
      {err && <div className="error">{err}</div>}
      <form className="card form" onSubmit={saveName}>
        <h2>שם תצוגה</h2>
        <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={40} />
        <button className="btn primary" disabled={!name.trim() || name.trim() === me.display_name}>שמירה</button>
      </form>
      <form className="card form" onSubmit={savePassword}>
        <h2>החלפת סיסמה</h2>
        <input type="password" dir="ltr" value={password} onChange={(e) => setPassword(e.target.value)} minLength={6} required autoComplete="new-password" placeholder="סיסמה חדשה" />
        <button className="btn primary">עדכון סיסמה</button>
      </form>
    </div>
  );
}
