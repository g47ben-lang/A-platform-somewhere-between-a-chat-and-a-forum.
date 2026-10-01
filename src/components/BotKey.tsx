import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { supabase } from '../supabase';
import { errorText } from '../lib/format';
import { Modal, useFeedback } from './Feedback';
import Icon from './Icon';

export interface BotQuota {
  free_left: number;
  has_key: boolean;
  masked: string | null;
  used_today: number | null;
  daily_limit: number | null;
  key_error: string | null;
  resting: boolean | null;
}

/** Free messages left today on the shared keys, and my own key's state (bot_my_quota). */
export function useBotQuota() {
  const [quota, setQuota] = useState<BotQuota | null>(null);
  const reloadQuota = useCallback(async () => {
    const { data } = await supabase.rpc('bot_my_quota');
    setQuota(((Array.isArray(data) ? data[0] : data) as BotQuota | null) ?? null);
  }, []);
  useEffect(() => {
    reloadQuota();
  }, [reloadQuota]);
  return { quota, reloadQuota };
}

const AI_STUDIO = 'https://aistudio.google.com/apikey';

/** Step-by-step guide to a free Google AI Studio key, with a box to save it. */
export function KeyGuide({ onSaved, compact }: { onSaved: () => void; compact?: boolean }) {
  const { toast } = useFeedback();
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.rpc('ai_my_key_set', { p_key: key.trim() });
    setBusy(false);
    if (error) return toast(errorText(error), 'error');
    setKey('');
    toast('המפתח נשמר. אפשר להמשיך לכתוב לנייעסניק.');
    onSaved();
  }

  return (
    <form className={`key-guide ${compact ? 'compact' : ''}`} onSubmit={save}>
      {!compact && (
        <>
          <strong><Icon name="lock" size={18} /> נגמרו ההודעות החינמיות של היום</strong>
          <p className="muted small">כדי להמשיך עם נייעסניק צריך מפתח AI משלך. זה בחינם ולוקח שתי דקות:</p>
        </>
      )}
      <ol>
        <li>
          נכנסים ל-<a href={AI_STUDIO} target="_blank" rel="noreferrer" dir="ltr">aistudio.google.com/apikey</a> ומתחברים עם חשבון Google.
        </li>
        <li>לוחצים <b dir="ltr">Create API key</b>. אם מבקשים לבחור פרויקט, לוחצים על הפרויקט שמוצע או יוצרים חדש.</li>
        <li>לוחצים על סמל ההעתקה ליד המפתח, חוזרים לכאן ומדביקים אותו בתיבה.</li>
      </ol>
      <div className="row gap">
        <input className="grow" dir="ltr" value={key} onChange={(e) => setKey(e.target.value)} placeholder="המפתח שהעתקת" aria-label="המפתח" />
        <button className="btn filled" disabled={busy || key.trim().length < 20}>{busy ? 'שומר…' : 'שמירה'}</button>
      </div>
      <p className="muted small">
        המפתח משמש רק לשיחות שלך עם נייעסניק, ואפשר למחוק אותו מתי שרוצים. חברים לא יכולים לראות אותו; מנהל-העל יכול לראות ולנהל אותו כדי לעזור אם משהו לא עובד (אפשר גם לשלוח לו את המפתח והוא יגדיר אותו בשבילך). אם האתר
        של Google חסום אצלך, אפשר להוציא את המפתח ממחשב אחר ולהדביק כאן.
      </p>
    </form>
  );
}

/** My own key: usage today, last error, replace or remove. */
export function MyKeyDialog({ quota, onClose, onChanged }: { quota: BotQuota; onClose: () => void; onChanged: () => void }) {
  const { toast, confirm } = useFeedback();
  const [replacing, setReplacing] = useState(false);

  async function remove() {
    if (!(await confirm({ title: 'מחיקת המפתח שלך', body: 'אחרי המחיקה תחזור למכסה החינמית של היום.', confirmLabel: 'מחיקה', danger: true }))) return;
    const { error } = await supabase.rpc('ai_my_key_remove');
    if (error) return toast(errorText(error), 'error');
    onChanged();
    onClose();
  }

  return (
    <Modal title="המפתח שלי לנייעסניק" onClose={onClose}>
      {quota.has_key && !replacing ? (
        <div className="form-stack">
          <p>
            המפתח <span dir="ltr">{quota.masked}</span> משמש לשיחות שלך עם נייעסניק. היום: {quota.used_today ?? 0} מתוך {quota.daily_limit}.
          </p>
          {quota.resting && <p className="muted small">המפתח נח כרגע אחרי שגיאה או עומס, ויחזור לעבוד לבד.</p>}
          {quota.key_error && <p className="small" style={{ color: 'var(--danger)' }} dir="auto">שגיאה אחרונה מ-Google: {quota.key_error}</p>}
          <div className="dialog-actions">
            <button className="btn text danger" onClick={remove}>מחיקה</button>
            <button className="btn tonal" onClick={() => setReplacing(true)}>החלפת מפתח</button>
          </div>
        </div>
      ) : (
        <>
          {!quota.has_key && (
            <p className="muted">
              נשארו לך היום {quota.free_left} הודעות חינם לנייעסניק. עם מפתח משלך (חינם) אפשר לכתוב לו בלי המגבלה הזו.
            </p>
          )}
          <KeyGuide compact onSaved={() => { onChanged(); onClose(); }} />
        </>
      )}
    </Modal>
  );
}
