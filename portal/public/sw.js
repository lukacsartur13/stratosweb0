// The Stratos portal's service worker: it only shows push notifications and
// opens the portal when one is tapped. It caches nothing and intercepts no
// request (the portal is no-store by design).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data ? event.data.text() : '' }; }
  const title = typeof data.title === 'string' ? data.title.slice(0, 80) : 'Stratos';
  const body = typeof data.body === 'string' ? data.body.slice(0, 240) : '';
  event.waitUntil(self.registration.showNotification(title, {
    body,
    icon: '/portal/icon-192.png',
    badge: '/portal/icon-192.png',
    data: { url: typeof data.url === 'string' ? data.url : '/portal/' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  // Only ever a page of this portal, whatever the message said.
  let url = '/portal/';
  try {
    const u = new URL(event.notification.data?.url || '/portal/', self.location.origin);
    if (u.origin === self.location.origin && u.pathname.startsWith('/portal')) url = u.pathname + u.search;
  } catch { /* the default */ }
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of windows) {
      if (new URL(w.url).pathname.startsWith('/portal') && 'focus' in w) {
        await w.navigate(url).catch(() => undefined);
        return w.focus();
      }
    }
    return self.clients.openWindow(url);
  })());
});
