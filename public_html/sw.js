/* NQ Chopper service worker: keep the solo game playable offline.
 *
 * Scripts and styles are requested with a ?v=<mtime> cache-buster, so they are fetched network-first
 * (always fresh online) and fall back to the last cached copy of the same file, whatever its version,
 * when offline. Only the plain /play page is cached; the Daily Challenge and online matches need the
 * network. Old caches are deleted on activate. */
const VERSION = 'nq-v2';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => {
    e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

async function networkFirst(req, cacheKey) {
    const cache = await caches.open(VERSION);
    try {
        const res = await fetch(req);
        if (res && res.ok && res.type !== 'opaque') {
            // Keep exactly one copy per path: drop older versions of the same asset
            if (cacheKey === undefined) {
                const old = await cache.keys();
                const path = new URL(req.url).pathname;
                await Promise.all(old.filter(k => new URL(k.url).pathname === path && k.url !== req.url).map(k => cache.delete(k)));
            }
            cache.put(cacheKey || req, res.clone());
        }
        return res;
    } catch (err) {
        const hit = await cache.match(cacheKey || req, { ignoreSearch: cacheKey === undefined });
        if (hit) return hit;
        return new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
    }
}

self.addEventListener('fetch', e => {
    const req = e.request;
    if (req.method !== 'GET') return;
    const url = new URL(req.url);
    if (url.origin !== self.location.origin) return;
    // Never cache matchmaking, scores, auth or APIs
    if (/^\/(matches|scores|login|register|logout|settings|api|join|auth|ping|admin|health)/.test(url.pathname)) return;
    if (/^\/(css|js)\//.test(url.pathname) || /\.(svg|png|webmanifest|ico)$/.test(url.pathname)) { e.respondWith(networkFirst(req)); return; }
    if (url.pathname === '/play' && url.search === '') { e.respondWith(networkFirst(req, '/play')); return; }
});
