import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../AppContext';
import { supabase } from '../supabase';
import type { Thread } from '../types';
import { timeAgo } from '../util';
import Avatar from './Avatar';

export default function ThreadList({ threads, showChannel }: { threads: Thread[]; showChannel?: boolean }) {
  const { profiles, channels, me } = useApp();
  const [reads, setReads] = useState<Map<number, string>>(new Map());

  const ids = threads.map((t) => t.id).join(',');
  useEffect(() => {
    if (!ids || !me) return;
    supabase
      .from('thread_reads')
      .select('thread_id,last_read_at')
      .in('thread_id', ids.split(',').map(Number))
      .then(({ data }) => {
        if (data) setReads(new Map(data.map((r) => [r.thread_id as number, r.last_read_at as string])));
      });
  }, [ids, me]);

  if (threads.length === 0) return <div className="empty">אין עדיין נושאים כאן. אפשר לפתוח את הראשון!</div>;

  return (
    <ul className="thread-list">
      {threads.map((t) => {
        const author = profiles.get(t.author_id);
        const read = reads.get(t.id);
        const unread = t.author_id !== me?.id && (!read || new Date(read) < new Date(t.last_activity_at));
        const channel = showChannel ? channels.find((c) => c.id === t.channel_id) : undefined;
        return (
          <li key={t.id} className={unread ? 'unread' : ''}>
            <Link to={`/t/${t.id}`} className="thread-row">
              <Avatar id={t.author_id} name={author?.display_name ?? '?'} />
              <div className="thread-main">
                <div className="thread-title">
                  {t.pinned && <span title="נעוץ">📌 </span>}
                  {t.locked && <span title="נעול">🔒 </span>}
                  {t.title}
                </div>
                <div className="thread-meta">
                  {channel && <span className="chip">#{channel.name}</span>}
                  <span>{author?.display_name ?? 'משתמש'}</span>
                  <span>·</span>
                  <span>פעילות {timeAgo(t.last_activity_at)}</span>
                </div>
              </div>
              <div className="thread-count" title="תגובות">
                💬 {t.message_count}
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
