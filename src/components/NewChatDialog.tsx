import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../AppContext';
import { supabase } from '../supabase';
import { errorText } from '../lib/format';
import Avatar from './Avatar';
import { Modal, useFeedback } from './Feedback';
import Icon from './Icon';

/** Pick a member to message, optionally anonymously. */
export default function NewChatDialog({ onClose, initialAnonymous = false }: { onClose: () => void; initialAnonymous?: boolean }) {
  const { profiles, me, online, reloadConversations } = useApp();
  const { toast } = useFeedback();
  const navigate = useNavigate();
  const [filter, setFilter] = useState('');
  const [anonymous, setAnonymous] = useState(initialAnonymous);
  const [busy, setBusy] = useState(false);

  const list = [...profiles.values()]
    .filter((p) => p.status === 'active' && p.id !== me?.id && p.display_name.includes(filter.trim()))
    .sort((a, b) => Number(online.has(b.id)) - Number(online.has(a.id)) || a.display_name.localeCompare(b.display_name, 'he'));

  async function open(userId: string) {
    setBusy(true);
    const conv = await startConversation(userId, anonymous);
    setBusy(false);
    if ('error' in conv) return toast(conv.error, 'error');
    await reloadConversations();
    onClose();
    navigate(`/dm/${conv.id}`);
  }

  return (
    <Modal title="צ'אט חדש" onClose={onClose}>
      <div className="field-search">
        <Icon name="search" />
        <input autoFocus placeholder="חיפוש לפי שם" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>
      {me?.can_send_anonymous && (
        <label className="switch-row">
          <span>
            <strong>שליחה בעילום שם</strong>
            <span className="muted small">הנמען לא יראה מי שלח את ההודעות.</span>
          </span>
          <input type="checkbox" className="switch" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} />
        </label>
      )}
      <ul className="pick-list">
        {list.map((p) => {
          const blocked = anonymous && !p.accept_anonymous;
          return (
            <li key={p.id}>
              <button disabled={busy || blocked} onClick={() => open(p.id)}>
                <Avatar id={p.id} name={p.display_name} size={36} online={online.has(p.id)} />
                <span className="grow">
                  <span className="pick-name">{p.display_name}</span>
                  {blocked && <span className="muted small">לא מקבל הודעות אנונימיות</span>}
                </span>
              </button>
            </li>
          );
        })}
        {list.length === 0 && <li className="empty small">לא נמצאו חברים</li>}
      </ul>
    </Modal>
  );
}

export async function startConversation(userId: string, anonymous: boolean): Promise<{ id: number } | { error: string }> {
  const { data, error } = await supabase.rpc('start_dm', { p_user: userId, p_anonymous: anonymous });
  if (error) return { error: errorText(error) };
  return { id: data as number };
}
