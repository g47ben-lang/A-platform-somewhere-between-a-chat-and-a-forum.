import { useCallback, useEffect, useState } from 'react';
import { useApp } from '../AppContext';
import { supabase } from '../supabase';
import { errorText, fullDate, timeAgo } from '../lib/format';
import { useFeedback } from './Feedback';
import Icon from './Icon';

type Kind = 'chat' | 'gag' | 'improve';
const KINDS: { id: Kind; label: string; hint: string }[] = [
  { id: 'chat', label: 'שיחה עם הבוט', hint: 'ההוראות הקבועות של הבוט בכל שיחה: אופי, סגנון, כללים ומה הוא יודע על עצמו.' },
  { id: 'gag', label: 'כתיבת מבזקים', hint: 'ההוראות לכפתור "כתוב לי" במחולל המבזקים.' },
  { id: 'improve', label: 'תיקון מתלונה', hint: 'ההוראות ל"אישור ותיקון אוטומטי": איך לכתוב כלל חדש מתלונה.' },
];
const MODE_LABEL: Record<string, string> = { chat: 'שיחה', gag: 'מבזק', improve: 'תיקון' };

interface LogRow {
  id: number;
  user_id: string | null;
  mode: string;
  model: string;
  system: string;
  messages: unknown;
  response: string;
  created_at: string;
}

/** Owner-only: see exactly what is sent to the AI, and edit the bot's instructions. */
export default function AiPromptsAdmin() {
  const { nameOf } = useApp();
  const { toast, confirm } = useFeedback();
  const [kind, setKind] = useState<Kind>('chat');
  const [defaults, setDefaults] = useState<Record<string, string> | null>(null);
  const [saved, setSaved] = useState<Record<string, string>>({});
  const [text, setText] = useState('');
  const [fnMissing, setFnMissing] = useState(false);
  const [log, setLog] = useState<LogRow[] | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [modeFilter, setModeFilter] = useState<string>('');

  const loadPrompts = useCallback(async () => {
    const [{ data: rows }, fn] = await Promise.all([
      supabase.from('bot_prompts').select('key, body'),
      supabase.functions.invoke('bot', { body: { mode: 'prompts' } }),
    ]);
    setSaved(Object.fromEntries(((rows as { key: string; body: string }[]) ?? []).map((r) => [r.key, r.body])));
    const d = (fn.data as { defaults?: Record<string, string> } | null)?.defaults;
    setFnMissing(!d);
    setDefaults(d ?? {});
  }, []);

  const loadLog = useCallback(async () => {
    let q = supabase.from('bot_api_log').select('*').order('id', { ascending: false }).limit(60);
    if (modeFilter) q = q.eq('mode', modeFilter);
    const { data } = await q;
    setLog((data as LogRow[]) ?? []);
  }, [modeFilter]);

  useEffect(() => {
    loadPrompts();
  }, [loadPrompts]);
  useEffect(() => {
    loadLog();
  }, [loadLog]);
  useEffect(() => {
    setText(saved[kind] ?? defaults?.[kind] ?? '');
  }, [kind, saved, defaults]);

  async function save() {
    const { error } = await supabase.rpc('bot_prompt_set', { p_key: kind, p_body: text });
    if (error) return toast(errorText(error), 'error');
    toast('ההוראות נשמרו. הן פועלות מההודעה הבאה.');
    loadPrompts();
  }

  async function reset() {
    if (!(await confirm({ title: 'חזרה להוראות ברירת המחדל', body: 'השינויים שלך בהוראות האלה יימחקו.', confirmLabel: 'חזרה לברירת מחדל', danger: true }))) return;
    const { error } = await supabase.rpc('bot_prompt_set', { p_key: kind, p_body: '' });
    if (error) return toast(errorText(error), 'error');
    toast('חזר לברירת המחדל');
    loadPrompts();
  }

  const edited = kind in saved;
  const dirty = text !== (saved[kind] ?? defaults?.[kind] ?? '');
  const current = KINDS.find((k) => k.id === kind)!;

  return (
    <>
      <section className="card-section">
        <div className="section-head">
          <h2>ההוראות של הבוט</h2>
          {edited && <span className="role-tag">נערך על ידך</span>}
        </div>
        <div className="chips">
          {KINDS.map((k) => (
            <button key={k.id} className={`chip-btn ${kind === k.id ? 'on' : ''}`} onClick={() => setKind(k.id)}>
              {k.label}{k.id in saved ? ' •' : ''}
            </button>
          ))}
        </div>
        <p className="muted small">
          {current.hint} {'{{BOT_NAME}}'} מוחלף בשם הבוט ו-{'{{USER}}'} בשם החבר. את המידע החי (רשימת החברים, מה קורה בצ'אט, מה ידוע על
          מי שהוזכר, הודעות שהועברו והתיקונים שנלמדו) המערכת מוסיפה לבד אחרי ההוראות, כך שלא צריך לכתוב אותו כאן. רואים את הכל ביומן
          למטה.
        </p>
        {fnMissing && (
          <p className="small" style={{ color: 'var(--danger)' }}>
            הפונקציה של הבוט ב-Supabase עוד לא עודכנה, אז לא רואים כאן את ברירת המחדל. הדבק מחדש את supabase/functions/bot/index.ts.
          </p>
        )}
        <textarea className="prompt-editor" dir="rtl" value={text} onChange={(e) => setText(e.target.value)} rows={18} />
        <div className="row gap">
          <button className="btn filled small" disabled={!dirty || text.trim().length < 20} onClick={save}>שמירה</button>
          {edited && <button className="btn text small danger" onClick={reset}>חזרה לברירת מחדל</button>}
          {dirty && <button className="btn text small" onClick={() => setText(saved[kind] ?? defaults?.[kind] ?? '')}>ביטול השינויים</button>}
          <span className="muted small">{text.length.toLocaleString()} תווים</span>
        </div>
      </section>

      <section className="card-section">
        <div className="section-head">
          <h2>יומן הפקודות ל-AI</h2>
          <button className="btn text small" onClick={loadLog}><Icon name="arrow_downward" size={16} /> רענון</button>
        </div>
        <p className="muted small">
          כל פנייה שהאתר שולח ל-AI (Gemini או Claude): ההוראות המלאות שנשלחו, ההודעות, ומה חזר. נשמרות 300 הפניות האחרונות. לחיצה על
          שורה פותחת אותה.
        </p>
        <div className="chips">
          {['', 'chat', 'gag', 'improve'].map((m) => (
            <button key={m || 'all'} className={`chip-btn ${modeFilter === m ? 'on' : ''}`} onClick={() => setModeFilter(m)}>
              {m ? MODE_LABEL[m] : 'הכל'}
            </button>
          ))}
        </div>
        {log === null ? (
          <div className="spinner" />
        ) : log.length === 0 ? (
          <div className="empty-inline small"><Icon name="smart_toy" /><span>עוד אין פניות ביומן.</span></div>
        ) : (
          <ul className="list ai-log">
            {log.map((r) => (
              <li key={r.id}>
                <button className="list-row" onClick={() => setOpen(open === r.id ? null : r.id)}>
                  <span className="role-tag">{MODE_LABEL[r.mode] ?? r.mode}</span>
                  <div className="list-main">
                    <div className="list-title">{r.user_id ? nameOf(r.user_id) : '—'} · <span dir="ltr">{r.model}</span></div>
                    <div className="list-sub">{r.response.slice(0, 140)}</div>
                  </div>
                  <span className="muted small" title={fullDate(r.created_at)}>{timeAgo(r.created_at)}</span>
                </button>
                {open === r.id && (
                  <div className="ai-log-detail">
                    <h3>ההוראות שנשלחו ({r.system.length.toLocaleString()} תווים)</h3>
                    <pre dir="auto">{r.system}</pre>
                    <h3>ההודעות</h3>
                    <pre dir="auto">{formatMessages(r.messages)}</pre>
                    <h3>מה חזר</h3>
                    <pre dir="auto">{r.response}</pre>
                    <button className="btn text small" onClick={() => navigator.clipboard.writeText(`הוראות:\n${r.system}\n\nהודעות:\n${formatMessages(r.messages)}\n\nתשובה:\n${r.response}`).then(() => toast('הועתק'))}>
                      <Icon name="content_copy" size={16} /> העתקת הכל
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

/** Gemini contents ({role, parts:[{text}]}) or Claude messages ({role, content}) as readable lines. */
function formatMessages(m: unknown): string {
  if (!Array.isArray(m)) return JSON.stringify(m ?? null, null, 2);
  return m
    .map((x: { role?: string; parts?: { text?: string }[]; content?: unknown }) => {
      const who = x.role === 'user' ? 'משתמש' : x.role === 'model' || x.role === 'assistant' ? 'בוט' : x.role ?? '?';
      const body = x.parts ? x.parts.map((p) => p.text ?? '').join('\n') : typeof x.content === 'string' ? x.content : JSON.stringify(x.content);
      return `[${who}]\n${body}`;
    })
    .join('\n\n');
}
