// ── Study OS · Service Worker ──────────────────────────────────────────────
// DEPLOY CHECKLIST: bump CACHE string on every deploy to force cache refresh on all devices.
// v27 — 2026-06-11: Test Series — ACE schedules, readiness-gated planner, score + mistake log
const CACHE = 'studyos-v31'; // v31: GO official-site additions — 18 subject tests + Mocks 6-21 (no activation yet), topic names enriched, auto-merge migration

// Static assets that are safe to cache forever (fonts, CDN libraries)
// index.html is intentionally NOT cached here — it uses network-first below
const STATIC_ASSETS = [
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js'
];

// ── INSTALL: only cache static CDN assets, NOT index.html ─────────────────
self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(CACHE).then(function(cache) {
      return Promise.allSettled(STATIC_ASSETS.map(function(url) {
        return cache.add(url).catch(function(err) {
          console.warn('[SW] Could not cache', url, err);
        });
      }));
    }).then(function() {
      return self.skipWaiting(); // activate immediately, don't wait for old tabs to close
    })
  );
});

// ── ACTIVATE: delete old caches so stale content is wiped ─────────────────
self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k) { return k !== CACHE; })
            .map(function(k) {
              console.log('[SW] Deleting old cache:', k);
              return caches.delete(k);
            })
      );
    }).then(function() {
      return self.clients.claim(); // take control of all open tabs immediately
    })
  );
});

// ── FETCH ─────────────────────────────────────────────────────────────────
self.addEventListener('fetch', function(e) {
  var url = e.request.url;

  // ① Firebase — always network only, never cache
  if (url.includes('firebaseio.com') ||
      url.includes('firebase.googleapis.com') ||
      url.includes('googleapis.com/identitytoolkit') ||
      url.includes('fcm.googleapis.com') ||
      url.includes('firebaseinstallations.googleapis.com') ||
      url.includes('gstatic.com/firebasejs')) {
    return; // let browser handle it directly
  }

  // ② HTML navigation (index.html, /, etc.) — NETWORK FIRST
  // This ensures deploys are always picked up immediately.
  // Falls back to cache only when completely offline.
  if (e.request.mode === 'navigate' ||
      url.endsWith('.html') ||
      url.endsWith('/') ||
      url === self.location.origin + '/') {
    e.respondWith(
      fetch(e.request).then(function(response) {
        // Got a fresh response — update the cache and return it
        if (response && response.status === 200) {
          var clone = response.clone();
          caches.open(CACHE).then(function(cache) {
            cache.put(e.request, clone);
          });
        }
        return response;
      }).catch(function() {
        // Offline: serve cached HTML if available
        console.log('[SW] Offline — serving cached HTML');
        return caches.match('./index.html') ||
               caches.match(e.request);
      })
    );
    return;
  }

  // ③ PNG icons and manifest — network first (so icon updates deploy)
  if (url.endsWith('.png') || url.endsWith('.json') || url.endsWith('manifest.json')) {
    e.respondWith(
      fetch(e.request).then(function(response) {
        if (response && response.status === 200) {
          var clone = response.clone();
          caches.open(CACHE).then(function(cache) { cache.put(e.request, clone); });
        }
        return response;
      }).catch(function() {
        return caches.match(e.request);
      })
    );
    return;
  }

  // ④ Static CDN assets (fonts, libraries) — cache first for performance
  e.respondWith(
    caches.match(e.request).then(function(cached) {
      if (cached) return cached;
      return fetch(e.request).then(function(response) {
        if (response && response.status === 200 && response.type !== 'opaque') {
          var clone = response.clone();
          caches.open(CACHE).then(function(cache) {
            cache.put(e.request, clone);
          });
        }
        return response;
      }).catch(function() {
        // Nothing we can do for non-HTML assets offline
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
  e.waitUntil(self.registration.showNotification(title, {
    body: body, tag: tag,
    icon: './icon-192.png',
    badge: './icon-192.png',
    vibrate: [200, 100, 200],
    data: { url: url },
    actions: [{ action: 'open', title: '▶ Open' }, { action: 'dismiss', title: '✕ Dismiss' }],
    requireInteraction: false
  }));
});

// ── NOTIFICATION CLICK ────────────────────────────────────────────────────
self.addEventListener('notificationclick', function(e) {
  e.notification.close();
  if (e.action === 'dismiss') {
    // Snooze 5 minutes — reschedule the alarm
    setTimeout(function() {
      self.registration.showNotification(e.notification.title || '📚 Study OS', {
        body: e.notification.body || 'Snoozed reminder — time to study!',
        tag: (e.notification.tag || 'studyos-alarm') + '-snooze',
        icon: './icon-192.png',
        badge: './icon-192.png',
        vibrate: [300, 150, 300, 150, 300],
        data: e.notification.data || { url: './index.html' },
        requireInteraction: true,
        actions: [{ action: 'open', title: '▶ Start Now' }, { action: 'dismiss', title: '✕ Snooze 5m' }]
      });
    }, 5 * 60 * 1000);
    return;
  }
  var targetUrl = (e.notification.data && e.notification.data.url) ? e.notification.data.url : './index.html';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(wins) {
      for (var i = 0; i < wins.length; i++) {
        if (wins[i].url.includes('index.html') && 'focus' in wins[i]) return wins[i].focus();
      }
      if (clients.openWindow) return clients.openWindow(targetUrl);
    })
  );
});

// ── MESSAGE: schedule local alarm from main thread ────────────────────────
self.addEventListener('message', function(e) {
  // Allow main thread to trigger SW activation (fixes SW waiting bug)
  if (e.data && e.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }
  if (!e.data || e.data.type !== 'SCHEDULE_ALARM') return;
  var delay = parseInt(e.data.delayMs, 10) || 0;
  if (delay <= 0) return;
  setTimeout(function() {
    self.registration.showNotification(e.data.title || '📚 Study OS', {
      body: e.data.body || 'Time to study!',
      tag: e.data.tag || 'studyos-alarm',
      icon: './icon-192.png',
      badge: './icon-192.png',
      vibrate: [300, 150, 300, 150, 300],
      data: { url: e.data.url || './index.html' },
      requireInteraction: true,
      actions: [{ action: 'open', title: '▶ Start Now' }, { action: 'dismiss', title: '✕ Snooze 5m' }]
    });
  }, delay);
});
