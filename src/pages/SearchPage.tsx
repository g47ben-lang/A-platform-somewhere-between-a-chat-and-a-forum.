import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../AppContext';
import { supabase } from '../supabase';
import type { Thread } from '../types';
import { timeAgo } from '../util';
import ThreadList from '../components/ThreadList';

interface MessageHit {
  id: number;
  thread_id: number;
  author_id: string;
  body: string;
  created_at: string;
  thread: { title: string } | null;
}

export default function SearchPage() {
  const { profiles } = useApp();
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [threads, setThreads] = useState<Thread[] | null>(null);
  const [hits, setHits] = useState<MessageHit[]>([]);

  async function search(e: FormEvent) {
    e.preventDefault();
    const term = q.trim();
    if (term.length < 2) return;
    setBusy(true);
    const pat = `%${term.replace(/[\\%_]/g, (c) => '\\' + c)}%`;
    const [byTitle, byBody, msgs] = await Promise.all([
      supabase.from('threads').select('*').ilike('title', pat).order('last_activity_at', { ascending: false }).limit(20),
      supabase.from('threads').select('*').ilike('body', pat).order('last_activity_at', { ascending: false }).limit(20),
      supabase
        .from('messages')
        .select('id,thread_id,author_id,body,created_at,thread:threads(title)')
        .eq('deleted', false)
        .ilike('body', pat)
        .order('id', { ascending: false })
        .limit(40),
    ]);
    const merged = new Map<number, Thread>();
    for (const t of [...((byTitle.data as Thread[]) ?? []), ...((byBody.data as Thread[]) ?? [])]) merged.set(t.id, t);
    setThreads([...merged.values()]);
    setHits((msgs.data as unknown as MessageHit[]) ?? []);
    setBusy(false);
  }

  return (
    <div className="page">
      <h1>חיפוש</h1>
      <form className="search-bar" onSubmit={search}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="מה מחפשים?" autoFocus />
        <button className="btn primary" disabled={busy}>חיפוש</button>
      </form>
      {threads && (
        <>
          <h2 className="section-title">נושאים ({threads.length})</h2>
          <ThreadList threads={threads} showChannel />
          <h2 className="section-title">הודעות ({hits.length})</h2>
          {hits.length === 0 ? (
            <div className="empty">לא נמצאו הודעות</div>
          ) : (
            <ul className="hit-list">
              {hits.map((h) => (
                <li key={h.id}>
                  <Link to={`/t/${h.thread_id}`}>
                    <div className="muted small">
                      {profiles.get(h.author_id)?.display_name ?? 'משתמש'} ב„{h.thread?.title}” · {timeAgo(h.created_at)}
                    </div>
                    <div>{h.body.length > 200 ? h.body.slice(0, 200) + '…' : h.body}</div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
