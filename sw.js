// v3: fixes a bug where ANY failed network request (including calls to
// the Supabase API, which is cross-origin) was being answered with the
// cached offline.html page as if it were a normal 200 response. Code
// that expected JSON back from Supabase would then try to parse that
// HTML as data and surface the raw page source as an "error message"
// (this is the "تعذر تحميل المنصة" bug with visible HTML/DOCTYPE text).
//
// Fix: this service worker now ONLY ever answers for same-origin
// requests. Any other request (Supabase, CDNs, APIs) is left
// completely alone and allowed to fail/succeed on its own — the app's
// own JS is responsible for handling those errors.
const CACHE_NAME = 'in-the-void-shell-v3';
const APP_SHELL = [
  './',
  './index.html',
  './2.html',
  './app/index.html',
  './offline.html',
  './1.png',
  './manifest.webmanifest',
  './app/theme-common.js',
  './app/theme-system.js',
  './midad-round5.js'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      Promise.all(APP_SHELL.map(url => cache.add(url).catch(() => null)))
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (_) { return; }

  // Never intercept cross-origin requests (Supabase REST/Auth/Storage,
  // CDNs, Firebase, etc). Let the browser/app handle those failures
  // directly so real errors (e.g. "Failed to fetch") reach the app's
  // own try/catch instead of being replaced with an HTML page.
  if (url.origin !== self.location.origin) return;

  const isNavigation = req.mode === 'navigate';

  event.respondWith(
    fetch(req)
      .then(res => {
        try {
          const copy = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(req, copy)).catch(() => null);
        } catch (_) {}
        return res;
      })
      .catch(async () => {
        const cached = await caches.match(req);
        if (cached) return cached;
        // Only ever fall back to a full HTML page for actual page
        // navigations. A failed request for a script/style/JSON asset
        // must stay a real network error, not a fake 200 HTML body.
        if (isNavigation) {
          return (await caches.match('./app/index.html')) ||
                 (await caches.match('./index.html')) ||
                 (await caches.match('./offline.html'));
        }
        return Response.error();
      })
  );
});

// Native push notifications on Android are handled by the Capacitor Push
// Notifications plugin (see app/native-bridge.js). This listener only
// covers the web/PWA case where a browser push subscription is used
// directly (no Capacitor).
self.addEventListener('push', event => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch (_) {}
  const title = payload.title || payload.notification?.title || 'IN THE VOID';
  const body = payload.body || payload.notification?.body || '';
  const url = (payload.data && payload.data.url) || payload.url || './app/index.html?openNotifCenter=1';
  const options = {
    body,
    icon: './1.png',
    badge: './1.png',
    data: { url }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = event.notification.data?.url || './app/index.html?openNotifCenter=1';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      for (const client of clients) {
        if ('focus' in client) { client.navigate(target); return client.focus(); }
      }
      return self.clients.openWindow(target);
    })
  );
});
