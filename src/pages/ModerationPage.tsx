import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../AppContext';
import { supabase } from '../supabase';
import { errorText, fullDate } from '../lib/format';
import type { Attachment } from '../types';
import Avatar from '../components/Avatar';
import { useFeedback } from '../components/Feedback';
import Icon from '../components/Icon';
import { muteUntilLabel } from '../components/Moderation';

interface Report {
  message_id: number;
  channel_id: number;
  author_id: string | null;
  anonymous: boolean;
  body: string;
  attachment: Attachment | null;
  reports: number;
  reasons: string[];
  last_at: string;
}

/** Inspectors and admins: reported messages, and who is muted right now. */
/** Moderation: open reports and muted members. `embedded`: as a tab inside ניהול הקהילה (no page frame). */
export default function ModerationPage({ embedded }: { embedded?: boolean } = {}) {
  const { profiles, rooms, nameOf, canRemove, reloadProfiles } = useApp();
  const { toast } = useFeedback();
  const [reports, setReports] = useState<Report[] | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.rpc('report_list');
    setReports((data as Report[]) ?? []);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (!canRemove) return null;

  async function handle(r: Report, del: boolean) {
    const { error } = await supabase.rpc('handle_report', { p_message: r.message_id, p_delete: del });
    if (error) return toast(errorText(error), 'error');
    toast(del ? 'ההודעה נמחקה' : 'הדיווח נסגר');
    load();
  }

  async function unmute(id: string) {
    const { error } = await supabase.rpc('unmute_member', { p_user: id });
    if (error) return toast(errorText(error), 'error');
    reloadProfiles();
  }

  const link = (r: Report) => {
    const room = rooms.find((x) => x.id === r.channel_id);
    return room && !room.is_main ? `/room/${room.id}?m=${r.message_id}` : `/?m=${r.message_id}`;
  };
  const muted = [...profiles.values()].filter((p) => p.muted_until && new Date(p.muted_until) > new Date());

  const content = (
      <>
        <section className="card-section">
          <div className="section-head"><h2>דיווחים פתוחים ({reports?.length ?? 0})</h2></div>
          {reports === null ? (
            <div className="spinner" />
          ) : reports.length === 0 ? (
            <div className="empty-inline small"><Icon name="check" /><span>אין דיווחים פתוחים.</span></div>
          ) : (
            <ul className="feedback-list">
              {reports.map((r) => (
                <li key={r.message_id}>
                  <div className="feedback-head">
                    <span className="role-tag">{r.reports} דיווחים</span>
                    <strong>{r.anonymous ? 'אנונימי' : nameOf(r.author_id)}</strong>
                    <time className="muted small">{fullDate(r.last_at)}</time>
                  </div>
                  <p className="feedback-body">{r.body || (r.attachment ? (r.attachment.type === 'video' ? '[סרטון]' : '[תמונה]') : '')}</p>
                  {r.reasons.length > 0 && <div className="muted small">סיבות: {r.reasons.join(' · ')}</div>}
                  <div className="row gap wrap">
                    <Link to={link(r)} className="btn text small">להודעה בצ'אט</Link>
                    <button className="btn danger-filled small" onClick={() => handle(r, true)}>מחיקת ההודעה</button>
                    <button className="btn tonal small" onClick={() => handle(r, false)}>ההודעה בסדר</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card-section">
          <div className="section-head"><h2>מושתקים עכשיו ({muted.length})</h2></div>
          {muted.length === 0 ? (
            <div className="empty-inline small"><span>אף אחד לא מושתק. משתיקים מתוך הפרופיל של החבר.</span></div>
          ) : (
            <ul className="list">
              {muted.map((p) => (
                <li key={p.id} className="list-row static">
                  <Avatar id={p.id} name={p.display_name} size={36} />
                  <div className="list-main">
                    <Link to={`/u/${p.id}`} className="list-title plain-link">{p.display_name}</Link>
                    <div className="list-sub">{muteUntilLabel(p.muted_until!)}</div>
                  </div>
                  <button className="btn text" onClick={() => unmute(p.id)}>ביטול השתקה</button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </>
  );

  if (embedded) {
    return (
      <>
        <p className="muted small">הודעות שחברים דיווחו עליהן, וחברים מושתקים. מי דיווח לא מוצג.</p>
        {content}
      </>
    );
  }
  return (
    <div className="pane scroll-pane">
      <div className="page narrow-page">
        <header className="page-head">
          <h1>פיקוח</h1>
          <p className="muted">הודעות שחברים דיווחו עליהן, וחברים מושתקים. מי דיווח לא מוצג.</p>
        </header>
        {content}
      </div>
    </div>
  );
}
