import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useApp } from '../AppContext';
import { supabase } from '../supabase';
import { subscribe } from '../lib/realtime';
import { errorText } from '../lib/format';
import { useTyping } from '../lib/useTyping';
import { messageLink, summarizeReactions } from '../lib/chat';
import type { DmMessage, DmReaction } from '../types';
import Avatar from '../components/Avatar';
import ChatStream, { type MenuAction, type StreamItem } from '../components/ChatStream';
import Composer, { type ComposerHandle, type SendOptions } from '../components/Composer';
import { useFeedback } from '../components/Feedback';
import ForwardDialog from '../components/ForwardDialog';
import Icon from '../components/Icon';
import { muteUntilLabel } from '../components/Moderation';
import { useProfileCard } from '../components/ProfileCard';

const PAGE = 80;

export default function DmPage() {
  const convId = Number(useParams().convId);
  const [search, setSearch] = useSearchParams();
  const linkedId = Number(search.get('m')) || null;
  const { me, conversations, online, nameOf, reloadConversations, myMute } = useApp();
  const { confirm, toast } = useFeedback();
  const openCard = useProfileCard();
  const conv = conversations.find((c) => c.id === convId);

  const [messages, setMessages] = useState<DmMessage[] | null>(null);
  const [hasOlder, setHasOlder] = useState(false);
  const [reactions, setReactions] = useState<DmReaction[]>([]);
  const [stars, setStars] = useState<Set<number>>(new Set());
  const [editing, setEditing] = useState<DmMessage | null>(null);
  const [replyTo, setReplyTo] = useState<DmMessage | null>(null);
  const [forward, setForward] = useState<DmMessage | null>(null);
  const [firstUnreadId, setFirstUnreadId] = useState<number | null>(null);
  const [sentTick, setSentTick] = useState(0);
  const composer = useRef<ComposerHandle>(null);
  const unreadSnapshot = useRef(0);
  const holdRead = useRef(false);
  // In an anonymous chat my typing pings carry no name.
  const { typingLabel, ping } = useTyping(`dm-${convId}`, conv?.i_am_hidden ? undefined : me?.display_name);

  const markRead = useCallback(async () => {
    if (holdRead.current) return;
    await supabase.rpc('mark_dm_read', { p_conv: convId });
    reloadConversations();
  }, [convId, reloadConversations]);

  useEffect(() => {
    unreadSnapshot.current = conv?.unread ?? 0;
    holdRead.current = false;
    // only when switching conversations
  }, [convId]);

  const hidden = !!conv?.i_am_hidden;
  const isMine = useCallback((m: DmMessage) => (m.sender_id ? m.sender_id === me?.id : hidden), [me, hidden]);

  const loadExtras = useCallback(async (list: DmMessage[]) => {
    const ids = list.map((m) => m.id);
    if (!ids.length) return;
    const [r, s] = await Promise.all([
      supabase.from('dm_reactions').select('message_id,user_id,hidden,emoji').in('message_id', ids),
      supabase.from('stars').select('item_id').eq('kind', 'dm').in('item_id', ids),
    ]);
    const idSet = new Set(ids);
    if (r.data) setReactions((prev) => [...prev.filter((x) => !idSet.has(x.message_id)), ...(r.data as DmReaction[])]);
    if (s.data) setStars((prev) => new Set([...prev, ...(s.data as { item_id: number }[]).map((x) => x.item_id)]));
  }, []);

  const reloadReactions = useCallback(async (messageId: number) => {
    const { data } = await supabase.from('dm_reactions').select('message_id,user_id,hidden,emoji').eq('message_id', messageId);
    setReactions((prev) => [...prev.filter((x) => x.message_id !== messageId), ...((data as DmReaction[]) ?? [])]);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setMessages(null);
    setEditing(null);
    setReplyTo(null);
    setFirstUnreadId(null);
    (async () => {
      let list: DmMessage[];
      if (linkedId) {
        const [before, after] = await Promise.all([
          supabase.from('dm_messages').select('*').eq('conversation_id', convId).lt('id', linkedId).order('id', { ascending: false }).limit(20),
          supabase.from('dm_messages').select('*').eq('conversation_id', convId).gte('id', linkedId).order('id').limit(200),
        ]);
        list = [...(((before.data as DmMessage[]) ?? []).reverse()), ...((after.data as DmMessage[]) ?? [])];
      } else {
        const { data } = await supabase.from('dm_messages').select('*').eq('conversation_id', convId).order('id', { ascending: false }).limit(PAGE);
        list = ((data as DmMessage[]) ?? []).reverse();
      }
      if (cancelled) return;
      if (!linkedId && unreadSnapshot.current > 0) {
        const theirs = list.filter((m) => !m.deleted && !isMine(m));
        setFirstUnreadId(theirs[Math.max(0, theirs.length - unreadSnapshot.current)]?.id ?? null);
      }
      setMessages(list);
      setHasOlder(list.length >= PAGE || !!linkedId);
      loadExtras(list);
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
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'dm_reactions' }, (p) => {
          const r = (p.new && 'message_id' in p.new ? p.new : p.old) as DmReaction;
          if (r?.message_id) reloadReactions(r.message_id);
        }),
    );
    const onVisible = () => !document.hidden && markRead();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      unsub();
      document.removeEventListener('visibilitychange', onVisible);
    };
    // isMine only affects the unread divider on first load
  }, [convId, linkedId, markRead, loadExtras, reloadReactions]);

  const byId = useMemo(() => new Map((messages ?? []).map((m) => [m.id, m])), [messages]);
  const otherName = conv ? (conv.other_id ? nameOf(conv.other_id) : 'משתמש אנונימי') : '';
  const senderName = (m: DmMessage) => (isMine(m) ? (hidden ? 'אתה (אנונימי)' : 'אתה') : otherName);

  const items: StreamItem[] | null = useMemo(
    () =>
      messages?.map((m) => {
        const parent = m.reply_to ? byId.get(m.reply_to) : undefined;
        return {
          id: m.id,
          authorId: m.sender_id,
          anonymous: !m.sender_id,
          mine: isMine(m),
          createdAt: m.created_at,
          editedAt: m.edited_at,
          deleted: m.deleted,
          body: m.body,
          attachment: m.attachment,
          forwarded: m.forwarded,
          starred: stars.has(m.id),
          quote: m.reply_to
            ? parent
              ? { name: senderName(parent), text: parent.deleted ? 'הודעה שנמחקה' : parent.body.slice(0, 200), media: !!parent.attachment }
              : { name: '', text: 'הודעה קודמת' }
            : null,
          reactions: summarizeReactions(
            reactions.filter((r) => r.message_id === m.id),
            (r) => (r.user_id ? r.user_id === me?.id : hidden),
            (r) => (r.user_id ? (r.user_id === me?.id ? 'אתה' : nameOf(r.user_id)) : hidden ? 'אתה' : 'אנונימי'),
          ),
        };
      }) ?? null,
    // senderName depends on the same inputs
    [messages, reactions, stars, byId, isMine, me, hidden, nameOf, otherName],
  );

  async function loadOlder() {
    const first = messages?.[0];
    if (!first) return;
    const { data } = await supabase.from('dm_messages').select('*').eq('conversation_id', convId).lt('id', first.id).order('id', { ascending: false }).limit(PAGE);
    const older = ((data as DmMessage[]) ?? []).reverse();
    setMessages((prev) => [...older, ...(prev ?? [])]);
    setHasOlder(older.length === PAGE);
    loadExtras(older);
  }

  async function send(text: string, opts: SendOptions) {
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
    const { data, error } = await supabase.rpc('send_dm', { p_conv: convId, p_body: text, p_reply_to: replyTo?.id ?? null, p_attachment: opts.attachment });
    if (error) {
      toast(errorText(error), 'error');
      return false;
    }
    const m = data as DmMessage;
    setMessages((prev) => (prev && !prev.some((x) => x.id === m.id) ? [...prev, m] : prev));
    setReplyTo(null);
    setFirstUnreadId(null);
    holdRead.current = false;
    if (linkedId) setSearch({}, { replace: true });
    setSentTick((t) => t + 1);
    reloadConversations();
    return true;
  }

  async function react(item: StreamItem, emoji: string) {
    const { error } = await supabase.rpc('toggle_dm_reaction', { p_message: item.id, p_emoji: emoji });
    if (error) return toast(errorText(error), 'error');
    reloadReactions(item.id);
  }

  async function remove(id: number) {
    const ok = await confirm({ title: 'מחיקת הודעה', body: 'ההודעה תימחק גם אצל הצד השני.', confirmLabel: 'מחיקה', danger: true });
    if (!ok) return;
    const { error } = await supabase.from('dm_messages').update({ deleted: true }).eq('id', id);
    if (error) toast(errorText(error), 'error');
    else setMessages((prev) => prev?.map((x) => (x.id === id ? { ...x, deleted: true, body: '', attachment: null } : x)) ?? prev);
  }

  async function toggleStar(id: number) {
    const starred = stars.has(id);
    const { error } = starred
      ? await supabase.from('stars').delete().match({ kind: 'dm', item_id: id })
      : await supabase.from('stars').insert({ user_id: me!.id, kind: 'dm', item_id: id });
    if (error) return toast(errorText(error), 'error');
    setStars((prev) => {
      const next = new Set(prev);
      if (starred) next.delete(id);
      else next.add(id);
      return next;
    });
    toast(starred ? 'הכוכב הוסר' : 'ההודעה סומנה בכוכב');
  }

  async function markUnread(id: number) {
    const { error } = await supabase.rpc('mark_dm_unread', { p_message: id });
    if (error) return toast(errorText(error), 'error');
    holdRead.current = true;
    await reloadConversations();
    toast('ההודעה סומנה כלא נקראה');
  }

  async function copy(text: string, done: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast(done);
    } catch {
      toast('ההעתקה נכשלה', 'error');
    }
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

  const recipientOfAnon = conv.anonymous && !conv.i_am_hidden;
  let disabledReason: string | undefined;
  if (myMute) disabledReason = `הושתקת ${muteUntilLabel(myMute.until)}`;
  else if (conv.closed) disabledReason = recipientOfAnon ? 'חסמת את השיחה הזו' : 'הנמען חסם את השיחה';
  else if (conv.i_am_hidden && !me?.can_send_anonymous) disabledReason = 'ההרשאה שלך לשלוח הודעות אנונימיות בוטלה על ידי מנהלי הקהילה';

  function menuFor(item: StreamItem): MenuAction[] {
    const m = byId.get(item.id)!;
    const a: MenuAction[] = [
      { icon: 'forward', label: 'העברת ההודעה', onClick: () => setForward(m) },
      { icon: 'mark_chat_unread', label: 'סימון שההודעה לא נקראה', onClick: () => markUnread(m.id), divider: true },
      { icon: 'star', label: item.starred ? 'הסרת הכוכב' : 'סימון בכוכב', onClick: () => toggleStar(m.id) },
      { icon: 'link', label: 'העתקת הקישור להודעה', onClick: () => copy(messageLink(`/dm/${convId}`, m.id), 'הקישור הועתק') },
    ];
    if (m.body) a.push({ icon: 'content_copy', label: 'העתקת הטקסט', onClick: () => copy(m.body, 'הטקסט הועתק') });
    if (item.mine && m.body) a.push({ icon: 'edit', label: 'עריכה', onClick: () => { setReplyTo(null); setEditing(m); composer.current?.setText(m.body); }, divider: true });
    if (item.mine) a.push({ icon: 'delete', label: 'מחיקה', onClick: () => remove(m.id), danger: true, divider: !m.body });
    return a;
  }

  const intro = (
    <div className="dm-intro">
      <Avatar id={conv.other_id} name={otherName} size={72} anonymous={!conv.other_id} />
      <h2>{otherName}</h2>
      <p className="muted">
        {conv.anonymous
          ? conv.i_am_hidden ? 'שיחה בעילום שם. הזהות שלך לא נחשפת.' : 'שיחה עם שולח אנונימי.'
          : 'זו תחילת השיחה הפרטית ביניכם. ההודעות גלויות רק לשניכם.'}
      </p>
      {conv.other_id && (
        <button className="btn tonal small" onClick={(e) => openCard(conv.other_id!, e.currentTarget)}>
          <Icon name="person" size={18} /> לפרופיל
        </button>
      )}
    </div>
  );

  return (
    <section className="pane chat-pane">
      <header className="pane-head dm-head">
        {conv.other_id ? (
          <button className="avatar-link" onClick={(e) => openCard(conv.other_id!, e.currentTarget)} aria-label={otherName}>
            <Avatar id={conv.other_id} name={otherName} size={40} online={online.has(conv.other_id)} />
          </button>
        ) : (
          <Avatar anonymous size={40} />
        )}
        <div className="pane-titles">
          <h1>
            {conv.other_id ? <button className="title-link" onClick={(e) => openCard(conv.other_id!, e.currentTarget)}>{otherName}</button> : otherName}
          </h1>
          <p className={conv.other_id && online.has(conv.other_id) ? 'is-online' : undefined}>
            {conv.other_id ? (online.has(conv.other_id) ? 'מחובר עכשיו' : 'לא מחובר') : 'זהות השולח מוסתרת'}
          </p>
        </div>
        {recipientOfAnon && (
          <button className="btn outlined small" onClick={() => setClosed(!conv.closed)}>
            <Icon name="block" size={18} /> {conv.closed ? 'ביטול חסימה' : 'חסימה'}
          </button>
        )}
        {conv.other_id && (
          <button className="icon-btn" title="פרופיל" aria-label="פרופיל" onClick={(e) => openCard(conv.other_id!, e.currentTarget)}>
            <Icon name="person" />
          </button>
        )}
      </header>

      {conv.anonymous && (
        <div className={`notice ${conv.i_am_hidden ? 'anon-self' : ''}`}>
          <Icon name="visibility_off" size={18} />
          {conv.i_am_hidden
            ? `אתה משוחח עם ${otherName} בעילום שם. הזהות שלך לא נחשפת בפניו, גם לא בתגובות האימוג'י (רק מנהל-העל יכול לדעת, למקרי חירום בלבד).`
            : 'אתה מקבל הודעות ממשתמש אנונימי. הזהות שלו לא גלויה לחברים ולמנהלים; רק מנהל-העל יכול לדעת, למקרי חירום בלבד.'}
        </div>
      )}

      <ChatStream
        key={`${convId}-${linkedId ?? ''}`}
        items={items}
        hasOlder={hasOlder}
        onLoadOlder={loadOlder}
        onReact={react}
        onReply={disabledReason ? undefined : (item) => { setEditing(null); setReplyTo(byId.get(item.id)!); composer.current?.focus(); }}
        menuFor={menuFor}
        showNames={false}
        firstUnreadId={firstUnreadId}
        highlightId={linkedId ?? editing?.id ?? null}
        typingLabel={typingLabel}
        sentTick={sentTick}
        lead={intro}
        empty={intro}
      />

      <Composer
        ref={composer}
        placeholder={`הודעה ל${otherName}`}
        onSend={send}
        allowAttachments={!editing}
        onTyping={(_anon, stop) => ping(hidden, stop)}
        disabledReason={disabledReason}
        context={
          editing ? (
            <><Icon name="edit" size={16} /> עריכת הודעה</>
          ) : replyTo ? (
            <><Icon name="format_quote" size={16} /> ציטוט של <strong>{senderName(replyTo)}</strong>: {replyTo.body.slice(0, 80) || 'תמונה / סרטון'}</>
          ) : undefined
        }
        onCancelContext={() => {
          if (editing) composer.current?.setText('');
          setEditing(null);
          setReplyTo(null);
        }}
      />
      {forward && <ForwardDialog body={forward.body} attachment={forward.attachment} onClose={() => setForward(null)} />}
    </section>
  );
}
