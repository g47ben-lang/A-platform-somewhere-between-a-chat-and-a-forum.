import { useEffect, useState } from 'react';
import { useApp } from '../AppContext';
import { supabase } from '../supabase';
import { errorText } from '../lib/format';
import { useFeedback } from './Feedback';
import Icon from './Icon';

/**
 * Pulls names out of a pasted list: one per line (or separated by wide gaps), with or without bullets.
 * Skips file names, emails and sentences.
 */
export function parseNames(text: string): string[] {
  return text
    .split(/\r?\n|\s{3,}|\t|\|/)
    .map((l) => l.replace(/^[\s*•·\-–—\d.)]+/, '').trim())
    .filter((l) => l && !/[@\d]|\.jpe?g|\.png/i.test(l))
    .map((l) => l.replace(/\s+/g, ' '))
    .filter((l) => {
      const words = l.split(/[\s-]+/).length;
      return words >= 2 && words <= 4 && l.length <= 60;
    });
}

interface RosterRow {
  id: number;
  name: string;
  claimed_by: string | null;
}

/** Admin: the yeshiva's list of names. Signing up with a name on it gets in at once. */
export default function RosterAdmin() {
  const { reloadProfiles, nameOf } = useApp();
  const { confirm, toast } = useFeedback();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<RosterRow[] | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const names = parseNames(text);

  const load = () =>
    supabase
      .from('roster')
      .select('id, name, claimed_by')
      .order('name')
      .then(({ data }) => setRows((data as RosterRow[]) ?? []));

  useEffect(() => {
    load();
  }, []);

  async function add() {
    setBusy(true);
    const { data, error } = await supabase.rpc('add_roster', { p_names: names });
    setBusy(false);
    if (error) return toast(errorText(error), 'error');
    const r = ((data as { added: number; activated: number }[]) ?? [])[0] ?? { added: 0, activated: 0 };
    setSummary(`נוספו ${r.added} שמות` + (r.activated ? ` · ${r.activated} שחיכו לאישור נכנסו עכשיו` : '') + (r.added < names.length ? ' (שמות שכבר היו ברשימה לא נוספו שוב)' : ''));
    setText('');
    load();
    reloadProfiles();
  }

  async function remove(r: RosterRow) {
    const ok = await confirm({ title: `הסרת ${r.name} מהרשימה`, body: 'מי שכבר נכנס עם השם הזה נשאר חבר.', confirmLabel: 'הסרה', danger: true });
    if (!ok) return;
    const { error } = await supabase.from('roster').delete().eq('id', r.id);
    if (error) return toast(errorText(error), 'error');
    load();
  }

  const claimed = (rows ?? []).filter((r) => r.claimed_by);
  const open = (rows ?? []).filter((r) => !r.claimed_by);

  return (
    <>
      <div className="info-card">
        <Icon name="group" size={22} />
        <div>
          <strong>רשימת השמות של הישיבה</strong>
          <p className="muted small">
            מי שנרשם עם שם שמופיע כאן נכנס מיד, בלי להמתין לאישור, ואתה מקבל התראה לבדוק אותו. ברשימה כותבים שם משפחה ואחריו שם
            פרטי (שם משפחה של שתי מילים עם מקף: בן-דוד). בהרשמה לא משנה הסדר, מקף או רווח, וכתיב עם או בלי ו/י, אבל שם המשפחה
            חייב להופיע. כל שם ברשימה נכנס פעם אחת בלבד.
          </p>
        </div>
      </div>
      <section className="settings-card">
        <label className="field">
          <span>הדבקת שמות</span>
          <textarea
            rows={8}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={'אבוטבול אליה\nאברמובסקי חיים\nאדלר אליעזר-מאיר'}
          />
          <span className="field-hint">{names.length ? `זוהו ${names.length} שמות` : 'שם אחד בכל שורה'}</span>
        </label>
        {names.length > 0 && (
          <ul className="parsed-list">
            {names.slice(0, 50).map((n, i) => (
              <li key={i}>{n}</li>
            ))}
            {names.length > 50 && <li className="muted">ועוד {names.length - 50}…</li>}
          </ul>
        )}
        {summary && <div className="alert info"><Icon name="check" size={18} /> {summary}</div>}
        <div className="form-actions">
          <button className="btn filled" disabled={busy || names.length === 0} onClick={add}>
            הוספת {names.length || ''} שמות
          </button>
        </div>
      </section>

      <section className="card-section">
        <div className="section-head">
          <h2>ברשימה ({rows?.length ?? 0})</h2>
        </div>
        {rows === null ? (
          <div className="spinner" />
        ) : rows.length === 0 ? (
          <div className="empty-inline small"><span>הרשימה ריקה.</span></div>
        ) : (
          <>
            <p className="muted small">{claimed.length} כבר נכנסו · {open.length} עוד לא נרשמו</p>
            <details className="roster-details">
              <summary>הצגת הרשימה</summary>
              <ul className="list">
                {rows.map((r) => (
                  <li key={r.id} className="list-row static">
                    <div className="list-main">
                      <div className="list-title">{r.name}</div>
                      <div className="list-sub">{r.claimed_by ? `נכנס בשם ${nameOf(r.claimed_by)}` : 'עוד לא נרשם'}</div>
                    </div>
                    <button className="btn text danger" onClick={() => remove(r)}>הסרה</button>
                  </li>
                ))}
              </ul>
            </details>
          </>
        )}
      </section>
    </>
  );
}
