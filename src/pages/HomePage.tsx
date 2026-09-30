import { useEffect, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../AppContext';
import { supabase, SITE_NAME } from '../supabase';
import { subscribe } from '../lib/realtime';
import { shortStamp } from '../lib/format';
import type { Thread } from '../types';
import Avatar, { SpaceTile } from '../components/Avatar';
import Icon from '../components/Icon';
import { useConversationTitle } from '../components/Layout';

// Banner photo lives at public/hero.jpg; without it the hero shows a plain gradient.
// Absolute URL: a relative url() inside a CSS variable would resolve against the stylesheet folder.
const HERO_URL = new URL(`${import.meta.env.BASE_URL}hero.jpg`, document.baseURI).href;

export default function HomePage() {
  const { me, channels, conversations, online, nameOf } = useApp();
  const convTitle = useConversationTitle();
  const [threads, setThreads] = useState<Thread[] | null>(null);

  useEffect(() => {
    const load = () =>
      supabase
        .from('threads')
        .select('*')
        .order('last_activity_at', { ascending: false })
        .limit(20)
        .then(({ data }) => setThreads((data as Thread[]) ?? []));
    load();
    return subscribe('home', (ch) => ch.on('postgres_changes', { event: '*', schema: 'public', table: 'threads' }, load));
  }, []);

  return (
    <div className="pane scroll-pane">
      <header className="hero" style={{ '--hero-img': `url("${HERO_URL}")` } as CSSProperties}>
        <div className="hero-inner">
          <span className="hero-org">{SITE_NAME}</span>
          <h1>שלום, {me?.display_name}</h1>
          <p>{online.size > 0 ? `${online.size} מחוברים עכשיו` : 'ברוכים הבאים'}</p>
        </div>
      </header>
      <div className="page">

        <section className="card-section">
          <div className="section-head">
            <h2>שיחות אחרונות</h2>
          </div>
          {conversations.length === 0 ? (
            <div className="empty-inline">
              <Icon name="chat" />
              <span>עוד אין שיחות פרטיות. אפשר לפתוח שיחה עם כל חבר/ה מהפרופיל או מכפתור "צ'אט חדש".</span>
            </div>
          ) : (
            <ul className="list">
              {conversations.slice(0, 6).map((c) => (
                <li key={c.id}>
                  <Link to={`/dm/${c.id}`} className={`list-row ${c.unread > 0 ? 'unread' : ''}`}>
                    <Avatar id={c.other_id} name={convTitle(c)} size={40} anonymous={!c.other_id} online={!!c.other_id && online.has(c.other_id)} />
                    <div className="list-main">
                      <div className="list-title">
                        {convTitle(c)}
                        {c.i_am_hidden && <span className="chip-mini"><Icon name="visibility_off" size={14} /> בעילום שם</span>}
                      </div>
                      <div className="list-sub">
                        {c.last_body === null ? 'שיחה חדשה' : `${c.last_from_me ? 'את/ה: ' : ''}${c.last_body || 'הודעה נמחקה'}`}
                      </div>
                    </div>
                    <div className="list-end">
                      <span className="list-time">{shortStamp(c.last_message_at)}</span>
                      {c.unread > 0 && <span className="badge-count">{c.unread}</span>}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card-section">
          <div className="section-head">
            <h2>פעילות במרחבים</h2>
          </div>
          {threads === null ? (
            <div className="spinner" />
          ) : threads.length === 0 ? (
            <div className="empty-inline"><Icon name="forum" /><span>עוד אין פעילות במרחבים.</span></div>
          ) : (
            <ul className="list">
              {threads.map((t) => {
                const space = channels.find((c) => c.id === t.channel_id);
                return (
                  <li key={t.id}>
                    <Link to={`/space/${t.channel_id}/t/${t.id}`} className="list-row">
                      <SpaceTile name={space?.name ?? '#'} size={40} announce={space?.admin_only_post} />
                      <div className="list-main">
                        <div className="list-title">
                          {t.title || t.body?.slice(0, 80)}
                        </div>
                        <div className="list-sub">
                          {space?.name} · {t.anonymous ? 'אנונימי' : nameOf(t.author_id)}
                          {t.message_count > 0 && ` · ${t.message_count} תשובות`}
                        </div>
                      </div>
                      <div className="list-end">
                        <span className="list-time">{shortStamp(t.last_activity_at)}</span>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
