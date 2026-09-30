import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useApp } from '../AppContext';
import { supabase } from '../supabase';
import { subscribe } from '../lib/realtime';
import { errorText } from '../lib/format';
import { useTyping } from '../lib/useTyping';
import type { DmMessage } from '../types';
import Avatar from '../components/Avatar';
import ChatStream, { type StreamItem } from '../components/ChatStream';
import Composer, { type ComposerHandle } from '../components/Composer';
import { useFeedback } from '../components/Feedback';
import Icon from '../components/Icon';
import type { RowAction } from '../components/MessageRow';
import { useProfileCard } from '../components/ProfileCard';

const PAGE = 80;

export default function DmPage() {
  const convId = Number(useParams().convId);
  const { me, conversations, online, nameOf, reloadConversations } = useApp();
  const { confirm, toast } = useFeedback();
  const openCard = useProfileCard();
  const conv = conversations.find((c) => c.id === convId);

  const [messages, setMessages] = useState<DmMessage[] | null>(null);
  const [hasOlder, setHasOlder] = useState(false);
  const [editing, setEditing] = useState<DmMessage | null>(null);
  const [firstUnreadId, setFirstUnreadId] = useState<number | null>(null);
  const [sentTick, setSentTick] = useState(0);
  const composer = useRef<ComposerHandle>(null);
  const unreadSnapshot = useRef(0);
  // In an anonymous chat my typing pings carry no name.
  const { typingLabel, ping } = useTyping(`dm-${convId}`, conv?.i_am_hidden ? undefined : me?.display_name);

  const markRead = useCallback(async () => {
    await supabase.rpc('mark_dm_read', { p_conv: convId });
    reloadConversations();
  }, [convId, reloadConversations]);

  useEffect(() => {
    unreadSnapshot.current = conv?.unread ?? 0;
    // only when switching conversations
  }, [convId]);

  const isMine = useCallback(
    (m: DmMessage) => (m.sender_id ? m.sender_id === me?.id : !!conv?.i_am_hidden),
    [me, conv?.i_am_hidden],
  );

  useEffect(() => {
    let cancelled = false;
    setMessages(null);
    setEditing(null);
    setFirstUnreadId(null);
    (async () => {
      const { data } = await supabase.from('dm_messages').select('*').eq('conversation_id', convId).order('id', { ascending: false }).limit(PAGE);
      if (cancelled) return;
      const list = ((data as DmMessage[]) ?? []).reverse();
      const unread = unreadSnapshot.current;
      if (unread > 0) {
        const theirs = list.filter((m) => !m.deleted && !isMine(m));
        setFirstUnreadId(theirs[Math.max(0, theirs.length - unread)]?.id ?? null);
      }
      setMessages(list);
      setHasOlder(list.length === PAGE);
      markRead();
    })();
    const unsub = subscribe(`dm-${convId}`, (ch) =>
      ch
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'dm_messages', filter: `conversation_id=eq.${convId}` }, (p) => {
          const m = p.new as DmMessage;
          setMessages((prev) => (prev && !prev.some((x) => x.id === m.id) ? [...prev, m] : prev));
          if (!document.hidden) markRead();
        })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'dm_messages', filter: `conversation_id=eq.${convId}` }, (p) => {
          const m = p.new as DmMessage;
          setMessages((prev) => prev?.map((x) => (x.id === m.id ? m : x)) ?? prev);
        }),
    );
    const onVisible = () => !document.hidden && markRead();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      unsub();
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [convId, markRead]);

  const items: StreamItem[] | null = useMemo(
    () =>
      messages?.map((m) => ({
        id: m.id,
        authorId: m.sender_id,
        anonymous: !m.sender_id,
        mine: isMine(m),
        createdAt: m.created_at,
        editedAt: m.edited_at,
        deleted: m.deleted,
        body: m.body,
      })) ?? null,
    [messages, isMine],
  );

  async function loadOlder() {
    const first = messages?.[0];
    if (!first) return;
    const { data } = await supabase.from('dm_messages').select('*').eq('conversation_id', convId).lt('id', first.id).order('id', { ascending: false }).limit(PAGE);
    const older = ((data as DmMessage[]) ?? []).reverse();
    setMessages((prev) => [...older, ...(prev ?? [])]);
    setHasOlder(older.length === PAGE);
  }

  async function send(text: string) {
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
    setMessages((prev) => (prev && !prev.some((x) => x.id === m.id) ? [...prev, m] : prev));
    setFirstUnreadId(null);
    setSentTick((t) => t + 1);
    reloadConversations();
    return true;
  }

  async function remove(id: number) {
    const ok = await confirm({ title: 'מחיקת הודעה', body: 'ההודעה תימחק גם אצל הצד השני.', confirmLabel: 'מחיקה', danger: true });
    if (!ok) return;
    const { error } = await supabase.from('dm_messages').update({ deleted: true }).eq('id', id);
    if (error) toast(errorText(error), 'error');
    else setMessages((prev) => prev?.map((x) => (x.id === id ? { ...x, deleted: true, body: '' } : x)) ?? prev);
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
        <div className="empty-state">{conversations.length === 0 ? <div className="spinner" /> : <p>השיחה לא נמצאה.</p>}</div>
      </div>
    );
  }

  const otherName = conv.other_id ? nameOf(conv.other_id) : 'משתמש אנונימי';
  const recipientOfAnon = conv.anonymous && !conv.i_am_hidden;

  let disabledReason: string | undefined;
  if (conv.closed) disabledReason = recipientOfAnon ? 'חסמת את השיחה הזו' : 'הנמען חסם את השיחה';
  else if (conv.i_am_hidden && !me?.can_send_anonymous) disabledReason = 'ההרשאה שלך לשלוח הודעות אנונימיות בוטלה על ידי מנהלי הקהילה';

  function actionsFor(item: StreamItem): RowAction[] {
    if (!item.mine) return [];
    const m = messages!.find((x) => x.id === item.id)!;
    return [
      { icon: 'edit', label: 'עריכה', onClick: () => { setEditing(m); composer.current?.setText(m.body); } },
      { icon: 'delete', label: 'מחיקה', onClick: () => remove(item.id), danger: true },
    ];
  }

  return (
    <section className="pane chat-pane">
      <header className="pane-head">
        {conv.other_id ? (
          <button className="avatar-link" onClick={(e) => openCard(conv.other_id!, e.currentTarget)} aria-label={otherName}>
            <Avatar id={conv.other_id} name={otherName} size={36} online={online.has(conv.other_id)} />
          </button>
        ) : (
          <Avatar anonymous size={36} />
        )}
        <div className="pane-titles">
          <h1>
            {conv.other_id ? (
              <button className="title-link" onClick={(e) => openCard(conv.other_id!, e.currentTarget)}>{otherName}</button>
            ) : (
              otherName
            )}
          </h1>
          <p>{conv.other_id ? (online.has(conv.other_id) ? 'מחובר/ת עכשיו' : 'לא מחובר/ת') : 'זהות השולח מוסתרת'}</p>
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

      <ChatStream
        key={convId}
        items={items}
        hasOlder={hasOlder}
        onLoadOlder={loadOlder}
        actionsFor={actionsFor}
        firstUnreadId={firstUnreadId}
        highlightId={editing?.id ?? null}
        typingLabel={typingLabel}
        sentTick={sentTick}
        empty={
          <>
            <Avatar id={conv.other_id} name={otherName} size={64} anonymous={!conv.other_id} />
            <p><strong>{otherName}</strong></p>
            <p className="muted">זו תחילת השיחה ביניכם. ההודעות גלויות רק לשניכם.</p>
          </>
        }
      />

      <Composer
        ref={composer}
        placeholder={`הודעה ל${otherName}`}
        onSend={send}
        onTyping={(_anon, stop) => ping(!!conv.i_am_hidden, stop)}
        disabledReason={disabledReason}
        context={editing ? <><Icon name="edit" size={16} /> עריכת הודעה</> : undefined}
        onCancelContext={editing ? () => { setEditing(null); composer.current?.setText(''); } : undefined}
      />
    </section>
  );
}
