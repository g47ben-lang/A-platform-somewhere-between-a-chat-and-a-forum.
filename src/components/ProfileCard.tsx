import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../AppContext';
import { supabase } from '../supabase';
import { levelFor, ROLE_LABEL } from '../lib/format';
import type { MemberStats } from '../types';
import Avatar from './Avatar';
import { useFeedback } from './Feedback';
import Icon from './Icon';
import { startConversation } from './NewChatDialog';

interface CardState {
  userId: string;
  x: number;
  y: number;
}

const Ctx = createContext<(userId: string, anchor: HTMLElement | { x: number; y: number }) => void>(() => {});

/** Opens the quick profile card for a member. Everything about a member starts here. */
export function useProfileCard() {
  return useContext(Ctx);
}

let statsCache: { at: number; data: Map<string, MemberStats> } | null = null;

async function loadStats(): Promise<Map<string, MemberStats>> {
  if (statsCache && Date.now() - statsCache.at < 60_000) return statsCache.data;
  const { data } = await supabase.rpc('member_stats');
  const map = new Map(((data as MemberStats[]) ?? []).map((s) => [s.id, s]));
  statsCache = { at: Date.now(), data: map };
  return map;
}

export function ProfileCardProvider({ children }: { children: ReactNode }) {
  const [card, setCard] = useState<CardState | null>(null);

  const open = useCallback((userId: string, anchor: HTMLElement | { x: number; y: number }) => {
    if (anchor instanceof HTMLElement) {
      const r = anchor.getBoundingClientRect();
      setCard({ userId, x: r.left + r.width / 2, y: r.bottom });
    } else {
      setCard({ userId, ...anchor });
    }
  }, []);

  return (
    <Ctx.Provider value={open}>
      {children}
      {card && <Card key={card.userId} {...card} onClose={() => setCard(null)} />}
    </Ctx.Provider>
  );
}

function Card({ userId, x, y, onClose }: CardState & { onClose: () => void }) {
  const { profiles, me, online, reloadConversations } = useApp();
  const { toast } = useFeedback();
  const navigate = useNavigate();
  const ref = useRef<HTMLDivElement>(null);
  const [stats, setStats] = useState<MemberStats | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const p = profiles.get(userId);
  const isMe = me?.id === userId;

  useEffect(() => {
    loadStats().then((m) => setStats(m.get(userId) ?? null));
  }, [userId]);

  // Keep the card inside the viewport.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const left = Math.min(Math.max(8, x - w / 2), window.innerWidth - w - 8);
    const top = y + 8 + h > window.innerHeight - 8 ? Math.max(8, y - h - 40) : y + 8;
    setPos({ left, top });
  }, [x, y, stats]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!p) return null;

  async function message(anonymous: boolean) {
    const res = await startConversation(userId, anonymous);
    if ('error' in res) return toast(res.error, 'error');
    await reloadConversations();
    onClose();
    navigate(`/dm/${res.id}`);
  }

  const rep = stats?.reputation ?? 0;
  const level = levelFor(rep);
  const canAnon = !isMe && !!me?.can_send_anonymous && p.accept_anonymous;

  return (
    <div className="card-layer" onMouseDown={onClose}>
      <div
        ref={ref}
        className="profile-pop"
        style={pos ? { left: pos.left, top: pos.top } : { visibility: 'hidden', left: 0, top: 0 }}
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={p.display_name}
      >
        <div className="pop-head">
          <Avatar id={p.id} name={p.display_name} size={64} online={online.has(p.id)} />
          <div className="pop-names">
            <div className="pop-name">{p.display_name}</div>
            <div className="pop-sub">
              {p.role !== 'member' && <span className="role-tag">{ROLE_LABEL[p.role]}</span>}
              <span>{online.has(p.id) ? 'מחובר עכשיו' : 'לא מחובר'}</span>
            </div>
          </div>
        </div>
        <div className="pop-rep">
          <Icon name="workspace_premium" filled size={20} />
          <strong>{stats ? rep : '–'}</strong>
          <span className="muted">מוניטין · {level.name}</span>
        </div>
        {p.bio && <p className="pop-bio">{p.bio}</p>}
        <div className="pop-actions">
          {isMe ? (
            <>
              <button className="btn tonal small" onClick={() => { onClose(); navigate(`/u/${p.id}`); }}>הפרופיל שלי</button>
              <button className="btn text small" onClick={() => { onClose(); navigate('/settings'); }}>הגדרות</button>
            </>
          ) : (
            <>
              <button className="btn filled small" onClick={() => message(false)}>
                <Icon name="chat" size={18} /> הודעה
              </button>
              {canAnon && (
                <button className="btn tonal small anon-btn" onClick={() => message(true)}>
                  <Icon name="visibility_off" size={18} /> אנונימית
                </button>
              )}
              <button className="btn text small" onClick={() => { onClose(); navigate(`/u/${p.id}`); }}>פרופיל מלא</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
