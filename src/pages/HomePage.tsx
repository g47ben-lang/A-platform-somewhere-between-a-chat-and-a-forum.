import { useEffect, useState } from 'react';
import { useApp } from '../AppContext';
import { supabase, SITE_NAME } from '../supabase';
import type { Thread } from '../types';
import ThreadList from '../components/ThreadList';

export default function HomePage() {
  const { me, profiles, online } = useApp();
  const [threads, setThreads] = useState<Thread[] | null>(null);

  useEffect(() => {
    const load = () =>
      supabase
        .from('threads')
        .select('*')
        .order('last_activity_at', { ascending: false })
        .limit(30)
        .then(({ data }) => setThreads((data as Thread[]) ?? []));
    load();
    const ch = supabase
      .channel('home-threads')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'threads' }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, []);

  const memberCount = [...profiles.values()].filter((p) => p.status === 'active').length;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>שלום {me?.display_name} 👋</h1>
          <p className="muted">
            ברוכים הבאים ל{SITE_NAME} · {memberCount} חברים · {online.size} מחוברים עכשיו
          </p>
        </div>
      </div>
      <h2 className="section-title">פעילות אחרונה</h2>
      {threads ? <ThreadList threads={threads} showChannel /> : <div className="spinner" />}
    </div>
  );
}
