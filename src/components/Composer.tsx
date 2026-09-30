import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import Icon from './Icon';

export interface SendOptions {
  anonymous: boolean;
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
}

const isTouch = () => typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;

const Composer = forwardRef<ComposerHandle, Props>(function Composer(
  { placeholder, onSend, allowAnonymous, context, onCancelContext, disabledReason, maxLength = 4000, mentionNames = [], onTyping },
  ref,
) {
  const [text, setText] = useState('');
  const [anonymous, setAnonymous] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const [pick, setPick] = useState(0);
  const input = useRef<HTMLTextAreaElement>(null);

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

  const canSend = !busy && text.trim().length > 0;

  async function send() {
    if (!canSend) return;
    setBusy(true);
    const ok = await onSend(text.trim(), { anonymous });
    setBusy(false);
    if (ok) {
      setText('');
      setMention(null);
      onTyping?.(anonymous, true);
    }
    input.current?.focus();
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
          {allowAnonymous && (
            <button
              type="button"
              className={`anon-toggle ${anonymous ? 'on' : ''}`}
              onClick={() => setAnonymous((v) => !v)}
              title={anonymous ? 'שולח/ת בעילום שם. לחיצה לשליחה בשמך' : 'שליחה בעילום שם'}
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
      {anonymous && <div className="anon-hint">ההודעה תופיע בשם "אנונימי". אף אחד, כולל המנהלים, לא יראה מי שלח.</div>}
    </div>
  );
});

export default Composer;
