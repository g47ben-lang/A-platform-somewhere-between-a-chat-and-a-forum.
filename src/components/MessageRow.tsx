import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../AppContext';
import { clockTime, fullDate } from '../lib/format';
import Avatar from './Avatar';
import Icon, { type IconName } from './Icon';
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
  title?: string | null;
  body: string | null;
  grouped?: boolean;
  quote?: ReactNode;
  footer?: ReactNode;
  actions?: RowAction[];
  highlight?: boolean;
  onClick?: () => void;
}

export default function MessageRow({
  authorId, anonymous, mine, createdAt, editedAt, deleted, title, body, grouped, quote, footer, actions, highlight, onClick,
}: Props) {
  const { profiles, online, nameOf } = useApp();
  const author = authorId ? profiles.get(authorId) : undefined;
  const isAnon = anonymous || !authorId;

  const name = isAnon ? (
    <span className="author anon-author">אנונימי{mine && <span className="you-tag">שלך</span>}</span>
  ) : (
    <Link to={`/u/${authorId}`} className="author">{nameOf(authorId)}</Link>
  );

  return (
    <div className={`row-msg ${grouped ? 'grouped' : ''} ${highlight ? 'highlight' : ''} ${onClick ? 'clickable' : ''}`} onClick={onClick}>
      <div className="row-gutter">
        {grouped ? (
          <span className="row-hover-time">{clockTime(createdAt)}</span>
        ) : isAnon ? (
          <Avatar anonymous size={36} />
        ) : (
          <Link to={`/u/${authorId}`} onClick={(e) => e.stopPropagation()} tabIndex={-1}>
            <Avatar id={authorId} name={author?.display_name} size={36} online={online.has(authorId!)} />
          </Link>
        )}
      </div>
      <div className="row-main">
        {!grouped && (
          <div className="row-head">
            {name}
            {author && author.role !== 'member' && (
              <span className="role-tag">{author.role === 'admin' ? 'מנהל/ת' : 'מנחה'}</span>
            )}
            <time className="row-time" title={fullDate(createdAt)}>{clockTime(createdAt)}</time>
          </div>
        )}
        {quote}
        {title && !deleted && <div className="row-title">{title}</div>}
        {deleted ? (
          <div className="row-body deleted">
            <Icon name="block" size={16} /> ההודעה נמחקה
          </div>
        ) : (
          body && (
            <div className="row-body">
              <RichText text={body} />
              {editedAt && <span className="edited">(נערך)</span>}
            </div>
          )
        )}
        {footer}
      </div>
      {actions && actions.length > 0 && !deleted && (
        <div className="row-actions" onClick={(e) => e.stopPropagation()}>
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
  if (count === 0 && disabled) return null;
  return (
    <button
      className={`like-chip ${liked ? 'on' : ''}`}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      disabled={disabled}
      title={disabled ? 'אי אפשר לסמן לייק לתוכן שלך' : liked ? 'ביטול לייק' : 'לייק'}
    >
      <Icon name="thumb_up" filled={liked} size={16} />
      {count > 0 && <span>{count}</span>}
    </button>
  );
}
