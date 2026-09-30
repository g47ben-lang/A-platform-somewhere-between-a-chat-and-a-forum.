import { useEffect, useState } from 'react';
import { useApp } from '../AppContext';
import { supabase } from '../supabase';
import { errorText } from '../lib/format';
import { canInstall, disablePush, enablePush, installApp, isInstalled, onInstallChange, pushEnabledHere, pushSupported } from '../lib/push';
import { useFeedback } from './Feedback';
import Icon from './Icon';

interface Prefs {
  on_dm: boolean;
  on_mention: boolean;
  on_reply: boolean;
  on_poll: boolean;
  no_shabbat: boolean;
}
const DEFAULTS: Prefs = { on_dm: true, on_mention: true, on_reply: true, on_poll: false, no_shabbat: true };
const ROWS: [keyof Prefs, string][] = [
  ['on_dm', 'הודעה אישית חדשה'],
  ['on_mention', 'מישהו הזכיר אותי'],
  ['on_reply', 'תגובה בציטוט להודעה שלי'],
  ['on_poll', 'סקר חדש'],
  ['no_shabbat', 'בלי התראות בשבת'],
];

/** Install the site as a desktop/phone app, and push notifications that arrive even when it is closed. */
export default function PushSettings() {
  const { me } = useApp();
  const { toast } = useFeedback();
  const [on, setOn] = useState(pushEnabledHere());
  const [busy, setBusy] = useState(false);
  const [prefs, setPrefs] = useState<Prefs>(DEFAULTS);
  const [, force] = useState(0);

  useEffect(() => onInstallChange(() => force((n) => n + 1)), []);
  useEffect(() => {
    if (!me) return;
    supabase.from('push_prefs').select('*').eq('user_id', me.id).maybeSingle().then(({ data }) => data && setPrefs({ ...DEFAULTS, ...(data as Prefs) }));
  }, [me]);

  async function toggle(v: boolean) {
    setBusy(true);
    try {
      if (v) await enablePush(me!.id);
      else await disablePush();
      setOn(v);
      toast(v ? 'ההתראות הופעלו במכשיר הזה' : 'ההתראות כובו במכשיר הזה');
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function setPref(k: keyof Prefs, v: boolean) {
    const next = { ...prefs, [k]: v };
    setPrefs(next);
    const { error } = await supabase.from('push_prefs').upsert({ user_id: me!.id, ...next });
    if (error) toast(errorText(error), 'error');
  }

  return (
    <section className="settings-card">
      <h2>תוכנה והתראות</h2>
      <div className="install-row">
        <Icon name="download" size={22} />
        <div className="grow">
          <strong>התקנה כתוכנה</strong>
          <span className="muted small">
            {isInstalled()
              ? 'האתר פתוח כתוכנה מותקנת.'
              : canInstall()
                ? 'האתר ייפתח בחלון משלו, עם סמל בשולחן העבודה ובשורת המשימות.'
                : 'בכרום או באדג\': בתפריט ⋮ ← "התקנת האתר כאפליקציה" (או סמל ההתקנה בשורת הכתובת). בטלפון: "הוספה למסך הבית".'}
          </span>
        </div>
        {!isInstalled() && canInstall() && (
          <button className="btn tonal" onClick={() => installApp()}>התקנה</button>
        )}
      </div>

      {pushSupported() ? (
        <label className="switch-row">
          <span>
            <strong>התראות גם כשהאתר סגור</strong>
            <span className="muted small">במכשיר הזה. צריך להפעיל בכל מחשב או טלפון בנפרד.</span>
          </span>
          <input type="checkbox" className="switch" checked={on} disabled={busy} onChange={(e) => toggle(e.target.checked)} />
        </label>
      ) : (
        <p className="muted small">הדפדפן הזה לא תומך בהתראות. באייפון צריך קודם להוסיף את האתר למסך הבית ולפתוח אותו משם.</p>
      )}
      {on && (
        <div className="check-group">
          {ROWS.map(([k, label]) => (
            <label key={k} className="check-row">
              <input type="checkbox" checked={prefs[k]} onChange={(e) => setPref(k, e.target.checked)} />
              <span>{label}</span>
            </label>
          ))}
        </div>
      )}
    </section>
  );
}
