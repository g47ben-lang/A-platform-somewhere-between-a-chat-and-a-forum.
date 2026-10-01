import { useCallback, useEffect, useState } from 'react';
import { useApp } from '../AppContext';
import { supabase } from '../supabase';
import { clockTime, fullDate, timeAgo } from '../lib/format';
import { BOT_NAME } from '../pages/BotPage';
import Avatar from './Avatar';
import { Modal } from './Feedback';
import Icon from './Icon';
import { useFeedback } from './Feedback';

interface Alert {
  id: number;
  user_id: string;
  level: 'odd' | 'concern' | 'urgent';
  reason: string;
  excerpt: string;
  created_at: string;
  seen_at: string | null;
}
interface Complaint {
  id: number;
  user_id: string;
  complaint: string;
  quote: string;
  created_at: string;
  handled_at: string | null;
}
interface Overview {
  user_id: string;
  messages: number;
  last_at: string;
  strikes: number;
  blocked_until: string | null;
  alerts: number;
}
interface BotMsg {
  id: number;
  role: 'user' | 'bot';
  body: string;
  created_at: string;
}

const LEVEL: Record<Alert['level'], string> = { odd: 'מוזר', concern: 'מדאיג', urgent: 'דחוף' };

/** Owner-only: נייעסניק's reports on unusual conversations, and a sample of conversations with it. */
export default function SenderReports() {
  const { nameOf } = useApp();
  const [alerts, setAlerts] = useState<Alert[] | null>(null);
  const [overview, setOverview] = useState<Overview[]>([]);
  const [open, setOpen] = useState<{ userId: string; highlight?: number | null } | null>(null);
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const { toast } = useFeedback();

  const load = useCallback(async () => {
    const [a, o, c] = await Promise.all([
      supabase.from('bot_alerts').select('*').order('id', { ascending: false }).limit(100),
      supabase.rpc('bot_overview'),
      supabase.from('bot_complaints').select('*').is('handled_at', null).order('id'),
    ]);
    setComplaints((c.data as Complaint[]) ?? []);
    setAlerts((a.data as Alert[]) ?? []);
    setOverview((o.data as Overview[]) ?? []);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  async function markSeen() {
    const ids = (alerts ?? []).filter((a) => !a.seen_at).map((a) => a.id);
    if (!ids.length) return;
    await supabase.rpc('bot_alerts_seen', { p_ids: ids });
    load();
  }

  // All open complaints as one text, to paste to whoever improves נייעסניק.
  async function copyComplaints() {
    const text = [`תלונות על ${BOT_NAME} (${complaints.length}):`, '']
      .concat(complaints.map((c, i) => `${i + 1}. ${fullDate(c.created_at)}\nהתלונה: ${c.complaint}${c.quote ? `\nמה ${BOT_NAME} ענה: "${c.quote}"` : ''}\n`))
      .join('\n');
    await navigator.clipboard.writeText(text);
    toast('כל התלונות הפתוחות הועתקו. אפשר להדביק אותן ולשלוח.');
  }

  async function markHandled() {
    await supabase.rpc('bot_complaints_handled', { p_ids: complaints.map((c) => c.id) });
    load();
  }

  function sample() {
    if (!overview.length) return;
    setOpen({ userId: overview[Math.floor(Math.random() * overview.length)].user_id });
  }

  const unseen = (alerts ?? []).filter((a) => !a.seen_at).length;

  return (
    <>
      <section className="card-section">
        <div className="section-head">
          <h2>תלונות על {BOT_NAME} ({complaints.length})</h2>
          {complaints.length > 0 && (
            <div className="row gap">
              <button className="btn tonal small" onClick={copyComplaints}><Icon name="content_copy" size={18} /> העתקת כל התלונות</button>
              <button className="btn text small" onClick={markHandled}>סימון כטופלו</button>
            </div>
          )}
        </div>
        <p className="muted small">
          כשחבר כותב לנייעסניק "יש לי תלונה עליך" או מתעצבן עליו, נייעסניק שואל מה הפריע ורושם את זה כאן, עם התשובה שהפריעה. מדי פעם מעתיקים את
          כולן, שולחים לתיקון ומסמנים כטופלו.
        </p>
        {complaints.length === 0 ? (
          <div className="empty-inline small"><Icon name="check" /><span>אין תלונות פתוחות.</span></div>
        ) : (
          <ul className="list">
            {complaints.map((c) => (
              <li key={c.id}>
                <button className="list-row" onClick={() => setOpen({ userId: c.user_id })}>
                  <div className="list-main">
                    <div className="list-title">{nameOf(c.user_id)}: {c.complaint}</div>
                    {c.quote && <div className="list-sub">{BOT_NAME} ענה: "{c.quote}"</div>}
                  </div>
                  <span className="muted small" title={fullDate(c.created_at)}>{timeAgo(c.created_at)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card-section">
        <div className="section-head">
          <h2>{BOT_NAME} מדווח ({unseen} חדשים)</h2>
          {unseen > 0 && <button className="btn text" onClick={markSeen}>סימון הכל כנקרא</button>}
        </div>
        <p className="muted small">
          {BOT_NAME} מדווח בשקט על דברים חריגים בשיחות איתו: מוזר (למשל ניסיון לברר מי כתב אנונימית), מדאיג (בריונות, מצוקה) ודחוף
          (סכנה). על מדאיג ודחוף מגיעה גם התראה לטלפון. החברים יודעים שמנהל-העל מקבל מדגם ודיווחים.
        </p>
        {alerts === null ? (
          <div className="spinner" />
        ) : alerts.length === 0 ? (
          <div className="empty-inline small"><Icon name="check" /><span>אין דיווחים. הכל שקט.</span></div>
        ) : (
          <ul className="list">
            {alerts.map((a) => (
              <li key={a.id}>
                <button className={`list-row ${a.seen_at ? '' : 'unread'}`} onClick={() => setOpen({ userId: a.user_id, highlight: null })}>
                  <span className={`alert-level l-${a.level}`}>{LEVEL[a.level]}</span>
                  <div className="list-main">
                    <div className="list-title">{nameOf(a.user_id)}: {a.reason}</div>
                    {a.excerpt && <div className="list-sub">"{a.excerpt}"</div>}
                  </div>
                  <span className="muted small" title={fullDate(a.created_at)}>{timeAgo(a.created_at)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card-section">
        <div className="section-head">
          <h2>שיחות עם {BOT_NAME} ({overview.length})</h2>
          <button className="btn tonal small" onClick={sample} disabled={!overview.length}>
            <Icon name="visibility" size={18} /> מדגם אקראי
          </button>
        </div>
        {overview.length === 0 ? (
          <div className="empty-inline small"><Icon name="smart_toy" /><span>עוד אף אחד לא דיבר עם {BOT_NAME}.</span></div>
        ) : (
          <ul className="list">
            {overview.map((o) => {
              const blocked = o.blocked_until && new Date(o.blocked_until) > new Date();
              return (
                <li key={o.user_id}>
                  <button className="list-row" onClick={() => setOpen({ userId: o.user_id })}>
                    <Avatar id={o.user_id} name={nameOf(o.user_id)} size={32} />
                    <div className="list-main">
                      <div className="list-title">
                        {nameOf(o.user_id)}
                        {blocked && <span className="role-tag">חסום לרבע שעה</span>}
                        {o.alerts > 0 && <span className="role-tag">{o.alerts} דיווחים</span>}
                      </div>
                      <div className="list-sub">{o.messages} הודעות · אחרונה {timeAgo(o.last_at)}{o.strikes > 0 && ` · ${o.strikes} בזבוזים`}</div>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {open && <Conversation userId={open.userId} onClose={() => setOpen(null)} />}
    </>
  );
}

function Conversation({ userId, onClose }: { userId: string; onClose: () => void }) {
  const { nameOf } = useApp();
  const [msgs, setMsgs] = useState<BotMsg[] | null>(null);
  useEffect(() => {
    supabase.from('bot_messages').select('id, role, body, created_at').eq('user_id', userId).order('id', { ascending: false }).limit(60)
      .then(({ data }) => setMsgs(((data as BotMsg[]) ?? []).reverse()));
  }, [userId]);
  return (
    <Modal title={`${nameOf(userId)} ו${BOT_NAME}`} onClose={onClose} wide>
      {msgs === null ? (
        <div className="spinner" />
      ) : (
        <div className="bot-review">
          {msgs.map((m) => (
            <div key={m.id} className={`review-line ${m.role}`}>
              <strong>{m.role === 'user' ? nameOf(userId) : BOT_NAME}</strong>
              <span>{m.body}</span>
              <time className="muted small" title={fullDate(m.created_at)}>{clockTime(m.created_at)}</time>
            </div>
          ))}
          {msgs.length === 0 && <p className="muted">אין הודעות.</p>}
        </div>
      )}
    </Modal>
  );
}
