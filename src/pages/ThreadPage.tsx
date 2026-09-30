import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useApp } from '../AppContext';
import { supabase } from '../supabase';
import type { Message, Reaction, Thread } from '../types';
import { clockTime, dayLabel, timeAgo } from '../util';
import Avatar from '../components/Avatar';
import RichText from '../components/RichText';

const PAGE = 100;
const QUICK_EMOJI = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
const GROUP_MS = 5 * 60 * 1000;

export default function ThreadPage() {
  const threadId = Number(useParams().threadId);
  const { me, profiles, channels, online, isMod } = useApp();
  const navigate = useNavigate();

  const [thread, setThread] = useState<Thread | null | undefined>(undefined);
  const [messages, setMessages] = useState<Message[]>([]);
  const [hasOlder, setHasOlder] = useState(false);
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editing, setEditing] = useState<Message | null>(null);
  const [picker, setPicker] = useState<number | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const stickToBottom = useRef(true);
  const preserveFrom = useRef<number | null>(null);

  const markRead = useCallback(() => {
    if (!me) return;
    supabase
      .from('thread_reads')
      .upsert({ user_id: me.id, thread_id: threadId, last_read_at: new Date().toISOString() })
      .then(() => {});
  }, [me, threadId]);

  const loadReactions = useCallback(async (ids: number[]) => {
    if (ids.length === 0) return;
    const { data } = await supabase.from('reactions').select('message_id,user_id,emoji').in('message_id', ids);
    if (data) {
      const idSet = new Set(ids);
      setReactions((prev) => [...prev.filter((r) => !idSet.has(r.message_id)), ...(data as Reaction[])]);
    }
  }, []);

  // Initial load + realtime.
  useEffect(() => {
    let cancelled = false;
    setThread(undefined);
    setMessages([]);
    setReactions([]);
    setReplyTo(null);
    setEditing(null);
    stickToBottom.current = true;

    (async () => {
      const [{ data: t }, { data: msgs }] = await Promise.all([
        supabase.from('threads').select('*').eq('id', threadId).maybeSingle(),
        supabase.from('messages').select('*').eq('thread_id', threadId).order('id', { ascending: false }).limit(PAGE),
      ]);
      if (cancelled) return;
      setThread((t as Thread) ?? null);
      const list = ((msgs as Message[]) ?? []).reverse();
      setMessages(list);
      setHasOlder(list.length === PAGE);
      loadReactions(list.map((m) => m.id));
      markRead();
    })();

    const ch = supabase
      .channel(`thread-${threadId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `thread_id=eq.${threadId}` }, (p) => {
        const m = p.new as Message;
        setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
        markRead();
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', filter: `thread_id=eq.${threadId}` }, (p) => {
        const m = p.new as Message;
        setMessages((prev) => prev.map((x) => (x.id === m.id ? m : x)));
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'threads', filter: `id=eq.${threadId}` }, (p) => {
        setThread(p.new as Thread);
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'threads', filter: `id=eq.${threadId}` }, () => {
        setThread(null);
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'reactions' }, (p) => {
        const r = p.new as Reaction;
        setReactions((prev) =>
          prev.some((x) => x.message_id === r.message_id && x.user_id === r.user_id && x.emoji === r.emoji) ? prev : [...prev, r],
        );
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'reactions' }, (p) => {
        const r = p.old as Reaction;
        setReactions((prev) => prev.filter((x) => !(x.message_id === r.message_id && x.user_id === r.user_id && x.emoji === r.emoji)));
      })
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(ch);
    };
  }, [threadId, loadReactions, markRead]);

  // Scroll management: stick to bottom for new messages, keep position when loading older ones.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (preserveFrom.current !== null) {
      el.scrollTop = el.scrollHeight - preserveFrom.current;
      preserveFrom.current = null;
    } else if (stickToBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, thread]);

  function onScroll() {
    const el = scrollRef.current;
    if (el) stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }

  async function loadOlder() {
    const first = messages[0];
    if (!first) return;
    const { data } = await supabase
      .from('messages')
      .select('*')
      .eq('thread_id', threadId)
      .lt('id', first.id)
      .order('id', { ascending: false })
      .limit(PAGE);
    const older = ((data as Message[]) ?? []).reverse();
    const el = scrollRef.current;
    if (el) preserveFrom.current = el.scrollHeight - el.scrollTop;
    setMessages((prev) => [...older, ...prev]);
    setHasOlder(older.length === PAGE);
    loadReactions(older.map((m) => m.id));
  }

  async function send() {
    const body = text.trim();
    if (!body || !me || sending) return;
    setSending(true);
    setError('');
    if (editing) {
      const { error } = await supabase.from('messages').update({ body }).eq('id', editing.id);
      if (error) setError(error.message);
      else {
        setEditing(null);
        setText('');
      }
    } else {
      const { data, error } = await supabase
        .from('messages')
        .insert({ thread_id: threadId, author_id: me.id, body, reply_to: replyTo?.id ?? null })
        .select('*')
        .single();
      if (error) setError(error.message);
      else {
        stickToBottom.current = true;
        setMessages((prev) => (prev.some((x) => x.id === data.id) ? prev : [...prev, data as Message]));
        setText('');
        setReplyTo(null);
      }
    }
    setSending(false);
    inputRef.current?.focus();
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends on desktop; on touch devices Enter inserts a newline and the button sends.
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && !matchMedia('(pointer: coarse)').matches) {
      e.preventDefault();
      send();
    } else if (e.key === 'Escape') {
      setReplyTo(null);
      if (editing) {
        setEditing(null);
        setText('');
      }
    }
  }

  async function toggleReaction(messageId: number, emoji: string) {
    if (!me) return;
    setPicker(null);
    const mine = reactions.some((r) => r.message_id === messageId && r.user_id === me.id && r.emoji === emoji);
    if (mine) {
      setReactions((prev) => prev.filter((r) => !(r.message_id === messageId && r.user_id === me.id && r.emoji === emoji)));
      await supabase.from('reactions').delete().match({ message_id: messageId, user_id: me.id, emoji });
    } else {
      setReactions((prev) => [...prev, { message_id: messageId, user_id: me.id, emoji }]);
      await supabase.from('reactions').insert({ message_id: messageId, user_id: me.id, emoji });
    }
  }

  async function deleteMessage(m: Message) {
    if (!confirm('למחוק את ההודעה?')) return;
    await supabase.from('messages').update({ deleted: true }).eq('id', m.id);
  }

  async function updateThread(patch: Partial<Thread>) {
    const { error } = await supabase.from('threads').update(patch).eq('id', threadId);
    if (error) alert(error.message);
  }

  async function deleteThread() {
    if (!confirm('למחוק את כל הנושא כולל כל ההודעות? אין דרך לשחזר.')) return;
    const channelId = thread?.channel_id;
    const { error } = await supabase.from('threads').delete().eq('id', threadId);
    if (error) alert(error.message);
    else navigate(channelId ? `/c/${channelId}` : '/');
  }

  function startEdit(m: Message) {
    setReplyTo(null);
    setEditing(m);
    setText(m.body);
    inputRef.current?.focus();
  }

  if (thread === undefined) return <div className="page"><div className="spinner" /></div>;
  if (thread === null)
    return (
      <div className="page">
        <div className="empty">הנושא לא נמצא או שנמחק.</div>
      </div>
    );

  const channel = channels.find((c) => c.id === thread.channel_id);
  const author = profiles.get(thread.author_id);
  const canManage = isMod || thread.author_id === me?.id;
  const canWrite = !thread.locked || isMod;
  const byId = new Map(messages.map((m) => [m.id, m]));
  const nameOf = (id: string) => profiles.get(id)?.display_name ?? 'משתמש';

  return (
    <div className="thread-page">
      <header className="thread-head">
        <div className="crumbs">
          {channel && <Link to={`/c/${channel.id}`}>#{channel.name}</Link>}
        </div>
        <h1>
          {thread.pinned && '📌 '}
          {thread.locked && '🔒 '}
          {thread.title}
        </h1>
        {canManage && (
          <div className="thread-tools">
            {isMod && (
              <>
                <button className="btn ghost small" onClick={() => updateThread({ pinned: !thread.pinned })}>
                  {thread.pinned ? 'ביטול נעיצה' : 'נעיצה'}
                </button>
                <button className="btn ghost small" onClick={() => updateThread({ locked: !thread.locked })}>
                  {thread.locked ? 'פתיחה' : 'נעילה'}
                </button>
                <select
                  className="small"
                  value={thread.channel_id}
                  onChange={(e) => updateThread({ channel_id: Number(e.target.value) })}
                  title="העברה לערוץ אחר"
                >
                  {channels.map((c) => (
                    <option key={c.id} value={c.id}>העברה ל: {c.name}</option>
                  ))}
                </select>
              </>
            )}
            {(isMod || thread.message_count === 0) && (
              <button className="btn ghost small danger" onClick={deleteThread}>מחיקה</button>
            )}
          </div>
        )}
      </header>

      <div className="messages" ref={scrollRef} onScroll={onScroll}>
        <article className="opening-post">
          <div className="msg-head">
            <Avatar id={thread.author_id} name={author?.display_name ?? '?'} online={online.has(thread.author_id)} />
            <strong>{author?.display_name ?? 'משתמש'}</strong>
            <span className="muted small">{timeAgo(thread.created_at)}</span>
          </div>
          {thread.body && (
            <div className="post-body">
              <RichText text={thread.body} />
            </div>
          )}
        </article>

        {hasOlder && (
          <button className="btn ghost wide" onClick={loadOlder}>טעינת הודעות קודמות</button>
        )}

        {messages.map((m, i) => {
          const prev = messages[i - 1];
          const newDay = !prev || dayLabel(prev.created_at) !== dayLabel(m.created_at);
          const grouped =
            !newDay && prev && prev.author_id === m.author_id && !m.reply_to &&
            new Date(m.created_at).getTime() - new Date(prev.created_at).getTime() < GROUP_MS;
          const mine = m.author_id === me?.id;
          const msgReactions = reactions.filter((r) => r.message_id === m.id);
          const counts = new Map<string, string[]>();
          for (const r of msgReactions) counts.set(r.emoji, [...(counts.get(r.emoji) ?? []), r.user_id]);
          const parent = m.reply_to ? byId.get(m.reply_to) : undefined;

          return (
            <div key={m.id}>
              {newDay && <div className="day-sep"><span>{dayLabel(m.created_at)}</span></div>}
              <div
                className={`msg ${grouped ? 'grouped' : ''} ${mine ? 'mine' : ''} ${selected === m.id ? 'selected' : ''}`}
                onClick={(e) => {
                  if ((e.target as HTMLElement).closest('button, a')) return;
                  setSelected(selected === m.id ? null : m.id);
                  setPicker(null);
                }}
              >
                <div className="msg-avatar">
                  {!grouped && <Avatar id={m.author_id} name={nameOf(m.author_id)} online={online.has(m.author_id)} />}
                </div>
                <div className="msg-content">
                  {!grouped && (
                    <div className="msg-head">
                      <strong>{nameOf(m.author_id)}</strong>
                      <span className="muted small">{clockTime(m.created_at)}</span>
                    </div>
                  )}
                  {m.reply_to && (
                    <div className="reply-quote">
                      ↩ {parent ? (
                        <>
                          <strong>{nameOf(parent.author_id)}:</strong> {parent.deleted ? 'הודעה שנמחקה' : parent.body.slice(0, 120)}
                        </>
                      ) : 'הודעה קודמת'}
                    </div>
                  )}
                  <div className={`msg-body ${m.deleted ? 'deleted' : ''}`}>
                    {m.deleted ? 'ההודעה נמחקה' : <RichText text={m.body} />}
                    {m.edited_at && !m.deleted && <span className="muted small"> (נערך)</span>}
                  </div>
                  {counts.size > 0 && (
                    <div className="reactions">
                      {[...counts.entries()].map(([emoji, users]) => (
                        <button
                          key={emoji}
                          className={`reaction ${users.includes(me?.id ?? '') ? 'me' : ''}`}
                          title={users.map(nameOf).join(', ')}
                          onClick={() => toggleReaction(m.id, emoji)}
                        >
                          {emoji} {users.length}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {!m.deleted && (
                  <div className="msg-actions">
                    <button title="תגובה" onClick={() => setPicker(picker === m.id ? null : m.id)}>😊</button>
                    {canWrite && (
                      <button title="השב" onClick={() => { setEditing(null); setReplyTo(m); inputRef.current?.focus(); }}>↩</button>
                    )}
                    {mine && <button title="עריכה" onClick={() => startEdit(m)}>✏️</button>}
                    {(mine || isMod) && <button title="מחיקה" onClick={() => deleteMessage(m)}>🗑</button>}
                    {picker === m.id && (
                      <div className="emoji-picker">
                        {QUICK_EMOJI.map((e) => (
                          <button key={e} onClick={() => toggleReaction(m.id, e)}>{e}</button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {canWrite ? (
        <div className="composer">
          {(replyTo || editing) && (
            <div className="composer-context">
              <span>
                {editing ? '✏️ עריכת הודעה' : <>↩ תגובה ל<strong>{nameOf(replyTo!.author_id)}</strong>: {replyTo!.body.slice(0, 80)}</>}
              </span>
              <button className="icon-btn" onClick={() => { setReplyTo(null); if (editing) { setEditing(null); setText(''); } }}>✕</button>
            </div>
          )}
          {error && <div className="error">{error}</div>}
          <div className="composer-row">
            <textarea
              ref={inputRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={onKey}
              placeholder="כתיבת הודעה…"
              rows={1}
              maxLength={4000}
            />
            <button className="btn primary" onClick={send} disabled={sending || !text.trim()}>
              {editing ? 'שמירה' : 'שליחה'}
            </button>
          </div>
        </div>
      ) : (
        <div className="composer locked">🔒 הנושא נעול לתגובות</div>
      )}
    </div>
  );
}
