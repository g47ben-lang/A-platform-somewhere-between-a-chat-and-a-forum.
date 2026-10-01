import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { supabase } from '../supabase';
import { errorText, timeAgo } from '../lib/format';
import { useFeedback } from './Feedback';
import Icon from './Icon';

interface AiKey {
  id: number;
  label: string;
  masked: string;
  model: string;
  daily_limit: number;
  per_minute: number;
  enabled: boolean;
  used_today: number;
  cooldown_until: string | null;
  last_error: string | null;
  last_used_at: string | null;
}

/** Owner-only: Google AI Studio keys for the bot. The bot uses the least used key that still has quota. */
export default function AiKeysAdmin() {
  const { toast, confirm } = useFeedback();
  const [keys, setKeys] = useState<AiKey[] | null>(null);
  const [form, setForm] = useState({ label: '', key: '', model: 'gemini-3.8-flash', daily: 200, minute: 8 });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.rpc('ai_key_list');
    setKeys((data as AiKey[]) ?? []);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  async function add(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.rpc('ai_key_add', { p_label: form.label, p_key: form.key, p_model: form.model, p_daily: form.daily, p_minute: form.minute });
    setBusy(false);
    if (error) return toast(errorText(error), 'error');
    setForm((f) => ({ ...f, label: '', key: '' }));
    toast('המפתח נוסף');
    load();
  }

  async function update(k: AiKey, patch: Partial<AiKey>) {
    const n = { ...k, ...patch };
    const { error } = await supabase.rpc('ai_key_update', { p_id: k.id, p_enabled: n.enabled, p_model: n.model, p_daily: n.daily_limit, p_minute: n.per_minute });
    if (error) return toast(errorText(error), 'error');
    load();
  }

  async function remove(k: AiKey) {
    if (!(await confirm({ title: `מחיקת המפתח "${k.label}"`, confirmLabel: 'מחיקה', danger: true }))) return;
    const { error } = await supabase.rpc('ai_key_remove', { p_id: k.id });
    if (error) return toast(errorText(error), 'error');
    load();
  }

  const totalLeft = (keys ?? []).filter((k) => k.enabled).reduce((n, k) => n + Math.max(0, k.daily_limit - k.used_today), 0);

  return (
    <section className="card-section ai-keys">
      <div className="section-head">
        <h2>מפתחות AI לבוט ({keys?.length ?? 0})</h2>
        <span className="muted small">נשארו היום כ-{totalLeft} תשובות</span>
      </div>
      <p className="muted small">
        מפתח חינמי יוצרים ב-aistudio.google.com/apikey (Get API key). הבוט בוחר כל פעם את המפתח הכי פחות מנוצל שעוד יש בו מכסה, ומפתח
        שקיבל "עומס" נח דקה. המכסה מתאפסת בכל לילה בשעה 10:00 בבוקר שעון ישראל (חצות בקליפורניה). שים לב: בשכבה החינמית Google רשאית
        להשתמש בתוכן כדי לשפר את המודלים שלה, ופתיחת הרבה חשבונות כדי לעקוף מגבלות עלולה להפר את התנאים שלה.
      </p>
      <form className="ai-key-form" onSubmit={add}>
        <label className="field"><span>שם</span><input value={form.label} maxLength={40} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="מפתח 1" /></label>
        <label className="field"><span>המפתח</span><input value={form.key} dir="ltr" onChange={(e) => setForm({ ...form, key: e.target.value })} placeholder="AIza..." /></label>
        <label className="field"><span>מודל</span><input value={form.model} dir="ltr" onChange={(e) => setForm({ ...form, model: e.target.value })} /></label>
        <label className="field"><span>תשובות ביום</span><input type="number" min={1} value={form.daily} onChange={(e) => setForm({ ...form, daily: Number(e.target.value) })} /></label>
        <label className="field"><span>בדקה</span><input type="number" min={1} value={form.minute} onChange={(e) => setForm({ ...form, minute: Number(e.target.value) })} /></label>
        <button className="btn filled" disabled={busy || !form.label.trim() || form.key.trim().length < 10}><Icon name="add" size={18} /> הוספה</button>
      </form>
      {keys === null ? (
        <div className="spinner" />
      ) : keys.length === 0 ? (
        <div className="empty-inline small"><Icon name="smart_toy" /><span>עוד אין מפתחות. בלי מפתח בוט לא עונה.</span></div>
      ) : (
        <ul className="list">
          {keys.map((k) => {
            const resting = k.cooldown_until && new Date(k.cooldown_until) > new Date();
            return (
              <li key={k.id} className="list-row static key-row">
                <div className="list-main">
                  <div className="list-title">
                    {k.label} <span className="muted small" dir="ltr">{k.masked}</span>
                    {!k.enabled && <span className="role-tag">כבוי</span>}
                    {resting && <span className="role-tag">נח</span>}
                  </div>
                  <div className="list-sub">
                    {k.model} · היום {k.used_today}/{k.daily_limit} · עד {k.per_minute} בדקה
                    {k.last_used_at && ` · שימוש אחרון ${timeAgo(k.last_used_at)}`}
                  </div>
                  <div className="ai-usage"><span style={{ width: `${Math.min(100, (100 * k.used_today) / k.daily_limit)}%` }} /></div>
                  {k.last_error && <div className="small" style={{ color: 'var(--danger)' }} dir="auto">{k.last_error}</div>}
                </div>
                <div className="row gap">
                  <button className="btn text" onClick={() => update(k, { enabled: !k.enabled })}>{k.enabled ? 'כיבוי' : 'הפעלה'}</button>
                  <button className="btn text danger" onClick={() => remove(k)}>מחיקה</button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
