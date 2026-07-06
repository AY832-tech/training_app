'use strict';
// アプリシェルはネットワーク優先（更新が即反映）。オフライン時のみキャッシュにフォールバック。
const CACHE = 'muscle-app-v13';
const SHELL = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/charts.js',
  '/exercise-icons.js',
  '/manifest.webmanifest',
  '/icon-192.png',
  '/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.pathname.startsWith('/api/')) {
    // API: ネットワーク優先（オフライン時はエラー）
    return;
  }
  // 静的: ネットワーク優先。取得できたらキャッシュも更新し、失敗（オフライン）時はキャッシュ
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok && e.request.method === 'GET') {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
