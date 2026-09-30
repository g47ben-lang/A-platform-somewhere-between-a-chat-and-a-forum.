import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useApp } from '../AppContext';
import { supabase } from '../supabase';
import { errorText, fullDate, timeAgo } from '../lib/format';
import type { FeedbackRow } from '../pages/ContactPage';
import { useFeedback } from './Feedback';
import Icon from './Icon';

interface Msg {
  id: number;
  author_id: string | null;
  from_admin: boolean;
  body: string;
  created_at: string;
}

/** A request as a short conversation between the member and the management. */
export default function FeedbackThread({ f, adminView, onChange }: { f: FeedbackRow; adminView: boolean; onChange?: () => void }) {
  const { nameOf } = useApp();
  const { toast } = useFeedback();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.from('feedback_messages').select('*').eq('feedback_id', f.id).order('id');
    setMsgs((data as Msg[]) ?? []);
  }, [f.id]);

  useEffect(() => {
    load();
  }, [load]);

  async function send(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.rpc('feedback_post', { p_feedback: f.id, p_body: text.trim() });
    setBusy(false);
    if (error) return toast(errorText(error), 'error');
    setText('');
    load();
    onChange?.();
  }

  // The first message is the request itself; an answer from before conversations existed shows as the management's.
  const all: Msg[] = [
    { id: -1, author_id: f.author_id, from_admin: false, body: f.body, created_at: f.created_at },
    ...(f.reply && f.replied_at ? [{ id: -2, author_id: null, from_admin: true, body: f.reply, created_at: f.replied_at }] : []),
    ...msgs,
  ];
  const mineSide = (m: Msg) => (adminView ? m.from_admin : !m.from_admin);

  return (
    <div className="fb-thread">
      {all.map((m) => (
        <div key={m.id} className={`fb-msg ${mineSide(m) ? 'mine' : 'theirs'}`}>
          <div className="fb-msg-head">
            <strong>{m.from_admin ? (adminView && m.author_id ? nameOf(m.author_id) : 'הניהול') : adminView ? nameOf(m.author_id) : 'אני'}</strong>
            <time title={fullDate(m.created_at)}>{timeAgo(m.created_at)}</time>
          </div>
          <div className="fb-msg-body">{m.body}</div>
        </div>
      ))}
      <form className="fb-reply" onSubmit={send}>
        <textarea
          rows={1}
          maxLength={2000}
          value={text}
          placeholder={adminView ? 'תשובה לפונה…' : 'להוסיף לפנייה…'}
          onChange={(e) => {
            setText(e.target.value);
            // grow with the text, up to about 6 lines
            e.target.style.height = 'auto';
            e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && text.trim()) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <button className="fb-send" disabled={busy || !text.trim()} aria-label="שליחה"><Icon name="send" size={20} className="icon-flip" /></button>
      </form>
    </div>
  );
}
