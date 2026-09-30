import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useApp } from '../AppContext';
import { supabase } from '../supabase';
import { subscribe } from '../lib/realtime';
import { dayLabel, errorText } from '../lib/format';
import { useStickyScroll } from '../lib/useStickyScroll';
import type { DmMessage } from '../types';
import Avatar from '../components/Avatar';
import Composer, { type ComposerHandle } from '../components/Composer';
import { useFeedback } from '../components/Feedback';
import Icon from '../components/Icon';
import MessageRow, { DaySeparator, type RowAction } from '../components/MessageRow';

const PAGE = 100;
const GROUP_MS = 5 * 60 * 1000;

export default function DmPage() {
  const convId = Number(useParams().convId);
  const { me, conversations, online, nameOf, reloadConversations } = useApp();
  const { confirm, toast } = useFeedback();
  const conv = conversations.find((c) => c.id === convId);

  const [messages, setMessages] = useState<DmMessage[] | null>(null);
  const [hasOlder, setHasOlder] = useState(false);
  const [editing, setEditing] = useState<DmMessage | null>(null);
  const composer = useRef<ComposerHandle>(null);
  const scroll = useStickyScroll([messages]);

  const markRead = useCallback(async () => {
    await supabase.rpc('mark_dm_read', { p_conv: convId });
    reloadConversations();
  }, [convId, reloadConversations]);

  useEffect(() => {
    let cancelled = false;
    setMessages(null);
    setEditing(null);
    scroll.toBottom();
    (async () => {
      const { data } = await supabase.from('dm_messages').select('*').eq('conversation_id', convId).order('id', { ascending: false }).limit(PAGE);
      if (cancelled) return;
      const list = ((data as DmMessage[]) ?? []).reverse();
      setMessages(list);
      setHasOlder(list.length === PAGE);
      markRead();
    })();
    const unsub = subscribe(`dm-${convId}`, (ch) =>
      ch
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'dm_messages', filter: `conversation_id=eq.${convId}` }, (p) => {
          const m = p.new as DmMessage;
          setMessages((prev) => (prev && !prev.some((x) => x.id === m.id) ? [...prev, m] : prev));
          markRead();
        })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'dm_messages', filter: `conversation_id=eq.${convId}` }, (p) => {
          const m = p.new as DmMessage;
          setMessages((prev) => prev?.map((x) => (x.id === m.id ? m : x)) ?? prev);
        }),
    );
    return () => {
      cancelled = true;
      unsub();
    };
    // scroll helpers are stable refs
  }, [convId, markRead]);

  async function loadOlder() {
    const first = messages?.[0];
    if (!first) return;
    const { data } = await supabase.from('dm_messages').select('*').eq('conversation_id', convId).lt('id', first.id).order('id', { ascending: false }).limit(PAGE);
    const older = ((data as DmMessage[]) ?? []).reverse();
    scroll.keepPosition();
    setMessages((prev) => [...older, ...(prev ?? [])]);
    setHasOlder(older.length === PAGE);
  }

  async function send(text: string) {
    if (!text) return false;
    if (editing) {
      const { error } = await supabase.from('dm_messages').update({ body: text }).eq('id', editing.id);
      if (error) {
        toast(errorText(error), 'error');
        return false;
      }
      setMessages((prev) => prev?.map((m) => (m.id === editing.id ? { ...m, body: text, edited_at: new Date().toISOString() } : m)) ?? prev);
      setEditing(null);
      return true;
    }
    const { data, error } = await supabase.rpc('send_dm', { p_conv: convId, p_body: text });
    if (error) {
      toast(errorText(error), 'error');
      return false;
    }
    const m = data as DmMessage;
    scroll.toBottom();
    setMessages((prev) => (prev && !prev.some((x) => x.id === m.id) ? [...prev, m] : prev));
    reloadConversations();
    return true;
  }

  async function remove(m: DmMessage) {
    const ok = await confirm({ title: 'מחיקת הודעה', body: 'ההודעה תימחק גם אצל הצד השני.', confirmLabel: 'מחיקה', danger: true });
    if (!ok) return;
    const { error } = await supabase.from('dm_messages').update({ deleted: true }).eq('id', m.id);
    if (error) toast(errorText(error), 'error');
    else setMessages((prev) => prev?.map((x) => (x.id === m.id ? { ...x, deleted: true, body: '' } : x)) ?? prev);
  }

  async function setClosed(closed: boolean) {
    if (closed) {
      const ok = await confirm({
        title: 'חסימת השיחה',
        body: 'השולח האנונימי לא יוכל לשלוח לך הודעות נוספות בשיחה הזו. אפשר לבטל את החסימה בכל עת.',
        confirmLabel: 'חסימה',
        danger: true,
      });
      if (!ok) return;
    }
    const { error } = await supabase.rpc('set_dm_closed', { p_conv: convId, p_closed: closed });
    if (error) toast(errorText(error), 'error');
    else {
      toast(closed ? 'השיחה נחסמה' : 'החסימה בוטלה');
      reloadConversations();
    }
  }

  if (!conv) {
    return (
      <div className="pane">
        <div className="empty-state">{conversations.length === 0 && messages === null ? <div className="spinner" /> : <p>השיחה לא נמצאה.</p>}</div>
      </div>
    );
  }

  const otherName = conv.other_id ? nameOf(conv.other_id) : 'משתמש אנונימי';
  const isMine = (m: DmMessage) => (m.sender_id ? m.sender_id === me?.id : conv.i_am_hidden);
  const recipientOfAnon = conv.anonymous && !conv.i_am_hidden;

  let disabledReason: string | undefined;
  if (conv.closed) disabledReason = recipientOfAnon ? 'חסמת את השיחה הזו' : 'הנמען חסם את השיחה';

  return (
    <section className="pane">
      <header className="pane-head">
        <Avatar id={conv.other_id} name={otherName} size={36} anonymous={!conv.other_id} online={!!conv.other_id && online.has(conv.other_id)} />
        <div className="pane-titles">
          <h1>
            {conv.other_id ? <Link to={`/u/${conv.other_id}`}>{otherName}</Link> : otherName}
          </h1>
          <p>
            {conv.other_id ? (online.has(conv.other_id) ? 'מחובר/ת עכשיו' : 'לא מחובר/ת') : 'זהות השולח מוסתרת'}
          </p>
        </div>
        {recipientOfAnon && (
          <button className="btn outlined small" onClick={() => setClosed(!conv.closed)}>
            <Icon name="block" size={18} /> {conv.closed ? 'ביטול חסימה' : 'חסימה'}
          </button>
        )}
      </header>

      {conv.anonymous && (
        <div className={`notice ${conv.i_am_hidden ? 'anon-self' : ''}`}>
          <Icon name="visibility_off" size={18} />
          {conv.i_am_hidden
            ? `את/ה משוחח/ת עם ${otherName} בעילום שם. הזהות שלך לא נחשפת בפניו/ה.`
            : 'את/ה מקבל/ת הודעות ממשתמש אנונימי. הזהות שלו לא גלויה לאף משתמש באתר, כולל מנהלי הקהילה.'}
        </div>
      )}

      <div className="stream" ref={scroll.ref} onScroll={scroll.onScroll}>
        {messages === null ? (
          <div className="spinner" />
        ) : messages.length === 0 ? (
          <div className="empty-state">
            <Avatar id={conv.other_id} name={otherName} size={64} anonymous={!conv.other_id} />
            <p><strong>{otherName}</strong></p>
            <p className="muted">זו תחילת השיחה ביניכם. ההודעות גלויות רק לשניכם.</p>
          </div>
        ) : (
          <>
            {hasOlder && <button className="btn tonal load-older" onClick={loadOlder}>טעינת הודעות קודמות</button>}
            {messages.map((m, i) => {
              const prev = messages[i - 1];
              const newDay = !prev || dayLabel(prev.created_at) !== dayLabel(m.created_at);
              const grouped = !newDay && prev && prev.sender_id === m.sender_id && new Date(m.created_at).getTime() - new Date(prev.created_at).getTime() < GROUP_MS;
              const mine = isMine(m);
              const actions: RowAction[] = mine
                ? [
                    { icon: 'edit', label: 'עריכה', onClick: () => { setEditing(m); composer.current?.setText(m.body); } },
                    { icon: 'delete', label: 'מחיקה', onClick: () => remove(m), danger: true },
                  ]
                : [];
              return (
                <div key={m.id}>
                  {newDay && <DaySeparator label={dayLabel(m.created_at)} />}
                  <MessageRow
                    authorId={m.sender_id}
                    anonymous={!m.sender_id}
                    mine={mine}
                    createdAt={m.created_at}
                    editedAt={m.edited_at}
                    deleted={m.deleted}
                    body={m.body}
                    grouped={grouped}
                    highlight={editing?.id === m.id}
                    actions={actions}
                  />
                </div>
              );
            })}
          </>
        )}
      </div>

      <Composer
        ref={composer}
        placeholder={`הודעה ל${otherName}`}
        onSend={send}
        disabledReason={disabledReason}
        context={editing ? <><Icon name="edit" size={16} /> עריכת הודעה</> : undefined}
        onCancelContext={editing ? () => { setEditing(null); composer.current?.setText(''); } : undefined}
      />
    </section>
  );
}
