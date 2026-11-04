// SwimLens 서비스 워커: 앱 파일은 네트워크 우선, 큰 라이브러리/모델/폰트는 캐시 우선 (오프라인 재사용)
const CACHE = "swimlens-v1";
const HEAVY = /\/vendor\//;
self.addEventListener("install", (e) => { self.skipWaiting(); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith("swimlens-") && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", (e) => {
  const req = e.request; if (req.method !== "GET" || !req.url.startsWith(self.location.origin)) return;
  if (HEAVY.test(req.url)) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); } return res; })));
  } else {
    e.respondWith(fetch(req).then(res => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); } return res; }).catch(() => caches.match(req)));
  }
});
