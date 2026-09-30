import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useApp } from '../AppContext';
import { supabase } from '../supabase';
import { shortStamp } from '../lib/format';
import type { Thread } from '../types';
import Avatar, { SpaceTile } from '../components/Avatar';
import Icon from '../components/Icon';

interface MessageHit {
  id: number;
  thread_id: number;
  author_id: string | null;
  anonymous: boolean;
  body: string;
  created_at: string;
  thread: { channel_id: number; title: string | null } | null;
}

export default function SearchPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const term = params.get('q')?.trim() ?? '';
  const { profiles, channels, nameOf } = useApp();
  const [q, setQ] = useState(term);
  const [busy, setBusy] = useState(false);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [hits, setHits] = useState<MessageHit[]>([]);

  useEffect(() => {
    setQ(term);
    if (term.length < 2) return;
    let cancelled = false;
    setBusy(true);
    const pat = `%${term.replace(/[\\%_]/g, (c) => '\\' + c)}%`;
    Promise.all([
      supabase.from('threads').select('*').ilike('title', pat).order('last_activity_at', { ascending: false }).limit(20),
      supabase.from('threads').select('*').ilike('body', pat).order('last_activity_at', { ascending: false }).limit(20),
      supabase
        .from('messages')
        .select('id,thread_id,author_id,anonymous,body,created_at,thread:threads(channel_id,title)')
        .eq('deleted', false)
        .ilike('body', pat)
        .order('id', { ascending: false })
        .limit(40),
    ]).then(([a, b, m]) => {
      if (cancelled) return;
      const merged = new Map<number, Thread>();
      for (const t of [...((a.data as Thread[]) ?? []), ...((b.data as Thread[]) ?? [])]) merged.set(t.id, t);
      setThreads([...merged.values()]);
      setHits((m.data as unknown as MessageHit[]) ?? []);
      setBusy(false);
    });
    return () => {
      cancelled = true;
    };
  }, [term]);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (q.trim().length >= 2) navigate(`/search?q=${encodeURIComponent(q.trim())}`);
  }

  const members = term.length >= 2 ? [...profiles.values()].filter((p) => p.status === 'active' && p.display_name.includes(term)) : [];
  const spaceName = (id: number | undefined) => channels.find((c) => c.id === id)?.name ?? '';

  return (
    <div className="pane scroll-pane">
      <div className="page">
        <header className="page-head">
          <h1>חיפוש</h1>
        </header>
        <form className="field-search big" onSubmit={submit}>
          <Icon name="search" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="חיפוש בהודעות, בשרשורים ובחברים" autoFocus />
        </form>

        {term.length < 2 ? (
          <div className="empty-inline"><Icon name="search" /><span>הקלידו לפחות 2 תווים לחיפוש.</span></div>
        ) : busy ? (
          <div className="spinner" />
        ) : (
          <>
            {members.length > 0 && (
              <section className="card-section">
                <div className="section-head"><h2>חברים ({members.length})</h2></div>
                <ul className="list">
                  {members.slice(0, 8).map((p) => (
                    <li key={p.id}>
                      <Link to={`/u/${p.id}`} className="list-row">
                        <Avatar id={p.id} name={p.display_name} size={36} />
                        <div className="list-main"><div className="list-title">{p.display_name}</div></div>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <section className="card-section">
              <div className="section-head"><h2>שרשורים ({threads.length})</h2></div>
              {threads.length === 0 ? (
                <div className="empty-inline small"><span>לא נמצאו שרשורים.</span></div>
              ) : (
                <ul className="list">
                  {threads.map((t) => (
                    <li key={t.id}>
                      <Link to={`/space/${t.channel_id}/t/${t.id}`} className="list-row">
                        <SpaceTile name={spaceName(t.channel_id) || '#'} size={36} />
                        <div className="list-main">
                          <div className="list-title">{t.title || t.body?.slice(0, 80)}</div>
                          <div className="list-sub">{spaceName(t.channel_id)} · {t.anonymous ? 'אנונימי' : nameOf(t.author_id)}</div>
                        </div>
                        <span className="list-time">{shortStamp(t.last_activity_at)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section className="card-section">
              <div className="section-head"><h2>הודעות ({hits.length})</h2></div>
              {hits.length === 0 ? (
                <div className="empty-inline small"><span>לא נמצאו הודעות.</span></div>
              ) : (
                <ul className="list">
                  {hits.map((h) => (
                    <li key={h.id}>
                      <Link to={`/space/${h.thread?.channel_id}/t/${h.thread_id}`} className="list-row">
                        <Avatar id={h.author_id} name={nameOf(h.author_id)} size={36} anonymous={h.anonymous} />
                        <div className="list-main">
                          <div className="list-sub">
                            {h.anonymous ? 'אנונימי' : nameOf(h.author_id)} · {spaceName(h.thread?.channel_id)}
                            {h.thread?.title && ` · ${h.thread.title}`}
                          </div>
                          <div className="list-body">{h.body.length > 220 ? h.body.slice(0, 220) + '…' : h.body}</div>
                        </div>
                        <span className="list-time">{shortStamp(h.created_at)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
