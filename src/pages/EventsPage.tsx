import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../AppContext';
import { supabase } from '../supabase';
import { errorText } from '../lib/format';
import { hebrewDayLetters, hebrewLabel, hebrewParts } from '../lib/hebrew';
import { subscribe } from '../lib/realtime';
import { Modal, useFeedback } from '../components/Feedback';
import Icon from '../components/Icon';

export type EventKind = 'yeshiva' | 'vaad' | 'simcha' | 'other';
export const KIND_LABEL: Record<EventKind, string> = { yeshiva: 'אירוע ישיבתי', vaad: 'אירוע ועד', simcha: 'שמחה', other: 'אחר' };

export interface CalEvent {
  id: number;
  title: string;
  description: string | null;
  starts_on: string;
  ends_on: string | null;
  kind: EventKind;
  created_by: string | null;
  editors: string[];
  message_id: number | null;
  status: 'approved' | 'conflict';
  conflict_with: number | null;
  escalated: boolean;
}

const WEEKDAYS = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'];
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const gregLabel = (s: string) => new Date(s + 'T12:00:00').toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long' });

export function dateLabel(e: Pick<CalEvent, 'starts_on' | 'ends_on'>) {
  const one = `${hebrewLabel(e.starts_on)} · ${gregLabel(e.starts_on)}`;
  return e.ends_on && e.ends_on !== e.starts_on ? `${one} – ${hebrewLabel(e.ends_on)}` : one;
}

/** Yeshiva calendar: month grid, upcoming list, adding events, and settling clashes. */
export default function EventsPage() {
  const { me, isAdmin, nameOf, isGuest } = useApp();
  const { toast } = useFeedback();
  const [events, setEvents] = useState<CalEvent[] | null>(null);
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [open, setOpen] = useState<CalEvent | null>(null);
  const [editing, setEditing] = useState<CalEvent | 'new' | null>(null);
  const [newDate, setNewDate] = useState<string | undefined>();

  const load = useCallback(async () => {
    const { data } = await supabase.from('events').select('*').order('starts_on');
    setEvents((data as CalEvent[]) ?? []);
  }, []);

  useEffect(() => {
    load();
    return subscribe('events', (ch) => ch.on('postgres_changes', { event: '*', schema: 'public', table: 'events' }, load));
  }, [load]);

  const byId = useMemo(() => new Map((events ?? []).map((e) => [e.id, e])), [events]);
  const today = iso(new Date());

  // Clashes that concern me: my new event waiting, someone clashing with my event, or (admins) all.
  const clashes = (events ?? []).filter((e) => {
    if (e.status !== 'conflict') return false;
    const orig = e.conflict_with ? byId.get(e.conflict_with) : undefined;
    return isAdmin || e.created_by === me?.id || orig?.created_by === me?.id;
  });

  async function resolve(e: CalEvent, action: string) {
    const { error } = await supabase.rpc('resolve_event', { p_id: e.id, p_action: action });
    if (error) return toast(errorText(error), 'error');
    toast(action === 'escalate' ? 'הועבר להכרעת המנהלים' : 'עודכן');
    load();
  }

  async function withdraw(e: CalEvent) {
    const { error } = await supabase.rpc('delete_event', { p_id: e.id });
    if (error) return toast(errorText(error), 'error');
    load();
  }

  // Month grid (Sunday first), padded to whole weeks.
  const cells = useMemo(() => {
    const first = new Date(month);
    const start = new Date(first);
    start.setDate(1 - first.getDay());
    const out: Date[] = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      out.push(d);
      if (i >= 34 && d.getMonth() !== month.getMonth() && d.getDay() === 6) break;
    }
    return out;
  }, [month]);

  const onDay = (d: string) =>
    (events ?? []).filter((e) => e.starts_on <= d && (e.ends_on ?? e.starts_on) >= d);
  const upcoming = (events ?? []).filter((e) => (e.ends_on ?? e.starts_on) >= today && e.status === 'approved').slice(0, 12);
  const hebMonths = [...new Set([cells[7], cells[cells.length - 8]].map((d) => hebrewParts(new Date(iso(d) + 'T12:00:00Z')).month))].join(' – ');

  return (
    <div className="pane scroll-pane">
      <div className="page">
        <header className="page-head polls-head">
          <div>
            <h1>לוח אירועים</h1>
            <p className="muted">כל בחור יכול להוסיף אירוע. אם אירוע כבר קיים בתאריך אחר או בשם דומה, בעל האירוע או המנהלים מכריעים.</p>
          </div>
          {!isGuest && <button className="btn filled" onClick={() => { setNewDate(undefined); setEditing('new'); }}>
            <Icon name="add" size={18} /> אירוע חדש
          </button>}
        </header>

        {clashes.length > 0 && (
          <section className="card-section clash-box">
            <div className="section-head"><h2><Icon name="error" size={20} /> סתירות לטיפול ({clashes.length})</h2></div>
            <ul className="clash-list">
              {clashes.map((e) => {
                const orig = e.conflict_with ? byId.get(e.conflict_with) : undefined;
                const mineOrig = orig?.created_by === me?.id;
                const mineNew = e.created_by === me?.id;
                return (
                  <li key={e.id}>
                    <div>
                      <strong>{e.title}</strong> · {dateLabel(e)} <span className="muted">({nameOf(e.created_by)})</span>
                      {orig && (
                        <div className="muted small">
                          סותר את "{orig.title}" · {dateLabel(orig)} ({nameOf(orig.created_by)})
                          {e.escalated && ' · הועבר להכרעת המנהלים'}
                        </div>
                      )}
                    </div>
                    <div className="row gap wrap">
                      {mineOrig && (
                        <>
                          <button className="btn tonal small" onClick={() => resolve(e, 'accept_new')}>לקבל את התאריך החדש</button>
                          <button className="btn tonal small" onClick={() => resolve(e, 'allow_edit')}>לאשר לו לערוך את האירוע שלי</button>
                          {!e.escalated && <button className="btn text small" onClick={() => resolve(e, 'escalate')}>להעביר להכרעת מנהל</button>}
                        </>
                      )}
                      {isAdmin && (
                        <>
                          <button className="btn tonal small" onClick={() => resolve(e, 'accept_new')}>החדש נכון</button>
                          <button className="btn tonal small" onClick={() => resolve(e, 'keep_original')}>הקיים נכון</button>
                          <button className="btn text small" onClick={() => resolve(e, 'keep_both')}>שניהם</button>
                        </>
                      )}
                      {mineNew && !isAdmin && <button className="btn text small danger" onClick={() => withdraw(e)}>ביטול האירוע שלי</button>}
                      {mineNew && !mineOrig && !isAdmin && <span className="muted small">ממתין לבעל האירוע הקיים או למנהל</span>}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <section className="cal">
          <div className="cal-head">
            <button className="icon-btn" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} aria-label="החודש הקודם"><Icon name="chevron_right" /></button>
            <div className="cal-title">
              <strong>{month.toLocaleDateString('he-IL', { month: 'long', year: 'numeric' })}</strong>
              <span className="muted small">{hebMonths}</span>
            </div>
            <button className="icon-btn" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} aria-label="החודש הבא"><Icon name="chevron_left" /></button>
          </div>
          <div className="cal-grid">
            {WEEKDAYS.map((w) => <div key={w} className="cal-wd">{w}</div>)}
            {cells.map((d) => {
              const k = iso(d);
              const list = onDay(k);
              const h = hebrewParts(new Date(k + 'T12:00:00Z'));
              return (
                <div
                  key={k}
                  className={`cal-day ${d.getMonth() !== month.getMonth() ? 'other' : ''} ${k === today ? 'today' : ''}`}
                  onDoubleClick={() => { if (isGuest) return; setNewDate(k); setEditing('new'); }}
                >
                  <div className="cal-num"><span>{d.getDate()}</span><span className="cal-heb">{hebrewDayLetters(h.day)}{h.day === 1 ? ` ${h.month}` : ''}</span></div>
                  {list.slice(0, 3).map((e) => (
                    <button key={e.id} className={`cal-ev k-${e.kind} ${e.status === 'conflict' ? 'clash' : ''}`} onClick={() => setOpen(e)} title={e.title}>
                      {e.title}
                    </button>
                  ))}
                  {list.length > 3 && <span className="cal-more">ועוד {list.length - 3}</span>}
                </div>
              );
            })}
          </div>
        </section>

        <section className="card-section">
          <div className="section-head"><h2>אירועים קרובים</h2></div>
          {events === null ? (
            <div className="spinner" />
          ) : upcoming.length === 0 ? (
            <div className="empty-inline small"><Icon name="calendar_month" /><span>אין אירועים קרובים. אפשר להוסיף.</span></div>
          ) : (
            <ul className="list">
              {upcoming.map((e) => (
                <li key={e.id}>
                  <button className="list-row" onClick={() => setOpen(e)}>
                    <span className={`ev-dot k-${e.kind}`} />
                    <div className="list-main">
                      <div className="list-title">{e.title}</div>
                      <div className="list-sub">{dateLabel(e)} · {KIND_LABEL[e.kind]}</div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {open && (
        <EventView
          e={open}
          onClose={() => setOpen(null)}
          onEdit={() => { setEditing(open); setOpen(null); }}
          onDeleted={() => { setOpen(null); load(); }}
        />
      )}
      {editing && <EventDialog event={editing === 'new' ? undefined : editing} date={newDate} onClose={() => setEditing(null)} onSaved={load} />}
    </div>
  );
}

function EventView({ e, onClose, onEdit, onDeleted }: { e: CalEvent; onClose: () => void; onEdit: () => void; onDeleted: () => void }) {
  const { me, isAdmin, canRemove, nameOf, rooms } = useApp();
  const { confirm, toast } = useFeedback();
  const canEdit = e.created_by === me?.id || (me ? e.editors.includes(me.id) : false) || isAdmin;
  const canDelete = e.created_by === me?.id || canRemove;
  const [msgLink, setMsgLink] = useState<string | null>(null);
  useEffect(() => {
    if (!e.message_id) return;
    supabase.from('messages').select('channel_id').eq('id', e.message_id).maybeSingle().then(({ data }) => {
      if (!data) return;
      const r = rooms.find((x) => x.id === data.channel_id);
      setMsgLink(r && !r.is_main ? `/room/${r.id}?m=${e.message_id}` : `/?m=${e.message_id}`);
    });
  }, [e.message_id, rooms]);

  async function remove() {
    const ok = await confirm({ title: `מחיקת "${e.title}"`, confirmLabel: 'מחיקה', danger: true });
    if (!ok) return;
    const { error } = await supabase.rpc('delete_event', { p_id: e.id });
    if (error) return toast(errorText(error), 'error');
    onDeleted();
  }

  return (
    <Modal title={e.title} onClose={onClose}>
      <div className="ev-view">
        <p><Icon name="calendar_month" size={18} /> {dateLabel(e)}</p>
        <p className="muted small">{KIND_LABEL[e.kind]} · נוסף על ידי {nameOf(e.created_by)}{e.status === 'conflict' ? ' · ממתין להכרעה' : ''}</p>
        {e.description && <p className="ev-desc">{e.description}</p>}
        {msgLink && <Link to={msgLink} onClick={onClose} className="btn text small">לברכה בצ'אט</Link>}
      </div>
      <div className="dialog-actions">
        {canDelete && <button className="btn text danger" onClick={remove}>מחיקה</button>}
        {canEdit && <button className="btn tonal" onClick={onEdit}><Icon name="edit" size={16} /> עריכה</button>}
      </div>
    </Modal>
  );
}

export function EventDialog({ event, date, onClose, onSaved }: { event?: CalEvent; date?: string; onClose: () => void; onSaved: () => void }) {
  const { toast } = useFeedback();
  const [title, setTitle] = useState(event?.title ?? '');
  const [starts, setStarts] = useState(event?.starts_on ?? date ?? iso(new Date()));
  const [ends, setEnds] = useState(event?.ends_on ?? '');
  const [kind, setKind] = useState<EventKind>(event?.kind ?? 'yeshiva');
  const [desc, setDesc] = useState(event?.description ?? '');
  const [busy, setBusy] = useState(false);

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    setBusy(true);
    const args = { p_title: title.trim(), p_starts: starts, p_ends: ends || null, p_kind: kind, p_description: desc.trim() || null };
    const { data, error } = event
      ? await supabase.rpc('update_event', { p_id: event.id, ...args })
      : await supabase.rpc('add_event', args);
    setBusy(false);
    if (error) return toast(errorText(error), 'error');
    const saved = data as CalEvent;
    toast(saved.status === 'conflict' ? 'האירוע נשמר, אבל הוא סותר אירוע קיים. בעל האירוע או מנהל יכריעו.' : 'האירוע נשמר');
    onSaved();
    onClose();
  }

  return (
    <Modal title={event ? 'עריכת אירוע' : 'אירוע חדש'} onClose={onClose}>
      <form className="form-stack" onSubmit={submit}>
        <label className="field">
          <span>שם האירוע</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={100} required autoFocus placeholder="למשל: שמחת בית השואבה" />
        </label>
        <div className="row gap wrap">
          <label className="field grow">
            <span>תאריך</span>
            <input type="date" value={starts} onChange={(e) => setStarts(e.target.value)} required />
            {starts && <span className="field-hint">{hebrewLabel(starts)}</span>}
          </label>
          <label className="field grow">
            <span>עד תאריך (לא חובה)</span>
            <input type="date" value={ends} min={starts} onChange={(e) => setEnds(e.target.value)} />
            {ends && <span className="field-hint">{hebrewLabel(ends)}</span>}
          </label>
        </div>
        <div className="chip-row">
          {(Object.keys(KIND_LABEL) as EventKind[]).map((k) => (
            <button key={k} type="button" className={`chip ${kind === k ? 'on' : ''}`} onClick={() => setKind(k)}>{KIND_LABEL[k]}</button>
          ))}
        </div>
        <label className="field">
          <span>פרטים (לא חובה)</span>
          <textarea rows={3} maxLength={500} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="שעה, מקום, מה להביא…" />
        </label>
        <div className="dialog-actions">
          <button type="button" className="btn text" onClick={onClose}>ביטול</button>
          <button className="btn filled" disabled={busy || title.trim().length < 2 || !starts}>שמירה</button>
        </div>
      </form>
    </Modal>
  );
}
