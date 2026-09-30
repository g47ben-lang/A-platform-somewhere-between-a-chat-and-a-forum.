import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../AppContext';
import { supabase } from '../supabase';
import { useSignedUrl } from '../lib/media';
import type { Attachment } from '../types';
import Icon from './Icon';

interface Highlight {
  kind: 'image' | 'quote';
  message_id: number;
  channel_id: number;
  author_id: string | null;
  anonymous: boolean;
  body: string;
  attachment: Attachment | null;
  score: number;
}

const HIDE_KEY = 'highlights-hidden';

/** "מבזק השבוע": the week's top image/meme and top quote, chosen by likes and reactions. */
export default function Highlights() {
  const { rooms, nameOf } = useApp();
  const [items, setItems] = useState<Highlight[]>([]);
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem(HIDE_KEY) ?? '';
    } catch {
      return '';
    }
  });

  useEffect(() => {
    supabase.rpc('weekly_highlights').then(({ data }) => setItems((data as Highlight[]) ?? []));
  }, []);

  const key = items.map((i) => i.message_id).join(',');
  if (!items.length || hidden === key) return null;

  const link = (h: Highlight) => {
    const r = rooms.find((x) => x.id === h.channel_id);
    return r && !r.is_main ? `/room/${r.id}?m=${h.message_id}` : `/?m=${h.message_id}`;
  };
  const who = (h: Highlight) => (h.anonymous ? 'אנונימי' : nameOf(h.author_id));
  const image = items.find((i) => i.kind === 'image');
  const quote = items.find((i) => i.kind === 'quote');

  function hide() {
    setHidden(key);
    try {
      localStorage.setItem(HIDE_KEY, key);
    } catch {
      /* storage unavailable */
    }
  }

  return (
    <aside className="highlights" aria-label="מבזק השבוע">
      <span className="hl-label"><Icon name="newspaper" size={16} /> מבזק השבוע</span>
      {image && (
        <Link to={link(image)} className="hl-item hl-image">
          {image.attachment && <Thumb path={image.attachment.path} />}
          <span>
            <strong>תמונת השבוע</strong>
            <span className="muted">{who(image)}</span>
          </span>
        </Link>
      )}
      {quote && (
        <Link to={link(quote)} className="hl-item hl-quote">
          <Icon name="format_quote" size={18} />
          <span>
            <strong>ציטוט השבוע</strong>
            <span className="hl-text">"{quote.body}" <span className="muted">· {who(quote)}</span></span>
          </span>
        </Link>
      )}
      <button className="icon-btn small hl-close" onClick={hide} aria-label="הסתרת המבזק"><Icon name="close" size={16} /></button>
    </aside>
  );
}

function Thumb({ path }: { path: string }) {
  const url = useSignedUrl(path);
  return url ? <img src={url} alt="" /> : <span className="hl-thumb-empty" />;
}
