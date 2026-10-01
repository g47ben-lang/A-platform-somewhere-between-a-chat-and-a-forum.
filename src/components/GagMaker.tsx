import { useEffect, useState } from 'react';
import { useApp } from '../AppContext';
import { supabase } from '../supabase';
import { errorText } from '../lib/format';
import type { MemberStats } from '../types';
import { Modal, useFeedback } from './Feedback';
import Icon from './Icon';
import FlashCard from './FlashCard';

const MIN_REPUTATION = 50; // must match gag_min_reputation() in schema.sql

type Template = 'flash' | 'quote' | 'notice' | 'qa';
const TEMPLATES: { id: Template; label: string; title: string; text: string; sign: string }[] = [
  { id: 'flash', label: 'מבזק', title: 'מבזק', text: 'מה קרה?', sign: '' },
  { id: 'quote', label: 'ציטוט השבוע', title: 'ציטוט השבוע', text: 'הציטוט', sign: 'מי אמר' },
  { id: 'notice', label: 'הודעה לציבור', title: 'הודעה לציבור הבחורים', text: 'תוכן ההודעה', sign: 'בברכה, ' },
  { id: 'qa', label: 'שו"ת', title: 'שאלה', text: 'תשובה', sign: '' },
];

/** News-flash maker: templates posted as text cards (send_flash, reputation-gated; no image, so NetFree shows them at once). */
export default function GagMaker({ roomId, onClose, onSent }: { roomId: number; onClose: () => void; onSent: () => void }) {
  const { me } = useApp();
  const { toast } = useFeedback();
  const [t, setT] = useState<Template>('flash');
  const tpl = TEMPLATES.find((x) => x.id === t)!;
  const [title, setTitle] = useState(tpl.title);
  const [text, setText] = useState('');
  const [sign, setSign] = useState('');
  const [rep, setRep] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [writing, setWriting] = useState(false);
  const exempt = me?.role === 'admin' || me?.role === 'inspector' || me?.role === 'moderator';

  useEffect(() => {
    supabase.rpc('member_stats').then(({ data }) => setRep(((data as MemberStats[]) ?? []).find((s) => s.id === me?.id)?.reputation ?? 0));
  }, [me?.id]);

  useEffect(() => {
    setTitle(tpl.title);
    setSign(tpl.sign);
  }, [t, tpl.title, tpl.sign]);

  const locked = rep !== null && rep < MIN_REPUTATION && !exempt;

  async function send() {
    setBusy(true);
    const { error } = await supabase.rpc('send_flash', { p_channel: roomId, p_template: t, p_title: title, p_text: text, p_sign: t === 'flash' || t === 'qa' ? '' : sign });
    setBusy(false);
    if (error) return toast(errorText(error), 'error');
    toast('המבזק פורסם');
    onSent();
    onClose();
  }

  // The AI bot writes (or polishes) the flash from the idea in the text box.
  async function aiWrite() {
    setWriting(true);
    const { data, error } = await supabase.functions.invoke('bot', { body: { mode: 'gag', template: t, idea: text || title } });
    setWriting(false);
    const r = data as { title?: string; text?: string; sign?: string; error?: string } | null;
    if (error || !r || r.error) return toast(r?.error ?? 'נייעסניק לא זמין כרגע', 'error');
    if (r.title) setTitle(r.title);
    if (r.text) setText(r.text);
    if (r.sign !== undefined && t !== 'flash' && t !== 'qa') setSign(r.sign);
  }

  return (
    <Modal title="מחולל מבזקים" onClose={onClose} wide>
      {locked ? (
        <div className="gag-locked">
          <Icon name="lock" size={32} />
          <p><strong>מחולל המבזקים נפתח מ-{MIN_REPUTATION} נקודות מוניטין.</strong></p>
          <p className="muted">יש לך כרגע {rep}. כל לייק שמתקבל על הודעה שלך = 5 נקודות.</p>
        </div>
      ) : (
        <div className="gag-maker">
          <div className="gag-form form-stack">
            <div className="chip-row">
              {TEMPLATES.map((x) => (
                <button key={x.id} type="button" className={`chip ${t === x.id ? 'on' : ''}`} onClick={() => setT(x.id)}>{x.label}</button>
              ))}
            </div>
            <label className="field">
              <span>{t === 'qa' ? 'השאלה' : 'כותרת'}</span>
              <input value={title} maxLength={t === 'qa' ? 200 : 40} onChange={(e) => setTitle(e.target.value)} />
            </label>
            <label className="field">
              <span>{t === 'qa' ? 'התשובה' : t === 'quote' ? 'הציטוט' : 'הטקסט'}</span>
              <textarea rows={4} maxLength={400} value={text} onChange={(e) => setText(e.target.value)} placeholder={tpl.text} />
            </label>
            {t !== 'flash' && t !== 'qa' && (
              <label className="field">
                <span>{t === 'quote' ? 'מי אמר' : 'חתימה'}</span>
                <input value={sign} maxLength={40} onChange={(e) => setSign(e.target.value)} />
              </label>
            )}
            <button type="button" className="btn tonal small" onClick={aiWrite} disabled={writing}>
              <Icon name="smart_toy" size={18} /> {writing ? 'נייעסניק כותב…' : text.trim() ? 'שיפור עם נייעסניק' : 'כתוב לי (נייעסניק)'}
            </button>
            <p className="muted small">המבזק מתפרסם כטקסט מעוצב (לא כתמונה, כדי שנטפרי לא יעכב אותו) בחדר הנוכחי, ומופיע ב"כל המבזקים" בכותרת הכחולה של הצ'אט הראשי.</p>
            <div className="dialog-actions">
              <button type="button" className="btn text" onClick={onClose}>ביטול</button>
              <button className="btn filled" disabled={busy || !text.trim() || rep === null} onClick={send}>{busy ? 'מפרסם…' : 'פרסום'}</button>
            </div>
          </div>
          <div className="gag-preview-card">
            <FlashCard f={{ t, title, text: text || tpl.text, sign: t === 'flash' || t === 'qa' ? '' : sign }} />
          </div>
        </div>
      )}
    </Modal>
  );
}
