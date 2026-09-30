import { useEffect, useState } from 'react';
import { useApp } from '../AppContext';
import { supabase } from '../supabase';
import { errorText, fullDate, timeAgo } from '../lib/format';
import { KIND_LABEL, type FeedbackRow } from '../pages/ContactPage';
import { useFeedback } from './Feedback';
import Icon from './Icon';

/** Admin: every request sent through "יצירת קשר עם הניהול", open ones first. */
export default function FeedbackAdmin() {
  const { nameOf } = useApp();
  const { toast } = useFeedback();
  const [rows, setRows] = useState<FeedbackRow[] | null>(null);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [showDone, setShowDone] = useState(false);

  const load = () =>
    supabase
      .from('feedback')
      .select('*')
      .order('id', { ascending: false })
      .limit(500)
      .then(({ data }) => setRows((data as FeedbackRow[]) ?? []));

  useEffect(() => {
    load();
  }, []);

  async function answer(f: FeedbackRow, done: boolean) {
    const { error } = await supabase.rpc('reply_feedback', { p_id: f.id, p_reply: drafts[f.id] ?? '', p_done: done });
    if (error) return toast(errorText(error), 'error');
    setDrafts((d) => ({ ...d, [f.id]: '' }));
    load();
  }

  const open = (rows ?? []).filter((f) => f.status === 'open');
  const done = (rows ?? []).filter((f) => f.status === 'done');
  const shown = showDone ? done : open;

  return (
    <section className="card-section">
      <div className="section-head">
        <h2>{showDone ? `פניות שטופלו (${done.length})` : `פניות פתוחות (${open.length})`}</h2>
        <button className="btn text" onClick={() => setShowDone(!showDone)}>{showDone ? 'לפניות הפתוחות' : `טופלו (${done.length})`}</button>
      </div>
      {rows === null ? (
        <div className="spinner" />
      ) : shown.length === 0 ? (
        <div className="empty-inline small"><Icon name="check" /><span>{showDone ? 'אין עדיין פניות שטופלו.' : 'אין פניות פתוחות.'}</span></div>
      ) : (
        <ul className="feedback-list">
          {shown.map((f) => (
            <li key={f.id}>
              <div className="feedback-head">
                <span className="role-tag">{KIND_LABEL[f.kind]}</span>
                <strong>{nameOf(f.author_id)}</strong>
                <time className="muted small" title={fullDate(f.created_at)}>{timeAgo(f.created_at)}</time>
              </div>
              <p className="feedback-body">{f.body}</p>
              {f.reply && <div className="feedback-reply"><strong>נענה:</strong> {f.reply}</div>}
              <textarea
                rows={2}
                className="feedback-answer"
                placeholder="תשובה לשולח (לא חובה)"
                value={drafts[f.id] ?? ''}
                onChange={(e) => setDrafts((d) => ({ ...d, [f.id]: e.target.value }))}
              />
              <div className="row gap">
                {f.status === 'open' ? (
                  <>
                    {(drafts[f.id] ?? '').trim() && <button className="btn text" onClick={() => answer(f, false)}>שליחת תשובה</button>}
                    <button className="btn filled small" onClick={() => answer(f, true)}>{(drafts[f.id] ?? '').trim() ? 'תשובה וסימון כטופל' : 'סימון כטופל'}</button>
                  </>
                ) : (
                  <button className="btn text" onClick={() => answer(f, false)}>פתיחה מחדש</button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
