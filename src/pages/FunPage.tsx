import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useApp } from '../AppContext';
import { supabase } from '../supabase';
import { errorText, timeAgo } from '../lib/format';
import Avatar from '../components/Avatar';
import { useFeedback } from '../components/Feedback';
import Icon from '../components/Icon';

const REACTIONS = ['😂', '😱', '🙈', '👏', '🤯', '🫡'];
type Tab = 'confessions' | 'quotes';

/** פינת החבר'ה: anonymous confessions and the "who said it?" game. */
export default function FunPage() {
  const [tab, setTab] = useState<Tab>(() => (location.hash.includes('tab=quotes') ? 'quotes' : 'confessions'));
  return (
    <div className="pane scroll-pane">
      <div className="page narrow-page">
        <header className="page-head">
          <h1>פינת החבר'ה</h1>
          <p className="muted">וידויים בעילום שם ומשחק "מי אמר את זה?". בכיף ובכבוד.</p>
        </header>
        <div className="tabs" role="tablist">
          <button className={tab === 'confessions' ? 'on' : ''} onClick={() => setTab('confessions')} role="tab">
            <Icon name="visibility_off" size={20} /> וידויים
          </button>
          <button className={tab === 'quotes' ? 'on' : ''} onClick={() => setTab('quotes')} role="tab">
            <Icon name="format_quote" size={20} /> מי אמר את זה?
          </button>
        </div>
        {tab === 'confessions' ? <Confessions /> : <WhoSaidIt />}
      </div>
    </div>
  );
}

interface Confession {
  id: number;
  body: string;
  created_at: string;
}
interface CReaction {
  confession_id: number;
  user_id: string;
  emoji: string;
}
interface CComment {
  id: number;
  confession_id: number;
  author_id: string;
  body: string;
  created_at: string;
}

function Confessions() {
  const { me, canRemove, isOwner, nameOf } = useApp();
  const { toast, confirm } = useFeedback();
  const [list, setList] = useState<Confession[] | null>(null);
  const [reactions, setReactions] = useState<CReaction[]>([]);
  const [comments, setComments] = useState<CComment[]>([]);
  const [authors, setAuthors] = useState<Map<number, string>>(new Map());
  const [text, setText] = useState('אף פעם לא ');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.from('confessions').select('*').order('id', { ascending: false }).limit(100);
    const rows = (data as Confession[]) ?? [];
    setList(rows);
    const ids = rows.map((r) => r.id);
    if (!ids.length) return;
    const [r, c, a] = await Promise.all([
      supabase.from('confession_reactions').select('*').in('confession_id', ids),
      supabase.from('confession_comments').select('*').in('confession_id', ids).order('id'),
      // RLS: my own confessions, or all of them for the owner.
      supabase.from('anon_authors').select('item_id, author_id').eq('kind', 'confession').in('item_id', ids),
    ]);
    setReactions((r.data as CReaction[]) ?? []);
    setComments((c.data as CComment[]) ?? []);
    setAuthors(new Map(((a.data as { item_id: number; author_id: string }[]) ?? []).map((x) => [x.item_id, x.author_id])));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function post(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.rpc('post_confession', { p_body: text.trim() });
    setBusy(false);
    if (error) return toast(errorText(error), 'error');
    setText('אף פעם לא ');
    load();
  }

  async function react(c: Confession, emoji: string) {
    const mine = reactions.some((r) => r.confession_id === c.id && r.user_id === me?.id && r.emoji === emoji);
    const q = supabase.from('confession_reactions');
    const { error } = mine
      ? await q.delete().match({ confession_id: c.id, user_id: me!.id, emoji })
      : await q.insert({ confession_id: c.id, user_id: me!.id, emoji });
    if (error) return toast(errorText(error), 'error');
    load();
  }

  async function remove(c: Confession) {
    const ok = await confirm({ title: 'מחיקת הווידוי', confirmLabel: 'מחיקה', danger: true });
    if (!ok) return;
    const { error } = await supabase.rpc('delete_confession', { p_id: c.id });
    if (error) return toast(errorText(error), 'error');
    load();
  }

  return (
    <>
      <form className="settings-card form-stack" onSubmit={post}>
        <label className="field">
          <span>וידוי בעילום שם</span>
          <textarea rows={3} maxLength={500} value={text} onChange={(e) => setText(e.target.value)} disabled={!me?.can_send_anonymous} />
        </label>
        <div className="form-actions spread">
          <span className="muted small">
            {me?.can_send_anonymous ? 'אף אחד לא יראה מי כתב (רק מנהל-העל, למקרי חירום).' : 'ההרשאה שלך לפרסם בעילום שם כבויה על ידי המנהלים.'}
          </span>
          <button className="btn filled" disabled={busy || !me?.can_send_anonymous || text.trim().length < 3}>פרסום</button>
        </div>
      </form>

      {list === null ? (
        <div className="spinner" />
      ) : list.length === 0 ? (
        <div className="empty-inline"><Icon name="visibility_off" /><span>עוד אין וידויים. מי יתחיל?</span></div>
      ) : (
        <ul className="confession-list">
          {list.map((c) => {
            const author = authors.get(c.id);
            const mine = author === me?.id;
            return (
              <li key={c.id} className="confession">
                <div className="confession-head">
                  <Avatar anonymous size={28} />
                  <span className="muted small">אנונימי · {timeAgo(c.created_at)}{mine ? ' · שלך' : ''}</span>
                  {isOwner && author && !mine && <span className="revealed-tag">{nameOf(author)}</span>}
                  {(mine || canRemove) && (
                    <button className="icon-btn small" onClick={() => remove(c)} aria-label="מחיקה"><Icon name="delete" size={16} /></button>
                  )}
                </div>
                <p className="confession-body">{c.body}</p>
                <div className="confession-reacts">
                  {REACTIONS.map((e) => {
                    const n = reactions.filter((r) => r.confession_id === c.id && r.emoji === e).length;
                    const on = reactions.some((r) => r.confession_id === c.id && r.emoji === e && r.user_id === me?.id);
                    return (
                      <button key={e} className={`reaction ${on ? 'mine' : ''}`} onClick={() => react(c, e)}>
                        {e} {n > 0 && <span>{n}</span>}
                      </button>
                    );
                  })}
                </div>
                <Comments confession={c} comments={comments.filter((x) => x.confession_id === c.id)} reload={load} />
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

function Comments({ confession, comments, reload }: { confession: Confession; comments: CComment[]; reload: () => void }) {
  const { me, nameOf, canRemove } = useApp();
  const { toast } = useFeedback();
  const [text, setText] = useState('');

  async function send(e: FormEvent) {
    e.preventDefault();
    const { error } = await supabase.from('confession_comments').insert({ confession_id: confession.id, author_id: me!.id, body: text.trim() });
    if (error) return toast(errorText(error), 'error');
    setText('');
    reload();
  }

  async function remove(c: CComment) {
    const { error } = await supabase.from('confession_comments').delete().eq('id', c.id);
    if (error) return toast(errorText(error), 'error');
    reload();
  }

  return (
    <div className="confession-comments">
      {comments.map((c) => (
        <div key={c.id} className="c-comment">
          <strong>{nameOf(c.author_id)}</strong> {c.body}
          {(c.author_id === me?.id || canRemove) && (
            <button className="link-danger" onClick={() => remove(c)}>מחיקה</button>
          )}
        </div>
      ))}
      <form onSubmit={send} className="nick-form">
        <input value={text} maxLength={300} onChange={(e) => setText(e.target.value)} placeholder="תגובה…" />
        <button className="btn text" disabled={!text.trim()}>שליחה</button>
      </form>
    </div>
  );
}

interface Quiz {
  id: number;
  quote: string;
  options: string[];
  grabbed_by: string | null;
  created_at: string;
  closes_at: string;
  guesses: number;
  correct_count: number;
  my_guess: string | null;
  answer: string | null;
}

function WhoSaidIt() {
  const { me, nameOf, profiles, canRemove } = useApp();
  const { toast } = useFeedback();
  const [list, setList] = useState<Quiz[] | null>(null);
  const [board, setBoard] = useState<{ user_id: string; points: number }[]>([]);

  const load = useCallback(async () => {
    const [q, b] = await Promise.all([supabase.rpc('quiz_list'), supabase.rpc('quiz_leaderboard')]);
    setList((q.data as Quiz[]) ?? []);
    setBoard((b.data as { user_id: string; points: number }[]) ?? []);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function guess(q: Quiz, who: string) {
    const { data, error } = await supabase.rpc('guess_quote', { p_quiz: q.id, p_guess: who });
    if (error) return toast(errorText(error), 'error');
    toast(data ? 'בול! קיבלת 10 נקודות' : 'לא הפעם…');
    load();
  }

  async function remove(q: Quiz) {
    const { error } = await supabase.rpc('delete_quiz', { p_id: q.id });
    if (error) return toast(errorText(error), 'error');
    load();
  }

  return (
    <>
      <div className="info-card">
        <Icon name="format_quote" size={22} />
        <div>
          <strong>איך משחקים?</strong>
          <p className="muted small">
            בצ'אט, בתפריט ⋮ של הודעה, בוחרים "העברה ל'מי אמר את זה?'". הציטוט מופיע כאן בלי שם, וכולם מנחשים מי כתב אותו מבין ארבעה.
            ניחוש נכון = 10 נקודות. הודעות אנונימיות לא עוברות לכאן אף פעם.
          </p>
        </div>
      </div>

      {board.length > 0 && (
        <section className="quiz-board">
          <strong>המנחשים המובילים</strong>
          <ol>
            {board.slice(0, 5).map((b) => (
              <li key={b.user_id}><span>{nameOf(b.user_id)}</span><span className="muted">{b.points}</span></li>
            ))}
          </ol>
        </section>
      )}

      {list === null ? (
        <div className="spinner" />
      ) : list.length === 0 ? (
        <div className="empty-inline"><Icon name="format_quote" /><span>עוד אין ציטוטים. תעביר את הראשון מהצ'אט.</span></div>
      ) : (
        <ul className="quiz-list">
          {list.map((q) => {
            const closed = new Date(q.closes_at) < new Date();
            const known = !!q.answer;
            return (
              <li key={q.id} className="quiz">
                <blockquote>"{q.quote}"</blockquote>
                <div className="quiz-options">
                  {q.options.map((o) => {
                    const cls = known ? (o === q.answer ? 'right' : o === q.my_guess ? 'wrong' : '') : '';
                    return (
                      <button key={o} className={`quiz-opt ${cls}`} disabled={known || closed} onClick={() => guess(q, o)}>
                        <Avatar id={o} name={profiles.get(o)?.display_name} size={24} />
                        {nameOf(o)}
                        {known && o === q.answer && <Icon name="check" size={16} />}
                      </button>
                    );
                  })}
                </div>
                <div className="quiz-meta muted small">
                  <span>
                    {q.guesses} ניחשו · {q.correct_count} צדקו
                    {q.grabbed_by && ` · הועבר על ידי ${nameOf(q.grabbed_by)}`}
                    {closed ? ' · נסגר' : ` · נסגר ${timeAgo(q.closes_at)}`}
                  </span>
                  {(q.grabbed_by === me?.id || q.answer === me?.id || canRemove) && (
                    <button className="link-danger" onClick={() => remove(q)}>הסרה</button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
