// ── Study OS · Service Worker ──────────────────────────────────────────────
// Cache name — bump version to force update
const CACHE = 'studyos-v3';

// App shell: files that make the UI work offline
const SHELL = [
  './',
  './index.html',
  'https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Sora:wght@400;500;600;700&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js'
];

// ── INSTALL: cache the app shell ──────────────────────────────────────────
self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(CACHE).then(function(cache) {
      // addAll fails if any request fails; use individual adds so fonts/CDN
      // failures don't break the install.
      return Promise.allSettled(SHELL.map(function(url) {
        return cache.add(url).catch(function(err) {
          console.warn('[SW] Could not cache', url, err);
        });
      }));
    }).then(function() {
      return self.skipWaiting();
    })
  );
});

// ── ACTIVATE: remove old caches ───────────────────────────────────────────
self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k) { return k !== CACHE; })
            .map(function(k) { return caches.delete(k); })
      );
    }).then(function() {
      return self.clients.claim();
    })
  );
});

// ── FETCH: cache-first for same-origin + CDN, network-first for Firebase ─
self.addEventListener('fetch', function(e) {
  var url = e.request.url;

  // Let Firebase Realtime DB / Auth / FCM go straight to network
  if (url.includes('firebaseio.com') ||
      url.includes('googleapis.com/identitytoolkit') ||
      url.includes('fcm.googleapis.com') ||
      url.includes('firebaseinstallations.googleapis.com')) {
    return; // default browser fetch
  }

  // Cache-first for everything else
  e.respondWith(
    caches.match(e.request).then(function(cached) {
      if (cached) return cached;
      return fetch(e.request).then(function(response) {
        // Only cache successful, non-opaque responses for app resources
        if (response && response.status === 200 && response.type !== 'opaque') {
          var clone = response.clone();
          caches.open(CACHE).then(function(cache) {
            cache.put(e.request, clone);
          });
        }
        return response;
      }).catch(function() {
        // Offline fallback: serve index.html for navigation requests
        if (e.request.mode === 'navigate') {
          return caches.match('./index.html');
        }
      });
    })
  );
});

// ── PUSH NOTIFICATIONS ────────────────────────────────────────────────────
self.addEventListener('push', function(e) {
  var data = {};
  try { data = e.data ? e.data.json() : {}; } catch(err) {}

  var title  = data.title  || '📚 Study OS';
  var body   = data.body   || 'Time to study!';
  var tag    = data.tag    || 'studyos-default';
  var url    = data.url    || './index.html';
  var badge  = data.badge  || '';

  var options = {
    body:    body,
    tag:     tag,
    icon:    'data:image/svg+xml,' + encodeURIComponent(
               '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192">' +
               '<rect width="192" height="192" rx="38" fill="#0d0d10"/>' +
               '<text x="50%" y="54%" dominant-baseline="middle" ' +
               'text-anchor="middle" font-size="110">📚</text></svg>'),
    badge:   badge,
    vibrate: [200, 100, 200],
    data:    { url: url },
    actions: [
      { action: 'open',    title: '▶ Open' },
      { action: 'dismiss', title: '✕ Dismiss' }
    ],
    requireInteraction: false
  };

  e.waitUntil(self.registration.showNotification(title, options));
});

// ── NOTIFICATION CLICK ────────────────────────────────────────────────────
self.addEventListener('notificationclick', function(e) {
  e.notification.close();
  if (e.action === 'dismiss') return;

  var targetUrl = (e.notification.data && e.notification.data.url)
    ? e.notification.data.url
    : './index.html';

  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(wins) {
      // Focus existing window if open
      for (var i = 0; i < wins.length; i++) {
        var w = wins[i];
        if (w.url.includes('index.html') && 'focus' in w) {
          return w.focus();
        }
      }
      // Otherwise open a new window
      if (clients.openWindow) return clients.openWindow(targetUrl);
    })
  );
});

// ── MESSAGE: schedule local alarm from main thread ────────────────────────
// Main thread posts: { type: 'SCHEDULE_ALARM', delayMs, title, body, tag, url }
self.addEventListener('message', function(e) {
  if (!e.data || e.data.type !== 'SCHEDULE_ALARM') return;

  var delay  = parseInt(e.data.delayMs, 10) || 0;
  var title  = e.data.title  || '📚 Study OS';
  var body   = e.data.body   || 'Time to study!';
  var tag    = e.data.tag    || 'studyos-alarm';
  var url    = e.data.url    || './index.html';

  if (delay <= 0) return;

  setTimeout(function() {
    self.registration.showNotification(title, {
      body:    body,
      tag:     tag,
      icon:    'data:image/svg+xml,' + encodeURIComponent(
                 '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192">' +
                 '<rect width="192" height="192" rx="38" fill="#0d0d10"/>' +
                 '<text x="50%" y="54%" dominant-baseline="middle" ' +
                 'text-anchor="middle" font-size="110">📚</text></svg>'),
      vibrate: [300, 150, 300, 150, 300],
      data:    { url: url },
      requireInteraction: true,
      actions: [
        { action: 'open',    title: '▶ Start Now' },
        { action: 'dismiss', title: '✕ Snooze 5m' }
      ]
    });
  }, delay);
});
