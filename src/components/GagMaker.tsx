import { useEffect, useRef, useState } from 'react';
import { useApp } from '../AppContext';
import { supabase } from '../supabase';
import { errorText } from '../lib/format';
import { uploadAttachment } from '../lib/media';
import type { MemberStats } from '../types';
import { Modal, useFeedback } from './Feedback';
import Icon from './Icon';

const MIN_REPUTATION = 50; // must match gag_min_reputation() in schema.sql

type Template = 'flash' | 'quote' | 'notice' | 'qa';
const TEMPLATES: { id: Template; label: string; title: string; text: string; sign: string }[] = [
  { id: 'flash', label: 'מבזק', title: 'מבזק', text: 'מה קרה?', sign: '' },
  { id: 'quote', label: 'ציטוט השבוע', title: 'ציטוט השבוע', text: 'הציטוט', sign: 'מי אמר' },
  { id: 'notice', label: 'הודעה לציבור', title: 'הודעה לציבור הבחורים', text: 'תוכן ההודעה', sign: 'בברכה, ' },
  { id: 'qa', label: 'שו"ת', title: 'שאלה', text: 'תשובה', sign: '' },
];

const W = 1080;
const H = 1080;

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > maxWidth && line) {
        lines.push(line);
        line = word;
      } else line = test;
    }
    lines.push(line);
  }
  return lines;
}

/** Draws a template onto the canvas: clean, newspaper-like cards (RTL). */
function draw(c: HTMLCanvasElement, t: Template, title: string, text: string, sign: string) {
  const ctx = c.getContext('2d')!;
  ctx.direction = 'rtl';
  ctx.textAlign = 'right';
  const font = (w: number, px: number) => `${w} ${px}px Heebo, Arial, sans-serif`;
  const pad = 80;
  const date = new Intl.DateTimeFormat('he-u-ca-hebrew', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());

  ctx.fillStyle = t === 'notice' ? '#fbf8f1' : '#ffffff';
  ctx.fillRect(0, 0, W, H);
  if (t === 'flash') {
    ctx.fillStyle = '#b3261e';
    ctx.fillRect(0, 0, W, 190);
    ctx.fillStyle = '#fff';
    ctx.font = font(800, 110);
    ctx.fillText(title || 'מבזק', W - pad, 140);
  } else if (t === 'notice') {
    ctx.strokeStyle = '#1f1f1f';
    ctx.lineWidth = 6;
    ctx.strokeRect(40, 40, W - 80, H - 80);
    ctx.lineWidth = 2;
    ctx.strokeRect(58, 58, W - 116, H - 116);
    ctx.fillStyle = '#1f1f1f';
    ctx.font = font(800, 76);
    ctx.textAlign = 'center';
    ctx.fillText(title, W / 2, 190);
    ctx.textAlign = 'right';
  } else {
    ctx.fillStyle = '#0b57d0';
    ctx.fillRect(0, 0, W, 16);
    ctx.fillStyle = '#0b57d0';
    ctx.font = font(800, t === 'qa' ? 64 : 80);
    ctx.fillText(t === 'qa' ? 'שאלה:' : title || 'ציטוט השבוע', W - pad, 150);
  }

  // Body
  const bodyTop = t === 'flash' ? 320 : t === 'notice' ? 320 : t === 'qa' ? 250 : 330;
  let y = bodyTop;
  ctx.fillStyle = '#1f1f1f';
  if (t === 'qa') {
    ctx.font = font(600, 52);
    for (const l of wrap(ctx, title, W - 2 * pad).slice(0, 5)) { ctx.fillText(l, W - pad, y); y += 70; }
    y += 40;
    ctx.fillStyle = '#0b57d0';
    ctx.font = font(800, 64);
    ctx.fillText('תשובה:', W - pad, y);
    y += 90;
    ctx.fillStyle = '#1f1f1f';
  }
  const size = t === 'quote' ? 66 : 56;
  ctx.font = font(t === 'quote' ? 700 : 500, size);
  if (t === 'quote') {
    ctx.fillStyle = '#d3e3fd';
    ctx.font = font(800, 260);
    ctx.fillText('”', W - pad + 20, 330);
    ctx.fillStyle = '#1f1f1f';
    ctx.font = font(700, size);
  }
  if (t === 'notice') ctx.textAlign = 'center';
  const x = t === 'notice' ? W / 2 : W - pad;
  for (const l of wrap(ctx, text, W - 2 * pad - 40).slice(0, 10)) {
    ctx.fillText(l, x, y);
    y += size * 1.35;
  }
  ctx.textAlign = 'right';
  if (sign.trim()) {
    ctx.fillStyle = '#444746';
    ctx.font = font(600, 46);
    ctx.fillText((t === 'quote' ? '— ' : '') + sign, W - pad, Math.min(y + 50, H - 150));
  }
  // Footer
  ctx.fillStyle = '#747775';
  ctx.font = font(400, 32);
  ctx.fillText(date, W - pad, H - 80);
  ctx.textAlign = 'left';
  ctx.fillText('מערכת ועד קמ"ד', pad, H - 80);
}

/** News-flash maker: templates rendered to an image and posted as a "gag" message (reputation-gated). */
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
  const canvas = useRef<HTMLCanvasElement>(null);
  const exempt = me?.role === 'admin' || me?.role === 'inspector' || me?.role === 'moderator';

  useEffect(() => {
    supabase.rpc('member_stats').then(({ data }) => setRep(((data as MemberStats[]) ?? []).find((s) => s.id === me?.id)?.reputation ?? 0));
  }, [me?.id]);

  useEffect(() => {
    setTitle(tpl.title);
    setSign(tpl.sign);
  }, [t, tpl.title, tpl.sign]);

  useEffect(() => {
    if (!canvas.current) return;
    document.fonts.ready.then(() => canvas.current && draw(canvas.current, t, title, text || tpl.text, sign));
  }, [t, title, text, sign, tpl.text]);

  const locked = rep !== null && rep < MIN_REPUTATION && !exempt;

  async function send() {
    if (!canvas.current) return;
    setBusy(true);
    try {
      draw(canvas.current, t, title, text, sign);
      const blob = await new Promise<Blob>((res, rej) => canvas.current!.toBlob((b) => (b ? res(b) : rej(new Error('יצירת התמונה נכשלה'))), 'image/jpeg', 0.9));
      const att = await uploadAttachment(new File([blob], 'flash.jpg', { type: 'image/jpeg' }));
      const { error } = await supabase.rpc('send_gag', { p_channel: roomId, p_attachment: att, p_caption: '' });
      if (error) throw error;
      toast('המבזק פורסם');
      onSent();
      onClose();
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      setBusy(false);
    }
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
            <p className="muted small">המבזק מתפרסם כתמונה בחדר הנוכחי, ויכול להיכנס ל"מבזק השבוע" בראש הצ'אט.</p>
            <div className="dialog-actions">
              <button type="button" className="btn text" onClick={onClose}>ביטול</button>
              <button className="btn filled" disabled={busy || !text.trim() || rep === null} onClick={send}>{busy ? 'מפרסם…' : 'פרסום'}</button>
            </div>
          </div>
          <canvas ref={canvas} width={W} height={H} className="gag-preview" />
        </div>
      )}
    </Modal>
  );
}
