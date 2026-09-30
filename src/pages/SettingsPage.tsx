import { useState, type FormEvent } from 'react';
import { useApp } from '../AppContext';
import { supabase } from '../supabase';
import { errorText } from '../lib/format';
import Avatar from '../components/Avatar';
import { useFeedback } from '../components/Feedback';
import PasswordFields, { passwordProblem } from '../components/PasswordFields';

export default function SettingsPage() {
  const { me, session, reloadMe } = useApp();
  const { toast } = useFeedback();
  const [name, setName] = useState(me?.display_name ?? '');
  const [bio, setBio] = useState(me?.bio ?? '');
  const [acceptAnon, setAcceptAnon] = useState(me?.accept_anonymous ?? true);
  const [pw, setPw] = useState({ password: '', confirm: '' });
  const [busy, setBusy] = useState(false);

  if (!me) return null;

  async function saveProfile(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase
      .from('profiles')
      .update({ display_name: name.trim(), bio: bio.trim() || null, accept_anonymous: acceptAnon })
      .eq('id', me!.id);
    setBusy(false);
    if (error) return toast(errorText(error), 'error');
    toast('הפרופיל נשמר');
    reloadMe();
  }

  async function savePassword(e: FormEvent) {
    e.preventDefault();
    const problem = passwordProblem(pw.password, pw.confirm);
    if (problem) return toast(problem, 'error');
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw.password });
    setBusy(false);
    if (error) return toast(errorText(error), 'error');
    toast('הסיסמה עודכנה');
    setPw({ password: '', confirm: '' });
  }

  const dirty = name.trim() !== me.display_name || (bio.trim() || null) !== (me.bio ?? null) || acceptAnon !== me.accept_anonymous;

  return (
    <div className="pane scroll-pane">
      <div className="page narrow-page">
        <header className="page-head">
          <h1>הגדרות</h1>
        </header>

        <form className="settings-card" onSubmit={saveProfile}>
          <h2>פרופיל</h2>
          <div className="row gap center">
            <Avatar id={me.id} name={name || me.display_name} size={56} />
            <div className="muted small" dir="ltr">{session?.user.email}</div>
          </div>
          <label className="field">
            <span>שם תצוגה</span>
            <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={40} />
          </label>
          <label className="field">
            <span>קצת עליי</span>
            <textarea value={bio} onChange={(e) => setBio(e.target.value)} rows={3} maxLength={500} placeholder="כמה מילים שיופיעו בפרופיל שלך" />
            <span className="field-hint">{bio.length}/500</span>
          </label>
          <label className="switch-row">
            <span>
              <strong>קבלת הודעות אנונימיות</strong>
              <span className="muted small">כשהאפשרות כבויה, אי אפשר לשלוח לך הודעות פרטיות אנונימיות או לכתוב בפרופיל שלך בעילום שם.</span>
            </span>
            <input type="checkbox" className="switch" checked={acceptAnon} onChange={(e) => setAcceptAnon(e.target.checked)} />
          </label>
          <div className="form-actions">
            <button className="btn filled" disabled={busy || !dirty || !name.trim()}>שמירת שינויים</button>
          </div>
        </form>

        <form className="settings-card" onSubmit={savePassword}>
          <h2>החלפת סיסמה</h2>
          <PasswordFields value={pw} onChange={setPw} />
          <div className="form-actions">
            <button className="btn filled" disabled={busy || !pw.password}>עדכון סיסמה</button>
          </div>
        </form>
      </div>
    </div>
  );
}
