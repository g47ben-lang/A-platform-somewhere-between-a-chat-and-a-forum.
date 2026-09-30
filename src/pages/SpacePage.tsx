import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useApp } from '../AppContext';
import { supabase } from '../supabase';
import { subscribe } from '../lib/realtime';
import { dayLabel, errorText, shortStamp } from '../lib/format';
import { useStickyScroll } from '../lib/useStickyScroll';
import type { Thread } from '../types';
import { SpaceTile } from '../components/Avatar';
import Composer from '../components/Composer';
import { useFeedback } from '../components/Feedback';
import Icon from '../components/Icon';
import MessageRow, { DaySeparator, LikeChip } from '../components/MessageRow';
import ThreadPanel from '../components/ThreadPanel';

const PAGE = 40;

interface Like {
  thread_id: number;
  user_id: string;
}

export default function SpacePage() {
  const params = useParams();
  const spaceId = Number(params.spaceId);
  const openThreadId = params.threadId ? Number(params.threadId) : null;
  const { channels, me, isMod } = useApp();
  const { toast } = useFeedback();
  const navigate = useNavigate();
  const space = channels.find((c) => c.id === spaceId);

  const [threads, setThreads] = useState<Thread[] | null>(null);
  const [hasOlder, setHasOlder] = useState(false);
  const [likes, setLikes] = useState<Like[]>([]);
  const [mineAnon, setMineAnon] = useState<Set<number>>(new Set());
  const [reads, setReads] = useState<Map<number, string>>(new Map());
  const scroll = useStickyScroll([threads]);

  const loadExtras = useCallback(async (ids: number[]) => {
    if (ids.length === 0) return;
    const [l, a, r] = await Promise.all([
      supabase.from('thread_likes').select('thread_id,user_id').in('thread_id', ids),
      supabase.from('anon_authors').select('item_id').eq('kind', 'thread').in('item_id', ids),
      supabase.from('thread_reads').select('thread_id,last_read_at').in('thread_id', ids),
    ]);
    const idSet = new Set(ids);
    if (l.data) setLikes((prev) => [...prev.filter((x) => !idSet.has(x.thread_id)), ...(l.data as Like[])]);
    if (a.data) setMineAnon((prev) => new Set([...prev, ...a.data.map((x) => x.item_id as number)]));
    if (r.data) setReads((prev) => new Map([...prev, ...r.data.map((x) => [x.thread_id as number, x.last_read_at as string] as const)]));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setThreads(null);
    setLikes([]);
    scroll.toBottom();
    (async () => {
      const { data } = await supabase
        .from('threads')
        .select('*')
        .eq('channel_id', spaceId)
        .order('last_activity_at', { ascending: false })
        .limit(PAGE);
      if (cancelled) return;
      const list = ((data as Thread[]) ?? []).reverse();
      setThreads(list);
      setHasOlder(list.length === PAGE);
      loadExtras(list.map((t) => t.id));
    })();

    const unsub = subscribe(`space-${spaceId}`, (ch) =>
      ch
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'threads', filter: `channel_id=eq.${spaceId}` }, (p) => {
          const t = p.new as Thread;
          setThreads((prev) => (prev && !prev.some((x) => x.id === t.id) ? [...prev, t] : prev));
        })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'threads' }, (p) => {
          const t = p.new as Thread;
          setThreads((prev) => {
            if (!prev) return prev;
            const rest = prev.filter((x) => x.id !== t.id);
            if (t.channel_id !== spaceId) return rest; // moved away
            // New activity moves the thread to the bottom, like a chat.
            return [...rest, t].sort((a, b) => a.last_activity_at.localeCompare(b.last_activity_at));
          });
        })
        .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'threads' }, (p) => {
          const id = (p.old as { id: number }).id;
          setThreads((prev) => prev?.filter((x) => x.id !== id) ?? prev);
        })
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'thread_likes' }, (p) => {
          const l = p.new as Like;
          setLikes((prev) => (prev.some((x) => x.thread_id === l.thread_id && x.user_id === l.user_id) ? prev : [...prev, l]));
        })
        .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'thread_likes' }, (p) => {
          const l = p.old as Like;
          setLikes((prev) => prev.filter((x) => !(x.thread_id === l.thread_id && x.user_id === l.user_id)));
        }),
    );
    return () => {
      cancelled = true;
      unsub();
    };
  }, [spaceId, loadExtras]);

  // Opening a thread marks it read locally, so the unread marker clears at once.
  useEffect(() => {
    if (openThreadId) setReads((prev) => new Map(prev).set(openThreadId, new Date().toISOString()));
  }, [openThreadId]);

  async function loadOlder() {
    const first = threads?.[0];
    if (!first) return;
    const { data } = await supabase
      .from('threads')
      .select('*')
      .eq('channel_id', spaceId)
      .lt('last_activity_at', first.last_activity_at)
      .order('last_activity_at', { ascending: false })
      .limit(PAGE);
    const older = ((data as Thread[]) ?? []).reverse();
    scroll.keepPosition();
    setThreads((prev) => [...older, ...(prev ?? [])]);
    setHasOlder(older.length === PAGE);
    loadExtras(older.map((t) => t.id));
  }

  async function post(text: string, opts: { anonymous: boolean; title: string }) {
    const { data, error } = await supabase.rpc('create_thread', {
      p_channel: spaceId,
      p_title: opts.title,
      p_body: text,
      p_anonymous: opts.anonymous,
    });
    if (error) {
      toast(errorText(error), 'error');
      return false;
    }
    const t = data as Thread;
    scroll.toBottom();
    setThreads((prev) => (prev && !prev.some((x) => x.id === t.id) ? [...prev, t] : prev));
    if (opts.anonymous) setMineAnon((prev) => new Set(prev).add(t.id));
    return true;
  }

  async function toggleLike(t: Thread) {
    if (!me) return;
    const liked = likes.some((l) => l.thread_id === t.id && l.user_id === me.id);
    if (liked) {
      setLikes((prev) => prev.filter((l) => !(l.thread_id === t.id && l.user_id === me.id)));
      const { error } = await supabase.from('thread_likes').delete().match({ thread_id: t.id, user_id: me.id });
      if (error) toast(errorText(error), 'error');
    } else {
      setLikes((prev) => [...prev, { thread_id: t.id, user_id: me.id }]);
      const { error } = await supabase.from('thread_likes').insert({ thread_id: t.id, user_id: me.id });
      if (error) {
        setLikes((prev) => prev.filter((l) => !(l.thread_id === t.id && l.user_id === me.id)));
        toast(errorText(error), 'error');
      }
    }
  }

  if (!space) {
    return (
      <div className="pane">
        <div className="empty-state">
          {channels.length === 0 ? <div className="spinner" /> : <p>המרחב לא נמצא.</p>}
        </div>
      </div>
    );
  }

  const canPost = !space.admin_only_post || isMod;
  const pinned = (threads ?? []).filter((t) => t.pinned);

  return (
    <div className={`split ${openThreadId ? 'has-panel' : ''}`}>
      <section className="pane space-pane">
        <header className="pane-head">
          <SpaceTile name={space.name} size={36} announce={space.admin_only_post} />
          <div className="pane-titles">
            <h1>{space.name}</h1>
            {space.description && <p>{space.description}</p>}
          </div>
        </header>

        {pinned.length > 0 && (
          <div className="pinned-bar">
            <Icon name="push_pin" size={18} filled />
            <div className="pinned-list">
              {pinned.map((t) => (
                <button key={t.id} onClick={() => navigate(`/space/${spaceId}/t/${t.id}`)}>
                  {t.title || t.body?.slice(0, 60)}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="stream" ref={scroll.ref} onScroll={scroll.onScroll}>
          {threads === null ? (
            <div className="spinner" />
          ) : threads.length === 0 ? (
            <div className="empty-state">
              <Icon name="forum" size={48} />
              <p>עוד אין כאן הודעות.</p>
              {canPost && <p className="muted">התחילו את השיחה הראשונה במרחב.</p>}
            </div>
          ) : (
            <>
              {hasOlder && (
                <button className="btn tonal load-older" onClick={loadOlder}>טעינת הודעות קודמות</button>
              )}
              {threads.map((t, i) => {
                const prev = threads[i - 1];
                const newDay = !prev || dayLabel(prev.last_activity_at) !== dayLabel(t.last_activity_at);
                const mine = t.author_id === me?.id || mineAnon.has(t.id);
                const threadLikes = likes.filter((l) => l.thread_id === t.id);
                const read = reads.get(t.id);
                const unread = !mine && (!read || new Date(read) < new Date(t.last_activity_at));
                return (
                  <div key={t.id}>
                    {newDay && <DaySeparator label={dayLabel(t.last_activity_at)} />}
                    <div className={`thread-card ${openThreadId === t.id ? 'selected' : ''}`}>
                      <MessageRow
                        authorId={t.author_id}
                        anonymous={t.anonymous}
                        mine={mine}
                        createdAt={t.created_at}
                        title={t.title}
                        body={t.body}
                        onClick={() => navigate(`/space/${spaceId}/t/${t.id}`)}
                        actions={[
                          ...(!mine ? [{ icon: 'thumb_up' as const, label: 'לייק', onClick: () => toggleLike(t), active: threadLikes.some((l) => l.user_id === me?.id) }] : []),
                          { icon: 'reply', label: 'תשובה בשרשור', onClick: () => navigate(`/space/${spaceId}/t/${t.id}`) },
                        ]}
                        footer={
                          <div className="thread-foot">
                            <LikeChip count={threadLikes.length} liked={threadLikes.some((l) => l.user_id === me?.id)} onClick={() => toggleLike(t)} disabled={mine} />
                            <button className={`replies-link ${unread && t.message_count > 0 ? 'unread' : ''}`} onClick={(e) => { e.stopPropagation(); navigate(`/space/${spaceId}/t/${t.id}`); }}>
                              <Icon name="chat_bubble" size={16} />
                              {t.message_count > 0 ? `${t.message_count} תשובות` : 'תשובה'}
                              {t.message_count > 0 && <span className="muted"> · {shortStamp(t.last_activity_at)}</span>}
                            </button>
                            {t.locked && <span className="meta-flag"><Icon name="lock" size={14} /> נעול</span>}
                          </div>
                        }
                      />
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>

        <Composer
          placeholder={`הודעה ב${space.name}`}
          allowAnonymous
          allowTitle
          onSend={post}
          disabledReason={canPost ? undefined : 'רק מנהלי הקהילה מפרסמים במרחב הזה'}
        />
      </section>

      {openThreadId && (
        <ThreadPanel key={openThreadId} threadId={openThreadId} onClose={() => navigate(`/space/${spaceId}`)} />
      )}
    </div>
  );
}
