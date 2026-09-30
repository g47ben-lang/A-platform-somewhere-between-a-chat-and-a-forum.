import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useApp } from '../AppContext';
import { supabase } from '../supabase';
import { shortStamp } from '../lib/format';
import type { Message } from '../types';
import Avatar from '../components/Avatar';
import Icon from '../components/Icon';
import { useProfileCard } from '../components/ProfileCard';

export default function SearchPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const term = params.get('q')?.trim() ?? '';
  const { profiles, rooms, nameOf } = useApp();
  const openCard = useProfileCard();
  const [q, setQ] = useState(term);
  const [busy, setBusy] = useState(false);
  const [hits, setHits] = useState<Message[]>([]);

  useEffect(() => {
    setQ(term);
    if (term.length < 2) return;
    let cancelled = false;
    setBusy(true);
    const pat = `%${term.replace(/[\\%_]/g, (c) => '\\' + c)}%`;
    supabase
      .from('messages')
      .select('*')
      .eq('deleted', false)
      .ilike('body', pat)
      .order('created_at', { ascending: false })
      .limit(60)
      .then(({ data }) => {
        if (cancelled) return;
        setHits((data as Message[]) ?? []);
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
  const roomOf = (id: number) => rooms.find((r) => r.id === id);
  const roomLink = (id: number) => (roomOf(id)?.is_main ? '/' : `/room/${id}`);

  return (
    <div className="pane scroll-pane">
      <div className="page">
        <header className="page-head">
          <h1>חיפוש</h1>
        </header>
        <form className="field-search big" onSubmit={submit}>
          <Icon name="search" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="חיפוש בהודעות ובחברים" autoFocus />
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
                <div className="chips">
                  {members.slice(0, 12).map((p) => (
                    <button key={p.id} className="person-chip" onClick={(e) => openCard(p.id, e.currentTarget)}>
                      <Avatar id={p.id} name={p.display_name} size={28} />
                      {p.display_name}
                    </button>
                  ))}
                </div>
              </section>
            )}
            <section className="card-section">
              <div className="section-head"><h2>הודעות ({hits.length})</h2></div>
              {hits.length === 0 ? (
                <div className="empty-inline small"><span>לא נמצאו הודעות.</span></div>
              ) : (
                <ul className="list">
                  {hits.map((h) => (
                    <li key={h.id}>
                      <Link to={roomLink(h.channel_id)} className="list-row">
                        <Avatar id={h.author_id} name={nameOf(h.author_id)} size={36} anonymous={h.anonymous} />
                        <div className="list-main">
                          <div className="list-sub">
                            {h.anonymous ? 'אנונימי' : nameOf(h.author_id)} · {roomOf(h.channel_id)?.name ?? ''}
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
