import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { dayLabel } from '../lib/format';
import Icon from './Icon';
import MessageRow, { DaySeparator, LikeChip, type RowAction } from './MessageRow';

export interface StreamItem {
  id: number;
  authorId: string | null;
  anonymous: boolean;
  mine: boolean;
  createdAt: string;
  editedAt: string | null;
  deleted: boolean;
  body: string;
  quote?: { name: string; text: string } | null;
  likes?: { count: number; liked: boolean };
}

interface Props {
  items: StreamItem[] | null;
  hasOlder: boolean;
  onLoadOlder: () => Promise<void>;
  actionsFor: (item: StreamItem) => RowAction[];
  onLike?: (item: StreamItem) => void;
  firstUnreadId?: number | null;
  highlightId?: number | null;
  empty: ReactNode;
  typingLabel?: string;
  /** Changes whenever the user sends, to force scrolling to the newest message. */
  sentTick?: number;
}

const GROUP_MS = 5 * 60 * 1000;

export default function ChatStream({ items, hasOlder, onLoadOlder, actionsFor, onLike, firstUnreadId, highlightId, empty, typingLabel, sentTick }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const preserve = useRef<number | null>(null);
  const seenCount = useRef(0);
  const [newBelow, setNewBelow] = useState(0);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const didInitialScroll = useRef(false);

  // Keep pinned to the newest message unless the user scrolled up; count arrivals meanwhile.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !items) return;
    if (preserve.current !== null) {
      el.scrollTop = el.scrollHeight - preserve.current;
      preserve.current = null;
    } else if (!didInitialScroll.current) {
      didInitialScroll.current = true;
      const divider = firstUnreadId ? el.querySelector('.unread-sep') : null;
      if (divider) (divider as HTMLElement).scrollIntoView({ block: 'center' });
      else el.scrollTop = el.scrollHeight;
    } else if (atBottom.current) {
      el.scrollTop = el.scrollHeight;
    } else if (items.length > seenCount.current) {
      setNewBelow((n) => n + (items.length - seenCount.current));
    }
    seenCount.current = items.length;
  }, [items, firstUnreadId]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
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

  return (
    <div className="stream-wrap">
      <div className="stream" ref={ref} onScroll={onScroll}>
        {items === null ? (
          <div className="spinner" />
        ) : items.length === 0 ? (
          <div className="empty-state">{empty}</div>
        ) : (
          <>
            {hasOlder && (
              <div className="older-row">{loadingOlder ? <div className="spinner small" /> : <button className="btn text small" onClick={loadOlder}>הודעות קודמות</button>}</div>
            )}
            {items.map((m, i) => {
              const prev = items[i - 1];
              const newDay = !prev || dayLabel(prev.createdAt) !== dayLabel(m.createdAt);
              const unreadHere = firstUnreadId === m.id;
              const grouped =
                !newDay && !unreadHere && !!prev && !m.anonymous && !prev.anonymous && prev.authorId === m.authorId && !m.quote &&
                new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() < GROUP_MS;
              return (
                <div key={m.id}>
                  {newDay && <DaySeparator label={dayLabel(m.createdAt)} />}
                  {unreadHere && <div className="unread-sep"><span>הודעות חדשות</span></div>}
                  <MessageRow
                    authorId={m.authorId}
                    anonymous={m.anonymous}
                    mine={m.mine}
                    createdAt={m.createdAt}
                    editedAt={m.editedAt}
                    deleted={m.deleted}
                    body={m.body}
                    grouped={grouped}
                    highlight={highlightId === m.id}
                    quote={
                      m.quote ? (
                        <div className="quote">
                          <Icon name="reply" size={14} className="icon-flip" />
                          <strong>{m.quote.name}</strong>
                          <span>{m.quote.text}</span>
                        </div>
                      ) : undefined
                    }
                    footer={
                      m.likes && m.likes.count > 0 && onLike ? (
                        <div className="row-foot">
                          <LikeChip count={m.likes.count} liked={m.likes.liked} onClick={() => onLike(m)} disabled={m.mine} />
                        </div>
                      ) : undefined
                    }
                    actions={actionsFor(m)}
                  />
                </div>
              );
            })}
          </>
        )}
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
    </div>
  );
}
