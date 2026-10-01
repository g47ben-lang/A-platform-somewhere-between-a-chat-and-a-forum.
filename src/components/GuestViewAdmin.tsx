import { useState } from 'react';
import { useApp } from '../AppContext';
import { supabase } from '../supabase';
import { errorText, fullDate } from '../lib/format';
import { useFeedback } from './Feedback';
import Icon from './Icon';

const CHOICES = [
  { hours: 24, label: 'יום אחד' },
  { hours: 48, label: 'יומיים' },
  { hours: 72, label: 'שלושה ימים' },
  { hours: 168, label: 'שבוע' },
];

/** Owner-only tab (מנהל-על): temporarily let visitors read the rooms without logging in. Closes by itself at the end time. */
export default function GuestViewAdmin() {
  const { guestUntil } = useApp();
  const { confirm, toast } = useFeedback();
  const [until, setUntil] = useState<string | null>(guestUntil);
  const [busy, setBusy] = useState(false);
  const open = !!until && new Date(until) > new Date();

  async function set(hours: number) {
    if (hours > 0) {
      const ok = await confirm({
        title: 'פתיחת האתר לצפייה ללא התחברות',
        body: 'כל מי שייכנס לאתר יוכל לקרוא את ההודעות בחדרים ואת שמות הכותבים, בלי להתחבר. צ\'אטים אישיים, זהות כותבים אנונימיים, סקרים ו"עוד" נשארים סגורים, ואי אפשר לכתוב או להגיב בלי להתחבר. הצפייה תיסגר לבד בסוף הזמן.',
        confirmLabel: 'פתיחה לצפייה',
      });
      if (!ok) return;
    }
    setBusy(true);
    const { data, error } = await supabase.rpc('set_guest_view', { p_hours: hours });
    setBusy(false);
    if (error) return toast(errorText(error), 'error');
    setUntil((data as string | null) ?? null);
    toast(hours > 0 ? 'האתר פתוח לצפייה ללא התחברות' : 'הצפייה ללא התחברות נסגרה');
  }

  return (
    <section className="card-section">
      <div className="section-head">
        <h2>צפייה ללא התחברות</h2>
      </div>
      <p className="muted">
        לתקופה קצרה, כדי להכיר את האתר לציבור, אפשר לתת לכל אחד לקרוא את הצ'אט הראשי והחדרים בלי להתחבר. המבקרים רואים
        הודעה שזה זמני, ולא יכולים לכתוב, להגיב, לפתוח פרופילים או צ'אטים אישיים. בסוף הזמן הצפייה נסגרת לבד.
      </p>
      <div className={`guest-status ${open ? 'on' : ''}`}>
        <Icon name={open ? 'visibility' : 'lock'} size={20} />
        <span className="grow">{open ? `פתוח לצפייה עד ${fullDate(until!)}` : 'סגור: רק חברים מחוברים רואים את הצ\'אט'}</span>
        {open && (
          <button className="btn outlined small" disabled={busy} onClick={() => set(0)}>סגירה עכשיו</button>
        )}
      </div>
      <p className="small muted">{open ? 'הארכה מעכשיו:' : 'פתיחה ל:'}</p>
      <div className="chips">
        {CHOICES.map((c) => (
          <button key={c.hours} className="chip-btn" disabled={busy} onClick={() => set(c.hours)}>{c.label}</button>
        ))}
      </div>
    </section>
  );
}
