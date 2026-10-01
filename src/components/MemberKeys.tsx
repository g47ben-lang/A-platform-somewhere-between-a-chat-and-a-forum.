import { useCallback, useEffect, useState } from 'react';
import { useApp } from '../AppContext';
import { supabase } from '../supabase';
import { errorText, timeAgo } from '../lib/format';
import Avatar from './Avatar';
import { useFeedback } from './Feedback';
import Icon from './Icon';

export interface MemberKey {
  user_id: string;
  key_id: number | null;
  masked: string | null;
  enabled: boolean | null;
  used_today: number | null;
  daily_limit: number | null;
  cooldown_until: string | null;
  last_error: string | null;
  last_used_at: string | null;
  free_used: number | null;
}

const FREE_DAILY = 10; // must match bot_free_daily() in schema.sql

/** Owner-only control panel: every member's own key for סנדר (to help members who ask). */
export default function MemberKeysAdmin() {
  const { nameOf } = useApp();
  const [rows, setRows] = useState<MemberKey[] | null>(null);
  const [filter, setFilter] = useState('');
  const load = useCallback(async () => {
    const { data } = await supabase.rpc('ai_member_keys');
    setRows((data as MemberKey[]) ?? []);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const shown = (rows ?? []).filter((r) => nameOf(r.user_id).includes(filter.trim()));
  const withKey = (rows ?? []).filter((r) => r.key_id).length;
  const broken = (rows ?? []).filter((r) => r.key_id && r.last_error).length;

  return (
    <section className="card-section">
      <div className="section-head">
        <h2>מפתחות של חברים ({withKey})</h2>
        {broken > 0 && <span className="role-tag">{broken} עם שגיאה</span>}
      </div>
      <p className="muted small">
        כל מי שיש לו מפתח משלו או שדיבר עם סנדר. אפשר להציג את המפתח, להדביק מפתח שחבר שלח לך, לכבות, להחזיר ממנוחה ולמחוק. אותו כרטיס
        מופיע גם בפרופיל של כל חבר (רק אצלך).
      </p>
      <input className="search-input" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="חיפוש חבר" />
      {rows === null ? (
        <div className="spinner" />
      ) : shown.length === 0 ? (
        <div className="empty-inline small"><Icon name="smart_toy" /><span>אין עדיין חברים עם מפתח.</span></div>
      ) : (
        <ul className="list">
          {shown.map((r) => (
            <li key={r.user_id} className="list-row static member-key-row">
              <Avatar id={r.user_id} name={nameOf(r.user_id)} size={32} />
              <div className="list-main">
                <div className="list-title">{nameOf(r.user_id)}</div>
                <KeyControls row={r} onChanged={load} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Owner-only card in a member's profile: his key for סנדר. */
export function MemberKeyCard({ userId }: { userId: string }) {
  const [row, setRow] = useState<MemberKey | null | undefined>(undefined);
  const load = useCallback(async () => {
    const { data } = await supabase.rpc('ai_member_keys');
    setRow(((data as MemberKey[]) ?? []).find((r) => r.user_id === userId) ?? null);
  }, [userId]);
  useEffect(() => {
    load();
  }, [load]);
  if (row === undefined) return null;
  return (
    <section className="card-section member-key-card">
      <div className="section-head"><h2><Icon name="smart_toy" size={20} /> המפתח שלו לסנדר</h2><span className="muted small">רק אצלך</span></div>
      <KeyControls row={row ?? { user_id: userId, key_id: null, masked: null, enabled: null, used_today: null, daily_limit: null, cooldown_until: null, last_error: null, last_used_at: null, free_used: null }} onChanged={load} />
    </section>
  );
}

function KeyControls({ row: r, onChanged }: { row: MemberKey; onChanged: () => void }) {
  const { toast, confirm } = useFeedback();
  const [revealed, setRevealed] = useState<string | null>(null);
  const [setting, setSetting] = useState(false);
  const [key, setKey] = useState('');
  const resting = !!r.cooldown_until && new Date(r.cooldown_until) > new Date();

  async function reveal() {
    const { data, error } = await supabase.rpc('ai_member_key_reveal', { p_user: r.user_id });
    if (error) return toast(errorText(error), 'error');
    setRevealed((data as string | null) ?? null);
  }
  async function copy() {
    const { data } = await supabase.rpc('ai_member_key_reveal', { p_user: r.user_id });
    if (data) {
      await navigator.clipboard.writeText(data as string);
      toast('המפתח הועתק');
    }
  }
  async function save() {
    const { error } = await supabase.rpc('ai_member_key_set', { p_user: r.user_id, p_key: key.trim() });
    if (error) return toast(errorText(error), 'error');
    setKey('');
    setSetting(false);
    setRevealed(null);
    toast('המפתח נשמר לחבר');
    onChanged();
  }
  async function toggle(enabled: boolean) {
    // Same daily/minute limits; switching on also ends a rest.
    const { error } = await supabase.rpc('ai_key_update', { p_id: r.key_id, p_enabled: enabled, p_model: null, p_daily: r.daily_limit ?? 200, p_minute: 8 });
    if (error) return toast(errorText(error), 'error');
    onChanged();
  }
  async function remove() {
    if (!(await confirm({ title: 'מחיקת המפתח של החבר', body: 'הוא יחזור למכסה החינמית.', confirmLabel: 'מחיקה', danger: true }))) return;
    const { error } = await supabase.rpc('ai_member_key_remove', { p_user: r.user_id });
    if (error) return toast(errorText(error), 'error');
    setRevealed(null);
    onChanged();
  }

  return (
    <div className="key-controls">
      <div className="list-sub">
        {r.key_id ? (
          <>
            <span dir="ltr">{revealed ?? r.masked}</span>
            {' · '}היום {r.used_today ?? 0}/{r.daily_limit}
            {r.last_used_at && ` · שימוש אחרון ${timeAgo(r.last_used_at)}`}
            {!r.enabled && <span className="role-tag">כבוי</span>}
            {resting && <span className="role-tag">נח</span>}
          </>
        ) : (
          <>אין מפתח משלו · חינם היום {r.free_used ?? 0}/{FREE_DAILY}</>
        )}
      </div>
      {r.last_error && <div className="small" style={{ color: 'var(--danger)' }} dir="auto">שגיאה אחרונה: {r.last_error}</div>}
      <div className="row gap wrap">
        {r.key_id && (
          <>
            <button className="btn text small" onClick={revealed ? () => setRevealed(null) : reveal}>{revealed ? 'הסתרה' : 'הצגה'}</button>
            <button className="btn text small" onClick={copy}>העתקה</button>
            {r.enabled && resting && <button className="btn text small" onClick={() => toggle(true)}>החזרה ממנוחה</button>}
            <button className="btn text small" onClick={() => toggle(!r.enabled)}>{r.enabled ? 'כיבוי' : 'הפעלה'}</button>
            <button className="btn text small danger" onClick={remove}>מחיקה</button>
          </>
        )}
        <button className="btn text small" onClick={() => setSetting((v) => !v)}>{r.key_id ? 'החלפת מפתח' : 'הגדרת מפתח בשבילו'}</button>
      </div>
      {setting && (
        <div className="row gap">
          <input className="grow search-input" dir="ltr" value={key} onChange={(e) => setKey(e.target.value)} placeholder="המפתח שהחבר שלח" />
          <button className="btn filled small" disabled={key.trim().length < 20} onClick={save}>שמירה</button>
        </div>
      )}
    </div>
  );
}
