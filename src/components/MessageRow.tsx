import { useMemo, type ReactNode } from 'react';
import { useApp } from '../AppContext';
import { clockTime, fullDate } from '../lib/format';
import Avatar from './Avatar';
import Icon, { type IconName } from './Icon';
import { useProfileCard } from './ProfileCard';
import RichText from './RichText';

export interface RowAction {
  icon: IconName;
  label: string;
  onClick: () => void;
  active?: boolean;
  danger?: boolean;
}

interface Props {
  authorId: string | null;
  anonymous?: boolean;
  mine?: boolean;
  createdAt: string;
  editedAt?: string | null;
  deleted?: boolean;
  body: string | null;
  grouped?: boolean;
  quote?: ReactNode;
  footer?: ReactNode;
  actions?: RowAction[];
  highlight?: boolean;
}

export default function MessageRow({ authorId, anonymous, mine, createdAt, editedAt, deleted, body, grouped, quote, footer, actions, highlight }: Props) {
  const { profiles, online, nameOf, me } = useApp();
  const openCard = useProfileCard();
  const author = authorId ? profiles.get(authorId) : undefined;
  const isAnon = anonymous || !authorId;
  const names = useMemo(() => [...profiles.values()].filter((p) => p.status === 'active').map((p) => p.display_name), [profiles]);
  const mentionsMe = !!me && !!body && !mine && body.includes(`@${me.display_name}`);

  return (
    <div className={`row-msg ${grouped ? 'grouped' : ''} ${highlight ? 'highlight' : ''} ${mentionsMe ? 'mentioned' : ''}`}>
      <div className="row-gutter">
        {grouped ? (
          <span className="row-hover-time">{clockTime(createdAt)}</span>
        ) : isAnon ? (
          <Avatar anonymous size={36} />
        ) : (
          <button className="avatar-link" onClick={(e) => openCard(authorId!, e.currentTarget)} aria-label={nameOf(authorId)}>
            <Avatar id={authorId} name={author?.display_name} size={36} online={online.has(authorId!)} />
          </button>
        )}
      </div>
      <div className="row-main">
        {!grouped && (
          <div className="row-head">
            {isAnon ? (
              <span className="author anon-author">אנונימי{mine && <span className="you-tag">שלך</span>}</span>
            ) : (
              <button className="author" onClick={(e) => openCard(authorId!, e.currentTarget)}>{nameOf(authorId)}</button>
            )}
            {author && author.role !== 'member' && <span className="role-tag">{author.role === 'admin' ? 'מנהל/ת' : 'מנחה'}</span>}
            <time className="row-time" title={fullDate(createdAt)}>{clockTime(createdAt)}</time>
          </div>
        )}
        {quote}
        {deleted ? (
          <div className="row-body deleted">
            <Icon name="block" size={16} /> ההודעה נמחקה
          </div>
        ) : (
          body && (
            <div className="row-body">
              <RichText text={body} names={names} myName={me?.display_name} />
              {editedAt && <span className="edited">(נערך)</span>}
            </div>
          )
        )}
        {footer}
      </div>
      {actions && actions.length > 0 && !deleted && (
        <div className="row-actions">
          {actions.map((a) => (
            <button
              key={a.label}
              className={`icon-btn small ${a.active ? 'active' : ''} ${a.danger ? 'danger' : ''}`}
              onClick={a.onClick}
              title={a.label}
              aria-label={a.label}
            >
              <Icon name={a.icon} filled={a.active} size={18} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function DaySeparator({ label }: { label: string }) {
  return (
    <div className="day-sep" role="separator">
      <span>{label}</span>
    </div>
  );
}

export function LikeChip({ count, liked, onClick, disabled }: { count: number; liked: boolean; onClick: () => void; disabled?: boolean }) {
  if (count === 0) return null;
  return (
    <button
      className={`like-chip ${liked ? 'on' : ''}`}
      onClick={onClick}
      disabled={disabled}
      title={disabled ? 'אי אפשר לסמן לייק להודעה שלך' : liked ? 'ביטול לייק' : 'לייק'}
    >
      <Icon name="thumb_up" filled={liked} size={16} />
      <span>{count}</span>
    </button>
  );
}
