import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useApp } from '../AppContext';
import { supabase } from '../supabase';
import type { Thread } from '../types';
import ThreadList from '../components/ThreadList';

const PAGE = 40;

export default function ChannelPage() {
  const channelId = Number(useParams().channelId);
  const { channels, me, isMod } = useApp();
  const channel = channels.find((c) => c.id === channelId);
  const navigate = useNavigate();
  const [threads, setThreads] = useState<Thread[] | null>(null);
  const [limit, setLimit] = useState(PAGE);
  const [composing, setComposing] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setComposing(false);
    setLimit(PAGE);
  }, [channelId]);

  useEffect(() => {
    const load = () =>
      supabase
        .from('threads')
        .select('*')
        .eq('channel_id', channelId)
        .order('pinned', { ascending: false })
        .order('last_activity_at', { ascending: false })
        .limit(limit)
        .then(({ data }) => setThreads((data as Thread[]) ?? []));
    load();
    const ch = supabase
      .channel(`channel-${channelId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'threads', filter: `channel_id=eq.${channelId}` }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [channelId, limit]);

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!me) return;
    setBusy(true);
    setError('');
    const { data, error } = await supabase
      .from('threads')
      .insert({ channel_id: channelId, author_id: me.id, title: title.trim(), body: body.trim() || null })
      .select('id')
      .single();
    setBusy(false);
    if (error) return setError(error.message);
    setTitle('');
    setBody('');
    navigate(`/t/${data.id}`);
  }

  if (!channel) return <div className="page"><div className="spinner" /></div>;
  const canPost = !channel.admin_only_post || isMod;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{channel.admin_only_post ? '📢' : '#'} {channel.name}</h1>
          {channel.description && <p className="muted">{channel.description}</p>}
        </div>
        {canPost && !composing && (
          <button className="btn primary" onClick={() => setComposing(true)}>+ נושא חדש</button>
        )}
      </div>

      {composing && (
        <form className="card compose-thread" onSubmit={create}>
          <input placeholder="כותרת הנושא" value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={150} autoFocus />
          <textarea placeholder="על מה רוצים לדבר? (לא חובה)" value={body} onChange={(e) => setBody(e.target.value)} rows={4} maxLength={8000} />
          {error && <div className="error">{error}</div>}
          <div className="row end">
            <button type="button" className="btn ghost" onClick={() => setComposing(false)}>ביטול</button>
            <button className="btn primary" disabled={busy || !title.trim()}>פרסום</button>
          </div>
        </form>
      )}

      {threads ? <ThreadList threads={threads} /> : <div className="spinner" />}
      {threads && threads.length >= limit && (
        <button className="btn ghost wide" onClick={() => setLimit((l) => l + PAGE)}>טעינת נושאים נוספים</button>
      )}
    </div>
  );
}
