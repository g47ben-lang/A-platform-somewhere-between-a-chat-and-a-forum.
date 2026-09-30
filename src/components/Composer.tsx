import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ClipboardEvent, type KeyboardEvent, type ReactNode } from 'react';
import { uploadAttachment } from '../lib/media';
import type { Attachment } from '../types';
import EmojiPicker from './EmojiPicker';
import { useFeedback } from './Feedback';
import Icon from './Icon';

export interface SendOptions {
  anonymous: boolean;
  attachment: Attachment | null;
}

export interface ComposerHandle {
  focus: () => void;
  setText: (t: string) => void;
}

interface Props {
  placeholder: string;
  onSend: (text: string, opts: SendOptions) => Promise<boolean>;
  allowAnonymous?: boolean;
  context?: ReactNode;
  onCancelContext?: () => void;
  disabledReason?: string;
  maxLength?: number;
  /** Member names offered after typing "@". */
  mentionNames?: string[];
  onTyping?: (anonymous: boolean, stopped?: boolean) => void;
  /** Photos and short videos (not while editing). */
  allowAttachments?: boolean;
}

interface Pending {
  preview: string;
  kind: 'image' | 'video';
  attachment: Attachment | null;
}

const isTouch = () => typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;

const Composer = forwardRef<ComposerHandle, Props>(function Composer(
  { placeholder, onSend, allowAnonymous, context, onCancelContext, disabledReason, maxLength = 4000, mentionNames = [], onTyping, allowAttachments },
  ref,
) {
  const [text, setText] = useState('');
  const [anonymous, setAnonymous] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const [pick, setPick] = useState(0);
  const [pending, setPending] = useState<Pending | null>(null);
  const [emojiAt, setEmojiAt] = useState<{ x: number; y: number } | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const { toast } = useFeedback();

  useImperativeHandle(ref, () => ({
    focus: () => input.current?.focus(),
    setText: (t: string) => {
      setText(t);
      setTimeout(() => input.current?.focus(), 0);
    },
  }));

  useEffect(() => {
    if (!allowAnonymous) setAnonymous(false);
  }, [allowAnonymous]);

  // Grow with content up to a cap.
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
  }, [text]);

  const suggestions = mention
    ? mentionNames.filter((n) => n.startsWith(mention.query) || n.includes(' ' + mention.query)).slice(0, 6)
    : [];

  if (disabledReason) {
    return (
      <div className="composer-wrap">
        <div className="composer disabled">
          <Icon name="lock" size={18} />
          <span>{disabledReason}</span>
        </div>
      </div>
    );
  }

  const uploading = !!pending && !pending.attachment;
  const canSend = !busy && !uploading && (text.trim().length > 0 || !!pending?.attachment);

  async function send() {
    if (!canSend) return;
    setBusy(true);
    const ok = await onSend(text.trim(), { anonymous, attachment: pending?.attachment ?? null });
    setBusy(false);
    if (ok) {
      setText('');
      setMention(null);
      clearPending();
      onTyping?.(anonymous, true);
    }
    input.current?.focus();
  }

  function clearPending() {
    if (pending) URL.revokeObjectURL(pending.preview);
    setPending(null);
  }

  async function attach(file: File | undefined) {
    if (!file) return;
    const kind = file.type.startsWith('video/') ? 'video' : 'image';
    const preview = URL.createObjectURL(file);
    setPending({ preview, kind, attachment: null });
    try {
      const attachment = await uploadAttachment(file);
      setPending((p) => (p && p.preview === preview ? { ...p, attachment } : p));
    } catch (err) {
      URL.revokeObjectURL(preview);
      setPending((p) => (p && p.preview === preview ? null : p));
      toast((err as Error).message, 'error');
    }
  }

  function onPaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    if (!allowAttachments) return;
    const file = [...e.clipboardData.files].find((f) => f.type.startsWith('image/') || f.type.startsWith('video/'));
    if (file) {
      e.preventDefault();
      attach(file);
    }
  }

  function insertEmoji(emoji: string) {
    const el = input.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    const next = text.slice(0, start) + emoji + text.slice(end);
    setText(next);
    setTimeout(() => {
      el?.focus();
      el?.setSelectionRange(start + emoji.length, start + emoji.length);
    }, 0);
  }

  function onChange(value: string, caret: number) {
    setText(value);
    const before = value.slice(0, caret);
    const m = before.match(/(^|\s)@([^\s@]{0,20})$/);
    if (m && mentionNames.length) {
      setMention({ start: caret - m[2].length - 1, query: m[2] });
      setPick(0);
    } else {
      setMention(null);
    }
    if (value.trim()) onTyping?.(anonymous);
  }

  function insertMention(name: string) {
    if (!mention) return;
    const caretEnd = mention.start + 1 + mention.query.length;
    const next = text.slice(0, mention.start) + '@' + name + ' ' + text.slice(caretEnd);
    setText(next);
    setMention(null);
    const pos = mention.start + name.length + 2;
    setTimeout(() => {
      input.current?.focus();
      input.current?.setSelectionRange(pos, pos);
    }, 0);
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (suggestions.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setPick((p) => (p + (e.key === 'ArrowDown' ? 1 : suggestions.length - 1)) % suggestions.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        insertMention(suggestions[pick]);
        return;
      }
      if (e.key === 'Escape') {
        setMention(null);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && !isTouch()) {
      e.preventDefault();
      send();
    } else if (e.key === 'Escape' && onCancelContext) {
      onCancelContext();
    }
  }

  return (
    <div className="composer-wrap">
      {context && (
        <div className="composer-context">
          <div className="composer-context-text">{context}</div>
          {onCancelContext && (
            <button className="icon-btn small" onClick={onCancelContext} aria-label="ביטול">
              <Icon name="close" size={18} />
            </button>
          )}
        </div>
      )}
      <div className={`composer ${anonymous ? 'is-anon' : ''}`}>
        {pending && (
          <div className="attach-preview">
            <div className="attach-thumb">
              {pending.kind === 'video' ? <video src={pending.preview} muted /> : <img src={pending.preview} alt="" />}
              {!pending.attachment && <div className="attach-progress"><div className="spinner small" /></div>}
              {pending.kind === 'video' && pending.attachment && <span className="attach-badge"><Icon name="videocam" size={14} /></span>}
            </div>
            <button className="icon-btn small" onClick={clearPending} aria-label="הסרת הקובץ"><Icon name="close" size={18} /></button>
          </div>
        )}
        {suggestions.length > 0 && (
          <ul className="mention-list" role="listbox">
            {suggestions.map((n, i) => (
              <li key={n}>
                <button
                  className={i === pick ? 'on' : ''}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    insertMention(n);
                  }}
                  role="option"
                  aria-selected={i === pick}
                >
                  @{n}
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="composer-row">
          {allowAttachments && (
            <>
              <button type="button" className="anon-toggle" onClick={() => fileInput.current?.click()} title="צירוף תמונה או סרטון" aria-label="צירוף תמונה או סרטון" disabled={!!pending}>
                <Icon name="add_photo_alternate" size={20} />
              </button>
              <input
                ref={fileInput}
                type="file"
                accept="image/*,video/mp4,video/webm,video/quicktime"
                hidden
                onChange={(e) => {
                  attach(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
            </>
          )}
          <button
            type="button"
            className="anon-toggle"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setEmojiAt({ x: r.left + r.width / 2, y: r.top });
            }}
            title="אימוג'י"
            aria-label="אימוג'י"
          >
            <Icon name="mood" size={20} />
          </button>
          {allowAnonymous && (
            <button
              type="button"
              className={`anon-toggle ${anonymous ? 'on' : ''}`}
              onClick={() => setAnonymous((v) => !v)}
              title={anonymous ? 'שולח בעילום שם. לחיצה לשליחה בשמך' : 'שליחה בעילום שם'}
              aria-pressed={anonymous}
            >
              <Icon name="visibility_off" size={20} />
            </button>
          )}
          <textarea
            ref={input}
            rows={1}
            value={text}
            onChange={(e) => onChange(e.target.value, e.target.selectionStart)}
            onKeyDown={onKey}
            onPaste={onPaste}
            onBlur={() => setTimeout(() => setMention(null), 150)}
            placeholder={anonymous ? 'הודעה בעילום שם' : placeholder}
            maxLength={maxLength}
            aria-label={placeholder}
          />
          <button className="send-btn" onClick={send} disabled={!canSend} aria-label="שליחה" title="שליחה">
            <Icon name="send" filled size={20} />
          </button>
        </div>
      </div>
      {emojiAt && <EmojiPicker anchor={emojiAt} onClose={() => setEmojiAt(null)} onPick={(e) => { setEmojiAt(null); insertEmoji(e); }} />}
      {pending && <div className="upload-note">לפי התקנון: מעלים רק תכנים התואמים את מדיניות נטפרי.</div>}
      {anonymous && <div className="anon-hint">ההודעה תופיע בשם "אנונימי". החברים והמנהלים לא יראו מי שלח; רק מנהל-העל יכול לדעת, למקרי חירום בלבד.</div>}
    </div>
  );
});

export default Composer;
