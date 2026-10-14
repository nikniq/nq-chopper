// Headless client tests: solo play and two-peer lockstep. Run with: node tests/js/client.test.js
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert';
const simSrc = fs.readFileSync('public_html/js/sim.js', 'utf8');
const gameSrc = fs.readFileSync('public_html/js/game.js', 'utf8');
const noop = () => {};

function makeClient(config, fakeNet) {
    const ctxProxy = new Proxy({}, { get: (t, k) => k === 'createLinearGradient' ? () => ({ addColorStop: noop }) : noop, set: () => true });
    const mkEl = () => ({ style: {}, classList: { add: noop }, addEventListener: noop, getContext: () => ctxProxy, textContent: '', disabled: false, blur: noop, width: 640, height: 400, querySelector: () => ({ textContent: '' }) });
    const els = {}, docHandlers = {}, fetches = [];
    let rafCb = null;
    const win = {
        NQ_CONFIG: config, matchMedia: () => ({ matches: false }), addEventListener: noop, innerWidth: 1280, innerHeight: 800,
        requestAnimationFrame: cb => { rafCb = cb; }, setTimeout: (fn) => { fn(); return 0; }, clearTimeout: noop, location: { href: '' },
        fetch: (url, o) => { fetches.push({ url, body: o && JSON.parse(o.body) }); return Promise.resolve({ ok: true, json: () => Promise.resolve({ rank: 1, best: 1 }) }); }
    };
    win.window = win; win.self = win; win.globalThis = win;
    win.document = { getElementById: id => (els[id] = els[id] || mkEl()), addEventListener: (ev, fn) => { docHandlers[ev] = fn; }, body: mkEl(), hidden: false };
    win.performance = { now: () => 0 }; win.localStorage = { getItem: () => null, setItem: noop };
    win.Math = Math; win.Date = Date; win.JSON = JSON; win.Object = Object; win.Array = Array; win.String = String; win.Number = Number; win.Promise = Promise; win.Set = Set; win.Error = Error; win.console = console; win.Proxy = Proxy; win.Infinity = Infinity;
    if (fakeNet) win.NQNet = fakeNet;
    const context = vm.createContext(win);
    vm.runInContext(simSrc, context);
    vm.runInContext(gameSrc, context);
    let t = 0;
    return { nq: win.__nq, fetches, win, frames(n) { for (let i = 0; i < n; i++) { t += 1000 / 60; rafCb(t); } }, key(code, up) { (up ? docHandlers.keyup : docHandlers.keydown)({ code, preventDefault: noop, repeat: false }); } };
}

// ---- Solo through the real client ----
const solo = makeClient({ scoreUrl: '/scores', csrf: 'x', match: null });
assert.strictEqual(solo.nq.screen, 'title');
solo.key('Space'); solo.frames(2);
assert.strictEqual(solo.nq.screen, 'playing', 'solo starts');
solo.key('Digit1'); solo.frames(2);
assert.strictEqual(solo.nq.sim.units.filter(u => u.team === 0).length, 1, 'soldier bought through client key');
solo.key('ArrowUp'); solo.key('ArrowRight'); solo.frames(120); solo.key('ArrowUp', true); solo.key('ArrowRight', true);
assert.ok(solo.nq.sim.players[0].x > 200, 'chopper flies');
solo.key('KeyP'); assert.strictEqual(solo.nq.screen, 'paused'); solo.key('KeyP'); assert.strictEqual(solo.nq.screen, 'playing');
// Crash it: zero hull then take a hit from a hard landing
const p = solo.nq.sim.players[0]; p.health = 5; p.invuln = 0; p.y = 100; p.vy = 5; p.landed = false;
solo.key('ArrowDown'); solo.frames(400); solo.key('ArrowDown', true);
assert.strictEqual(solo.nq.screen, 'gameover', 'solo reaches game over: ' + solo.nq.screen);
assert.ok(solo.fetches.some(f => f.url === '/scores' && typeof f.body.score === 'number'), 'score posted');
solo.key('KeyR'); solo.frames(1); assert.strictEqual(solo.nq.screen, 'playing', 'restart works');
console.log('solo client ok');

// ---- Two clients in lockstep over an in-memory channel ----
function fakeNetPair() {
    const links = [];
    const make = (opts) => {
        const me = { opts, peer: null, queue: [], send(obj) { if (this.peer) this.peer.queue.push(JSON.parse(JSON.stringify(obj))); return true; }, close: noop, open: true, opponent: opts.opponent };
        links.push(me);
        return me;
    };
    const pump = () => { for (const l of links) { const q = l.queue.splice(0); for (const m of q) l.opts.onMessage(m); } };
    return { createLink: make, links, pump };
}
const netA = fakeNetPair(), netB = fakeNetPair();
const urls = { status: '/s', signal: '/sig', signals: '/sigs', result: '/result', lobby: '/multiplayer' };
const host = makeClient({ scoreUrl: null, csrf: 'x', match: { code: 'ABCDEF', role: 'host', seed: 777, status: 'active', me: { id: 1, name: 'Alpha' }, opponent: { id: 2, name: 'Bravo' }, urls } }, netA);
const guest = makeClient({ scoreUrl: null, csrf: 'x', match: { code: 'ABCDEF', role: 'guest', seed: 777, status: 'active', me: { id: 2, name: 'Bravo' }, opponent: { id: 1, name: 'Alpha' }, urls } }, netB);
// wire the two fake links together
const la = netA.links[0], lb = netB.links[0]; la.peer = lb; lb.peer = la;
const pump = () => { netA.pump(); netB.pump(); };
assert.strictEqual(host.nq.screen, 'lobby'); assert.strictEqual(guest.nq.screen, 'lobby');
la.opts.onOpen(); lb.opts.onOpen();
assert.strictEqual(host.nq.screen, 'countdown'); assert.strictEqual(guest.nq.screen, 'countdown');
host.frames(183); guest.frames(183);
assert.strictEqual(host.nq.screen, 'playing', 'host playing'); assert.strictEqual(guest.nq.screen, 'playing', 'guest playing');
assert.strictEqual(host.nq.localId, 0); assert.strictEqual(guest.nq.localId, 1);
// Host flies right and shoots, guest buys tanks; run with uneven pacing to exercise stalls
host.key('ArrowUp'); host.key('ArrowRight'); host.key('Space');
guest.key('ArrowUp'); guest.key('ArrowLeft');
guest.nq.sim.players[1].credits = 5000; host.nq.sim.players[1].credits = 5000; // same change on both sides keeps determinism
let maxStall = 0;
for (let i = 0; i < 600; i++) {
    host.frames(1); if (i % 3 !== 0) guest.frames(1); if (i % 7 === 0) guest.frames(3);
    if (i % 50 === 0) { guest.key('Digit2'); }
    if (i % 5 === 0) pump();
    maxStall = Math.max(maxStall, host.nq.net.stalled, guest.nq.net.stalled);
}
for (let i = 0; i < 20; i++) { host.frames(1); guest.frames(1); pump(); }
pump();
const sa = host.nq.sim, sb = guest.nq.sim;
console.log('frames host/guest', sa.frame, sb.frame, 'max stall', maxStall, 'desync', host.nq.net.desync, guest.nq.net.desync);
// bring both to the same frame
while (sb.frame < sa.frame) { guest.frames(1); pump(); }
while (sa.frame < sb.frame) { host.frames(1); pump(); }
assert.strictEqual(sa.frame, sb.frame, 'both at same frame');
assert.strictEqual(host.win.NQSim.hash(sa), guest.win.NQSim.hash(sb), 'lockstep states identical');
assert.ok(!host.nq.net.desync && !guest.nq.net.desync, 'no desync flagged');
assert.ok(sa.players[0].x > 300, 'host chopper moved on both sims: ' + sa.players[0].x);
assert.ok(sb.units.filter(u => u.team === 1).length > 0, 'guest tanks exist on both sims');
assert.ok(maxStall > 0, 'uneven pacing produced stalls that were absorbed');
// End the match: destroy guest base on both sims identically via the sim (simulating gameplay outcome)
[sa, sb].forEach(s => { s.bases[1].health = 1; s.players[0].x = s.bases[1].x - 120; s.players[0].y = s.bases[1].y + 10; s.players[0].dir = 1; s.players[0].invuln = 1e9; });
host.key('ArrowRight', true); host.key('ArrowUp', true);
for (let i = 0; i < 1200 && host.nq.screen !== 'over'; i++) { host.frames(1); guest.frames(1); pump(); }
assert.strictEqual(host.nq.screen, 'over', 'host sees match over'); assert.strictEqual(guest.nq.screen, 'over', 'guest sees match over');
assert.strictEqual(sa.winner, 0, 'host wins'); assert.strictEqual(sb.winner, 0, 'guest agrees host won');
assert.ok(host.fetches.some(f => f.url === '/result' && f.body.winner === 0), 'result posted');
console.log('lockstep client ok');
console.log('all client tests passed');
