import { useEffect, useState } from 'react';
import { useApp } from '../AppContext';
import { supabase } from '../supabase';
import type { DmMessage } from '../types';
import { errorText, fullDate, OWNER_LABEL, timeAgo } from '../lib/format';
import { Modal, useFeedback } from './Feedback';
import Icon from './Icon';

interface Conv {
  id: number;
  anonymous: boolean;
  last_message_at: string;
}
interface Part {
  conversation_id: number;
  user_id: string;
  hidden: boolean;
}

/** Owner ("מנהל-על") tools: every private conversation, and the full reset. */
export default function OwnerTools() {
  const { isOwner } = useApp();
  return (
    <>
      {isOwner && <AllConversations />}
      <ResetCard />
    </>
  );
}

function AllConversations() {
  const { nameOf } = useApp();
  const [convs, setConvs] = useState<Conv[] | null>(null);
  const [parts, setParts] = useState<Part[]>([]);
  const [filter, setFilter] = useState('');
  const [open, setOpen] = useState<Conv | null>(null);

  useEffect(() => {
    Promise.all([
      supabase.from('dm_conversations').select('id, anonymous, last_message_at').order('last_message_at', { ascending: false }).limit(500),
      supabase.from('dm_participants').select('conversation_id, user_id, hidden'),
    ]).then(([c, p]) => {
      setConvs((c.data as Conv[]) ?? []);
      setParts((p.data as Part[]) ?? []);
    });
  }, []);

  const label = (c: Conv) =>
    parts
      .filter((p) => p.conversation_id === c.id)
      .map((p) => nameOf(p.user_id) + (p.hidden ? ' (כאנונימי)' : ''))
      .join(' ↔ ');
  const shown = (convs ?? []).filter((c) => label(c).includes(filter.trim()));

  return (
    <>
      <div className="info-card">
        <Icon name="shield_person" size={22} />
        <div>
          <strong>{OWNER_LABEL}: צפייה בצ'אטים פרטיים ובזהות של כותבים אנונימיים</strong>
          <p className="muted small">
            רק אתה רואה את זה, מנהלים רגילים ומפקחים לא. בחדרים, ליד כל הודעה אנונימית מופיע אצלך השם האמיתי באדום. החברים יודעים על
            האפשרות הזו מתקנון ההרשמה, שם נכתב שהיא משמשת למקרי חירום בלבד.
          </p>
        </div>
      </div>
      <section className="card-section">
        <div className="section-head"><h2>כל הצ'אטים הפרטיים ({convs?.length ?? 0})</h2></div>
        <div className="toolbar">
          <div className="field-search">
            <Icon name="search" />
            <input placeholder="סינון לפי שם" value={filter} onChange={(e) => setFilter(e.target.value)} />
          </div>
        </div>
        {convs === null ? (
          <div className="spinner" />
        ) : shown.length === 0 ? (
          <div className="empty-inline small"><span>אין צ'אטים פרטיים.</span></div>
        ) : (
          <ul className="list">
            {shown.map((c) => (
              <li key={c.id}>
                <button className="list-row" onClick={() => setOpen(c)}>
                  <Icon name={c.anonymous ? 'visibility_off' : 'chat'} />
                  <div className="list-main">
                    <div className="list-title">{label(c)}</div>
                    <div className="list-sub">{c.anonymous ? 'שיחה אנונימית · ' : ''}פעילות אחרונה {timeAgo(c.last_message_at)}</div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      {open && <ConversationView conv={open} parts={parts.filter((p) => p.conversation_id === open.id)} title={label(open)} onClose={() => setOpen(null)} />}
    </>
  );
}

function ConversationView({ conv, parts, title, onClose }: { conv: Conv; parts: Part[]; title: string; onClose: () => void }) {
  const { nameOf } = useApp();
  const [msgs, setMsgs] = useState<DmMessage[] | null>(null);
  const hidden = parts.find((p) => p.hidden);

  useEffect(() => {
    supabase
      .from('dm_messages')
      .select('*')
      .eq('conversation_id', conv.id)
      .order('id')
      .limit(1000)
      .then(({ data }) => setMsgs((data as DmMessage[]) ?? []));
  }, [conv.id]);

  const sender = (m: DmMessage) => (m.sender_id ? nameOf(m.sender_id) : hidden ? `${nameOf(hidden.user_id)} (כאנונימי)` : 'אנונימי');

  return (
    <Modal title={title} onClose={onClose} wide>
      {msgs === null ? (
        <div className="spinner" />
      ) : msgs.length === 0 ? (
        <p className="muted">אין הודעות.</p>
      ) : (
        <ul className="owner-dm">
          {msgs.map((m) => (
            <li key={m.id}>
              <div className="owner-dm-head">
                <strong>{sender(m)}</strong>
                <time title={fullDate(m.created_at)}>{timeAgo(m.created_at)}</time>
              </div>
              <div className={m.deleted ? 'muted' : ''}>
                {m.deleted ? 'הודעה שנמחקה' : m.body || (m.attachment ? (m.attachment.type === 'video' ? '[סרטון]' : '[תמונה]') : '')}
                {!m.deleted && m.body && m.attachment ? (m.attachment.type === 'video' ? ' [סרטון]' : ' [תמונה]') : ''}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

/** Removes every stored photo, video and profile picture (Storage can't be emptied from SQL). */
async function emptyMedia() {
  for (const folder of ['m', 'a']) {
    for (;;) {
      const { data, error } = await supabase.storage.from('media').list(folder, { limit: 100 });
      if (error) throw error;
      const files = (data ?? []).filter((f) => f.id).map((f) => `${folder}/${f.name}`);
      if (files.length === 0) break;
      const { error: e2 } = await supabase.storage.from('media').remove(files);
      if (e2) throw e2;
    }
  }
}

function ResetCard() {
  const { session } = useApp();
  const { toast } = useFeedback();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [understood, setUnderstood] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  async function reset() {
    setError('');
    setBusy('בודק סיסמה…');
    try {
      // Check the password before touching anything; the server checks it again.
      const { error: e1 } = await supabase.auth.signInWithPassword({ email: session!.user.email!, password });
      if (e1) throw new Error('הסיסמה שגויה');
      setBusy('מוחק תמונות וסרטונים…');
      await emptyMedia();
      setBusy('מוחק את כל הנתונים…');
      const { error: e2 } = await supabase.rpc('reset_everything', { p_password: password });
      if (e2) throw e2;
      await supabase.auth.signOut({ scope: 'local' });
      window.location.hash = '#/';
      window.location.reload();
    } catch (err) {
      setBusy('');
      setError(err instanceof Error ? err.message : errorText(err));
      toast('האיפוס לא בוצע', 'error');
    }
  }

  return (
    <section className="card-section danger-zone">
      <div className="section-head"><h2>איפוס המערכת</h2></div>
      <p className="muted small">מוחק את כל התוכן ואת כל המשתמשים ומתחיל מאפס. לפני שמכניסים נתוני אמת.</p>
      <button className="btn outlined danger-outline" onClick={() => setOpen(true)}>
        <Icon name="delete" size={18} /> איפוס המערכת
      </button>
      {open && (
        <Modal title="איפוס המערכת" onClose={() => !busy && setOpen(false)}>
          <div className="reset-explain">
            <p><strong>מה נמחק, לצמיתות ובלי אפשרות לשחזר:</strong></p>
            <ul>
              <li>כל ההודעות בצ'אט הראשי ובכל החדרים, והחדרים עצמם</li>
              <li>כל הצ'אטים הפרטיים, ההודעות על קירות, הלייקים והתגובות</li>
              <li>כל התמונות, הסרטונים ותמונות הפרופיל</li>
              <li>רשימת השמות ורשימת המיילים המאושרים מראש</li>
              <li><strong>כל המשתמשים, כולל אתה.</strong> כולם יצטרכו להירשם מחדש.</li>
            </ul>
            <p><strong>מה נשאר:</strong> האתר עצמו, והצ'אט הראשי ריק.</p>
            <p>
              אחרי האיפוס תתנתק. כדי לחזור כ{OWNER_LABEL}, נרשמים עם המייל <span dir="ltr">shmuelshmuel@gmail.com</span>: החשבון הזה
              מקבל תמיד את כל ההרשאות.
            </p>
          </div>
          <label className="field">
            <span>הסיסמה של החשבון שלך, לאישור</span>
            <input type="password" dir="ltr" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          </label>
          <label className="terms">
            <input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} />
            <span>אני מבין שהכל יימחק לצמיתות.</span>
          </label>
          {error && <div className="alert error"><Icon name="error" size={18} /> {error}</div>}
          <div className="form-actions">
            <button className="btn text" disabled={!!busy} onClick={() => setOpen(false)}>ביטול</button>
            <button className="btn danger-filled" disabled={!!busy || !understood || !password} onClick={reset}>
              {busy || 'איפוס עכשיו'}
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}
