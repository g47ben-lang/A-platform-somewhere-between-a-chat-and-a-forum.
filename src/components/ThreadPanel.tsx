import { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '../AppContext';
import { supabase } from '../supabase';
import { subscribe } from '../lib/realtime';
import { dayLabel, errorText } from '../lib/format';
import { useStickyScroll } from '../lib/useStickyScroll';
import type { Message, Thread } from '../types';
import Composer, { type ComposerHandle } from './Composer';
import EditDialog from './EditDialog';
import { useFeedback } from './Feedback';
import Icon from './Icon';
import MessageRow, { DaySeparator, LikeChip, type RowAction } from './MessageRow';

const PAGE = 100;
const GROUP_MS = 5 * 60 * 1000;

interface Like {
  message_id: number;
  user_id: string;
}

export default function ThreadPanel({ threadId, onClose }: { threadId: number; onClose: () => void }) {
  const { me, channels, isMod, nameOf } = useApp();
  const { confirm, toast } = useFeedback();

  const [thread, setThread] = useState<Thread | null | undefined>(undefined);
  const [messages, setMessages] = useState<Message[]>([]);
  const [hasOlder, setHasOlder] = useState(false);
  const [likes, setLikes] = useState<Like[]>([]);
  const [threadLikes, setThreadLikes] = useState<string[]>([]);
  const [mineAnon, setMineAnon] = useState<Set<number>>(new Set());
  const [threadIsMine, setThreadIsMine] = useState(false);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editing, setEditing] = useState<Message | null>(null);
  const [editThread, setEditThread] = useState(false);
  const [menu, setMenu] = useState(false);
  const composer = useRef<ComposerHandle>(null);
  const scroll = useStickyScroll([messages, thread]);

  const markRead = useCallback(() => {
    if (!me) return;
    supabase.from('thread_reads').upsert({ user_id: me.id, thread_id: threadId, last_read_at: new Date().toISOString() }).then(() => {});
  }, [me, threadId]);

  const loadExtras = useCallback(async (ids: number[]) => {
    if (ids.length === 0) return;
    const [l, a] = await Promise.all([
      supabase.from('reactions').select('message_id,user_id').in('message_id', ids),
      supabase.from('anon_authors').select('item_id').eq('kind', 'message').in('item_id', ids),
    ]);
    const idSet = new Set(ids);
    if (l.data) setLikes((prev) => [...prev.filter((x) => !idSet.has(x.message_id)), ...(l.data as Like[])]);
    if (a.data) setMineAnon((prev) => new Set([...prev, ...a.data.map((x) => x.item_id as number)]));
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [t, msgs, tl, ta] = await Promise.all([
        supabase.from('threads').select('*').eq('id', threadId).maybeSingle(),
        supabase.from('messages').select('*').eq('thread_id', threadId).order('id', { ascending: false }).limit(PAGE),
        supabase.from('thread_likes').select('user_id').eq('thread_id', threadId),
        supabase.from('anon_authors').select('item_id').eq('kind', 'thread').eq('item_id', threadId),
      ]);
      if (cancelled) return;
      setThread((t.data as Thread) ?? null);
      const list = ((msgs.data as Message[]) ?? []).reverse();
      setMessages(list);
      setHasOlder(list.length === PAGE);
      setThreadLikes((tl.data ?? []).map((x) => x.user_id as string));
      setThreadIsMine((ta.data ?? []).length > 0);
      loadExtras(list.map((m) => m.id));
      markRead();
    })();

    const unsub = subscribe(`thread-${threadId}`, (ch) =>
      ch
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `thread_id=eq.${threadId}` }, (p) => {
          const m = p.new as Message;
          setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
          markRead();
        })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', filter: `thread_id=eq.${threadId}` }, (p) => {
          const m = p.new as Message;
          setMessages((prev) => prev.map((x) => (x.id === m.id ? m : x)));
        })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'threads', filter: `id=eq.${threadId}` }, (p) => setThread(p.new as Thread))
        .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'threads', filter: `id=eq.${threadId}` }, () => setThread(null))
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'reactions' }, (p) => {
          const l = p.new as Like;
          setLikes((prev) => (prev.some((x) => x.message_id === l.message_id && x.user_id === l.user_id) ? prev : [...prev, l]));
        })
        .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'reactions' }, (p) => {
          const l = p.old as Like;
          setLikes((prev) => prev.filter((x) => !(x.message_id === l.message_id && x.user_id === l.user_id)));
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'thread_likes', filter: `thread_id=eq.${threadId}` }, async () => {
          const { data } = await supabase.from('thread_likes').select('user_id').eq('thread_id', threadId);
          setThreadLikes((data ?? []).map((x) => x.user_id as string));
        }),
    );
    return () => {
      cancelled = true;
      unsub();
    };
  }, [threadId, loadExtras, markRead]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !replyTo && !editing && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, replyTo, editing]);

  async function loadOlder() {
    const first = messages[0];
    if (!first) return;
    const { data } = await supabase.from('messages').select('*').eq('thread_id', threadId).lt('id', first.id).order('id', { ascending: false }).limit(PAGE);
    const older = ((data as Message[]) ?? []).reverse();
    scroll.keepPosition();
    setMessages((prev) => [...older, ...prev]);
    setHasOlder(older.length === PAGE);
    loadExtras(older.map((m) => m.id));
  }

  async function send(text: string, opts: { anonymous: boolean }) {
    if (!text) return false;
    if (editing) {
      const { error } = await supabase.from('messages').update({ body: text }).eq('id', editing.id);
      if (error) {
        toast(errorText(error), 'error');
        return false;
      }
      setMessages((prev) => prev.map((m) => (m.id === editing.id ? { ...m, body: text, edited_at: new Date().toISOString() } : m)));
      setEditing(null);
      return true;
    }
    const { data, error } = await supabase.rpc('post_message', {
      p_thread: threadId,
      p_body: text,
      p_reply_to: replyTo?.id ?? null,
      p_anonymous: opts.anonymous,
    });
    if (error) {
      toast(errorText(error), 'error');
      return false;
    }
    const m = data as Message;
    scroll.toBottom();
    setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
    if (opts.anonymous) setMineAnon((prev) => new Set(prev).add(m.id));
    setReplyTo(null);
    return true;
  }

  async function toggleLike(m: Message) {
    if (!me) return;
    const liked = likes.some((l) => l.message_id === m.id && l.user_id === me.id);
    if (liked) {
      setLikes((prev) => prev.filter((l) => !(l.message_id === m.id && l.user_id === me.id)));
      await supabase.from('reactions').delete().match({ message_id: m.id, user_id: me.id });
    } else {
      setLikes((prev) => [...prev, { message_id: m.id, user_id: me.id }]);
      const { error } = await supabase.from('reactions').insert({ message_id: m.id, user_id: me.id });
      if (error) {
        setLikes((prev) => prev.filter((l) => !(l.message_id === m.id && l.user_id === me.id)));
        toast(errorText(error), 'error');
      }
    }
  }

  async function toggleThreadLike() {
    if (!me) return;
    const liked = threadLikes.includes(me.id);
    setThreadLikes((prev) => (liked ? prev.filter((u) => u !== me.id) : [...prev, me.id]));
    const { error } = liked
      ? await supabase.from('thread_likes').delete().match({ thread_id: threadId, user_id: me.id })
      : await supabase.from('thread_likes').insert({ thread_id: threadId, user_id: me.id });
    if (error) toast(errorText(error), 'error');
  }

  async function removeMessage(m: Message) {
    const ok = await confirm({ title: 'מחיקת הודעה', body: 'ההודעה תימחק לצמיתות.', confirmLabel: 'מחיקה', danger: true });
    if (!ok) return;
    const { error } = await supabase.from('messages').update({ deleted: true }).eq('id', m.id);
    if (error) toast(errorText(error), 'error');
    else setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, deleted: true, body: '' } : x)));
  }

  async function updateThread(patch: Partial<Thread>) {
    setMenu(false);
    const { error } = await supabase.from('threads').update(patch).eq('id', threadId);
    if (error) toast(errorText(error), 'error');
  }

  async function deleteThread() {
    setMenu(false);
    const ok = await confirm({ title: 'מחיקת השרשור', body: 'השרשור וכל התשובות בו יימחקו לצמיתות.', confirmLabel: 'מחיקה', danger: true });
    if (!ok) return;
    const { error } = await supabase.from('threads').delete().eq('id', threadId);
    if (error) toast(errorText(error), 'error');
    else onClose();
  }

  if (thread === undefined) {
    return (
      <aside className="panel"><div className="spinner" /></aside>
    );
  }
  if (thread === null) {
    return (
      <aside className="panel">
        <PanelHead title="שרשור" onClose={onClose} />
        <div className="empty-state"><p>השרשור לא נמצא או שנמחק.</p></div>
      </aside>
    );
  }

  const threadMine = thread.author_id === me?.id || threadIsMine;
  const canWrite = !thread.locked || isMod;
  const canDeleteThread = isMod || (threadMine && thread.message_count === 0);
  const byId = new Map(messages.map((m) => [m.id, m]));
  const hasMenu = isMod || threadMine;

  return (
    <aside className="panel">
      <PanelHead title={thread.title || 'שרשור'} onClose={onClose}>
        {hasMenu && (
          <div className="menu-anchor">
            <button className="icon-btn" onClick={() => setMenu((m) => !m)} aria-label="אפשרויות">
              <Icon name="more_vert" />
            </button>
            {menu && (
              <div className="menu" onMouseLeave={() => setMenu(false)}>
                {threadMine && (
                  <button className="menu-item" onClick={() => { setMenu(false); setEditThread(true); }}>
                    <Icon name="edit" /> עריכה
                  </button>
                )}
                {isMod && (
                  <>
                    <button className="menu-item" onClick={() => updateThread({ pinned: !thread.pinned })}>
                      <Icon name="push_pin" /> {thread.pinned ? 'ביטול הצמדה' : 'הצמדה לראש המרחב'}
                    </button>
                    <button className="menu-item" onClick={() => updateThread({ locked: !thread.locked })}>
                      <Icon name={thread.locked ? 'lock_open' : 'lock'} /> {thread.locked ? 'פתיחה לתגובות' : 'נעילה לתגובות'}
                    </button>
                    <div className="menu-label"><Icon name="drive_file_move" /> העברה למרחב</div>
                    {channels.filter((c) => c.id !== thread.channel_id).map((c) => (
                      <button key={c.id} className="menu-item sub" onClick={() => updateThread({ channel_id: c.id })}>{c.name}</button>
                    ))}
                  </>
                )}
                {canDeleteThread && (
                  <button className="menu-item danger" onClick={deleteThread}>
                    <Icon name="delete" /> מחיקת השרשור
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </PanelHead>

      <div className="stream" ref={scroll.ref} onScroll={scroll.onScroll}>
        <div className="thread-origin">
          <MessageRow
            authorId={thread.author_id}
            anonymous={thread.anonymous}
            mine={threadMine}
            createdAt={thread.created_at}
            body={thread.body}
            footer={
              <div className="thread-foot">
                <LikeChip count={threadLikes.length} liked={!!me && threadLikes.includes(me.id)} onClick={toggleThreadLike} disabled={threadMine} />
                {thread.pinned && <span className="meta-flag"><Icon name="push_pin" size={14} /> מוצמד</span>}
                {thread.locked && <span className="meta-flag"><Icon name="lock" size={14} /> נעול</span>}
              </div>
            }
          />
          <div className="replies-count">{thread.message_count > 0 ? `${thread.message_count} תשובות` : 'אין עדיין תשובות'}</div>
        </div>

        {hasOlder && <button className="btn tonal load-older" onClick={loadOlder}>טעינת תשובות קודמות</button>}

        {messages.map((m, i) => {
          const prev = messages[i - 1];
          const newDay = !prev || dayLabel(prev.created_at) !== dayLabel(m.created_at);
          const sameAuthor = prev && !m.anonymous && !prev.anonymous && prev.author_id === m.author_id;
          const grouped = !newDay && sameAuthor && !m.reply_to && new Date(m.created_at).getTime() - new Date(prev.created_at).getTime() < GROUP_MS;
          const mine = m.author_id === me?.id || mineAnon.has(m.id);
          const msgLikes = likes.filter((l) => l.message_id === m.id);
          const liked = !!me && msgLikes.some((l) => l.user_id === me.id);
          const parent = m.reply_to ? byId.get(m.reply_to) : undefined;

          const actions: RowAction[] = [];
          if (!mine) actions.push({ icon: 'thumb_up', label: 'לייק', onClick: () => toggleLike(m), active: liked });
          if (canWrite) actions.push({ icon: 'reply', label: 'ציטוט ותשובה', onClick: () => { setEditing(null); setReplyTo(m); composer.current?.focus(); } });
          if (mine) actions.push({ icon: 'edit', label: 'עריכה', onClick: () => { setReplyTo(null); setEditing(m); composer.current?.setText(m.body); } });
          if (mine || isMod) actions.push({ icon: 'delete', label: 'מחיקה', onClick: () => removeMessage(m), danger: true });

          return (
            <div key={m.id}>
              {newDay && <DaySeparator label={dayLabel(m.created_at)} />}
              <MessageRow
                authorId={m.author_id}
                anonymous={m.anonymous}
                mine={mine}
                createdAt={m.created_at}
                editedAt={m.edited_at}
                deleted={m.deleted}
                body={m.body}
                grouped={grouped}
                highlight={editing?.id === m.id}
                quote={
                  m.reply_to ? (
                    <div className="quote">
                      <Icon name="reply" size={14} />
                      {parent ? (
                        <>
                          <strong>{parent.anonymous ? 'אנונימי' : nameOf(parent.author_id)}</strong>
                          <span>{parent.deleted ? 'הודעה שנמחקה' : parent.body.slice(0, 140)}</span>
                        </>
                      ) : (
                        <span>הודעה קודמת</span>
                      )}
                    </div>
                  ) : undefined
                }
                footer={msgLikes.length > 0 ? <div className="thread-foot"><LikeChip count={msgLikes.length} liked={liked} onClick={() => toggleLike(m)} disabled={mine} /></div> : undefined}
                actions={actions}
              />
            </div>
          );
        })}
      </div>

      <Composer
        ref={composer}
        placeholder="תשובה"
        allowAnonymous={!editing}
        onSend={send}
        disabledReason={canWrite ? undefined : 'השרשור נעול לתגובות'}
        context={
          editing ? (
            <><Icon name="edit" size={16} /> עריכת הודעה</>
          ) : replyTo ? (
            <><Icon name="reply" size={16} /> תשובה ל<strong>{replyTo.anonymous ? 'אנונימי' : nameOf(replyTo.author_id)}</strong>: {replyTo.body.slice(0, 80)}</>
          ) : undefined
        }
        onCancelContext={() => {
          if (editing) composer.current?.setText('');
          setEditing(null);
          setReplyTo(null);
        }}
      />

      {editThread && (
        <EditDialog
          heading="עריכת הודעה"
          withTitle
          title={thread.title}
          body={thread.body ?? ''}
          onClose={() => setEditThread(false)}
          onSave={async ({ title, body }) => {
            const { error } = await supabase.from('threads').update({ title: title || null, body: body || null }).eq('id', threadId);
            if (error) toast(errorText(error), 'error');
            return !error;
          }}
        />
      )}
    </aside>
  );
}

function PanelHead({ title, onClose, children }: { title: string; onClose: () => void; children?: React.ReactNode }) {
  return (
    <header className="panel-head">
      <button className="icon-btn" onClick={onClose} aria-label="סגירת השרשור">
        <Icon name="close" />
      </button>
      <h2>{title}</h2>
      {children}
    </header>
  );
}
