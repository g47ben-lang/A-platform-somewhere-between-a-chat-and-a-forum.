import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { EMOJI_CATEGORIES, recentEmoji, rememberEmoji, searchEmoji } from '../lib/emoji';
import Icon from './Icon';

interface Props {
  /** Screen point the picker opens next to. */
  anchor: { x: number; y: number };
  onPick: (emoji: string) => void;
  onClose: () => void;
}

/** Full emoji picker: recent, categories, Hebrew search. Popover on desktop, bottom sheet on phones. */
export default function EmojiPicker({ anchor, onPick, onClose }: Props) {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<string>('recent');
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const recent = recentEmoji();

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const left = Math.min(Math.max(8, anchor.x - w / 2), window.innerWidth - w - 8);
    const top = anchor.y - h - 8 > 8 ? anchor.y - h - 8 : Math.min(anchor.y + 8, window.innerHeight - h - 8);
    setPos({ left, top });
  }, [anchor]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function pick(e: string) {
    rememberEmoji(e);
    onPick(e);
  }

  function jump(id: string) {
    setCat(id);
    setQ('');
    body.current?.querySelector(`[data-cat="${id}"]`)?.scrollIntoView({ block: 'start' });
  }

  const results = q.trim() ? searchEmoji(q) : null;

  return (
    <div className="card-layer" onMouseDown={onClose}>
      <div
        ref={ref}
        className="emoji-picker"
        style={pos ?? { visibility: 'hidden', left: 0, top: 0 }}
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="בחירת אימוג'י"
      >
        <div className="emoji-search">
          <Icon name="search" size={18} />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="חיפוש אימוג'י (למשל: שמחה, ספר, חנוכה)" />
        </div>
        <div className="emoji-tabs" role="tablist">
          {recent.length > 0 && (
            <button className={cat === 'recent' ? 'on' : ''} onClick={() => jump('recent')} title="אחרונים" role="tab">
              <Icon name="schedule" size={18} />
            </button>
          )}
          {EMOJI_CATEGORIES.map((c) => (
            <button key={c.id} className={cat === c.id ? 'on' : ''} onClick={() => jump(c.id)} title={c.label} role="tab">
              {c.icon}
            </button>
          ))}
        </div>
        <div className="emoji-body" ref={body}>
          {results ? (
            results.length ? (
              <div className="emoji-grid">{results.map((e) => <button key={e} onClick={() => pick(e)}>{e}</button>)}</div>
            ) : (
              <div className="emoji-empty">לא נמצא אימוג'י מתאים</div>
            )
          ) : (
            <>
              {recent.length > 0 && (
                <section data-cat="recent">
                  <h4>אחרונים</h4>
                  <div className="emoji-grid">{recent.map((e) => <button key={e} onClick={() => pick(e)}>{e}</button>)}</div>
                </section>
              )}
              {EMOJI_CATEGORIES.map((c) => (
                <section key={c.id} data-cat={c.id}>
                  <h4>{c.label}</h4>
                  <div className="emoji-grid">
                    {c.items.map(([e, words]) => (
                      <button key={c.id + e} onClick={() => pick(e)} title={words.split(' ')[0]}>{e}</button>
                    ))}
                  </div>
                </section>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
