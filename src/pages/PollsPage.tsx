import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useApp } from '../AppContext';
import { supabase } from '../supabase';
import type { Poll, PollOption } from '../types';
import { errorText, fullDate, timeAgo } from '../lib/format';
import { Modal, useFeedback } from '../components/Feedback';
import Icon from '../components/Icon';

/** /polls: every poll, newest first. /polls/:pollId: answer one poll and see its results. */
export default function PollsPage() {
  const pollId = Number(useParams().pollId) || null;
  return pollId ? <PollView id={pollId} /> : <PollList />;
}

function PollList() {
  const { nameOf } = useApp();
  const [polls, setPolls] = useState<Poll[] | null>(null);
  const [answered, setAnswered] = useState<Set<number>>(new Set());
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    Promise.all([
      supabase.from('polls').select('*').order('created_at', { ascending: false }).limit(200),
      supabase.from('poll_votes').select('poll_id'),
    ]).then(([p, v]) => {
      setPolls((p.data as Poll[]) ?? []);
      setAnswered(new Set(((v.data as { poll_id: number }[]) ?? []).map((x) => x.poll_id)));
    });
  }, []);

  return (
    <div className="pane scroll-pane">
      <div className="page narrow-page">
        <header className="page-head polls-head">
          <div>
            <h1>סקרים</h1>
            <p className="muted">כל חבר יכול לפתוח סקר. ההצבעות חסויות: רואים רק כמה בחרו בכל תשובה, לא מי.</p>
          </div>
          <button className="btn filled" onClick={() => setCreating(true)}>
            <Icon name="add" size={18} /> סקר חדש
          </button>
        </header>
        {polls === null ? (
          <div className="spinner" />
        ) : polls.length === 0 ? (
          <div className="empty-inline"><Icon name="ballot" /><span>עוד אין סקרים. אפשר לפתוח את הראשון.</span></div>
        ) : (
          <ul className="list">
            {polls.map((p) => (
              <li key={p.id}>
                <Link to={`/polls/${p.id}`} className="list-row plain-link">
                  <Icon name="ballot" />
                  <div className="list-main">
                    <div className="list-title">{p.question}</div>
                    <div className="list-sub">
                      {nameOf(p.author_id)} · {timeAgo(p.created_at)}
                      {p.closed ? ' · נסגר' : answered.has(p.id) ? ' · ענית' : ''}
                    </div>
                  </div>
                  {!p.closed && !answered.has(p.id) && <span className="badge-count">חדש</span>}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
      {creating && <CreatePollDialog onClose={() => setCreating(false)} />}
    </div>
  );
}

interface Result {
  option_id: number;
  votes: number;
  voters: number;
}

function PollView({ id }: { id: number }) {
  const { me, nameOf, canRemove } = useApp();
  const { confirm, toast } = useFeedback();
  const navigate = useNavigate();
  const [poll, setPoll] = useState<Poll | null | undefined>(undefined);
  const [options, setOptions] = useState<PollOption[]>([]);
  const [results, setResults] = useState<Result[]>([]);
  const [mine, setMine] = useState<Set<number>>(new Set());
  const [choice, setChoice] = useState<Set<number>>(new Set());
  const [changing, setChanging] = useState(false);
  const [busy, setBusy] = useState(false);

  const loadResults = useCallback(async () => {
    const { data } = await supabase.rpc('poll_results', { p_poll: id });
    setResults((data as Result[]) ?? []);
  }, [id]);

  const load = useCallback(async () => {
    const [p, o, v] = await Promise.all([
      supabase.from('polls').select('*').eq('id', id).maybeSingle(),
      supabase.from('poll_options').select('*').eq('poll_id', id).order('position'),
      supabase.from('poll_votes').select('option_id').eq('poll_id', id),
    ]);
    setPoll((p.data as Poll) ?? null);
    setOptions((o.data as PollOption[]) ?? []);
    const my = new Set(((v.data as { option_id: number }[]) ?? []).map((x) => x.option_id));
    setMine(my);
    setChoice(new Set(my));
    loadResults();
  }, [id, loadResults]);

  useEffect(() => {
    setPoll(undefined);
    setChanging(false);
    load();
  }, [load]);

  // Totals change as others answer; votes are private, so poll instead of subscribing.
  useEffect(() => {
    const t = setInterval(loadResults, 15000);
    return () => clearInterval(t);
  }, [loadResults]);

  if (poll === undefined) return <div className="pane"><div className="spinner" /></div>;
  if (poll === null) {
    return (
      <div className="pane scroll-pane">
        <div className="page narrow-page">
          <div className="empty-inline"><Icon name="ballot" /><span>הסקר לא נמצא, אולי הוא נמחק.</span></div>
          <Link to="/polls" className="btn text">לכל הסקרים</Link>
        </div>
      </div>
    );
  }

  const voted = mine.size > 0;
  const answering = !poll.closed && (!voted || changing);
  const voters = results[0]?.voters ?? 0;
  const canManage = poll.author_id === me?.id || canRemove;

  function toggle(o: number) {
    setChoice((prev) => {
      if (!poll!.multi) return new Set([o]);
      const next = new Set(prev);
      if (next.has(o)) next.delete(o);
      else next.add(o);
      return next;
    });
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.rpc('vote_poll', { p_poll: id, p_options: [...choice] });
    setBusy(false);
    if (error) return toast(errorText(error), 'error');
    setMine(new Set(choice));
    setChanging(false);
    loadResults();
  }

  async function setClosed(closed: boolean) {
    const { error } = await supabase.rpc('set_poll_closed', { p_poll: id, p_closed: closed });
    if (error) return toast(errorText(error), 'error');
    load();
  }

  async function remove() {
    const ok = await confirm({ title: 'מחיקת הסקר', body: 'הסקר וכל התשובות יימחקו.', confirmLabel: 'מחיקה', danger: true });
    if (!ok) return;
    const { error } = await supabase.from('polls').delete().eq('id', id);
    if (error) return toast(errorText(error), 'error');
    toast('הסקר נמחק');
    navigate('/polls');
  }

  return (
    <div className="pane scroll-pane">
      <div className="page narrow-page">
        <Link to="/polls" className="back-link"><Icon name="forward" size={18} /> כל הסקרים</Link>
        <section className="poll-card">
          <div className="poll-head">
            <Icon name="ballot" size={22} />
            <div>
              <h1 className="poll-question">{poll.question}</h1>
              <div className="muted small">
                {nameOf(poll.author_id)} · <span title={fullDate(poll.created_at)}>{timeAgo(poll.created_at)}</span>
                {poll.multi ? ' · אפשר לבחור כמה תשובות' : ''}
                {poll.closed ? ' · הסקר נסגר' : ''}
              </div>
            </div>
          </div>

          {answering ? (
            <form onSubmit={submit} className="poll-options">
              {options.map((o) => (
                <label key={o.id} className={`poll-option ${choice.has(o.id) ? 'on' : ''}`}>
                  <input type={poll.multi ? 'checkbox' : 'radio'} name="poll" checked={choice.has(o.id)} onChange={() => toggle(o.id)} />
                  <span>{o.label}</span>
                </label>
              ))}
              <div className="form-actions">
                {changing && <button type="button" className="btn text" onClick={() => { setChanging(false); setChoice(new Set(mine)); }}>ביטול</button>}
                <button className="btn filled" disabled={busy || choice.size === 0}>{voted ? 'עדכון התשובה' : 'שליחת תשובה'}</button>
              </div>
            </form>
          ) : (
            <div className="poll-options">
              <div className="poll-results-wrap">
                <PollDonut
                  slices={options.map((o, i) => ({ value: results.find((r) => r.option_id === o.id)?.votes ?? 0, color: SLICE_COLORS[i % SLICE_COLORS.length] }))}
                  center={String(voters)}
                  sub="ענו"
                />
                <div className="poll-results-list">
                  {options.map((o, i) => {
                    const n = results.find((r) => r.option_id === o.id)?.votes ?? 0;
                    const pct = voters ? Math.round((n / voters) * 100) : 0;
                    return (
                      <div key={o.id} className={`poll-result ${mine.has(o.id) ? 'mine' : ''}`}>
                        <div className="poll-bar" style={{ width: `${pct}%`, background: `${SLICE_COLORS[i % SLICE_COLORS.length]}33` }} />
                        <span className="poll-label">
                          <span className="slice-dot" style={{ background: SLICE_COLORS[i % SLICE_COLORS.length] }} />
                          {o.label}
                          {mine.has(o.id) && <Icon name="check" size={16} />}
                        </span>
                        <span className="poll-count">{n} · {pct}%</span>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="poll-foot">
                <span className="muted small">{voters} ענו</span>
                {!poll.closed && <button className="btn text" onClick={() => setChanging(true)}>שינוי התשובה</button>}
              </div>
            </div>
          )}
        </section>

        {canManage && (
          <div className="row gap poll-manage">
            <button className="btn outlined" onClick={() => setClosed(!poll.closed)}>{poll.closed ? 'פתיחה מחדש' : 'סגירת הסקר'}</button>
            <button className="btn text danger" onClick={remove}>מחיקת הסקר</button>
          </div>
        )}
      </div>
    </div>
  );
}

/** New poll: question, 2–10 answers, single or multiple choice, and the room where it is announced. */
export function CreatePollDialog({ onClose, roomId }: { onClose: () => void; roomId?: number }) {
  const { rooms, mainRoom, isMod } = useApp();
  const { toast } = useFeedback();
  const navigate = useNavigate();
  const [question, setQuestion] = useState('');
  const [opts, setOpts] = useState(['', '']);
  const [multi, setMulti] = useState(false);
  const [room, setRoom] = useState<number | undefined>(roomId ?? mainRoom?.id);
  const [busy, setBusy] = useState(false);
  const writable = rooms.filter((r) => !r.admin_only_post || isMod);
  const filled = opts.filter((o) => o.trim()).length;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { data, error } = await supabase.rpc('create_poll', {
      p_question: question.trim(),
      p_options: opts.map((o) => o.trim()).filter(Boolean),
      p_multi: multi,
      p_channel: room ?? null,
    });
    setBusy(false);
    if (error) return toast(errorText(error), 'error');
    toast('הסקר נפתח והודעה עליו נשלחה בצ\'אט');
    onClose();
    navigate(`/polls/${data as number}`);
  }

  return (
    <Modal title="סקר חדש" onClose={onClose}>
      <form className="form-stack" onSubmit={submit}>
        <label className="field">
          <span>השאלה</span>
          <input value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={300} required autoFocus placeholder="למשל: באיזה יום נוח לכם לשיעור?" />
        </label>
        <div className="field">
          <span>תשובות</span>
          {opts.map((o, i) => (
            <div key={i} className="poll-edit-row">
              <input value={o} maxLength={100} placeholder={`תשובה ${i + 1}`} onChange={(e) => setOpts((p) => p.map((x, j) => (j === i ? e.target.value : x)))} />
              {opts.length > 2 && (
                <button type="button" className="icon-btn" aria-label="הסרת תשובה" onClick={() => setOpts((p) => p.filter((_, j) => j !== i))}>
                  <Icon name="remove" />
                </button>
              )}
            </div>
          ))}
          {opts.length < 10 && (
            <button type="button" className="btn text poll-add" onClick={() => setOpts((p) => [...p, ''])}>
              <Icon name="add_circle" size={18} /> הוספת תשובה
            </button>
          )}
        </div>
        <label className="switch-row">
          <span>
            <strong>אפשר לבחור כמה תשובות</strong>
          </span>
          <input type="checkbox" className="switch" checked={multi} onChange={(e) => setMulti(e.target.checked)} />
        </label>
        <label className="field">
          <span>איפה לפרסם הודעה על הסקר</span>
          <select value={room ?? ''} onChange={(e) => setRoom(Number(e.target.value))}>
            {writable.map((r) => (
              <option key={r.id} value={r.id}>{r.is_main ? 'הצ\'אט הראשי' : r.name}</option>
            ))}
          </select>
        </label>
        <div className="dialog-actions">
          <button type="button" className="btn text" onClick={onClose}>ביטול</button>
          <button className="btn filled" disabled={busy || !question.trim() || filled < 2}>פתיחת הסקר</button>
        </div>
      </form>
    </Modal>
  );
}

// Distinct, calm colors that read well in light and dark mode.
const SLICE_COLORS = ['#0b57d0', '#1e8e3e', '#e37400', '#a142f4', '#d93025', '#12b5cb', '#f9ab00', '#e52592', '#5f6368', '#7cb342'];

/** Donut chart of a poll's answers (SVG, no library). */
function PollDonut({ slices, center, sub }: { slices: { value: number; color: string }[]; center: string; sub: string }) {
  const total = slices.reduce((n, x) => n + x.value, 0);
  const r = 42;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <svg className="poll-donut" viewBox="0 0 100 100" role="img" aria-label="תוצאות הסקר">
      <circle cx="50" cy="50" r={r} fill="none" stroke="var(--surface-2)" strokeWidth="14" />
      {total > 0 &&
        slices.map((x, i) => {
          const len = (x.value / total) * c;
          const el = x.value ? (
            <circle key={i} cx="50" cy="50" r={r} fill="none" stroke={x.color} strokeWidth="14"
              strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-offset} transform="rotate(-90 50 50)" />
          ) : null;
          offset += len;
          return el;
        })}
      <text x="50" y="49" textAnchor="middle" className="donut-num">{center}</text>
      <text x="50" y="63" textAnchor="middle" className="donut-sub">{sub}</text>
    </svg>
  );
}
