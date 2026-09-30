import { useEffect, useState, type FormEvent } from 'react';
import { useApp } from '../AppContext';
import { supabase } from '../supabase';
import { errorText, fullDate, timeAgo } from '../lib/format';
import { useFeedback } from '../components/Feedback';
import Icon from '../components/Icon';

export type FeedbackKind = 'bug' | 'idea' | 'other';
export const KIND_LABEL: Record<FeedbackKind, string> = { bug: 'באג / תקלה', idea: 'הצעה לשיפור', other: 'אחר' };

export interface FeedbackRow {
  id: number;
  author_id: string;
  kind: FeedbackKind;
  body: string;
  status: 'open' | 'done';
  reply: string | null;
  replied_at: string | null;
  created_at: string;
}

/** Members write to the management (bugs, suggestions, anything else) and see the answers. */
export default function ContactPage() {
  const { me } = useApp();
  const { toast } = useFeedback();
  const [kind, setKind] = useState<FeedbackKind>('idea');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [mine, setMine] = useState<FeedbackRow[] | null>(null);

  // Only my own requests: admins may read everyone's, but those belong in the admin tab.
  const load = () =>
    supabase
      .from('feedback')
      .select('*')
      .eq('author_id', me?.id ?? '')
      .order('id', { ascending: false })
      .then(({ data }) => setMine((data as FeedbackRow[]) ?? []));

  useEffect(() => {
    load();
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.rpc('send_feedback', { p_kind: kind, p_body: body.trim() });
    setBusy(false);
    if (error) return toast(errorText(error), 'error');
    toast('הפנייה נשלחה לניהול. תודה!');
    setBody('');
    load();
  }

  return (
    <div className="pane scroll-pane">
      <div className="page narrow-page">
        <header className="page-head">
          <h1>יצירת קשר עם הניהול</h1>
          <p className="muted">מצאת באג? יש לך רעיון לשיפור? כתוב כאן. רק מנהלי האתר רואים את הפנייה, והתשובה תופיע למטה.</p>
        </header>
        <form className="settings-card form-stack" onSubmit={submit}>
          <div className="chip-row" role="radiogroup">
            {(Object.keys(KIND_LABEL) as FeedbackKind[]).map((k) => (
              <button type="button" key={k} role="radio" aria-checked={kind === k} className={`chip ${kind === k ? 'on' : ''}`} onClick={() => setKind(k)}>
                <Icon name={k === 'bug' ? 'error' : k === 'idea' ? 'star' : 'mail'} size={16} /> {KIND_LABEL[k]}
              </button>
            ))}
          </div>
          <label className="field">
            <span>{kind === 'bug' ? 'מה קרה? איפה ומתי?' : kind === 'idea' ? 'מה היית מוסיף או משנה?' : 'מה תרצה לומר?'}</span>
            <textarea rows={5} maxLength={2000} value={body} onChange={(e) => setBody(e.target.value)} required />
          </label>
          <div className="form-actions">
            <button className="btn filled" disabled={busy || !body.trim()}>שליחה</button>
          </div>
        </form>

        <section className="card-section">
          <div className="section-head"><h2>הפניות שלי</h2></div>
          {mine === null ? (
            <div className="spinner" />
          ) : mine.length === 0 ? (
            <div className="empty-inline small"><span>עוד לא שלחת פניות.</span></div>
          ) : (
            <ul className="feedback-list">
              {mine.map((f) => (
                <li key={f.id}>
                  <div className="feedback-head">
                    <span className="role-tag">{KIND_LABEL[f.kind]}</span>
                    <span className={`feedback-status ${f.status}`}>{f.status === 'done' ? 'טופל' : 'פתוח'}</span>
                    <time className="muted small" title={fullDate(f.created_at)}>{timeAgo(f.created_at)}</time>
                  </div>
                  <p className="feedback-body">{f.body}</p>
                  {f.reply && (
                    <div className="feedback-reply">
                      <strong>תשובת הניהול:</strong> {f.reply}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
