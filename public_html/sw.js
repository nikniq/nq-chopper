/* NQ Chopper service worker: cache the solo game shell so it plays offline. */
const VERSION = 'nq-v1';
const SHELL = ['/play', '/css/game.css', '/js/sim.js', '/js/net.js', '/js/game.js', '/icon.svg', '/manifest.webmanifest'];

self.addEventListener('install', e => {
    e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
    e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
    const req = e.request;
    if (req.method !== 'GET') return;
    const url = new URL(req.url);
    if (url.origin !== self.location.origin) return;
    // Never cache matchmaking, scores or auth traffic
    if (/^\/(matches|scores|login|register|logout|settings)/.test(url.pathname)) return;
    const isAsset = /^\/(css|js)\//.test(url.pathname) || /\.(svg|webmanifest|ico)$/.test(url.pathname);
    if (isAsset) {
        // Versioned assets: cache first, refresh in the background
        e.respondWith(caches.open(VERSION).then(async c => {
            const hit = await c.match(req);
            const fetching = fetch(req).then(res => { if (res.ok) c.put(req, res.clone()); return res; }).catch(() => hit);
            return hit || fetching;
        }));
        return;
    }
    // Pages: network first, fall back to the cached solo game
    e.respondWith(fetch(req).then(res => {
        if (res.ok && url.pathname === '/play') caches.open(VERSION).then(c => c.put('/play', res.clone()));
        return res;
    }).catch(() => caches.match(url.pathname === '/play' || url.pathname.startsWith('/play') ? '/play' : req)));
});
