import { useState, type FormEvent } from 'react';
import { useApp } from '../AppContext';
import { supabase } from '../supabase';
import { errorText } from '../lib/format';
import { notificationsEnabled, notificationsSupported, setNotificationsEnabled } from '../lib/notify';
import Avatar from '../components/Avatar';
import { useFeedback } from '../components/Feedback';
import Icon from '../components/Icon';
import PasswordFields, { passwordProblem } from '../components/PasswordFields';

export default function SettingsPage() {
  const { me, session, reloadMe } = useApp();
  const { toast } = useFeedback();
  const [name, setName] = useState(me?.display_name ?? '');
  const [bio, setBio] = useState(me?.bio ?? '');
  const [pw, setPw] = useState({ password: '', confirm: '' });
  const [notifyOn, setNotifyOn] = useState(notificationsEnabled());
  const [busy, setBusy] = useState(false);

  if (!me) return null;

  async function saveProfile(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.from('profiles').update({ display_name: name.trim(), bio: bio.trim() || null }).eq('id', me!.id);
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

  async function toggleNotify(on: boolean) {
    const result = await setNotificationsEnabled(on);
    setNotifyOn(result);
    if (on && !result) toast('הדפדפן לא אישר התראות. אפשר לאשר בהגדרות האתר בדפדפן.', 'error');
  }

  const dirty = name.trim() !== me.display_name || (bio.trim() || null) !== (me.bio ?? null);

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
            <textarea value={bio} onChange={(e) => setBio(e.target.value)} rows={3} maxLength={500} placeholder="כמה מילים שיופיעו בכרטיס שלך" />
            <span className="field-hint">{bio.length}/500</span>
          </label>
          <div className="form-actions">
            <button className="btn filled" disabled={busy || !dirty || !name.trim()}>שמירת שינויים</button>
          </div>
        </form>

        <section className="settings-card">
          <h2>התראות</h2>
          {notificationsSupported() ? (
            <label className="switch-row">
              <span>
                <strong>התראות בדפדפן</strong>
                <span className="muted small">התראה כשמגיעה הודעה אישית או כשמישהו מזכיר אותך, בזמן שהאתר פתוח ברקע.</span>
              </span>
              <input type="checkbox" className="switch" checked={notifyOn} onChange={(e) => toggleNotify(e.target.checked)} />
            </label>
          ) : (
            <p className="muted">הדפדפן הזה לא תומך בהתראות.</p>
          )}
        </section>

        <section className="settings-card">
          <h2>הודעות אנונימיות</h2>
          <p className="muted small">ההרשאות האלה נקבעות על ידי מנהלי הקהילה.</p>
          <PermRow on={me.can_send_anonymous} label="שליחת הודעות בעילום שם" />
          <PermRow on={me.accept_anonymous} label="קבלת הודעות אנונימיות" />
        </section>

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

function PermRow({ on, label }: { on: boolean; label: string }) {
  return (
    <div className="perm-row">
      <span className={`perm-state ${on ? 'on' : ''}`}>
        <Icon name={on ? 'check' : 'block'} size={18} />
      </span>
      <span className="grow">{label}</span>
      <span className="muted small">{on ? 'מותר' : 'חסום'}</span>
    </div>
  );
}
