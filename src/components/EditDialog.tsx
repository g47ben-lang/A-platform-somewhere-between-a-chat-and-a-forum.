import { useState, type FormEvent } from 'react';
import { Modal } from './Feedback';

interface Props {
  heading: string;
  title?: string | null;
  withTitle?: boolean;
  body: string;
  onSave: (v: { title: string; body: string }) => Promise<boolean>;
  onClose: () => void;
}

export default function EditDialog({ heading, title, withTitle, body, onSave, onClose }: Props) {
  const [t, setT] = useState(title ?? '');
  const [b, setB] = useState(body);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const ok = await onSave({ title: t.trim(), body: b.trim() });
    setBusy(false);
    if (ok) onClose();
  }

  return (
    <Modal title={heading} onClose={onClose} wide>
      <form className="form-stack" onSubmit={submit}>
        {withTitle && (
          <label className="field">
            <span>נושא</span>
            <input value={t} onChange={(e) => setT(e.target.value)} maxLength={150} />
          </label>
        )}
        <label className="field">
          <span>תוכן</span>
          <textarea value={b} onChange={(e) => setB(e.target.value)} rows={6} maxLength={8000} autoFocus />
        </label>
        <div className="dialog-actions">
          <button type="button" className="btn text" onClick={onClose}>ביטול</button>
          <button className="btn filled" disabled={busy || (!b.trim() && !t.trim())}>שמירה</button>
        </div>
      </form>
    </Modal>
  );
}
