import { useEffect, useState } from 'react';
import { useApp } from '../AppContext';
import { supabase } from '../supabase';
import { errorText, timeAgo } from '../lib/format';
import { useFeedback } from './Feedback';
import Icon from './Icon';

interface Entry {
  email: string;
  name: string | null;
}

/**
 * Pulls emails (and a name when there is one) out of any pasted text: "name email", "email, name",
 * or a copied member list where the name sits on the line above the email.
 */
export function parseEntries(text: string): Entry[] {
  const out = new Map<string, Entry>();
  let lastName: string | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const emails = line.match(/[^\s<>(),;"']+@[^\s<>(),;"']+\.[^\s<>(),;"']+/g);
    if (!emails) {
      lastName = line.replace(/[<>(),;"'|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40) || null;
      continue;
    }
    const rest = emails
      .reduce((l, e) => l.replace(e, ' '), line)
      .replace(/[<>(),;"'|-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    for (const e of emails) {
      const email = e.toLowerCase();
      if (!out.has(email)) out.set(email, { email, name: (emails.length === 1 && rest) || lastName });
    }
    lastName = null;
  }
  return [...out.values()];
}

interface Pre {
  email: string;
  display_name: string | null;
  added_at: string;
  used_at: string | null;
}

/** Admin: approve a list of emails in advance, without notifying anyone. */
export default function PreapprovedAdmin() {
  const { reloadProfiles } = useApp();
  const { confirm, toast } = useFeedback();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [list, setList] = useState<Pre[] | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const entries = parseEntries(text);

  const load = () =>
    supabase
      .from('preapproved_emails')
      .select('*')
      .order('added_at', { ascending: false })
      .then(({ data }) => setList((data as Pre[]) ?? []));

  useEffect(() => {
    load();
  }, []);

  async function add() {
    setBusy(true);
    const { data, error } = await supabase.rpc('add_preapproved', { p_entries: entries });
    setBusy(false);
    if (error) return toast(errorText(error), 'error');
    const rows = (data as { addr: string; result: string }[]) ?? [];
    const count = (r: string) => rows.filter((x) => x.result === r).length;
    setSummary(
      `נוספו ${count('added')} לרשימה` +
        (count('activated') ? ` · ${count('activated')} שכבר נרשמו אושרו עכשיו` : '') +
        (count('member') ? ` · ${count('member')} כבר חברים` : '') +
        (count('banned') ? ` · ${count('banned')} חסומים (לא שונו)` : ''),
    );
    setText('');
    load();
    reloadProfiles();
  }

  async function remove(p: Pre) {
    const ok = await confirm({ title: `הסרת ${p.email}`, body: 'אם יירשם בעתיד, יחכה לאישור כרגיל.', confirmLabel: 'הסרה', danger: true });
    if (!ok) return;
    const { error } = await supabase.from('preapproved_emails').delete().eq('email', p.email);
    if (error) return toast(errorText(error), 'error');
    load();
  }

  const waiting = (list ?? []).filter((p) => !p.used_at);
  const joined = (list ?? []).filter((p) => p.used_at);

  return (
    <>
      <div className="info-card">
        <Icon name="shield_person" size={22} />
        <div>
          <strong>אישור חברים מראש, בלי לשלוח להם כלום</strong>
          <p className="muted small">
            מדביקים כאן רשימת מיילים בכל צורה: שורה לכל אחד, "שם מייל", או רשימה מועתקת מ-Google Chat. מי שברשימה ונרשם לאתר נכנס מיד בלי
            להמתין לאישור, ומי שכבר נרשם וממתין מאושר עכשיו. אף אחד לא מקבל הודעה. בכניסה הראשונה כל אחד יתבקש לאשר את תקנון נטפרי.
          </p>
        </div>
      </div>
      <section className="settings-card">
        <label className="field">
          <span>רשימת מיילים</span>
          <textarea
            rows={8}
            dir="auto"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={'ישראל ישראלי israel@gmail.com\nmoshe@gmail.com'}
          />
          <span className="field-hint">{entries.length ? `זוהו ${entries.length} מיילים` : 'לא זוהו מיילים עדיין'}</span>
        </label>
        {entries.length > 0 && (
          <ul className="parsed-list">
            {entries.slice(0, 50).map((e) => (
              <li key={e.email}>
                <span dir="ltr">{e.email}</span>
                {e.name && <span className="muted"> · {e.name}</span>}
              </li>
            ))}
            {entries.length > 50 && <li className="muted">ועוד {entries.length - 50}…</li>}
          </ul>
        )}
        {summary && <div className="alert info"><Icon name="check" size={18} /> {summary}</div>}
        <div className="form-actions">
          <button className="btn filled" disabled={busy || entries.length === 0} onClick={add}>
            אישור {entries.length || ''} מראש
          </button>
        </div>
      </section>

      <section className="card-section">
        <div className="section-head"><h2>אושרו וטרם נרשמו ({waiting.length})</h2></div>
        {list === null ? (
          <div className="spinner" />
        ) : waiting.length === 0 ? (
          <div className="empty-inline small"><span>אין מיילים שאושרו מראש וטרם נרשמו.</span></div>
        ) : (
          <ul className="list">
            {waiting.map((p) => (
              <li key={p.email} className="list-row static">
                <div className="list-main">
                  <div className="list-title" dir="ltr" style={{ textAlign: 'right' }}>{p.email}</div>
                  <div className="list-sub">{p.display_name ?? 'ללא שם'} · אושר {timeAgo(p.added_at)}</div>
                </div>
                <button className="btn text danger" onClick={() => remove(p)}>הסרה</button>
              </li>
            ))}
          </ul>
        )}
        {joined.length > 0 && <p className="muted small" style={{ marginTop: 8 }}>{joined.length} מהרשימה כבר נרשמו ונכנסו.</p>}
      </section>
    </>
  );
}
