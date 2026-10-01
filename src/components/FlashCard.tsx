import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../AppContext';
import { supabase } from '../supabase';
import { timeAgo } from '../lib/format';
import type { FlashData } from '../types';
import Icon from './Icon';

/**
 * A news flash (מבזק) drawn as styled text, not an image, so content filters (NetFree) show it at once.
 * Used in the chat, in the flash maker's preview and in the main room banner's strip.
 */
export default function FlashCard({ f, compact, at }: { f: FlashData; compact?: boolean; at?: string }) {
  const date = new Intl.DateTimeFormat('he-u-ca-hebrew', { day: 'numeric', month: 'long' }).format(at ? new Date(at) : new Date());
  return (
    <div className={`flash-card t-${f.t} ${compact ? 'compact' : ''}`} dir="rtl">
      {f.t === 'flash' && <div className="fc-band">{f.title || 'מבזק'}</div>}
      {f.t === 'notice' && <div className="fc-notice-title">{f.title}</div>}
      {f.t === 'quote' && <div className="fc-head">{f.title || 'ציטוט השבוע'}</div>}
      {f.t === 'qa' && (
        <>
          <div className="fc-head">שאלה:</div>
          <div className="fc-question">{f.title}</div>
          <div className="fc-head">תשובה:</div>
        </>
      )}
      <div className="fc-text">{f.t === 'quote' && <span className="fc-mark">”</span>}{f.text}</div>
      {f.sign && <div className="fc-sign">{f.t === 'quote' ? '— ' : ''}{f.sign}</div>}
      {!compact && (
        <div className="fc-foot">
          <span>{date}</span>
          <span>מערכת ועד קמ"ד</span>
        </div>
      )}
    </div>
  );
}

interface Row {
  id: number;
  channel_id: number;
  author_id: string | null;
  flash: FlashData;
  created_at: string;
  likes: number;
}

/**
 * All recent news flashes from every room, as a sliding strip of cards. `inline`: small cards that fit the empty
 * space in the top row of the main room's blue banner (between the title and the buttons), no heading.
 */
export function FlashStrip({ inline }: { inline?: boolean }) {
  const { rooms, nameOf } = useApp();
  const [rows, setRows] = useState<Row[]>([]);
  const track = useRef<HTMLDivElement>(null);

  useEffect(() => {
    supabase.rpc('recent_flashes', { p_limit: 30 }).then(({ data }) => setRows((data as Row[]) ?? []));
  }, []);

  if (!rows.length) return null;
  const link = (r: Row) => {
    const room = rooms.find((x) => x.id === r.channel_id);
    return room && !room.is_main ? `/room/${room.id}?m=${r.id}` : `/?m=${r.id}`;
  };
  // RTL: the "next" arrow scrolls toward the end (left).
  const slide = (dir: 1 | -1) => track.current?.scrollBy({ left: -dir * track.current.clientWidth * 0.8, behavior: 'smooth' });

  if (inline) {
    return (
      <section className="flash-inline" aria-label="המבזקים">
        <button className="icon-btn small fi-arrow" onClick={() => slide(-1)} aria-label="הקודמים"><Icon name="chevron_right" size={18} /></button>
        <div className="fi-track" ref={track}>
          {rows.map((r) => (
            <Link key={r.id} to={link(r)} className={`fi-card t-${r.flash.t}`} title={`${r.flash.title}: ${r.flash.text}`}>
              <strong>{r.flash.t === 'qa' ? 'שו"ת' : r.flash.title || 'מבזק'}</strong>
              <span>{r.flash.t === 'qa' ? r.flash.title : r.flash.text}</span>
              <small>{nameOf(r.author_id)} · {timeAgo(r.created_at)}</small>
            </Link>
          ))}
        </div>
        <button className="icon-btn small fi-arrow" onClick={() => slide(1)} aria-label="הבאים"><Icon name="chevron_left" size={18} /></button>
      </section>
    );
  }

  return (
    <section className="flash-strip" aria-label="כל המבזקים">
      <div className="flash-strip-head">
        <span className="hl-label"><Icon name="newspaper" size={16} /> כל המבזקים</span>
        <div className="row">
          <button className="icon-btn small" onClick={() => slide(-1)} aria-label="הקודמים"><Icon name="chevron_right" size={20} /></button>
          <button className="icon-btn small" onClick={() => slide(1)} aria-label="הבאים"><Icon name="chevron_left" size={20} /></button>
        </div>
      </div>
      <div className="flash-track" ref={track}>
        {rows.map((r) => (
          <Link key={r.id} to={link(r)} className="flash-slide">
            <FlashCard f={r.flash} compact />
            <span className="flash-meta">
              {nameOf(r.author_id)} · {timeAgo(r.created_at)}
              {r.likes > 0 && <> · <Icon name="thumb_up" size={12} filled /> {r.likes}</>}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
