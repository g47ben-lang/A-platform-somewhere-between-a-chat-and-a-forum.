// Desktop notifications for new private messages and mentions while the tab is in the background.
const KEY = 'notify-enabled';

export function notificationsSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function notificationsEnabled(): boolean {
  try {
    return notificationsSupported() && Notification.permission === 'granted' && localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export async function setNotificationsEnabled(on: boolean): Promise<boolean> {
  if (!notificationsSupported()) return false;
  if (on && Notification.permission !== 'granted') {
    const p = await Notification.requestPermission();
    if (p !== 'granted') return false;
  }
  try {
    localStorage.setItem(KEY, on ? '1' : '0');
  } catch {
    /* storage unavailable: setting just won't persist */
  }
  return on;
}

export function notify(title: string, body: string, onClick?: () => void) {
  if (!notificationsEnabled() || !document.hidden) return;
  try {
    const n = new Notification(title, { body: body.slice(0, 140), dir: 'rtl', lang: 'he', tag: title });
    n.onclick = () => {
      window.focus();
      onClick?.();
      n.close();
    };
  } catch {
    /* some mobile browsers only allow notifications from a service worker */
  }
}
