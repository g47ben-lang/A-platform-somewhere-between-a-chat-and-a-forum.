import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../supabase';
import { errorText, timeAgo } from '../lib/format';
import { useFeedback } from './Feedback';
import Icon from './Icon';

interface Status {
  has_key: boolean | null;
  masked: string | null;
  last_error: string | null;
  used_at: string | null;
}

/** Owner-only: the Claude (Anthropic API) key used for "אישור ותיקון אוטומטי" on complaints. */
export default function ClaudeKeyAdmin() {
  const { toast, confirm } = useFeedback();
  const [st, setSt] = useState<Status | null>(null);
  const [key, setKey] = useState('');
  const [editing, setEditing] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.rpc('ai_claude_key_status');
    setSt(((Array.isArray(data) ? data[0] : data) as Status | null) ?? null);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  async function save(k: string | null) {
    const { error } = await supabase.rpc('ai_claude_key_set', { p_key: k });
    if (error) return toast(errorText(error), 'error');
    setKey('');
    setEditing(false);
    toast(k ? 'מפתח Claude נשמר' : 'מפתח Claude נמחק');
    load();
  }

  async function remove() {
    if (await confirm({ title: 'מחיקת מפתח Claude', body: 'התיקונים האוטומטיים יחזרו ל-Gemini.', confirmLabel: 'מחיקה', danger: true })) save(null);
  }

  const has = !!st?.has_key;
  return (
    <section className="card-section">
      <div className="section-head">
        <h2><Icon name="smart_toy" size={20} /> מפתח Claude לתיקון תלונות</h2>
        {has && <span className="role-tag">פעיל</span>}
      </div>
      <p className="muted small">
        משמש רק לכפתור "אישור ותיקון אוטומטי" בלשונית "בוט מדווח": Claude כותב את התיקון לבוט (בערך סנט לתיקון). בלי מפתח, או אם
        Claude נכשל, התיקון נעשה ב-Gemini. יוצרים מפתח ב-console.anthropic.com ← API Keys (צריך לטעון קרדיט מראש). המפתח נשמר בשרת
        ואף אחד לא יכול לקרוא אותו מהאתר.
      </p>
      {has && !editing ? (
        <div className="key-controls">
          <div className="list-sub">
            <span dir="ltr">{st?.masked}</span>
            {st?.used_at ? ` · תיקון אחרון ${timeAgo(st.used_at)}` : ' · עוד לא שימש'}
          </div>
          {st?.last_error && <div className="small" style={{ color: 'var(--danger)' }} dir="auto">שגיאה אחרונה: {st.last_error}</div>}
          <div className="row gap">
            <button className="btn text small" onClick={() => setEditing(true)}>החלפה</button>
            <button className="btn text small danger" onClick={remove}>מחיקה</button>
          </div>
        </div>
      ) : (
        <div className="row gap">
          <input className="grow search-input" dir="ltr" value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-ant-..." />
          <button className="btn filled small" disabled={!key.trim().startsWith('sk-ant-')} onClick={() => save(key.trim())}>שמירה</button>
          {editing && <button className="btn text small" onClick={() => setEditing(false)}>ביטול</button>}
        </div>
      )}
    </section>
  );
}
