import { useEffect, useRef, useState, type FormEvent } from 'react';
import { supabase } from '../supabase';
import { errorText } from '../lib/format';
import { Modal, useFeedback } from './Feedback';
import Icon from './Icon';

interface Turn {
  role: 'owner' | 'claude';
  text: string;
}

/**
 * Owner-only: talk with Claude about one complaint and guide the fix. Claude proposes a rule each turn; the owner
 * can edit it and approve it (bot_rule_add). Nothing is saved before approval.
 */
export default function ComplaintChat({
  complaint,
  onClose,
  onSaved,
}: {
  complaint: { id: number; complaint: string; quote: string; suggestion: string };
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useFeedback();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [rule, setRule] = useState('');
  const [by, setBy] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);

  async function ask(next: Turn[]) {
    setBusy(true);
    const { data, error } = await supabase.functions.invoke('bot', { body: { mode: 'improve_chat', complaint_id: complaint.id, messages: next } });
    setBusy(false);
    const r = data as { reply?: string; rule?: string; by?: string; error?: string } | null;
    if (error || !r || r.error) return toast(r?.error ?? 'אין תשובה כרגע. נסה שוב עוד מעט.', 'error');
    setTurns([...next, { role: 'claude', text: r.reply ?? '' }]);
    if (r.rule) setRule(r.rule);
    setBy(r.by ?? '');
  }

  // Opening the dialog asks for a first opinion.
  useEffect(() => {
    ask([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [turns, busy]);

  function send(e: FormEvent) {
    e.preventDefault();
    if (!text.trim() || busy) return;
    // The first turn sent to the AI is the implicit opening question; keep the history the owner sees.
    const history: Turn[] = turns.length ? turns : [{ role: 'owner', text: 'מה דעתך על התלונה הזו, ואיזה תיקון אתה מציע?' }];
    const next: Turn[] = [...history, { role: 'owner', text: text.trim() }];
    setText('');
    setTurns(next);
    ask(next);
  }

  async function approve() {
    const { error } = await supabase.rpc('bot_rule_add', { p_complaint: complaint.id, p_rule: rule.trim() });
    if (error) return toast(errorText(error), 'error');
    toast('התיקון נוסף להוראות של הבוט');
    onSaved();
    onClose();
  }

  return (
    <Modal title={`תיקון התלונה עם ${by || 'Claude'}`} onClose={onClose} wide>
      <div className="complaint-chat">
        <div className="cc-complaint">
          <strong>התלונה:</strong> {complaint.complaint}
          {complaint.quote && <div className="muted small">הבוט ענה: "{complaint.quote}"</div>}
          {complaint.suggestion && <div className="muted small">הצעת הבוט: {complaint.suggestion}</div>}
        </div>
        <div className="cc-turns">
          {turns.map((t, i) => (
            <div key={i} className={`cc-turn ${t.role}`}>
              <span className="cc-who">{t.role === 'owner' ? 'אתה' : by || 'Claude'}</span>
              <span>{t.text}</span>
            </div>
          ))}
          {busy && <div className="typing-line"><span className="dots"><i /><i /><i /></span>{by || 'Claude'} חושב…</div>}
          <div ref={end} />
        </div>
        <form className="row gap" onSubmit={send}>
          <input className="grow search-input" value={text} onChange={(e) => setText(e.target.value)} placeholder="הנחיה לתיקון, למשל: תעשה את זה פחות חריף" />
          <button className="btn tonal small" disabled={busy || !text.trim()}><Icon name="send" size={16} /> שליחה</button>
        </form>
        <label className="field">
          <span>התיקון המוצע (אפשר לערוך לפני האישור)</span>
          <textarea rows={3} value={rule} onChange={(e) => setRule(e.target.value)} maxLength={600} />
        </label>
        <div className="dialog-actions">
          <button type="button" className="btn text" onClick={onClose}>סגירה בלי לשמור</button>
          <button type="button" className="btn filled" disabled={busy || rule.trim().length < 5} onClick={approve}>אישור והוספת התיקון</button>
        </div>
      </div>
    </Modal>
  );
}
