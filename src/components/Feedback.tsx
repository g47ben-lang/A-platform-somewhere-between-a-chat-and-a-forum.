import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import Icon from './Icon';

interface ConfirmOptions {
  title: string;
  body?: string;
  confirmLabel?: string;
  danger?: boolean;
}

interface FeedbackApi {
  confirm: (o: ConfirmOptions) => Promise<boolean>;
  toast: (text: string, kind?: 'info' | 'error') => void;
}

const Ctx = createContext<FeedbackApi | null>(null);

export function useFeedback(): FeedbackApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('useFeedback outside FeedbackProvider');
  return v;
}

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [dialog, setDialog] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null);
  const [toasts, setToasts] = useState<{ id: number; text: string; kind: 'info' | 'error' }[]>([]);
  const nextId = useRef(1);

  const confirm = useCallback(
    (o: ConfirmOptions) => new Promise<boolean>((resolve) => setDialog({ ...o, resolve })),
    [],
  );

  const toast = useCallback((text: string, kind: 'info' | 'error' = 'info') => {
    const id = nextId.current++;
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 6000 : 3500);
  }, []);

  const close = (v: boolean) => {
    dialog?.resolve(v);
    setDialog(null);
  };

  return (
    <Ctx.Provider value={{ confirm, toast }}>
      {children}
      {dialog && (
        <div className="scrim" onMouseDown={() => close(false)}>
          <div className="dialog" role="alertdialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
            <h2>{dialog.title}</h2>
            {dialog.body && <p className="dialog-body">{dialog.body}</p>}
            <div className="dialog-actions">
              <button className="btn text" onClick={() => close(false)}>ביטול</button>
              <button className={`btn ${dialog.danger ? 'danger-filled' : 'filled'}`} onClick={() => close(true)} autoFocus>
                {dialog.confirmLabel ?? 'אישור'}
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {t.kind === 'error' && <Icon name="error" size={20} />}
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return (
    <div className="scrim" onMouseDown={onClose}>
      <div className={`dialog ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
        <div className="dialog-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="סגירה">
            <Icon name="close" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
