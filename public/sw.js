const CACHE_NAME = 'zunari-static-v2';
const APP_SHELL = ['/', '/index.html'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => Promise.all(
        cacheNames
          .filter((name) => name === 'zunari-v1' || (
            name.startsWith('zunari-static-') && name !== CACHE_NAME
          ))
          .map((name) => caches.delete(name))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (
    request.method !== 'GET' ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/socket.io/')
  ) return;

  const isAppShell = url.pathname === '/' || url.pathname === '/index.html';
  const isBuildAsset = url.pathname.startsWith('/assets/');
  if (!isAppShell && !isBuildAsset) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cachedResponse = await cache.match(request);
    const networkResponse = fetch(request).then(async (response) => {
      if (response.ok && response.type === 'basic') {
        await cache.put(request, response.clone());
      }
      return response;
    });

    if (cachedResponse) {
      event.waitUntil(networkResponse.catch((error) => {
        console.warn('Static asset refresh failed:', error);
      }));
      return cachedResponse;
    }

    try {
      return await networkResponse;
    } catch (error) {
      if (request.mode === 'navigate') {
        const fallback = await cache.match('/index.html');
        if (fallback) return fallback;
      }
      throw error;
    }
  })());
});

self.addEventListener('sync', (event) => {
  if (event.tag === 'send-messages') event.waitUntil(notifyClients('SYNC_MESSAGES'));
});

self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'sync-conversations') {
    event.waitUntil(notifyClients('SYNC_CONVERSATIONS'));
  }
});

async function notifyClients(type) {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  clients.forEach((client) => client.postMessage({ type }));
}

self.addEventListener('message', (event) => {
  const { type, payload } = event.data || {};
  if (type === 'REGISTER_SYNC' && payload?.tag && self.registration.sync) {
    self.registration.sync.register(payload.tag).catch((error) => {
      console.error('Background sync registration failed:', error);
    });
  } else if (type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('push', (event) => {
  if (!event.data) return;
  const data = event.data.json();
  const options = {
    body: data.body,
    icon: data.icon || '/icon-192.png',
    badge: data.badge || '/badge-72.png',
    vibrate: data.vibrate || [200, 100, 200],
    data: data.data || {},
    actions: data.actions || [],
    requireInteraction: data.requireInteraction || false,
    silent: data.silent || false,
  };
  event.waitUntil(self.registration.showNotification(data.title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (event.action) {
      clients.forEach((client) => client.postMessage({
        type: 'NOTIFICATION_ACTION',
        action: event.action,
        data: event.notification.data,
      }));
      return;
    }

    for (const client of clients) {
      if (client.url === '/' && 'focus' in client) {
        await client.focus();
        return;
      }
    }
    await self.clients.openWindow('/');
  })());
});
