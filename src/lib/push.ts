// Installable app (PWA) + Web Push: notifications even when the site is closed.
import { supabase } from '../supabase';

const FN_URL = `${import.meta.env.VITE_SUPABASE_URL as string}/functions/v1/send-push`;
const ENABLED_KEY = 'push-enabled';

export function pushSupported(): boolean {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

/** Registers the service worker (needed both for installing the app and for push). */
export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('./sw.js').catch(() => undefined);
}

export function pushEnabledHere(): boolean {
  try {
    return localStorage.getItem(ENABLED_KEY) === '1' && Notification.permission === 'granted';
  } catch {
    return false;
  }
}

function keyBytes(base64url: string): Uint8Array {
  const pad = '='.repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function publicKey(): Promise<string> {
  let { data } = await supabase.rpc('push_public_key');
  if (!data) {
    // The push job creates its keys on its first run.
    await fetch(FN_URL, { method: 'POST', body: '{}' }).catch(() => undefined);
    ({ data } = await supabase.rpc('push_public_key'));
  }
  if (!data) throw new Error('שירות ההתראות עוד לא הופעל בשרת (הפונקציה send-push)');
  return data as string;
}

/** Asks permission and subscribes this device. */
export async function enablePush(userId: string): Promise<void> {
  if (!pushSupported()) throw new Error('הדפדפן הזה לא תומך בהתראות');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('לא ניתן אישור להתראות. אפשר לאשר בהגדרות הדפדפן (סמל המנעול ליד הכתובת).');
  registerServiceWorker();
  const reg = await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(await publicKey()) as BufferSource }));
  const j = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  const { error } = await supabase.from('push_subscriptions').upsert({ endpoint: j.endpoint, user_id: userId, p256dh: j.keys.p256dh, auth: j.keys.auth });
  if (error) throw error;
  localStorage.setItem(ENABLED_KEY, '1');
}

export async function disablePush(): Promise<void> {
  localStorage.setItem(ENABLED_KEY, '0');
  if (!('serviceWorker' in navigator)) return;
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
    await sub.unsubscribe();
  }
}

// "Install as an app": Chrome/Edge fire beforeinstallprompt; we keep it for the settings button.
interface InstallPrompt extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: string }>;
}
let deferred: InstallPrompt | null = null;
const listeners = new Set<() => void>();
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as InstallPrompt;
    listeners.forEach((f) => f());
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    listeners.forEach((f) => f());
  });
}
export const canInstall = () => !!deferred;
export const isInstalled = () => typeof window !== 'undefined' && matchMedia('(display-mode: standalone)').matches;
export function onInstallChange(f: () => void) {
  listeners.add(f);
  return () => {
    listeners.delete(f);
  };
}
export async function installApp(): Promise<boolean> {
  if (!deferred) return false;
  await deferred.prompt();
  const { outcome } = await deferred.userChoice;
  deferred = null;
  listeners.forEach((f) => f());
  return outcome === 'accepted';
}
