import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, NavLink, Route, Routes, useParams } from 'react-router-dom';
import { useApp } from '../AppContext';
import { supabase, SITE_NAME } from '../supabase';
import { subscribe } from '../lib/realtime';
import { summarizeReactions } from '../lib/chat';
import { fullDate } from '../lib/format';
import type { Message, Reaction } from '../types';
import ChatStream, { type StreamItem } from '../components/ChatStream';
import { SpaceTile } from '../components/Avatar';
import Icon from '../components/Icon';
import Highlights from '../components/Highlights';
import PollsPage from './PollsPage';
import FunPage from './FunPage';
import EventsPage from './EventsPage';

const PAGE = 60;

/**
 * Temporary guest view: while the owner keeps it open, visitors who are not logged in may read the
 * rooms, polls, "עוד" and the calendar. Read-only: no writing, voting, reactions, profiles or private
 * chats (the database enforces this too).
 */
export default function GuestPage({ onLogin }: { onLogin: () => void }) {
  const { guestUntil } = useApp();
  return (
    <div className="guest">
      <header className="topbar">
        <span className="brand">
          <span className="brand-mark"><Icon name="forum" filled size={22} /></span>
          <span className="brand-name">{SITE_NAME}</span>
        </span>
        <div className="topbar-end">
          <button className="btn filled" onClick={onLogin}>התחברות / הרשמה</button>
        </div>
      </header>

      <div className="guest-notice" role="status">
        <Icon name="visibility" size={22} />
        <div>
          <strong>צפייה זמנית ללא התחברות</strong>
          <span>
            באופן זמני, כדי להכיר את האתר לציבור, אפשר לצפות בצ'אטים גם בלי להתחבר. בהמשך האתר יחזור להיות פתוח לחברים
            רשומים בלבד. כדי לכתוב, להגיב, להצביע או לשלוח הודעה אישית צריך להתחבר.
          </span>
          {guestUntil && <span className="muted small">פתוח לצפייה עד {fullDate(guestUntil)}</span>}
        </div>
      </div>

      <nav className="guest-tabs" aria-label="מדורים">
        <NavLink to="/" end className={({ isActive }) => `chip-btn ${isActive || location.hash.startsWith('#/room/') ? 'on' : ''}`}>
          <Icon name="forum" size={18} /> צ'אט
        </NavLink>
        <NavLink to="/polls" className={({ isActive }) => `chip-btn ${isActive ? 'on' : ''}`}><Icon name="ballot" size={18} /> סקרים</NavLink>
        <NavLink to="/more" className={({ isActive }) => `chip-btn ${isActive ? 'on' : ''}`}><Icon name="interests" size={18} /> וידויים ו"מי אמר את זה?"</NavLink>
        <NavLink to="/events" className={({ isActive }) => `chip-btn ${isActive ? 'on' : ''}`}><Icon name="calendar_month" size={18} /> לוח אירועים</NavLink>
      </nav>

      <div className="guest-body">
        <Routes>
          <Route index element={<GuestChat onLogin={onLogin} />} />
          <Route path="room/:roomId" element={<GuestChat onLogin={onLogin} />} />
          <Route path="polls" element={<PollsPage />} />
          <Route path="polls/:pollId" element={<PollsPage />} />
          <Route path="more" element={<FunPage />} />
          <Route path="events" element={<EventsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </div>
  );
}

function GuestChat({ onLogin }: { onLogin: () => void }) {
  const { rooms, nameOf } = useApp();
  const roomId = Number(useParams().roomId) || null;
  const room = rooms.find((r) => r.id === roomId) ?? rooms.find((r) => r.is_main) ?? rooms[0];
  const id = room?.id ?? null;

  const [messages, setMessages] = useState<Message[] | null>(null);
  const [hasOlder, setHasOlder] = useState(false);
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const [likes, setLikes] = useState<{ message_id: number; user_id: string }[]>([]);

  const loadExtras = useCallback(async (list: Message[]) => {
    const ids = list.map((m) => m.id);
    if (!ids.length) return;
    const [r, l] = await Promise.all([
      supabase.from('reactions').select('message_id,user_id,emoji').in('message_id', ids),
      supabase.from('message_likes').select('message_id,user_id').in('message_id', ids),
    ]);
    const idSet = new Set(ids);
    if (r.data) setReactions((prev) => [...prev.filter((x) => !idSet.has(x.message_id)), ...(r.data as Reaction[])]);
    if (l.data) setLikes((prev) => [...prev.filter((x) => !idSet.has(x.message_id)), ...(l.data as { message_id: number; user_id: string }[])]);
  }, []);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setMessages(null);
    setReactions([]);
    setLikes([]);
    supabase.from('messages').select('*').eq('channel_id', id).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(PAGE)
      .then(({ data }) => {
        if (cancelled) return;
        const list = ((data as Message[]) ?? []).reverse();
        setMessages(list);
        setHasOlder(list.length >= PAGE);
        loadExtras(list);
      });
    const unsub = subscribe(`guest-room-${id}`, (ch) =>
      ch
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `channel_id=eq.${id}` }, (p) => {
          const m = p.new as Message;
          setMessages((prev) => (prev && !prev.some((x) => x.id === m.id) ? [...prev, m] : prev));
        })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', filter: `channel_id=eq.${id}` }, (p) => {
          const m = p.new as Message;
          setMessages((prev) => prev?.map((x) => (x.id === m.id ? m : x)) ?? prev);
        }),
    );
    return () => {
      cancelled = true;
      unsub();
    };
  }, [id, loadExtras]);

  async function loadOlder() {
    const first = messages?.[0];
    if (!first || !id) return;
    const { data } = await supabase.from('messages').select('*').eq('channel_id', id).lt('created_at', first.created_at).order('created_at', { ascending: false }).limit(PAGE);
    const older = ((data as Message[]) ?? []).reverse();
    setMessages((prev) => [...older, ...(prev ?? [])]);
    setHasOlder(older.length === PAGE);
    loadExtras(older);
  }

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
        mine: false,
        system: m.system,
        pollId: m.poll_id,
        createdAt: m.created_at,
        editedAt: m.edited_at,
        deleted: m.deleted,
        body: m.body,
        attachment: m.attachment,
        forwarded: m.forwarded,
        quote: m.reply_to
          ? parent
            ? { name: parent.anonymous ? 'אנונימי' : nameOf(parent.author_id), text: parent.deleted ? 'הודעה שנמחקה' : parent.body.slice(0, 200), media: !!parent.attachment }
            : { name: '', text: 'הודעה קודמת' }
          : null,
        reactions: summarizeReactions(reactions.filter((r) => r.message_id === m.id), () => false, (r) => nameOf(r.user_id)),
        likes: { count: ls.length, liked: false, names: ls.map((l) => nameOf(l.user_id)) },
      };
    });
  }, [messages, reactions, likes, byId, nameOf]);

  return (
    <>
      {rooms.length > 1 && (
        <nav className="guest-rooms" aria-label="חדרים">
          {rooms.map((r) => (
            <NavLink key={r.id} to={r.is_main ? '/' : `/room/${r.id}`} className={`chip-btn ${r.id === id ? 'on' : ''}`}>
              {r.is_main ? <Icon name="home" size={18} /> : <SpaceTile name={r.name} size={20} announce={r.admin_only_post} />}
              {r.is_main ? "הצ'אט הראשי" : r.name}
            </NavLink>
          ))}
        </nav>
      )}

      <section className="pane chat-pane guest-pane">
        {room && (
          <header className="pane-head">
            <div className="pane-titles">
              <h1>{room.is_main ? "הצ'אט הראשי" : room.name}</h1>
              {room.description && <p>{room.description}</p>}
            </div>
          </header>
        )}
        {room?.is_main && <div className="guest-highlights"><Highlights /></div>}
        <ChatStream
          items={rooms.length ? items : []}
          hasOlder={hasOlder}
          onLoadOlder={loadOlder}
          onReact={() => undefined}
          menuFor={() => []}
          showNames
          readOnly
          empty={<p className="muted">{rooms.length ? 'עדיין אין הודעות בחדר הזה.' : 'טוען...'}</p>}
        />
        <div className="composer-wrap">
          <div className="composer disabled">
            <Icon name="lock" size={20} />
            <span className="grow">כדי לכתוב בצ'אט צריך להתחבר</span>
            <button className="btn tonal small" onClick={onLogin}>התחברות</button>
          </div>
        </div>
      </section>
    </>
  );
}
