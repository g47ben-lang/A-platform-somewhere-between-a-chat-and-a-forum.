import { useEffect, useState, type FormEvent } from 'react';
import { useApp } from '../AppContext';
import { supabase } from '../supabase';
import { errorText, fullDate } from '../lib/format';
import { Modal, useFeedback } from './Feedback';
import Icon from './Icon';

/** Report a message to the moderators (the reporter is never shown to anyone but them). */
export function ReportDialog({ messageId, onClose }: { messageId: number; onClose: () => void }) {
  const { toast } = useFeedback();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.rpc('report_message', { p_message: messageId, p_reason: reason.trim() || null });
    setBusy(false);
    if (error) return toast(errorText(error), 'error');
    toast('הדיווח נשלח למפקחים. תודה');
    onClose();
  }

  return (
    <Modal title="דיווח על הודעה" onClose={onClose}>
      <form className="form-stack" onSubmit={submit}>
        <p className="dialog-body">ההודעה תגיע לבדיקת המפקחים והמנהלים. הכותב לא יידע מי דיווח.</p>
        <label className="field">
          <span>מה הבעיה? (לא חובה)</span>
          <textarea rows={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="למשל: תוכן לא מתאים לנטפרי" />
        </label>
        <div className="dialog-actions">
          <button type="button" className="btn text" onClick={onClose}>ביטול</button>
          <button className="btn filled" disabled={busy}>שליחת דיווח</button>
        </div>
      </form>
    </Modal>
  );
}

const DURATIONS: [number | null, string][] = [
  [60, 'שעה'],
  [60 * 24, 'יום'],
  [60 * 24 * 3, '3 ימים'],
  [60 * 24 * 7, 'שבוע'],
  [60 * 24 * 30, 'חודש'],
  [null, 'עד שיבוטל'],
];

/** Moderators: mute a member for a while, optionally with a reason he will see (never who muted him). */
export function MuteDialog({ userId, onClose }: { userId: string; onClose: () => void }) {
  const { nameOf, reloadProfiles } = useApp();
  const { toast } = useFeedback();
  const [minutes, setMinutes] = useState<number | null>(60 * 24);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.rpc('mute_member', { p_user: userId, p_minutes: minutes, p_reason: reason.trim() || null });
    setBusy(false);
    if (error) return toast(errorText(error), 'error');
    toast(`${nameOf(userId)} הושתק`);
    reloadProfiles();
    onClose();
  }

  return (
    <Modal title={`השתקת ${nameOf(userId)}`} onClose={onClose}>
      <form className="form-stack" onSubmit={submit}>
        <p className="dialog-body">בזמן ההשתקה הוא יכול לקרוא אבל לא לכתוב. הוא יראה "הושתקת", עד מתי ואת הסיבה, אבל לא מי השתיק. בפרופיל שלו יופיע "מורחק".</p>
        <div className="chip-row">
          {DURATIONS.map(([m, l]) => (
            <button key={l} type="button" className={`chip ${minutes === m ? 'on' : ''}`} onClick={() => setMinutes(m)}>{l}</button>
          ))}
        </div>
        <label className="field">
          <span>סיבה (לא חובה, הוא יראה אותה)</span>
          <textarea rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        <div className="dialog-actions">
          <button type="button" className="btn text" onClick={onClose}>ביטול</button>
          <button className="btn danger-filled" disabled={busy}>השתקה</button>
        </div>
      </form>
    </Modal>
  );
}

export const muteUntilLabel = (until: string) =>
  until.startsWith('infinity') || new Date(until).getFullYear() > 9000 ? 'עד להודעה חדשה' : `עד ${fullDate(until)}`;

/** Shown once per mute when a muted member opens the site. */
export function MutedNotice() {
  const { myMute } = useApp();
  const key = myMute ? `mute-seen-${myMute.until}` : '';
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!myMute) return setOpen(false);
    try {
      setOpen(localStorage.getItem(key) !== '1');
    } catch {
      setOpen(true);
    }
  }, [myMute, key]);

  if (!myMute || !open) return null;
  const close = () => {
    try {
      localStorage.setItem(key, '1');
    } catch {
      /* storage unavailable */
    }
    setOpen(false);
  };
  return (
    <Modal title="הושתקת" onClose={close}>
      <div className="muted-notice">
        <Icon name="block" size={32} />
        <p><strong>לא ניתן לכתוב בצ'אט {muteUntilLabel(myMute.until)}.</strong></p>
        {myMute.reason && <p>סיבה: {myMute.reason}</p>}
        <p className="muted small">אפשר להמשיך לקרוא. לשאלות אפשר לפנות לניהול דרך "יצירת קשר עם הניהול".</p>
      </div>
      <div className="dialog-actions"><button className="btn filled" onClick={close}>הבנתי</button></div>
    </Modal>
  );
}

interface Scheduled {
  id: number;
  channel_id: number;
  body: string;
  send_at: string;
  sent_at: string | null;
  error: string | null;
}

const localInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

/** Write now, send later (in this room). Lists my pending scheduled messages with a cancel button. */
export function ScheduleDialog({ roomId, onClose }: { roomId: number; onClose: () => void }) {
  const { rooms } = useApp();
  const { toast } = useFeedback();
  const [body, setBody] = useState('');
  const [at, setAt] = useState(() => localInput(new Date(Date.now() + 60 * 60000)));
  const [list, setList] = useState<Scheduled[]>([]);
  const [busy, setBusy] = useState(false);

  const load = () =>
    supabase.from('scheduled_messages').select('*').is('sent_at', null).order('send_at').then(({ data }) => setList((data as Scheduled[]) ?? []));
  useEffect(() => {
    load();
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.rpc('schedule_message', { p_channel: roomId, p_body: body.trim(), p_send_at: new Date(at).toISOString() });
    setBusy(false);
    if (error) return toast(errorText(error), 'error');
    toast('ההודעה תוזמנה');
    setBody('');
    load();
  }

  async function cancel(s: Scheduled) {
    const { error } = await supabase.from('scheduled_messages').delete().eq('id', s.id);
    if (error) return toast(errorText(error), 'error');
    load();
  }

  const roomName = (id: number) => {
    const r = rooms.find((x) => x.id === id);
    return r ? (r.is_main ? 'הצ\'אט הראשי' : r.name) : '';
  };

  return (
    <Modal title="הודעה מתוזמנת" onClose={onClose}>
      <form className="form-stack" onSubmit={submit}>
        <label className="field">
          <span>ההודעה</span>
          <textarea rows={3} maxLength={4000} value={body} onChange={(e) => setBody(e.target.value)} required autoFocus />
        </label>
        <label className="field">
          <span>מתי לשלוח</span>
          <input type="datetime-local" value={at} min={localInput(new Date(Date.now() + 2 * 60000))} onChange={(e) => setAt(e.target.value)} required />
        </label>
        <div className="dialog-actions">
          <button type="button" className="btn text" onClick={onClose}>סגירה</button>
          <button className="btn filled" disabled={busy || !body.trim()}>תזמון</button>
        </div>
      </form>
      {list.length > 0 && (
        <div className="sched-list">
          <strong className="small">ממתינות לשליחה</strong>
          <ul className="list">
            {list.map((s) => (
              <li key={s.id} className="list-row static">
                <Icon name="schedule" />
                <div className="list-main">
                  <div className="list-title">{s.body}</div>
                  <div className="list-sub">{fullDate(s.send_at)} · {roomName(s.channel_id)}</div>
                </div>
                <button className="btn text danger" onClick={() => cancel(s)}>ביטול</button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Modal>
  );
}
