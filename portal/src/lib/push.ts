import { supabase } from '@/lib/supabase';

/**
 * Push notifications on THIS device (20261013000100_notifications.sql).
 *
 * The portal's service worker (/portal/sw.js) shows them. On an iPhone or iPad
 * a web page may only receive push once it has been added to the Home Screen
 * and opened from there (iOS 16.4+) — `needsHomeScreen` says when that is the
 * missing step.
 */
export const VAPID_PUBLIC_KEY = 'BOa0bTvJd819zVBs0Ze0RpdvLzQPTt3G55Dtx00THYrs2hjesLhRneKODO7kxIgcablM2tYhLppE9RRBciFKCSg';

export type PushState = 'unsupported' | 'needs-home-screen' | 'denied' | 'off' | 'on';

const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;

export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

function keyBytes(base64url: string): ArrayBuffer {
  const pad = '='.repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0)).buffer;
}

async function registration() {
  return navigator.serviceWorker.register('/portal/sw.js', { scope: '/portal/' });
}

export async function pushState(): Promise<PushState> {
  if (isIos() && !isStandalone()) return 'needs-home-screen';
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await navigator.serviceWorker.getRegistration('/portal/');
  const sub = await reg?.pushManager.getSubscription();
  return sub ? 'on' : 'off';
}

/** Ask, subscribe, and register this device for the signed-in person. Returns an error key or null. */
export async function enablePush(): Promise<'denied' | 'failed' | null> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return 'denied';
  try {
    const reg = await registration();
    await navigator.serviceWorker.ready;
    const sub = (await reg.pushManager.getSubscription())
      ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_PUBLIC_KEY) });
    const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
    const { error } = await supabase.rpc('push_subscribe', {
      p_endpoint: json.endpoint, p_p256dh: json.keys.p256dh, p_auth: json.keys.auth, p_user_agent: navigator.userAgent.slice(0, 300),
    });
    if (error) { console.error('[push.subscribe]', error.code); return 'failed'; }
    return null;
  } catch (e) {
    console.error('[push.enable]', e);
    return 'failed';
  }
}

export async function disablePush(): Promise<void> {
  const reg = await navigator.serviceWorker.getRegistration('/portal/');
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
  await sub.unsubscribe();
}
