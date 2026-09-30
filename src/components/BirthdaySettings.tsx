import { useEffect, useState } from 'react';
import { useApp } from '../AppContext';
import { supabase } from '../supabase';
import { errorText } from '../lib/format';
import { useFeedback } from './Feedback';

interface Birthday {
  birth_date: string;
  after_sunset: boolean;
  show_profile: boolean;
  announce: boolean;
}

const DAYS = ['א\'', 'ב\'', 'ג\'', 'ד\'', 'ה\'', 'ו\'', 'ז\'', 'ח\'', 'ט\'', 'י\'', 'י"א', 'י"ב', 'י"ג', 'י"ד', 'ט"ו', 'ט"ז', 'י"ז', 'י"ח', 'י"ט', 'כ\'',
  'כ"א', 'כ"ב', 'כ"ג', 'כ"ד', 'כ"ה', 'כ"ו', 'כ"ז', 'כ"ח', 'כ"ט', 'ל\''];

/** Hebrew day and month of a birth date, e.g. 'י"ב בחשון' (same style as the server's hebrew_label). */
export function hebrewDay(iso: string, afterSunset: boolean): string {
  const d = new Date(iso + 'T12:00:00Z');
  if (afterSunset) d.setUTCDate(d.getUTCDate() + 1);
  const parts = new Intl.DateTimeFormat('he-u-ca-hebrew', { timeZone: 'UTC', day: 'numeric', month: 'long' }).formatToParts(d);
  const day = Number(parts.find((x) => x.type === 'day')?.value);
  const month = parts.find((x) => x.type === 'month')?.value ?? '';
  return `${DAYS[day - 1] ?? day} ב${month.replace(/^ב/, "")}`;
}

/** Birth date (private): the Hebrew birthday shows on the profile and gets a greeting in the main room. */
export default function BirthdaySettings() {
  const { me } = useApp();
  const { toast } = useFeedback();
  const [b, setB] = useState<Birthday | null>(null);
  const [had, setHad] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!me) return;
    supabase
      .from('birthdays')
      .select('birth_date, after_sunset, show_profile, announce')
      .eq('user_id', me.id)
      .maybeSingle()
      .then(({ data }) => {
        setHad(!!data);
        setB((data as Birthday) ?? { birth_date: '', after_sunset: false, show_profile: true, announce: true });
      });
  }, [me]);

  if (!b || !me) return null;
  const today = new Date().toISOString().slice(0, 10);

  async function save() {
    setBusy(true);
    const { error } = await supabase.from('birthdays').upsert({ user_id: me!.id, ...b });
    setBusy(false);
    if (error) return toast(errorText(error), 'error');
    setHad(true);
    toast('יום ההולדת נשמר');
  }

  async function remove() {
    const { error } = await supabase.from('birthdays').delete().eq('user_id', me!.id);
    if (error) return toast(errorText(error), 'error');
    setHad(false);
    setB({ birth_date: '', after_sunset: false, show_profile: true, announce: true });
  }

  return (
    <section className="settings-card">
      <h2>יום הולדת</h2>
      <p className="muted small">תאריך הלידה נשאר פרטי. ביום ההולדת העברי תתפרסם ברכה בצ'אט הראשי, ואפשר להציג את היום העברי (בלי שנה) בפרופיל.</p>
      <label className="field inline">
        <span>תאריך לידה (לועזי)</span>
        <input type="date" value={b.birth_date} max={today} min="1900-01-01" onChange={(e) => setB({ ...b, birth_date: e.target.value })} />
      </label>
      {b.birth_date && <p className="hebrew-day">יום ההולדת העברי: <strong>{hebrewDay(b.birth_date, b.after_sunset)}</strong></p>}
      <label className="check-row">
        <input type="checkbox" checked={b.after_sunset} onChange={(e) => setB({ ...b, after_sunset: e.target.checked })} />
        <span>נולדתי אחרי השקיעה</span>
      </label>
      <label className="check-row">
        <input type="checkbox" checked={b.announce} onChange={(e) => setB({ ...b, announce: e.target.checked })} />
        <span>לפרסם ברכת מזל טוב בצ'אט הראשי</span>
      </label>
      <label className="check-row">
        <input type="checkbox" checked={b.show_profile} onChange={(e) => setB({ ...b, show_profile: e.target.checked })} />
        <span>להציג את יום ההולדת העברי בפרופיל</span>
      </label>
      <div className="form-actions">
        {had && <button className="btn text danger" onClick={remove}>מחיקה</button>}
        <button className="btn filled" disabled={busy || !b.birth_date} onClick={save}>שמירה</button>
      </div>
    </section>
  );
}
