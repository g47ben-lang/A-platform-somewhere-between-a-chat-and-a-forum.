import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../AppContext';
import { supabase } from '../supabase';
import { errorText, shortStamp } from '../lib/format';
import type { DmMessage, Message } from '../types';
import Avatar from '../components/Avatar';
import { useFeedback } from '../components/Feedback';
import Icon from '../components/Icon';
import { useConversationTitle } from '../components/Layout';

interface Row {
  kind: 'room' | 'dm';
  id: number;
  starredAt: string;
  authorId: string | null;
  anonymous: boolean;
  body: string;
  media: boolean;
  createdAt: string;
  where: string;
  link: string;
}

export default function StarredPage() {
  const { rooms, conversations, nameOf } = useApp();
  const { toast } = useFeedback();
  const convTitle = useConversationTitle();
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    (async () => {
      const { data: stars } = await supabase.from('stars').select('kind,item_id,created_at').order('created_at', { ascending: false });
      const list = (stars ?? []) as { kind: 'room' | 'dm'; item_id: number; created_at: string }[];
      const roomIds = list.filter((s) => s.kind === 'room').map((s) => s.item_id);
      const dmIds = list.filter((s) => s.kind === 'dm').map((s) => s.item_id);
      const [rm, dm] = await Promise.all([
        roomIds.length ? supabase.from('messages').select('*').in('id', roomIds) : Promise.resolve({ data: [] }),
        dmIds.length ? supabase.from('dm_messages').select('*').in('id', dmIds) : Promise.resolve({ data: [] }),
      ]);
      const rById = new Map(((rm.data ?? []) as Message[]).map((m) => [m.id, m]));
      const dById = new Map(((dm.data ?? []) as DmMessage[]).map((m) => [m.id, m]));
      const out: Row[] = [];
      for (const s of list) {
        if (s.kind === 'room') {
          const m = rById.get(s.item_id);
          if (!m || m.deleted) continue;
          const room = rooms.find((r) => r.id === m.channel_id);
          out.push({
            kind: 'room', id: m.id, starredAt: s.created_at, authorId: m.author_id, anonymous: m.anonymous, body: m.body, media: !!m.attachment,
            createdAt: m.created_at, where: room?.name ?? '', link: `${room?.is_main ? '/' : `/room/${m.channel_id}`}?m=${m.id}`,
          });
        } else {
          const m = dById.get(s.item_id);
          if (!m || m.deleted) continue;
          const conv = conversations.find((c) => c.id === m.conversation_id);
          out.push({
            kind: 'dm', id: m.id, starredAt: s.created_at, authorId: m.sender_id, anonymous: !m.sender_id, body: m.body, media: !!m.attachment,
            createdAt: m.created_at, where: conv ? `שיחה עם ${convTitle(conv)}` : 'שיחה אישית', link: `/dm/${m.conversation_id}?m=${m.id}`,
          });
        }
      }
      setRows(out);
    })();
    // rooms/conversations only provide labels
  }, []);

  async function unstar(r: Row) {
    const { error } = await supabase.from('stars').delete().match({ kind: r.kind, item_id: r.id });
    if (error) return toast(errorText(error), 'error');
    setRows((prev) => prev?.filter((x) => !(x.kind === r.kind && x.id === r.id)) ?? prev);
  }

  return (
    <div className="pane scroll-pane">
      <div className="page narrow-page">
        <header className="page-head">
          <h1>הודעות מסומנות בכוכב</h1>
          <p className="muted">הודעות ששמרת לעצמך. רק אתה רואה את הרשימה הזו.</p>
        </header>
        {rows === null ? (
          <div className="spinner" />
        ) : rows.length === 0 ? (
          <div className="empty-inline"><Icon name="star" /><span>עוד אין הודעות מסומנות. אפשר לסמן הודעה בכוכב מתפריט ⋮ שלה.</span></div>
        ) : (
          <ul className="list">
            {rows.map((r) => (
              <li key={`${r.kind}${r.id}`} className="list-row static">
                <Avatar id={r.authorId} name={nameOf(r.authorId)} size={36} anonymous={r.anonymous} />
                <Link to={r.link} className="list-main plain-link">
                  <div className="list-sub">{r.anonymous ? 'אנונימי' : nameOf(r.authorId)} · {r.where} · {shortStamp(r.createdAt)}</div>
                  <div className="list-body">{r.body || (r.media ? 'תמונה / סרטון' : '')}</div>
                </Link>
                <button className="icon-btn small" onClick={() => unstar(r)} title="הסרת הכוכב" aria-label="הסרת הכוכב">
                  <Icon name="star" filled size={20} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
