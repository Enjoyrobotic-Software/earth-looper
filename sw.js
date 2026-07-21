/**
 * EarthOS Service Worker — self-destruct edition.
 * Deletes all caches, forces a reload of all clients, then unregisters.
 * This runs once to evict the old earthos-v5-r1 cache.
 */

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.map(k => caches.delete(k))))
      .then(() => self.clients.claim())
      .then(() => self.clients.matchAll({ type: 'window', includeUncontrolled: true }))
      .then(clients => clients.forEach(c => c.navigate(c.url)))
      .then(() => self.registration.unregister())
      .catch(() => self.registration.unregister())
  );
});
