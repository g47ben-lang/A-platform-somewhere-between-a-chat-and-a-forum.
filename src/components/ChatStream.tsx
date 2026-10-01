import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../AppContext';
import { clockTime, dayLabel, fullDate, roleTag } from '../lib/format';
import { quickReactions, rememberEmoji } from '../lib/emoji';
import { useSignedUrl } from '../lib/media';
import type { Attachment } from '../types';
import Avatar from './Avatar';
import EmojiPicker from './EmojiPicker';
import Icon, { type IconName } from './Icon';
import { useProfileCard } from './ProfileCard';
import RichText from './RichText';

export interface ReactionSummary {
  emoji: string;
  count: number;
  mine: boolean;
  names: string[];
}

export interface StreamItem {
  id: number;
  authorId: string | null;
  anonymous: boolean;
  mine: boolean;
  createdAt: string;
  editedAt: string | null;
  deleted: boolean;
  body: string;
  attachment: Attachment | null;
  forwarded: boolean;
  pinned?: boolean;
  starred?: boolean;
  quote?: { name: string; text: string; media?: boolean } | null;
  reactions: ReactionSummary[];
  /** Automatic message (birthday greeting), shown centered without an author. */
  system?: boolean;
  /** A calendar event scheduled from this message (blessings room). */
  eventLabel?: string | null;
  /** Announcement of a poll: shows a button to its page. */
  pollId?: number | null;
  /** Owner only: the real author of an anonymous message. */
  revealedAuthor?: string | null;
  /** Reputation likes (rooms only). */
  likes?: { count: number; liked: boolean; names: string[] };
}

export interface MenuAction {
  icon: IconName;
  label: string;
  onClick: () => void;
  danger?: boolean;
  divider?: boolean;
}

interface Props {
  items: StreamItem[] | null;
  hasOlder: boolean;
  onLoadOlder: () => Promise<void>;
  onReact: (item: StreamItem, emoji: string) => void;
  /** Reputation like; rooms only. */
  onLike?: (item: StreamItem) => void;
  onReply?: (item: StreamItem) => void;
  menuFor: (item: StreamItem) => MenuAction[];
  /** Rooms show author names above other people's bubbles; 1:1 chats don't need them. */
  showNames: boolean;
  firstUnreadId?: number | null;
  highlightId?: number | null;
  empty: ReactNode;
  /** Shown above the first message once the whole history is loaded (1:1 chats: who this is). */
  lead?: ReactNode;
  typingLabel?: string;
  /** Changes whenever the user sends, to force scrolling to the newest message. */
  sentTick?: number;
  /** Visitors who are not logged in (guest view): no actions, no profile cards, no links. */
  readOnly?: boolean;
}

const GROUP_MS = 5 * 60 * 1000;

export default function ChatStream(props: Props) {
  const { items, hasOlder, onLoadOlder, firstUnreadId, highlightId, empty, lead, typingLabel, sentTick } = props;
  const ref = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const preserve = useRef<number | null>(null);
  const seenCount = useRef(0);
  const [newBelow, setNewBelow] = useState(0);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const didInitialScroll = useRef(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !items) return;
    if (preserve.current !== null) {
      el.scrollTop = el.scrollHeight - preserve.current;
      preserve.current = null;
    } else if (!didInitialScroll.current) {
      didInitialScroll.current = true;
      const target = highlightId ? el.querySelector(`[data-mid="${highlightId}"]`) : firstUnreadId ? el.querySelector('.unread-sep') : null;
      if (target) (target as HTMLElement).scrollIntoView({ block: 'center' });
      else el.scrollTop = el.scrollHeight;
      atBottom.current = !target;
    } else if (atBottom.current) {
      el.scrollTop = el.scrollHeight;
    } else if (items.length > seenCount.current) {
      setNewBelow((n) => n + (items.length - seenCount.current));
    }
    seenCount.current = items.length;
  }, [items, firstUnreadId, highlightId]);

  // Jump to a linked message after the initial load too.
  useEffect(() => {
    if (!highlightId || !didInitialScroll.current) return;
    ref.current?.querySelector(`[data-mid="${highlightId}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [highlightId]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !sentTick) return;
    atBottom.current = true;
    el.scrollTop = el.scrollHeight;
    setNewBelow(0);
  }, [sentTick]);

  useEffect(() => {
    const el = ref.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [typingLabel]);

  function onScroll() {
    const el = ref.current;
    if (!el) return;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (atBottom.current && newBelow) setNewBelow(0);
    if (el.scrollTop < 200 && hasOlder && !loadingOlder) loadOlder();
  }

  async function loadOlder() {
    const el = ref.current;
    setLoadingOlder(true);
    if (el) preserve.current = el.scrollHeight - el.scrollTop;
    await onLoadOlder();
    setLoadingOlder(false);
  }

  function toBottom() {
    const el = ref.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    setNewBelow(0);
  }

  // Photos keep the view pinned to the bottom once they finish loading.
  function onMediaLoad() {
    const el = ref.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }

  return (
    <div className="stream-wrap">
      <div className="stream bubbles" ref={ref} onScroll={onScroll}>
        <div className="stream-inner">
        {items === null ? (
          <div className="spinner" />
        ) : items.length === 0 ? (
          <div className="empty-state">{empty}</div>
        ) : (
          <>
            {!hasOlder && lead && <div className="stream-lead">{lead}</div>}
            {hasOlder && (
              <div className="older-row">{loadingOlder ? <div className="spinner small" /> : <button className="btn text small" onClick={loadOlder}>הודעות קודמות</button>}</div>
            )}
            {items.map((m, i) => {
              const prev = items[i - 1];
              const newDay = !prev || dayLabel(prev.createdAt) !== dayLabel(m.createdAt);
              const unreadHere = firstUnreadId === m.id;
              const grouped =
                !newDay && !unreadHere && !!prev && prev.mine === m.mine && !m.anonymous && !prev.anonymous &&
                prev.authorId === m.authorId && new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() < GROUP_MS;
              return (
                <div key={m.id}>
                  {newDay && <div className="day-sep" role="separator"><span>{dayLabel(m.createdAt)}</span></div>}
                  {unreadHere && <div className="unread-sep"><span>הודעות חדשות</span></div>}
                  <Bubble
                    item={m}
                    grouped={grouped}
                    props={props}
                    selected={selected === m.id}
                    onSelect={() => setSelected((s) => (s === m.id ? null : m.id))}
                    onOpenImage={setLightbox}
                    onMediaLoad={onMediaLoad}
                  />
                </div>
              );
            })}
          </>
        )}
        </div>
      </div>
      <div className="typing-line" aria-live="polite">
        {typingLabel && (
          <>
            <span className="dots"><i /><i /><i /></span>
            {typingLabel}
          </>
        )}
      </div>
      {newBelow > 0 && (
        <button className="jump-btn" onClick={toBottom}>
          <Icon name="arrow_downward" size={18} />
          {newBelow} הודעות חדשות
        </button>
      )}
      {lightbox && (
        <div className="lightbox" onClick={() => setLightbox(null)} role="dialog" aria-label="תמונה">
          <button className="icon-btn lightbox-close" aria-label="סגירה"><Icon name="close" /></button>
          <img src={lightbox} alt="" onClick={(e) => e.stopPropagation()} />
          <a className="btn tonal small lightbox-dl" href={lightbox} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
            <Icon name="download" size={18} /> פתיחה בגודל מלא
          </a>
        </div>
      )}
    </div>
  );
}

function Bubble({
  item: m,
  grouped,
  props,
  selected,
  onSelect,
  onOpenImage,
  onMediaLoad,
}: {
  item: StreamItem;
  grouped: boolean;
  props: Props;
  selected: boolean;
  onSelect: () => void;
  onOpenImage: (url: string) => void;
  onMediaLoad: () => void;
}) {
  const { profiles, online, nameOf, me, ownerId } = useApp();
  const openCard = useProfileCard();
  const [picker, setPicker] = useState<{ x: number; y: number } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const names = useMemo(() => [...profiles.values()].filter((p) => p.status === 'active').map((p) => p.display_name), [profiles]);
  const isAnon = m.anonymous || !m.authorId;
  const author = m.authorId ? profiles.get(m.authorId) : undefined;
  const mentionsMe = !!me && !m.mine && m.body.includes(`@${me.display_name}`);
  const showHead = !grouped && !m.mine && props.showNames;
  const quick = quickReactions();

  function react(e: string) {
    rememberEmoji(e);
    props.onReact(m, e);
  }

  const at = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top };
  };

  if (m.system) {
    return (
      <div data-mid={m.id} className={`b-row system ${props.highlightId === m.id ? 'flash' : ''}`}>
        <div className="b-system">
          <Icon name="cake" size={20} />
          <span><RichText text={m.body} names={names} myName={me?.display_name} /></span>
          <time title={fullDate(m.createdAt)}>{clockTime(m.createdAt)}</time>
        </div>
      </div>
    );
  }

  return (
    <div
      data-mid={m.id}
      className={`b-row ${m.mine ? 'mine' : 'theirs'} ${grouped ? 'grouped' : ''} ${selected ? 'selected' : ''} ${props.highlightId === m.id ? 'flash' : ''}`}
      onClick={(e) => {
        // Tap-to-show-actions is for touch screens; with a mouse the bar appears on hover only.
        if (!matchMedia('(hover: none)').matches) return;
        if ((e.target as HTMLElement).closest('button, a, video, img, .b-toolbar')) return;
        onSelect();
      }}
    >
      {!m.mine && (
        <div className="b-avatar">
          {!grouped &&
            (isAnon ? (
              <Avatar anonymous size={32} />
            ) : props.readOnly ? (
              <Avatar id={m.authorId} name={author?.display_name} size={32} />
            ) : (
              <button className="avatar-link" onClick={(e) => openCard(m.authorId!, e.currentTarget)} aria-label={nameOf(m.authorId)}>
                <Avatar id={m.authorId} name={author?.display_name} size={32} online={online.has(m.authorId!)} />
              </button>
            ))}
        </div>
      )}
      <div className="b-col">
        {(showHead || (!grouped && m.mine && m.anonymous)) && (
          <div className="b-head">
            {isAnon ? (
              <span className="anon-author">
                אנונימי{m.mine && <span className="you-tag">שלך</span>}
                {m.revealedAuthor && <span className="revealed-tag" title="גלוי רק למנהל-העל">{m.revealedAuthor}</span>}
              </span>
            ) : props.readOnly ? (
              <span className="author">{nameOf(m.authorId)}</span>
            ) : (
              <button className="author" onClick={(e) => openCard(m.authorId!, e.currentTarget)}>{nameOf(m.authorId)}</button>
            )}
            {author && roleTag(author, ownerId) && <span className="role-tag">{roleTag(author, ownerId)}</span>}
            <time title={fullDate(m.createdAt)}>{clockTime(m.createdAt)}</time>
          </div>
        )}
        <div className="b-line">
          <div className={`bubble ${m.anonymous ? 'anon' : ''} ${mentionsMe ? 'mentioned' : ''} ${m.deleted ? 'deleted' : ''}`}>
            {m.forwarded && !m.deleted && (
              <div className="b-forwarded"><Icon name="forward" size={14} className="icon-flip" /> הועברה</div>
            )}
            {m.quote && !m.deleted && (
              <div className="b-quote">
                <Icon name="format_quote" size={16} />
                <div>
                  {m.quote.name && <strong>{m.quote.name}</strong>}
                  <span>{m.quote.media && !m.quote.text ? 'תמונה / סרטון' : m.quote.text}</span>
                </div>
              </div>
            )}
            {m.deleted ? (
              <span className="b-deleted"><Icon name="block" size={16} /> ההודעה נמחקה</span>
            ) : (
              <>
                {m.attachment && <Media att={m.attachment} onOpenImage={onOpenImage} onLoad={onMediaLoad} />}
                {m.body && (
                  <div className="b-text">
                    <RichText text={m.body} names={names} myName={me?.display_name} />
                  </div>
                )}
                {m.eventLabel && !props.readOnly && (
                  <Link to="/events" className="b-event">
                    <Icon name="calendar_month" size={16} /> בלוח: {m.eventLabel}
                  </Link>
                )}
                {m.pollId && !props.readOnly && (
                  <Link to={`/polls/${m.pollId}`} className="b-poll">
                    <Icon name="ballot" size={18} /> למענה על הסקר
                  </Link>
                )}
              </>
            )}
            <div className="b-meta">
              {m.pinned && <Icon name="keep" size={12} filled />}
              {m.starred && <Icon name="star" size={12} filled />}
              {m.editedAt && !m.deleted && <span>נערך</span>}
              {(grouped || m.mine || !props.showNames) && <time title={fullDate(m.createdAt)}>{clockTime(m.createdAt)}</time>}
            </div>
          </div>

          {!m.deleted && !props.readOnly && (
            <div className="b-toolbar" onClick={(e) => e.stopPropagation()}>
              {props.onLike && !m.mine && (
                <button
                  className={`like-btn ${m.likes?.liked ? 'on' : ''}`}
                  onClick={() => props.onLike!(m)}
                  title={m.likes?.liked ? 'ביטול לייק' : 'לייק (מוסיף מוניטין לכותב)'}
                  aria-label="לייק"
                  aria-pressed={!!m.likes?.liked}
                >
                  <Icon name="thumb_up" filled={m.likes?.liked} size={18} />
                </button>
              )}
              <div className="b-quick">
                {quick.map((e) => (
                  <button key={e} className="emoji-btn" onClick={() => react(e)} title={`תגובה ${e}`}>{e}</button>
                ))}
              </div>
              <div className="b-tools">
                <button className="icon-btn small" title="הוספת תגובה" aria-label="הוספת תגובה" onClick={(e) => setPicker(at(e.currentTarget))}>
                  <Icon name="add_reaction" size={18} />
                </button>
                {props.onReply && (
                  <button className="icon-btn small" title="ציטוט בתשובה" aria-label="ציטוט בתשובה" onClick={() => props.onReply!(m)}>
                    <Icon name="reply" size={18} className="icon-flip" />
                  </button>
                )}
                <button className="icon-btn small" title="אפשרויות נוספות" aria-label="אפשרויות נוספות" onClick={(e) => setMenu(at(e.currentTarget))}>
                  <Icon name="more_vert" size={18} />
                </button>
              </div>
            </div>
          )}
        </div>

        {(m.reactions.length > 0 || (m.likes?.count ?? 0) > 0) && (
          <div className="b-reactions">
            {m.likes && m.likes.count > 0 && (
              <button
                className={`like-chip ${m.likes.liked ? 'on' : ''}`}
                onClick={() => props.onLike?.(m)}
                disabled={m.mine || !props.onLike}
                title={`לייק: ${m.likes.names.join(', ')}`}
              >
                <Icon name="thumb_up" filled size={15} />
                <span>{m.likes.count}</span>
              </button>
            )}
            {m.reactions.map((r) => (
              <button key={r.emoji} className={`reaction ${r.mine ? 'mine' : ''}`} onClick={() => react(r.emoji)} disabled={props.readOnly} title={r.names.join(', ')}>
                <span className="r-emoji">{r.emoji}</span>
                <span>{r.count}</span>
              </button>
            ))}
            {!props.readOnly && (
              <button className="reaction add" onClick={(e) => setPicker(at(e.currentTarget))} aria-label="הוספת תגובה">
                <Icon name="add_reaction" size={16} />
              </button>
            )}
          </div>
        )}
      </div>

      {picker && (
        <EmojiPicker
          anchor={picker}
          onClose={() => setPicker(null)}
          onPick={(e) => {
            setPicker(null);
            props.onReact(m, e);
          }}
        />
      )}
      {menu && <ActionMenu at={menu} actions={props.menuFor(m)} onClose={() => setMenu(null)} />}
    </div>
  );
}

function Media({ att, onOpenImage, onLoad }: { att: Attachment; onOpenImage: (url: string) => void; onLoad: () => void }) {
  const url = useSignedUrl(att.path);
  const ratio = att.width && att.height ? `${att.width} / ${att.height}` : undefined;
  if (att.type === 'video') {
    return (
      <div className="b-media" style={{ aspectRatio: ratio }}>
        {url ? <video src={url} controls preload="metadata" playsInline onLoadedMetadata={onLoad} /> : <div className="media-loading" />}
      </div>
    );
  }
  return (
    <button className="b-media" style={{ aspectRatio: ratio }} onClick={() => url && onOpenImage(url)} aria-label="הגדלת התמונה">
      {url ? <img src={url} alt="" loading="lazy" onLoad={onLoad} /> : <div className="media-loading" />}
    </button>
  );
}

export function ActionMenu({ at, actions, onClose }: { at: { x: number; y: number }; actions: MenuAction[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    setPos({
      left: Math.min(Math.max(8, at.x - w / 2), window.innerWidth - w - 8),
      top: at.y - h - 6 > 8 ? at.y - h - 6 : Math.min(at.y + 30, window.innerHeight - h - 8),
    });
  }, [at]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="card-layer" onMouseDown={onClose}>
      <div ref={ref} className="menu floating" style={pos ?? { visibility: 'hidden', left: 0, top: 0 }} onMouseDown={(e) => e.stopPropagation()} role="menu">
        {actions.map((a) => (
          <div key={a.label}>
            {a.divider && <div className="menu-divider" />}
            <button
              className={`menu-item ${a.danger ? 'danger' : ''}`}
              role="menuitem"
              onClick={() => {
                onClose();
                a.onClick();
              }}
            >
              <Icon name={a.icon} /> {a.label}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
