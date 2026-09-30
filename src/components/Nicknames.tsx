import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useApp } from '../AppContext';
import { supabase } from '../supabase';
import { errorText } from '../lib/format';
import { useFeedback } from './Feedback';
import Icon from './Icon';

export interface Nickname {
  id: number;
  nickname: string;
  votes: number;
  i_voted: boolean;
  mine: boolean;
}

/** Nicknames members propose for each other; the one with most votes is shown under the name. */
export function useNicknames(userId: string) {
  const [list, setList] = useState<Nickname[] | null>(null);
  const load = useCallback(async () => {
    const { data } = await supabase.rpc('nickname_list', { p_target: userId });
    setList((data as Nickname[]) ?? []);
  }, [userId]);
  useEffect(() => {
    setList(null);
    load();
  }, [load]);
  return { list, load };
}

export default function Nicknames({ userId, list, reload }: { userId: string; list: Nickname[] | null; reload: () => void }) {
  const { me, canRemove, nameOf } = useApp();
  const { toast, confirm } = useFeedback();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const isMe = me?.id === userId;

  async function propose(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.rpc('propose_nickname', { p_target: userId, p_nickname: text.trim() });
    setBusy(false);
    if (error) return toast(errorText(error), 'error');
    setText('');
    reload();
  }

  async function vote(n: Nickname) {
    const { error } = await supabase.rpc('toggle_nickname_vote', { p_id: n.id });
    if (error) return toast(errorText(error), 'error');
    reload();
  }

  async function remove(n: Nickname) {
    const ok = await confirm({ title: `הסרת הכינוי "${n.nickname}"`, confirmLabel: 'הסרה', danger: true });
    if (!ok) return;
    const { error } = await supabase.rpc('remove_nickname', { p_id: n.id });
    if (error) return toast(errorText(error), 'error');
    reload();
  }

  return (
    <section className="card-section nick-section">
      <div className="section-head"><h2>כינויים</h2></div>
      <p className="muted small">
        {isMe
          ? 'כינויים שהחבר\'ה הציעו לך. הכינוי עם הכי הרבה קולות מוצג מתחת לשם שלך. כינוי שלא מתאים לך אפשר להסיר.'
          : `מה הכינוי של ${nameOf(userId)}? מציעים ומצביעים, והכינוי המוביל מוצג בפרופיל. מי שהציע לא נחשף.`}
      </p>
      {list === null ? (
        <div className="spinner" />
      ) : list.length === 0 ? (
        <div className="empty-inline small"><span>{isMe ? 'עוד לא הציעו לך כינוי.' : 'עוד אין כינויים. תהיה הראשון.'}</span></div>
      ) : (
        <ul className="nick-list">
          {list.map((n, i) => (
            <li key={n.id} className={i === 0 ? 'top' : ''}>
              <button className={`nick-vote ${n.i_voted ? 'on' : ''}`} onClick={() => vote(n)} disabled={isMe} title={isMe ? '' : n.i_voted ? 'ביטול הקול' : 'הצבעה'}>
                <Icon name="thumb_up" size={16} filled={n.i_voted} /> {n.votes}
              </button>
              <span className="nick-name">{n.nickname}</span>
              {i === 0 && <span className="role-tag">מוביל</span>}
              {(isMe || n.mine || canRemove) && (
                <button className="icon-btn small" onClick={() => remove(n)} aria-label="הסרה"><Icon name="close" size={16} /></button>
              )}
            </li>
          ))}
        </ul>
      )}
      {!isMe && (
        <form className="nick-form" onSubmit={propose}>
          <input value={text} onChange={(e) => setText(e.target.value)} maxLength={30} placeholder="להציע כינוי…" />
          <button className="btn tonal" disabled={busy || text.trim().length < 2}>הצעה</button>
        </form>
      )}
    </section>
  );
}
