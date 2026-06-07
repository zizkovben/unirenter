// UniRenter Service Worker — push notification handler
// Deployed at /sw.js (repo root)
// Registered by unirenter-dashboard.html

const SW_VERSION = 'ur-sw-v1';

// ── Push event — fires when server sends a push ──
self.addEventListener('push', function(event) {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch(e) {
    payload = { title: 'UniRenter', body: event.data.text() };
  }

  const title   = payload.title || 'UniRenter 🤠';
  const options = {
    body:    payload.body  || 'You have an upcoming date to check.',
    icon:    '/favicon.ico',
    badge:   '/favicon.ico',
    tag:     payload.tag   || 'ur-notification',
    data:    { url: payload.url || '/dashboard?tab=calendar' },
    actions: [
      { action: 'view', title: 'View calendar' },
      { action: 'dismiss', title: 'Dismiss' }
    ],
    requireInteraction: payload.critical === true
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

// ── Notification click — open dashboard on calendar tab ──
self.addEventListener('notificationclick', function(event) {
  event.notification.close();

  if (event.action === 'dismiss') return;

  const targetUrl = (event.notification.data && event.notification.data.url)
    ? event.notification.data.url
    : '/dashboard?tab=calendar';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
      // Focus existing tab if open
      for (let i = 0; i < clientList.length; i++) {
        const client = clientList[i];
        if (client.url.includes('/dashboard') && 'focus' in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      // Open new tab
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});

// ── Activate — clean up old caches if needed ──
self.addEventListener('activate', function(event) {
  event.waitUntil(self.clients.claim());
});
