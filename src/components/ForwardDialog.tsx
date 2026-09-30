import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../AppContext';
import { supabase } from '../supabase';
import { errorText } from '../lib/format';
import type { Attachment } from '../types';
import Avatar, { SpaceTile } from './Avatar';
import { Modal, useFeedback } from './Feedback';
import Icon from './Icon';
import { useConversationTitle } from './Layout';
import { startConversation } from './NewChatDialog';

interface Props {
  body: string;
  attachment: Attachment | null;
  onClose: () => void;
}

/** Forward a message to a room, an existing chat or any member. Always sent under the forwarder's name. */
export default function ForwardDialog({ body, attachment, onClose }: Props) {
  const { rooms, conversations, profiles, me, isMod, online, reloadConversations } = useApp();
  const { toast } = useFeedback();
  const navigate = useNavigate();
  const convTitle = useConversationTitle();
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(false);
  const f = filter.trim();

  const roomList = rooms.filter((r) => (!r.admin_only_post || isMod) && r.name.includes(f));
  const chatList = conversations.filter((c) => !c.closed && convTitle(c).includes(f));
  const withChat = new Set(conversations.filter((c) => !c.anonymous).map((c) => c.other_id));
  const people = [...profiles.values()].filter((p) => p.status === 'active' && p.id !== me?.id && !withChat.has(p.id) && p.display_name.includes(f));

  async function done(path: string, error: unknown) {
    setBusy(false);
    if (error) return toast(errorText(error), 'error');
    toast('ההודעה הועברה');
    onClose();
    navigate(path);
  }

  async function toRoom(id: number, isMain: boolean) {
    setBusy(true);
    const { error } = await supabase.rpc('send_message', { p_channel: id, p_body: body, p_attachment: attachment, p_forwarded: true });
    done(isMain ? '/' : `/room/${id}`, error);
  }

  async function toChat(id: number) {
    setBusy(true);
    const { error } = await supabase.rpc('send_dm', { p_conv: id, p_body: body, p_attachment: attachment, p_forwarded: true });
    await reloadConversations();
    done(`/dm/${id}`, error);
  }

  async function toPerson(userId: string) {
    setBusy(true);
    const res = await startConversation(userId, false);
    if ('error' in res) {
      setBusy(false);
      return toast(res.error, 'error');
    }
    await toChat(res.id);
  }

  return (
    <Modal title="העברת הודעה" onClose={onClose}>
      <div className="forward-preview">
        <Icon name="forward" size={18} className="icon-flip" />
        <span>{body || (attachment?.type === 'video' ? 'סרטון' : 'תמונה')}</span>
      </div>
      <div className="field-search">
        <Icon name="search" />
        <input autoFocus placeholder="חיפוש חדר או חבר" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>
      <ul className="pick-list">
        {roomList.length > 0 && <li className="pick-heading">חדרים</li>}
        {roomList.map((r) => (
          <li key={`r${r.id}`}>
            <button disabled={busy} onClick={() => toRoom(r.id, r.is_main)}>
              <SpaceTile name={r.name} size={36} announce={r.admin_only_post} />
              <span className="grow"><span className="pick-name">{r.name}</span></span>
            </button>
          </li>
        ))}
        {chatList.length > 0 && <li className="pick-heading">שיחות</li>}
        {chatList.map((c) => (
          <li key={`c${c.id}`}>
            <button disabled={busy} onClick={() => toChat(c.id)}>
              <Avatar id={c.other_id} name={convTitle(c)} size={36} anonymous={!c.other_id} online={!!c.other_id && online.has(c.other_id)} />
              <span className="grow">
                <span className="pick-name">{convTitle(c)}</span>
                {c.i_am_hidden && <span className="muted small">אתה בעילום שם בשיחה הזו</span>}
              </span>
            </button>
          </li>
        ))}
        {people.length > 0 && <li className="pick-heading">חברים</li>}
        {people.map((p) => (
          <li key={`p${p.id}`}>
            <button disabled={busy} onClick={() => toPerson(p.id)}>
              <Avatar id={p.id} name={p.display_name} size={36} online={online.has(p.id)} />
              <span className="grow"><span className="pick-name">{p.display_name}</span></span>
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
