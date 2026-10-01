import { useCallback, useEffect, useState } from 'react';
import { useApp } from '../AppContext';
import { supabase } from '../supabase';
import { clockTime, errorText, fullDate, timeAgo } from '../lib/format';
import { BOT_NAME } from '../pages/BotPage';
import Avatar from './Avatar';
import { Modal } from './Feedback';
import Icon from './Icon';
import { useFeedback } from './Feedback';
import ComplaintChat from './ComplaintChat';

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
  suggestion: string;
  created_at: string;
  handled_at: string | null;
}
interface Rule {
  id: number;
  rule: string;
  active: boolean;
  created_at: string;
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

/** Owner-only: בוט's reports on unusual conversations, and a sample of conversations with it. */
export default function SenderReports() {
  const { nameOf, me } = useApp();
  const [alerts, setAlerts] = useState<Alert[] | null>(null);
  const [overview, setOverview] = useState<Overview[]>([]);
  const [open, setOpen] = useState<{ userId: string; highlight?: number | null } | null>(null);
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [fixing, setFixing] = useState<number | null>(null);
  const [talking, setTalking] = useState<Complaint | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { toast } = useFeedback();

  const load = useCallback(async () => {
    const { data: r } = await supabase.from('bot_prompt_rules').select('*').order('id', { ascending: false });
    setRules((r as Rule[]) ?? []);
    const [a, o, c] = await Promise.all([
      supabase.rpc('bot_alert_list'),
      supabase.rpc('bot_overview'),
      supabase.from('bot_complaints').select('*').is('handled_at', null).order('id'),
    ]);
    setComplaints((c.data as Complaint[]) ?? []);
    let list = (a.data as Alert[]) ?? [];
    let err = a.error;
    if (err) {
      // bot_alert_list missing (schema.sql not pasted yet) or the request was blocked: read the table directly (owner-only RLS).
      const t = await supabase.from('bot_alerts').select('*').order('id', { ascending: false }).limit(100);
      if (!t.error) {
        list = ((t.data as Alert[]) ?? []).filter((x) => x.user_id !== me?.id);
        err = null;
      }
    }
    setAlerts(list);
    setLoadError(err ? `${errorText(err)}${err.code ? ` (${err.code})` : ''}` : null);
    // Opening the tab is seeing them: the badge clears; this view still marks which ones were new.
    const fresh = list.filter((x) => !x.seen_at).map((x) => x.id);
    if (fresh.length) supabase.rpc('bot_alerts_seen', { p_ids: fresh }).then(() => window.dispatchEvent(new Event('bot-alerts-seen')));
    setOverview((o.data as Overview[]) ?? []);
  }, [me?.id]);
  useEffect(() => {
    load();
  }, [load]);

  async function markSeen() {
    const ids = (alerts ?? []).filter((a) => !a.seen_at).map((a) => a.id);
    if (!ids.length) return;
    await supabase.rpc('bot_alerts_seen', { p_ids: ids });
    load();
  }

  // All open complaints as one text, to paste to whoever improves בוט.
  async function copyComplaints() {
    const text = [`תלונות על ${BOT_NAME} (${complaints.length}):`, '']
      .concat(complaints.map((c, i) => `${i + 1}. ${fullDate(c.created_at)}\nהתלונה: ${c.complaint}${c.quote ? `\nמה ${BOT_NAME} ענה: "${c.quote}"` : ''}${c.suggestion ? `\nהצעת שיפור: ${c.suggestion}` : ''}\n`))
      .join('\n');
    await navigator.clipboard.writeText(text);
    toast('כל התלונות הפתוחות הועתקו. אפשר להדביק אותן ולשלוח.');
  }

  // Approve one complaint: Gemini writes a short rule that is added to the bot's instructions from now on.
  async function autoFix(c: Complaint) {
    setFixing(c.id);
    const { data, error } = await supabase.functions.invoke('bot', { body: { mode: 'improve', complaint_id: c.id } });
    setFixing(null);
    const r = data as { rule?: string; by?: string; error?: string } | null;
    if (error || !r?.rule) return toast(r?.error ?? 'התיקון האוטומטי לא הצליח. נסה שוב עוד מעט.', 'error');
    toast(`נוסף תיקון${r.by ? ` (${r.by})` : ''}: ${r.rule}`);
    load();
  }

  async function dismiss(c: Complaint) {
    await supabase.rpc('bot_complaints_handled', { p_ids: [c.id] });
    load();
  }

  async function setRule(r: Rule, active: boolean | null) {
    const { error } = await supabase.rpc('bot_rule_set', { p_id: r.id, p_active: active });
    if (error) return toast(errorText(error), 'error');
    load();
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
          כשחבר כותב לבוט "יש לי תלונה עליך" או מתעצבן עליו, בוט שואל מה הפריע ורושם את זה כאן, עם התשובה שהפריעה. מדי פעם מעתיקים את
          כולן, שולחים לתיקון ומסמנים כטופלו.
        </p>
        {complaints.length === 0 ? (
          <div className="empty-inline small"><Icon name="check" /><span>אין תלונות פתוחות.</span></div>
        ) : (
          <ul className="list">
            {complaints.map((c) => (
              <li key={c.id} className="list-row static complaint-row">
                <div className="list-main">
                  <div className="list-title">{nameOf(c.user_id)}: {c.complaint}</div>
                  {c.quote && <div className="list-sub">{BOT_NAME} ענה: "{c.quote}"</div>}
                  {c.suggestion && <div className="list-sub suggestion"><Icon name="smart_toy" size={14} /> הצעת שיפור: {c.suggestion}</div>}
                  <div className="row gap wrap">
                    <button className="btn tonal small" disabled={fixing === c.id} onClick={() => autoFix(c)}>
                      {fixing === c.id ? 'מתקן…' : 'אישור ותיקון אוטומטי'}
                    </button>
                    <button className="btn tonal small" onClick={() => setTalking(c)}><Icon name="smart_toy" size={16} /> שיחה עם Claude על התיקון</button>
                    <button className="btn text small" onClick={() => setOpen({ userId: c.user_id })}>לשיחה עם החבר</button>
                    <button className="btn text small" onClick={() => dismiss(c)}>דחייה</button>
                  </div>
                </div>
                <span className="muted small" title={fullDate(c.created_at)}>{timeAgo(c.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {rules.length > 0 && (
        <section className="card-section">
          <div className="section-head"><h2>תיקונים ש{BOT_NAME} למד ({rules.filter((r) => r.active).length} פעילים)</h2></div>
          <p className="muted small">כל תיקון נוסף להוראות של {BOT_NAME} מרגע שאושר. כללי הפרטיות תמיד גוברים עליהם.</p>
          <ul className="list">
            {rules.map((r) => (
              <li key={r.id} className={`list-row static ${r.active ? '' : 'muted-row'}`}>
                <div className="list-main">
                  <div className="list-title">{r.rule}</div>
                  <div className="list-sub">{timeAgo(r.created_at)}{!r.active && ' · כבוי'}</div>
                </div>
                <div className="row gap">
                  <button className="btn text small" onClick={() => setRule(r, !r.active)}>{r.active ? 'כיבוי' : 'הפעלה'}</button>
                  <button className="btn text small danger" onClick={() => setRule(r, null)}>מחיקה</button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card-section">
        <div className="section-head">
          <h2>{BOT_NAME} מדווח ({unseen} חדשים)</h2>
          {unseen > 0 && <button className="btn text" onClick={markSeen}>סימון הכל כנקרא</button>}
        </div>
        <p className="muted small">
          {BOT_NAME} מדווח בשקט על דברים חריגים בשיחות איתו: מוזר (למשל ניסיון לברר מי כתב אנונימית), מדאיג (בריונות, מצוקה) ודחוף
          (סכנה). על מדאיג ודחוף מגיעה גם התראה לטלפון. החברים יודעים שמנהל-העל מקבל מדגם ודיווחים.
        </p>
        {loadError && <p className="small" style={{ color: 'var(--danger)' }}>שגיאה בטעינת הדיווחים: {loadError}</p>}
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

      {talking && <ComplaintChat complaint={talking} onClose={() => setTalking(null)} onSaved={load} />}
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
