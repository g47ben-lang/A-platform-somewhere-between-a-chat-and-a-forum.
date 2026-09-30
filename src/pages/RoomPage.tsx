import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useApp } from '../AppContext';
import { supabase, SITE_NAME } from '../supabase';
import { subscribe } from '../lib/realtime';
import { errorText, roleTag } from '../lib/format';
import { useTyping } from '../lib/useTyping';
import { messageLink, summarizeReactions } from '../lib/chat';
import { removeFile } from '../lib/media';
import type { Message, Reaction } from '../types';
import Avatar, { SpaceTile } from '../components/Avatar';
import ChatStream, { type MenuAction, type StreamItem } from '../components/ChatStream';
import Composer, { type ComposerHandle, type SendOptions } from '../components/Composer';
import { useFeedback } from '../components/Feedback';
import ForwardDialog from '../components/ForwardDialog';
import Icon from '../components/Icon';
import { useProfileCard } from '../components/ProfileCard';
import RoomDialog from '../components/RoomDialog';

const PAGE = 60;

// Banner photo for the main chat lives at public/hero.jpg; without it a gradient shows.
// Absolute URL: a relative url() inside a CSS variable would resolve against the stylesheet folder.
const HERO_URL = new URL(`${import.meta.env.BASE_URL}hero.jpg`, document.baseURI).href;

type Panel = 'people' | 'pins' | null;

export default function RoomPage() {
  const params = useParams();
  const [search, setSearch] = useSearchParams();
  const linkedId = Number(search.get('m')) || null;
  const { rooms, mainRoom, me, isMod, canRemove, isOwner, ownerId, profiles, online, nameOf, reloadRooms } = useApp();
  const room = params.roomId ? rooms.find((r) => r.id === Number(params.roomId)) : mainRoom;
  const roomId = room?.id ?? null;
  const { confirm, toast } = useFeedback();
  const navigate = useNavigate();
  const openCard = useProfileCard();

  const [messages, setMessages] = useState<Message[] | null>(null);
  const [hasOlder, setHasOlder] = useState(false);
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const [likes, setLikes] = useState<{ message_id: number; user_id: string }[]>([]);
  const [mineAnon, setMineAnon] = useState<Set<number>>(new Set());
  // Real authors of anonymous messages: RLS returns only my own rows, except to the owner who gets all.
  const [anonAuthor, setAnonAuthor] = useState<Map<number, string>>(new Map());
  const meIdRef = useRef<string | undefined>(undefined);
  meIdRef.current = me?.id;
  const [stars, setStars] = useState<Set<number>>(new Set());
  const [pinned, setPinned] = useState<Message[]>([]);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editing, setEditing] = useState<Message | null>(null);
  const [forward, setForward] = useState<Message | null>(null);
  const [firstUnreadId, setFirstUnreadId] = useState<number | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [menu, setMenu] = useState(false);
  const [editRoom, setEditRoom] = useState(false);
  const [sentTick, setSentTick] = useState(0);
  const composer = useRef<ComposerHandle>(null);
  const unreadSnapshot = useRef(0);
  // After "mark as unread" the room must not mark itself read again until the user acts.
  const holdRead = useRef(false);
  const { typingLabel, ping } = useTyping(roomId ? `room-${roomId}` : null, me?.display_name);

  const markRead = useCallback(async () => {
    if (!roomId || holdRead.current) return;
    await supabase.rpc('mark_room_read', { p_channel: roomId });
    reloadRooms();
  }, [roomId, reloadRooms]);

  const loadExtras = useCallback(async (list: Message[]) => {
    const ids = list.map((m) => m.id);
    if (!ids.length) return;
    const anonIds = list.filter((m) => m.anonymous).map((m) => m.id);
    const [r, a, s, l] = await Promise.all([
      supabase.from('reactions').select('message_id,user_id,emoji').in('message_id', ids),
      anonIds.length ? supabase.from('anon_authors').select('item_id,author_id').eq('kind', 'message').in('item_id', anonIds) : Promise.resolve({ data: [] }),
      supabase.from('stars').select('item_id').eq('kind', 'room').in('item_id', ids),
      supabase.from('message_likes').select('message_id,user_id').in('message_id', ids),
    ]);
    const idSet = new Set(ids);
    if (l.data) setLikes((prev) => [...prev.filter((x) => !idSet.has(x.message_id)), ...(l.data as { message_id: number; user_id: string }[])]);
    if (r.data) setReactions((prev) => [...prev.filter((x) => !idSet.has(x.message_id)), ...(r.data as Reaction[])]);
    if (a.data) {
      const rows = a.data as { item_id: number; author_id: string }[];
      setMineAnon((prev) => new Set([...prev, ...rows.filter((x) => x.author_id === meIdRef.current).map((x) => x.item_id)]));
      setAnonAuthor((prev) => new Map([...prev, ...rows.map((x) => [x.item_id, x.author_id] as [number, string])]));
    }
    if (s.data) setStars((prev) => new Set([...prev, ...(s.data as { item_id: number }[]).map((x) => x.item_id)]));
  }, []);

  const loadPins = useCallback(async () => {
    if (!roomId) return;
    const { data } = await supabase.from('messages').select('*').eq('channel_id', roomId).not('pinned_at', 'is', null).order('pinned_at', { ascending: false });
    setPinned(((data as Message[]) ?? []).filter((m) => !m.deleted));
  }, [roomId]);

  // Remember how many were unread when the room was opened, before mark-read resets it.
  useEffect(() => {
    unreadSnapshot.current = room?.unread ?? 0;
    holdRead.current = false;
    // only when switching rooms
  }, [roomId]);

  useEffect(() => {
    if (!roomId) return;
    let cancelled = false;
    setMessages(null);
    setReactions([]);
    setLikes([]);
    setReplyTo(null);
    setEditing(null);
    setFirstUnreadId(null);
    setMenu(false);
    (async () => {
      let list: Message[];
      if (linkedId) {
        // Open around a linked message: some context before it, everything after it.
        const { data: target } = await supabase.from('messages').select('created_at').eq('id', linkedId).eq('channel_id', roomId).maybeSingle();
        const at = (target as { created_at: string } | null)?.created_at;
        const [before, after] = await Promise.all([
          at ? supabase.from('messages').select('*').eq('channel_id', roomId).lt('created_at', at).order('created_at', { ascending: false }).limit(20) : Promise.resolve({ data: [] }),
          supabase.from('messages').select('*').eq('channel_id', roomId).gte('created_at', at ?? '1970-01-01').order('created_at').limit(200),
        ]);
        list = [...(((before.data as Message[]) ?? []).reverse()), ...((after.data as Message[]) ?? [])];
      } else {
        const { data } = await supabase.from('messages').select('*').eq('channel_id', roomId).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(PAGE);
        list = ((data as Message[]) ?? []).reverse();
      }
      if (cancelled) return;
      if (!linkedId && unreadSnapshot.current > 0) {
        const theirs = list.filter((m) => m.author_id !== me?.id && !m.deleted);
        setFirstUnreadId(theirs[Math.max(0, theirs.length - unreadSnapshot.current)]?.id ?? null);
      }
      setMessages(list);
      setHasOlder(list.length >= PAGE || !!linkedId);
      loadExtras(list);
      loadPins();
      markRead();
    })();

    const unsub = subscribe(`room-${roomId}`, (ch) =>
      ch
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `channel_id=eq.${roomId}` }, (p) => {
          const m = p.new as Message;
          setMessages((prev) => (prev && !prev.some((x) => x.id === m.id) ? [...prev, m] : prev));
          if (!document.hidden) markRead();
        })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', filter: `channel_id=eq.${roomId}` }, (p) => {
          const m = p.new as Message;
          setMessages((prev) => prev?.map((x) => (x.id === m.id ? m : x)) ?? prev);
          loadPins();
        })
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'reactions' }, (p) => {
          const r = p.new as Reaction;
          setReactions((prev) => (prev.some((x) => x.message_id === r.message_id && x.user_id === r.user_id && x.emoji === r.emoji) ? prev : [...prev, r]));
        })
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'message_likes' }, (p) => {
          const l = p.new as { message_id: number; user_id: string };
          setLikes((prev) => (prev.some((x) => x.message_id === l.message_id && x.user_id === l.user_id) ? prev : [...prev, l]));
        })
        .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'message_likes' }, (p) => {
          const l = p.old as { message_id: number; user_id: string };
          setLikes((prev) => prev.filter((x) => !(x.message_id === l.message_id && x.user_id === l.user_id)));
        })
        .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'reactions' }, (p) => {
          const r = p.old as Reaction;
          setReactions((prev) => prev.filter((x) => !(x.message_id === r.message_id && x.user_id === r.user_id && x.emoji === r.emoji)));
        }),
    );
    const onVisible = () => !document.hidden && markRead();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      unsub();
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [roomId, linkedId, loadExtras, loadPins, markRead]);

  const byId = useMemo(() => new Map((messages ?? []).map((m) => [m.id, m])), [messages]);

  const items: StreamItem[] | null = useMemo(() => {
    if (!messages) return null;
    return messages.map((m) => {
      const parent = m.reply_to ? byId.get(m.reply_to) : undefined;
      return {
        id: m.id,
        authorId: m.author_id,
        anonymous: m.anonymous,
        mine: m.author_id === me?.id || mineAnon.has(m.id),
        pollId: m.poll_id,
        system: m.system,
        revealedAuthor: isOwner && m.anonymous && anonAuthor.has(m.id) ? nameOf(anonAuthor.get(m.id)) : null,
        createdAt: m.created_at,
        editedAt: m.edited_at,
        deleted: m.deleted,
        body: m.body,
        attachment: m.attachment,
        forwarded: m.forwarded,
        pinned: !!m.pinned_at,
        starred: stars.has(m.id),
        quote: m.reply_to
          ? parent
            ? { name: parent.anonymous ? 'אנונימי' : nameOf(parent.author_id), text: parent.deleted ? 'הודעה שנמחקה' : parent.body.slice(0, 200), media: !!parent.attachment }
            : { name: '', text: 'הודעה קודמת' }
          : null,
        reactions: summarizeReactions(
          reactions.filter((r) => r.message_id === m.id),
          (r) => r.user_id === me?.id,
          (r) => nameOf(r.user_id),
        ),
        likes: (() => {
          const ls = likes.filter((l) => l.message_id === m.id);
          return { count: ls.length, liked: !!me && ls.some((l) => l.user_id === me.id), names: ls.map((l) => nameOf(l.user_id)) };
        })(),
      };
    });
  }, [messages, reactions, likes, mineAnon, anonAuthor, isOwner, stars, byId, me, nameOf]);

  async function loadOlder() {
    const first = messages?.[0];
    if (!first || !roomId) return;
    const { data } = await supabase.from('messages').select('*').eq('channel_id', roomId).lt('created_at', first.created_at).order('created_at', { ascending: false }).limit(PAGE);
    const older = ((data as Message[]) ?? []).reverse();
    setMessages((prev) => [...older, ...(prev ?? [])]);
    setHasOlder(older.length === PAGE);
    loadExtras(older);
  }

  async function send(text: string, opts: SendOptions) {
    if (!roomId) return false;
    if (editing) {
      const { error } = await supabase.from('messages').update({ body: text }).eq('id', editing.id);
      if (error) {
        toast(errorText(error), 'error');
        return false;
      }
      setMessages((prev) => prev?.map((m) => (m.id === editing.id ? { ...m, body: text, edited_at: new Date().toISOString() } : m)) ?? prev);
      setEditing(null);
      return true;
    }
    const { data, error } = await supabase.rpc('send_message', {
      p_channel: roomId,
      p_body: text,
      p_reply_to: replyTo?.id ?? null,
      p_anonymous: opts.anonymous,
      p_attachment: opts.attachment,
    });
    if (error) {
      toast(errorText(error), 'error');
      return false;
    }
    const m = data as Message;
    setMessages((prev) => (prev && !prev.some((x) => x.id === m.id) ? [...prev, m] : prev));
    if (opts.anonymous) setMineAnon((prev) => new Set(prev).add(m.id));
    setReplyTo(null);
    setFirstUnreadId(null);
    holdRead.current = false;
    if (linkedId) setSearch({}, { replace: true });
    setSentTick((t) => t + 1);
    return true;
  }

  async function react(item: StreamItem, emoji: string) {
    if (!me) return;
    const mine = reactions.some((r) => r.message_id === item.id && r.user_id === me.id && r.emoji === emoji);
    const row = { message_id: item.id, user_id: me.id, emoji };
    if (mine) {
      setReactions((prev) => prev.filter((r) => !(r.message_id === item.id && r.user_id === me.id && r.emoji === emoji)));
      const { error } = await supabase.from('reactions').delete().match(row);
      if (error) toast(errorText(error), 'error');
    } else {
      setReactions((prev) => [...prev, row]);
      const { error } = await supabase.from('reactions').insert(row);
      if (error) {
        setReactions((prev) => prev.filter((r) => !(r.message_id === item.id && r.user_id === me.id && r.emoji === emoji)));
        toast(errorText(error), 'error');
      }
    }
  }

  async function toggleLike(item: StreamItem) {
    if (!me || item.mine) return;
    const row = { message_id: item.id, user_id: me.id };
    const liked = likes.some((l) => l.message_id === item.id && l.user_id === me.id);
    if (liked) {
      setLikes((prev) => prev.filter((l) => !(l.message_id === item.id && l.user_id === me.id)));
      const { error } = await supabase.from('message_likes').delete().match(row);
      if (error) toast(errorText(error), 'error');
    } else {
      setLikes((prev) => [...prev, row]);
      const { error } = await supabase.from('message_likes').insert(row);
      if (error) {
        setLikes((prev) => prev.filter((l) => !(l.message_id === item.id && l.user_id === me.id)));
        toast(errorText(error), 'error');
      }
    }
  }

  async function remove(id: number) {
    const target = byId.get(id);
    const ok = await confirm({
      title: target?.attachment ? (target.attachment.type === 'video' ? 'מחיקת סרטון' : 'מחיקת תמונה') : 'מחיקת הודעה',
      body: 'ההודעה תימחק לכל המשתתפים.',
      confirmLabel: 'מחיקה',
      danger: true,
    });
    if (!ok) return;
    const { error } = await supabase.from('messages').update({ deleted: true }).eq('id', id);
    if (!error && canRemove && target?.attachment) removeFile(target.attachment.path);
    if (error) toast(errorText(error), 'error');
    else setMessages((prev) => prev?.map((x) => (x.id === id ? { ...x, deleted: true, body: '', attachment: null } : x)) ?? prev);
  }

  async function togglePin(m: Message) {
    const { error } = await supabase.rpc('set_message_pinned', { p_message: m.id, p_pinned: !m.pinned_at });
    if (error) return toast(errorText(error), 'error');
    toast(m.pinned_at ? 'ההודעה הוסרה מהלוח' : 'ההודעה הוצמדה ללוח החדר');
    setMessages((prev) => prev?.map((x) => (x.id === m.id ? { ...x, pinned_at: m.pinned_at ? null : new Date().toISOString() } : x)) ?? prev);
    loadPins();
  }

  async function toggleStar(id: number) {
    const starred = stars.has(id);
    const { error } = starred
      ? await supabase.from('stars').delete().match({ kind: 'room', item_id: id })
      : await supabase.from('stars').insert({ user_id: me!.id, kind: 'room', item_id: id });
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
    const { error } = await supabase.rpc('mark_room_unread', { p_message: id });
    if (error) return toast(errorText(error), 'error');
    holdRead.current = true;
    await reloadRooms();
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

  function menuFor(item: StreamItem): MenuAction[] {
    const m = byId.get(item.id)!;
    const a: MenuAction[] = [{ icon: 'forward', label: 'העברת ההודעה', onClick: () => setForward(m) }];
    a.push({ icon: 'mark_chat_unread', label: 'סימון שההודעה לא נקראה', onClick: () => markUnread(m.id), divider: true });
    a.push({ icon: 'star', label: item.starred ? 'הסרת הכוכב' : 'סימון בכוכב', onClick: () => toggleStar(m.id) });
    if (!room?.admin_only_post || isMod) a.push({ icon: 'keep', label: m.pinned_at ? 'הסרה מהלוח' : 'הצמדה ללוח', onClick: () => togglePin(m) });
    a.push({ icon: 'link', label: 'העתקת הקישור להודעה', onClick: () => copy(messageLink(room!.is_main ? '/' : `/room/${roomId}`, m.id), 'הקישור הועתק') });
    if (m.body) a.push({ icon: 'content_copy', label: 'העתקת הטקסט', onClick: () => copy(m.body, 'הטקסט הועתק') });
    if (item.mine && m.body) a.push({ icon: 'edit', label: 'עריכה', onClick: () => { setReplyTo(null); setEditing(m); composer.current?.setText(m.body); }, divider: true });
    if (item.mine || canRemove) a.push({ icon: 'delete', label: 'מחיקה', onClick: () => remove(m.id), danger: true, divider: !(item.mine && m.body) });
    return a;
  }

  const mentionNames = useMemo(
    () => [...profiles.values()].filter((p) => p.status === 'active' && p.id !== me?.id).map((p) => p.display_name),
    [profiles, me],
  );

  if (!room) {
    return (
      <div className="pane">
        <div className="empty-state">{rooms.length === 0 ? <div className="spinner" /> : <p>החדר לא נמצא. ייתכן שנמחק.</p>}</div>
      </div>
    );
  }

  const canWrite = !room.admin_only_post || isMod;
  const canManage = isMod || (!!me && room.created_by === me.id);
  const members = [...profiles.values()]
    .filter((p) => p.status === 'active')
    .sort((a, b) => Number(online.has(b.id)) - Number(online.has(a.id)) || a.display_name.localeCompare(b.display_name, 'he'));

  const headerTools = (
    <div className="room-tools">
      <button className={`chip-btn ${panel === 'pins' ? 'on' : ''}`} onClick={() => setPanel((v) => (v === 'pins' ? null : 'pins'))} title="לוח הודעות מוצמדות">
        <Icon name="keep" size={18} />
        {pinned.length > 0 && <span>{pinned.length}</span>}
      </button>
      <button className={`chip-btn ${panel === 'people' ? 'on' : ''}`} onClick={() => setPanel((v) => (v === 'people' ? null : 'people'))} title="משתתפים">
        <Icon name="group" size={18} />
        <span>{online.size}</span>
      </button>
      {canManage && (
        <div className="menu-anchor">
          <button className="icon-btn" onClick={() => setMenu((v) => !v)} aria-label="אפשרויות החדר">
            <Icon name="more_vert" />
          </button>
          {menu && (
            <div className="menu" onMouseLeave={() => setMenu(false)}>
              <button className="menu-item" onClick={() => { setMenu(false); setEditRoom(true); }}>
                <Icon name="edit" /> עריכת החדר
              </button>
              {!room.is_main && (
                <button className="menu-item danger" onClick={deleteRoom}>
                  <Icon name="delete" /> מחיקת החדר
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );

  async function deleteRoom() {
    if (!room) return;
    setMenu(false);
    const ok = await confirm({ title: `מחיקת החדר "${room.name}"`, body: 'כל ההודעות בחדר יימחקו לצמיתות.', confirmLabel: 'מחיקה', danger: true });
    if (!ok) return;
    const { error } = await supabase.from('channels').delete().eq('id', room.id);
    if (error) return toast(errorText(error), 'error');
    toast('החדר נמחק');
    await reloadRooms();
    navigate('/');
  }

  return (
    <div className={`split ${panel ? 'has-panel' : ''}`}>
      <section className="pane chat-pane">
        {room.is_main ? (
          <header className="room-hero" style={{ '--hero-img': `url("${HERO_URL}")` } as CSSProperties}>
            <div className="room-hero-text">
              <span className="hero-org">{SITE_NAME}</span>
              <h1>{room.name}</h1>
              <p>{online.size > 0 ? `${online.size} מחוברים עכשיו` : room.description}</p>
            </div>
            {headerTools}
          </header>
        ) : (
          <header className="pane-head">
            <SpaceTile name={room.name} size={36} announce={room.admin_only_post} />
            <div className="pane-titles">
              <h1>{room.name}</h1>
              <p>
                {room.description ?? 'חדר צ\'אט'}
                {room.created_by && ` · נפתח על ידי ${nameOf(room.created_by)}`}
              </p>
            </div>
            {headerTools}
          </header>
        )}

        <ChatStream
          key={`${room.id}-${linkedId ?? ''}`}
          items={items}
          hasOlder={hasOlder}
          onLoadOlder={loadOlder}
          onReact={react}
          onLike={toggleLike}
          onReply={canWrite ? (item) => { setEditing(null); setReplyTo(byId.get(item.id)!); composer.current?.focus(); } : undefined}
          menuFor={menuFor}
          showNames
          firstUnreadId={firstUnreadId}
          highlightId={linkedId ?? editing?.id ?? null}
          typingLabel={typingLabel}
          sentTick={sentTick}
          empty={
            <>
              <Icon name="forum" size={48} />
              <p><strong>{room.name}</strong></p>
              <p className="muted">{canWrite ? 'עוד אין כאן הודעות. כתבו את הראשונה!' : 'עוד אין הודעות בחדר.'}</p>
            </>
          }
        />

        <Composer
          ref={composer}
          placeholder={room.is_main ? 'הודעה לכל הקהילה' : `הודעה ב${room.name}`}
          allowAnonymous={!!me?.can_send_anonymous && !editing}
          allowAttachments={!editing}
          onSend={send}
          mentionNames={mentionNames}
          onTyping={(anon, stop) => ping(anon, stop)}
          disabledReason={canWrite ? undefined : 'רק מנהלי הקהילה כותבים בחדר הזה'}
          context={
            editing ? (
              <><Icon name="edit" size={16} /> עריכת הודעה</>
            ) : replyTo ? (
              <><Icon name="format_quote" size={16} /> ציטוט של <strong>{replyTo.anonymous ? 'אנונימי' : nameOf(replyTo.author_id)}</strong>: {replyTo.body.slice(0, 80) || 'תמונה / סרטון'}</>
            ) : undefined
          }
          onCancelContext={() => {
            if (editing) composer.current?.setText('');
            setEditing(null);
            setReplyTo(null);
          }}
        />
      </section>

      {panel === 'people' && (
        <aside className="panel">
          <header className="panel-head">
            <button className="icon-btn" onClick={() => setPanel(null)} aria-label="סגירה"><Icon name="close" /></button>
            <h2>משתתפים</h2>
          </header>
          <div className="panel-body">
            <div className="panel-sub">{online.size} מחוברים · {members.length} חברים</div>
            <ul className="people">
              {members.map((p) => (
                <li key={p.id}>
                  <button onClick={(e) => openCard(p.id, e.currentTarget)}>
                    <Avatar id={p.id} name={p.display_name} size={32} online={online.has(p.id)} />
                    <span className="grow">{p.display_name}</span>
                    {roleTag(p, ownerId) && <span className="role-tag">{roleTag(p, ownerId)}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      )}

      {panel === 'pins' && (
        <aside className="panel">
          <header className="panel-head">
            <button className="icon-btn" onClick={() => setPanel(null)} aria-label="סגירה"><Icon name="close" /></button>
            <h2>לוח ההודעות המוצמדות</h2>
          </header>
          <div className="panel-body">
            {pinned.length === 0 ? (
              <div className="empty-state small">
                <Icon name="keep" size={36} />
                <p className="muted">אין הודעות מוצמדות. אפשר להצמיד הודעה חשובה מתפריט ⋮ שלה.</p>
              </div>
            ) : (
              <ul className="pins">
                {pinned.map((m) => (
                  <li key={m.id}>
                    <button onClick={() => setSearch({ m: String(m.id) })}>
                      <Avatar id={m.author_id} name={nameOf(m.author_id)} size={28} anonymous={m.anonymous} />
                      <span className="grow">
                        <span className="pin-author">{m.anonymous ? 'אנונימי' : nameOf(m.author_id)}</span>
                        <span className="pin-body">{m.body || (m.attachment ? 'תמונה / סרטון' : '')}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      )}

      {editRoom && <RoomDialog room={room} onClose={() => setEditRoom(false)} />}
      {forward && <ForwardDialog body={forward.body} attachment={forward.attachment} onClose={() => setForward(null)} />}
    </div>
  );
}
