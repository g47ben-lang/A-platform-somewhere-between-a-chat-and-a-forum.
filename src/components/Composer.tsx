import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import Icon from './Icon';

export interface SendOptions {
  anonymous: boolean;
  title: string;
}

export interface ComposerHandle {
  focus: () => void;
  setText: (t: string) => void;
}

interface Props {
  placeholder: string;
  onSend: (text: string, opts: SendOptions) => Promise<boolean>;
  allowAnonymous?: boolean;
  allowTitle?: boolean;
  context?: ReactNode;
  onCancelContext?: () => void;
  disabledReason?: string;
  maxLength?: number;
  submitLabel?: string;
}

const isTouch = () => typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;

const Composer = forwardRef<ComposerHandle, Props>(function Composer(
  { placeholder, onSend, allowAnonymous, allowTitle, context, onCancelContext, disabledReason, maxLength = 4000, submitLabel = 'שליחה' },
  ref,
) {
  const [text, setText] = useState('');
  const [title, setTitle] = useState('');
  const [showTitle, setShowTitle] = useState(false);
  const [anonymous, setAnonymous] = useState(false);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);

  useImperativeHandle(ref, () => ({
    focus: () => input.current?.focus(),
    setText: (t: string) => {
      setText(t);
      setTimeout(() => input.current?.focus(), 0);
    },
  }));

  // Grow with content up to a cap (field-sizing is not supported everywhere yet).
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
  }, [text]);

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

  const canSend = !busy && (text.trim().length > 0 || (showTitle && title.trim().length > 0));

  async function send() {
    if (!canSend) return;
    setBusy(true);
    const ok = await onSend(text.trim(), { anonymous, title: showTitle ? title.trim() : '' });
    setBusy(false);
    if (ok) {
      setText('');
      setTitle('');
      setShowTitle(false);
    }
    input.current?.focus();
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
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
        {showTitle && (
          <input
            className="composer-title"
            placeholder="נושא (לא חובה)"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={150}
          />
        )}
        <textarea
          ref={input}
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
          placeholder={anonymous ? 'הודעה אנונימית' : placeholder}
          maxLength={maxLength}
        />
        <div className="composer-bar">
          <div className="composer-tools">
            {allowTitle && (
              <button
                type="button"
                className={`chip-toggle ${showTitle ? 'on' : ''}`}
                onClick={() => setShowTitle((v) => !v)}
                title="הוספת נושא"
              >
                <Icon name="title" size={18} />
                <span>נושא</span>
              </button>
            )}
            {allowAnonymous && (
              <button
                type="button"
                className={`chip-toggle ${anonymous ? 'on anon' : ''}`}
                onClick={() => setAnonymous((v) => !v)}
                title="פרסום בעילום שם"
                aria-pressed={anonymous}
              >
                <Icon name={anonymous ? 'visibility_off' : 'visibility'} size={18} />
                <span>{anonymous ? 'אנונימי' : 'בשמי'}</span>
              </button>
            )}
          </div>
          <button className="send-btn" onClick={send} disabled={!canSend} aria-label={submitLabel} title={submitLabel}>
            <Icon name="send" filled size={20} />
          </button>
        </div>
      </div>
    </div>
  );
});

export default Composer;
