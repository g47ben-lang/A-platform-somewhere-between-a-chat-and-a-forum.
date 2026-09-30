import { useState } from 'react';
import { useApp } from '../AppContext';
import { supabase, SITE_NAME } from '../supabase';
import { errorText } from '../lib/format';
import Icon from '../components/Icon';

/** Shown once to every member (including pre-approved ones) until he accepts the content rules. */
export default function TermsGate() {
  const { me, reloadMe } = useApp();
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function accept() {
    setBusy(true);
    const { error } = await supabase.from('profiles').update({ terms_accepted_at: new Date().toISOString() }).eq('id', me!.id);
    setBusy(false);
    if (error) return setError(errorText(error));
    reloadMe();
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <span className="status-icon"><Icon name="shield_person" size={32} /></span>
        <h1 className="auth-title">ברוך הבא ל{SITE_NAME}</h1>
        <p className="auth-sub">לפני הכניסה, יש לאשר את תקנון התוכן של הקהילה.</p>
        <div className="terms-box">
          <strong>תקנון תוכן</strong>
          <ul>
            <li>מעלים לצ'אט רק תכנים, תמונות וסרטונים התואמים את מדיניות נטפרי, כדי למנוע את חסימת הצ'אט.</li>
            <li>משתמש שיעבור על כך יוסר מהקהילה לאלתר.</li>
          </ul>
        </div>
        <label className="terms">
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
          <span>קראתי ואני מצהיר שאעלה לצ'אט רק תכנים התואמים את מדיניות נטפרי.</span>
        </label>
        {error && <div className="alert error"><Icon name="error" size={18} /> {error}</div>}
        <div className="auth-actions">
          <button className="btn text" onClick={() => supabase.auth.signOut()}>התנתקות</button>
          <button className="btn filled" disabled={!agreed || busy} onClick={accept}>אישור וכניסה</button>
        </div>
      </div>
    </div>
  );
}
