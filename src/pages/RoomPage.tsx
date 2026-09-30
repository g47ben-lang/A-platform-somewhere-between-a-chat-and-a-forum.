import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useApp } from '../AppContext';
import { supabase, SITE_NAME } from '../supabase';
import { subscribe } from '../lib/realtime';
import { errorText } from '../lib/format';
import { useTyping } from '../lib/useTyping';
import type { Message } from '../types';
import Avatar, { SpaceTile } from '../components/Avatar';
import ChatStream, { type StreamItem } from '../components/ChatStream';
import Composer, { type ComposerHandle } from '../components/Composer';
import { useFeedback } from '../components/Feedback';
import Icon from '../components/Icon';
import type { RowAction } from '../components/MessageRow';
import { useProfileCard } from '../components/ProfileCard';
import RoomDialog from '../components/RoomDialog';

const PAGE = 60;

// Banner photo for the main chat lives at public/hero.jpg; without it a gradient shows.
// Absolute URL: a relative url() inside a CSS variable would resolve against the stylesheet folder.
const HERO_URL = new URL(`${import.meta.env.BASE_URL}hero.jpg`, document.baseURI).href;

interface Like {
  message_id: number;
  user_id: string;
}

export default function RoomPage() {
  const params = useParams();
  const { rooms, mainRoom, me, isMod, profiles, online, nameOf, reloadRooms } = useApp();
  const room = params.roomId ? rooms.find((r) => r.id === Number(params.roomId)) : mainRoom;
  const roomId = room?.id ?? null;
  const { confirm, toast } = useFeedback();
  const navigate = useNavigate();
  const openCard = useProfileCard();

  const [messages, setMessages] = useState<Message[] | null>(null);
  const [hasOlder, setHasOlder] = useState(false);
  const [likes, setLikes] = useState<Like[]>([]);
  const [mineAnon, setMineAnon] = useState<Set<number>>(new Set());
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editing, setEditing] = useState<Message | null>(null);
  const [firstUnreadId, setFirstUnreadId] = useState<number | null>(null);
  const [panel, setPanel] = useState(false);
  const [menu, setMenu] = useState(false);
  const [editRoom, setEditRoom] = useState(false);
  const [sentTick, setSentTick] = useState(0);
  const composer = useRef<ComposerHandle>(null);
  const unreadSnapshot = useRef(0);
  const { typingLabel, ping } = useTyping(roomId ? `room-${roomId}` : null, me?.display_name);

  const markRead = useCallback(async () => {
    if (!roomId) return;
    await supabase.rpc('mark_room_read', { p_channel: roomId });
    reloadRooms();
  }, [roomId, reloadRooms]);

  const loadExtras = useCallback(async (list: Message[]) => {
    const ids = list.map((m) => m.id);
    if (!ids.length) return;
    const anonIds = list.filter((m) => m.anonymous).map((m) => m.id);
    const [l, a] = await Promise.all([
      supabase.from('reactions').select('message_id,user_id').in('message_id', ids),
      anonIds.length ? supabase.from('anon_authors').select('item_id').eq('kind', 'message').in('item_id', anonIds) : Promise.resolve({ data: [] }),
    ]);
    const idSet = new Set(ids);
    if (l.data) setLikes((prev) => [...prev.filter((x) => !idSet.has(x.message_id)), ...(l.data as Like[])]);
    if (a.data) setMineAnon((prev) => new Set([...prev, ...(a.data as { item_id: number }[]).map((x) => x.item_id)]));
  }, []);

  // Remember how many were unread when the room was opened, for the "new messages" divider.
  useEffect(() => {
    unreadSnapshot.current = room?.unread ?? 0;
    // only when switching rooms, before the mark-read below changes it
  }, [roomId]);

  useEffect(() => {
    if (!roomId) return;
    let cancelled = false;
    setMessages(null);
    setLikes([]);
    setReplyTo(null);
    setEditing(null);
    setFirstUnreadId(null);
    setMenu(false);
    (async () => {
      const { data } = await supabase
        .from('messages')
        .select('*')
        .eq('channel_id', roomId)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(PAGE);
      if (cancelled) return;
      const list = ((data as Message[]) ?? []).reverse();
      // Divider before the Nth-from-last message not written by me.
      let n = unreadSnapshot.current;
      let first: number | null = null;
      for (let i = list.length - 1; i >= 0 && n > 0; i--) {
        if (list[i].author_id !== me?.id && !list[i].deleted) {
          first = list[i].id;
          n--;
        }
      }
      setFirstUnreadId(unreadSnapshot.current > 0 ? first : null);
      setMessages(list);
      setHasOlder(list.length === PAGE);
      loadExtras(list);
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
        })
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'reactions' }, (p) => {
          const l = p.new as Like;
          setLikes((prev) => (prev.some((x) => x.message_id === l.message_id && x.user_id === l.user_id) ? prev : [...prev, l]));
        })
        .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'reactions' }, (p) => {
          const l = p.old as Like;
          setLikes((prev) => prev.filter((x) => !(x.message_id === l.message_id && x.user_id === l.user_id)));
        }),
    );
    const onVisible = () => !document.hidden && markRead();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      unsub();
      document.removeEventListener('visibilitychange', onVisible);
    };
    // me?.id is stable for the session
  }, [roomId, loadExtras, markRead]);

  const byId = useMemo(() => new Map((messages ?? []).map((m) => [m.id, m])), [messages]);

  const items: StreamItem[] | null = useMemo(() => {
    if (!messages) return null;
    return messages.map((m) => {
      const parent = m.reply_to ? byId.get(m.reply_to) : undefined;
      const ls = likes.filter((l) => l.message_id === m.id);
      return {
        id: m.id,
        authorId: m.author_id,
        anonymous: m.anonymous,
        mine: m.author_id === me?.id || mineAnon.has(m.id),
        createdAt: m.created_at,
        editedAt: m.edited_at,
        deleted: m.deleted,
        body: m.body,
        quote: m.reply_to
          ? parent
            ? { name: parent.anonymous ? 'אנונימי' : nameOf(parent.author_id), text: parent.deleted ? 'הודעה שנמחקה' : parent.body.slice(0, 160) }
            : { name: '', text: 'הודעה קודמת' }
          : null,
        likes: { count: ls.length, liked: !!me && ls.some((l) => l.user_id === me.id) },
      };
    });
  }, [messages, likes, mineAnon, byId, me, nameOf]);

  async function loadOlder() {
    const first = messages?.[0];
    if (!first || !roomId) return;
    const { data } = await supabase
      .from('messages')
      .select('*')
      .eq('channel_id', roomId)
      .lt('created_at', first.created_at)
      .order('created_at', { ascending: false })
      .limit(PAGE);
    const older = ((data as Message[]) ?? []).reverse();
    setMessages((prev) => [...older, ...(prev ?? [])]);
    setHasOlder(older.length === PAGE);
    loadExtras(older);
  }

  async function send(text: string, opts: { anonymous: boolean }) {
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
    setSentTick((t) => t + 1);
    return true;
  }

  async function toggleLike(item: StreamItem) {
    if (!me || item.mine) return;
    const liked = likes.some((l) => l.message_id === item.id && l.user_id === me.id);
    if (liked) {
      setLikes((prev) => prev.filter((l) => !(l.message_id === item.id && l.user_id === me.id)));
      await supabase.from('reactions').delete().match({ message_id: item.id, user_id: me.id });
    } else {
      setLikes((prev) => [...prev, { message_id: item.id, user_id: me.id }]);
      const { error } = await supabase.from('reactions').insert({ message_id: item.id, user_id: me.id });
      if (error) {
        setLikes((prev) => prev.filter((l) => !(l.message_id === item.id && l.user_id === me.id)));
        toast(errorText(error), 'error');
      }
    }
  }

  async function remove(id: number) {
    const ok = await confirm({ title: 'מחיקת הודעה', body: 'ההודעה תימחק לכל המשתתפים.', confirmLabel: 'מחיקה', danger: true });
    if (!ok) return;
    const { error } = await supabase.from('messages').update({ deleted: true }).eq('id', id);
    if (error) toast(errorText(error), 'error');
    else setMessages((prev) => prev?.map((x) => (x.id === id ? { ...x, deleted: true, body: '' } : x)) ?? prev);
  }

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

  function actionsFor(item: StreamItem): RowAction[] {
    const m = byId.get(item.id)!;
    const a: RowAction[] = [];
    if (!item.mine) a.push({ icon: 'thumb_up', label: 'לייק', onClick: () => toggleLike(item), active: item.likes?.liked });
    if (canWrite) a.push({ icon: 'reply', label: 'ציטוט ותשובה', onClick: () => { setEditing(null); setReplyTo(m); composer.current?.focus(); } });
    if (item.mine) a.push({ icon: 'edit', label: 'עריכה', onClick: () => { setReplyTo(null); setEditing(m); composer.current?.setText(m.body); } });
    if (item.mine || isMod) a.push({ icon: 'delete', label: 'מחיקה', onClick: () => remove(item.id), danger: true });
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
      <button className={`chip-btn ${panel ? 'on' : ''}`} onClick={() => setPanel((v) => !v)} title="משתתפים">
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
          key={room.id}
          items={items}
          hasOlder={hasOlder}
          onLoadOlder={loadOlder}
          actionsFor={actionsFor}
          onLike={toggleLike}
          firstUnreadId={firstUnreadId}
          highlightId={editing?.id ?? null}
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
          onSend={send}
          mentionNames={mentionNames}
          onTyping={(anon, stop) => ping(anon, stop)}
          disabledReason={canWrite ? undefined : 'רק מנהלי הקהילה כותבים בחדר הזה'}
          context={
            editing ? (
              <><Icon name="edit" size={16} /> עריכת הודעה</>
            ) : replyTo ? (
              <><Icon name="reply" size={16} className="icon-flip" /> תשובה ל<strong>{replyTo.anonymous ? 'אנונימי' : nameOf(replyTo.author_id)}</strong>: {replyTo.body.slice(0, 80)}</>
            ) : undefined
          }
          onCancelContext={() => {
            if (editing) composer.current?.setText('');
            setEditing(null);
            setReplyTo(null);
          }}
        />
      </section>

      {panel && (
        <aside className="panel">
          <header className="panel-head">
            <button className="icon-btn" onClick={() => setPanel(false)} aria-label="סגירה">
              <Icon name="close" />
            </button>
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
                    {p.role !== 'member' && <span className="role-tag">{p.role === 'admin' ? 'מנהל/ת' : 'מנחה'}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      )}

      {editRoom && <RoomDialog room={room} onClose={() => setEditRoom(false)} />}
    </div>
  );
}
