import { useEffect, useState } from 'react';
import { useApp } from '../AppContext';
import { OWNER_EMAIL, supabase } from '../supabase';
import { errorText } from '../lib/format';
import { useFeedback } from './Feedback';

interface Prefs {
  enabled: boolean;
  on_dm: boolean;
  dm_preview: boolean;
  on_mention: boolean;
  on_reply: boolean;
  on_poll: boolean;
  on_birthday: boolean;
  on_feedback: boolean;
  on_nickname: boolean;
  rooms: number[];
  frequency: 'instant' | 'hourly' | 'daily';
  delay_minutes: number;
  daily_hour: number;
  only_unread: boolean;
  no_shabbat: boolean;
  quiet_from: number | null;
  quiet_to: number | null;
  max_per_day: number;
}

const DEFAULTS: Prefs = {
  enabled: false, on_dm: true, dm_preview: true, on_mention: true, on_reply: true, on_poll: false, on_birthday: false,
  on_feedback: true, on_nickname: true, rooms: [], frequency: 'instant', delay_minutes: 10, daily_hour: 20,
  only_unread: true, no_shabbat: true, quiet_from: null, quiet_to: null, max_per_day: 20,
};

const EVENTS: [keyof Prefs, string, string][] = [
  ['on_dm', 'הודעה אישית חדשה', 'כולל הודעות אנונימיות (בלי לחשוף את השולח).'],
  ['on_mention', 'מישהו הזכיר אותי (@השם שלי)', ''],
  ['on_reply', 'תגובה בציטוט להודעה שלי', ''],
  ['on_poll', 'סקר חדש נפתח', ''],
  ['on_birthday', 'יום הולדת של חבר', ''],
  ['on_nickname', 'הציעו לי כינוי', ''],
  ['on_feedback', 'הניהול ענה לפנייה שלי', ''],
];

const hour = (h: number) => `${String(h).padStart(2, '0')}:00`;

/** Per-member email notification settings: what, how often, and when not to. */
export default function EmailSettings() {
  const { me, session, rooms } = useApp();
  const { toast } = useFeedback();
  const [p, setP] = useState<Prefs | null>(null);
  const [saved, setSaved] = useState<string>('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!me) return;
    supabase
      .from('email_prefs')
      .select('*')
      .eq('user_id', me.id)
      .maybeSingle()
      .then(({ data }) => {
        const v = { ...DEFAULTS, ...((data as Partial<Prefs>) ?? {}) };
        setP(v);
        setSaved(JSON.stringify(v));
      });
  }, [me]);

  if (!p || !me) return <section className="settings-card"><h2>התראות במייל</h2><div className="spinner" /></section>;

  const set = <K extends keyof Prefs>(k: K, v: Prefs[K]) => setP({ ...p, [k]: v });
  const dirty = JSON.stringify(p) !== saved;
  const fake = session?.user.email?.toLowerCase() === OWNER_EMAIL;

  async function save(next: Prefs = p!) {
    setBusy(true);
    const { error } = await supabase.from('email_prefs').upsert({ user_id: me!.id, ...next });
    setBusy(false);
    if (error) return toast(errorText(error), 'error');
    setSaved(JSON.stringify(next));
    toast('הגדרות המייל נשמרו');
  }

  function toggleRoom(id: number, on: boolean) {
    set('rooms', on ? [...p!.rooms, id] : p!.rooms.filter((r) => r !== id));
  }

  return (
    <section className="settings-card email-settings">
      <h2>התראות במייל</h2>
      <label className="switch-row">
        <span>
          <strong>לקבל התראות במייל</strong>
          <span className="muted small" dir="auto">אל {session?.user.email}. אפשר לבחור בדיוק על מה, מתי וכמה.</span>
        </span>
        <input type="checkbox" className="switch" checked={p.enabled} onChange={(e) => { const n = { ...p, enabled: e.target.checked }; setP(n); save(n); }} />
      </label>
      {fake && p.enabled && <div className="alert error">הכתובת של החשבון הזה לא קיימת באמת, ולכן לא יישלחו אליה מיילים.</div>}

      {p.enabled && (
        <>
          <h3>על מה לשלוח</h3>
          <div className="check-group">
            {EVENTS.map(([k, label, hint]) => (
              <div key={k}>
                <label className="check-row">
                  <input type="checkbox" checked={p[k] as boolean} onChange={(e) => set(k, e.target.checked as never)} />
                  <span>{label}{hint && <span className="muted small"> · {hint}</span>}</span>
                </label>
                {k === 'on_dm' && p.on_dm && (
                  <label className="check-row sub">
                    <input type="checkbox" checked={p.dm_preview} onChange={(e) => set('dm_preview', e.target.checked)} />
                    <span>לכלול את תוכן ההודעה האישית במייל</span>
                  </label>
                )}
              </div>
            ))}
          </div>

          <h3>כל הודעה בחדרים שאני עוקב אחריהם</h3>
          <div className="room-checks">
            {rooms.map((r) => (
              <label key={r.id} className="check-row">
                <input type="checkbox" checked={p.rooms.includes(r.id)} onChange={(e) => toggleRoom(r.id, e.target.checked)} />
                <span>{r.is_main ? 'הצ\'אט הראשי' : r.name}</span>
              </label>
            ))}
          </div>

          <h3>מתי</h3>
          <div className="chip-row">
            {([['instant', 'מיד'], ['hourly', 'סיכום כל שעה'], ['daily', 'סיכום יומי']] as const).map(([v, l]) => (
              <button key={v} type="button" className={`chip ${p.frequency === v ? 'on' : ''}`} onClick={() => set('frequency', v)}>{l}</button>
            ))}
          </div>
          {p.frequency === 'instant' && (
            <label className="field inline">
              <span>לחכות לפני השליחה (אולי אראה באתר בינתיים)</span>
              <select value={p.delay_minutes} onChange={(e) => set('delay_minutes', Number(e.target.value))}>
                {[0, 5, 10, 30, 60, 120].map((m) => <option key={m} value={m}>{m === 0 ? 'בלי המתנה' : `${m} דקות`}</option>)}
              </select>
            </label>
          )}
          {p.frequency === 'daily' && (
            <label className="field inline">
              <span>שעת הסיכום היומי</span>
              <select value={p.daily_hour} onChange={(e) => set('daily_hour', Number(e.target.value))}>
                {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{hour(h)}</option>)}
              </select>
            </label>
          )}
          <div className="check-group">
          <label className="check-row">
            <input type="checkbox" checked={p.only_unread} onChange={(e) => set('only_unread', e.target.checked)} />
            <span>רק על מה שעוד לא קראתי באתר</span>
          </label>
          <label className="check-row">
            <input type="checkbox" checked={p.no_shabbat} onChange={(e) => set('no_shabbat', e.target.checked)} />
            <span>לא לשלוח בשבת (מיום שישי 15:00 עד מוצאי שבת 21:00)</span>
          </label>
          </div>
          <div className="field inline">
            <span>שעות שקט (בלי מיילים)</span>
            <div className="row gap">
              <select value={p.quiet_from ?? ''} onChange={(e) => set('quiet_from', e.target.value === '' ? null : Number(e.target.value))} aria-label="משעה">
                <option value="">בלי</option>
                {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>מ-{hour(h)}</option>)}
              </select>
              <select value={p.quiet_to ?? ''} onChange={(e) => set('quiet_to', e.target.value === '' ? null : Number(e.target.value))} aria-label="עד שעה">
                <option value="">בלי</option>
                {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>עד {hour(h)}</option>)}
              </select>
            </div>
          </div>
          <label className="field inline">
            <span>לכל היותר מיילים ביום</span>
            <select value={p.max_per_day} onChange={(e) => set('max_per_day', Number(e.target.value))}>
              {[3, 5, 10, 20, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <div className="form-actions">
            <button className="btn filled" disabled={busy || !dirty} onClick={() => save()}>שמירה</button>
          </div>
        </>
      )}
    </section>
  );
}
