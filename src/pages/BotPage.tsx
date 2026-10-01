import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useApp } from '../AppContext';
import { supabase } from '../supabase';
import { subscribe } from '../lib/realtime';
import { clockTime, errorText } from '../lib/format';
import { useFeedback } from '../components/Feedback';
import Icon from '../components/Icon';
import RichText from '../components/RichText';

export const BOT_NAME = 'סנדר';

interface BotMessage {
  id: number;
  role: 'user' | 'bot';
  body: string;
  claim_id: number | null;
  from_id: string | null;
  created_at: string;
}

/** /bot: my private conversation with the AI bot (Edge Function "bot"). */
export default function BotPage() {
  const { me } = useApp();
  const { toast } = useFeedback();
  const [list, setList] = useState<BotMessage[] | null>(null);
  const [claims, setClaims] = useState<Map<number, string>>(new Map());
  const [text, setText] = useState('');
  const [thinking, setThinking] = useState(false);
  // Wasting the bot (off topic, repeating) blocks him for a quarter of an hour.
  const [blockedUntil, setBlockedUntil] = useState<string | null>(null);
  const checkBlock = useCallback(async () => {
    const { data } = await supabase.rpc('bot_my_block');
    setBlockedUntil((data as string | null) ?? null);
  }, []);
  useEffect(() => {
    checkBlock();
  }, [checkBlock]);
  useEffect(() => {
    if (!blockedUntil) return;
    const t = setTimeout(checkBlock, Math.max(1000, new Date(blockedUntil).getTime() - Date.now() + 1000));
    return () => clearTimeout(t);
  }, [blockedUntil, checkBlock]);
  const blocked = !!blockedUntil && new Date(blockedUntil) > new Date();
  const end = useRef<HTMLDivElement>(null);

  const loadClaims = useCallback(async () => {
    const { data } = await supabase.rpc('bot_claims_about_me');
    setClaims(new Map(((data as { id: number; status: string }[]) ?? []).map((c) => [c.id, c.status])));
  }, []);

  const load = useCallback(async () => {
    const { data } = await supabase.from('bot_messages').select('*').eq('user_id', me!.id).order('id', { ascending: false }).limit(200);
    setList(((data as BotMessage[]) ?? []).reverse());
  }, [me]);

  useEffect(() => {
    if (!me) return;
    load();
    loadClaims();
    return subscribe(`bot-${me.id}`, (ch) =>
      ch.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'bot_messages', filter: `user_id=eq.${me.id}` }, (p) => {
        const m = p.new as BotMessage;
        setList((prev) => (prev && !prev.some((x) => x.id === m.id) ? [...prev, m] : prev));
        if (m.claim_id) loadClaims();
      }),
    );
  }, [me, load, loadClaims]);

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [list, thinking]);

  async function send(e?: FormEvent) {
    e?.preventDefault();
    const body = text.trim();
    if (!body || thinking) return;
    const { data: id, error } = await supabase.rpc('bot_send', { p_body: body });
    if (error) {
      checkBlock();
      return toast(errorText(error), 'error');
    }
    setText('');
    setList((prev) => (prev && !prev.some((x) => x.id === id) ? [...prev, { id: id as number, role: 'user', body, claim_id: null, from_id: null, created_at: new Date().toISOString() }] : prev));
    setThinking(true);
    const { error: fnError } = await supabase.functions.invoke('bot', { body: { mode: 'chat' } });
    setThinking(false);
    if (fnError) toast(`${BOT_NAME} לא זמין כרגע. אולי עוד לא הוגדר מפתח AI.`, 'error');
    load();
    checkBlock();
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  async function answer(claimId: number, allow: boolean) {
    const { error } = await supabase.rpc('bot_answer_claim', { p_claim: claimId, p_allow: allow });
    if (error) return toast(errorText(error), 'error');
    loadClaims();
  }

  return (
    <section className="pane chat-pane">
      <header className="pane-head">
        <span className="bot-avatar"><Icon name="smart_toy" size={24} /></span>
        <div className="pane-titles">
          <h1>{BOT_NAME}</h1>
          <p>הבוט של הוועד: נייעס, פאנצ'ים ומה קורה בצ'אט</p>
        </div>
      </header>
      <div className="notice bot-notice">
        <Icon name="lock" size={18} />
        <span>
          על חבר סנדר מספר רק מה שהחבר כתב בעצמו בצ'אט, או מה שהחבר אישר לספר, ואף פעם לא ממי שמע. הוא לא רואה צ'אטים אישיים. ההודעות
          כאן נשלחות לשירות ה-AI של Google כדי לענות, ולכן לא כותבים פה דברים פרטיים. מנהל-העל רואה מדגם מהשיחות עם סנדר, וסנדר מדווח לו על דברים חריגים (למשל ניסיון לברר מי כתב אנונימית, בריונות או מצוקה).
        </span>
      </div>
      <div className="stream bubbles bot-stream">
        <div className="stream-inner">
          {list === null ? (
            <div className="spinner" />
          ) : (
            <>
              {list.length === 0 && (
                <div className="dm-intro">
                  <span className="bot-avatar large"><Icon name="smart_toy" size={40} /></span>
                  <h2>{BOT_NAME}</h2>
                  <p className="muted">
                    שואלים אותו מה הנייעס, מה חבר כתב בצ'אט, מבקשים שיעביר שאלה לחבר ("תשאל את... אם...") או סתם פאנץ'.
                    הוא מדבר רק על הצ'אט והוועד. מי שמבזבז לו את הזמן נחסם לרבע שעה.
                  </p>
                </div>
              )}
              {list.map((m) => {
                const status = m.claim_id ? claims.get(m.claim_id) : undefined;
                return (
                  <div key={m.id} className={`b-row ${m.role === 'user' ? 'mine' : 'theirs'}`}>
                    <div className="b-col">
                      <div className="b-line">
                        <div className={`bubble ${m.from_id ? 'relay' : ''}`}>
                          <div className="b-text"><RichText text={m.body} names={[]} /></div>
                          {m.claim_id && status === 'pending' && (
                            <div className="row gap claim-actions">
                              <button className="btn tonal small" onClick={() => answer(m.claim_id!, true)}>מותר לספר</button>
                              <button className="btn outlined small" onClick={() => answer(m.claim_id!, false)}>לא, תשאיר אצלך</button>
                            </div>
                          )}
                          {m.claim_id && status && status !== 'pending' && (
                            <div className="muted small">{status === 'allowed' ? 'אישרת לספר' : 'ביקשת לא לספר'}</div>
                          )}
                          <div className="b-meta"><time>{clockTime(m.created_at)}</time></div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </>
          )}
          {thinking && (
            <div className="typing-line"><span className="dots"><i /><i /><i /></span>{BOT_NAME} כותב…</div>
          )}
          <div ref={end} />
        </div>
      </div>
      <div className="composer-wrap">
        {blocked ? (
          <div className="composer disabled">
            <Icon name="hourglass_top" size={20} />
            <span className="grow">
              {BOT_NAME} עסוק עכשיו בנייעס עם חבר'ה אחרים. אפשר לכתוב לו שוב בשעה{' '}
              {new Date(blockedUntil!).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}.
            </span>
          </div>
        ) : (
        <form className="composer" onSubmit={send}>
          <div className="composer-row">
            <textarea rows={1} value={text} maxLength={1000} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} placeholder="מה הנייעס?" />
            <button className="send-btn" disabled={!text.trim() || thinking} aria-label="שליחה" title="שליחה"><Icon name="send" filled size={20} /></button>
          </div>
        </form>
        )}
      </div>
    </section>
  );
}
