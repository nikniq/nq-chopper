/*
 * NQ Chopper client: rendering, input, sound and online lockstep.
 * All gameplay lives in sim.js; this file only feeds it inputs and draws it.
 */
(function () {
    'use strict';

    const Sim = window.NQSim;
    const cfg = window.NQ_CONFIG || {};
    const match = cfg.match || null;
    const daily = cfg.daily || null;   // { seed, day } when playing the Daily Challenge

    // =====================================================================
    // Setup
    // =====================================================================
    const canvas = document.getElementById('gameCanvas');
    const ctx = canvas.getContext('2d');
    const canvasWrapper = document.getElementById('canvasWrapper');
    const fullscreenBtn = document.getElementById('fullscreenBtn');
    const muteBtn = document.getElementById('muteBtn');
    const scoreDiv = document.getElementById('score');
    const touchControls = document.getElementById('touchControls');
    const creditsSpan = document.getElementById('credits');
    const shareBtn = document.getElementById('shareBtn');
    const announcer = document.getElementById('announcer');
    const reducedMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    function track(name, params) { try { if (typeof window.gtag === 'function') window.gtag('event', name, params || {}); } catch (e) { /* ignore */ } }
    // Top pilots fetched for the title and game-over screens
    let board = { rows: null, mode: null, fetchedAt: 0 };
    function loadBoard() {
        if (!cfg.boardUrl || typeof fetch !== 'function') return;
        const m = daily ? 'daily' : 'solo';
        if (board.mode === m && Date.now() - board.fetchedAt < 30000) return;
        board.mode = m; board.fetchedAt = Date.now();
        fetch(cfg.boardUrl + '?mode=' + m, { credentials: 'same-origin', headers: { 'Accept': 'application/json' } })
            .then(r => r.ok ? r.json() : Promise.reject(r.status)).then(d => { board.rows = d.rows || []; }).catch(() => { board.rows = board.rows || []; });
    }
    // On phones the canvas is scaled down; never let HUD text drop below ~10.5 real CSS pixels
    const MIN_CSS_PX = 10.5;
    function hudSize(px) { return isTouch ? Math.max(px, Math.ceil(MIN_CSS_PX / (view.cssPerUnit || 1))) : px; }
    function hudFont(px, bold) { return (bold === false ? '' : 'bold ') + hudSize(px) + 'px Arial'; }
    function drawBoardPanel(x, y, title) {
        if (!cfg.boardUrl) return;
        const rows = board.rows;
        const n = hudSize(10), pitch = n + 5, w = isTouch ? 210 : 190;
        x = Math.min(x, GAME_WIDTH - w - 8);
        ctx.save();
        panel(x, y, w, 22 + pitch * 5 + n + 8);
        ctx.fillStyle = '#ff0'; ctx.font = hudFont(11); ctx.textAlign = 'left'; ctx.fillText(title, x + 8, y + 15);
        ctx.font = hudFont(10);
        const top = y + 20 + n;
        if (!rows) { ctx.fillStyle = '#aaa'; ctx.fillText('loading...', x + 8, top); }
        else if (!rows.length) { ctx.fillStyle = '#aaa'; ctx.fillText('No scores yet. Be the first!', x + 8, top); }
        else rows.slice(0, 5).forEach((r, i) => {
            ctx.fillStyle = r.me ? '#8f8' : '#fff';
            ctx.textAlign = 'left'; ctx.fillText((i + 1) + '. ' + String(r.name).slice(0, 14), x + 8, top + i * pitch, w - 70);
            ctx.textAlign = 'right'; ctx.fillText(String(r.score), x + w - 8, top + i * pitch);
        });
        ctx.fillStyle = '#9cf'; ctx.textAlign = 'left'; ctx.font = hudFont(9, false); ctx.fillText(cfg.scoreUrl ? 'Full board: Leaderboard link above' : 'Log in to save your score', x + 8, top + pitch * 5, w - 16);
        ctx.restore();
    }
    let lastAnnounced = '';
    function announce(text) { if (announcer && text !== lastAnnounced) { lastAnnounced = text; announcer.textContent = text; } }
    const shopButtons = [
        [document.getElementById('buySoldier'), 'soldier'], [document.getElementById('buyTank'), 'tank'],
        [document.getElementById('buyGun'), 'gun'], [document.getElementById('buyArmor'), 'armor'],
        [document.getElementById('buyStrike'), 'strike'], [document.getElementById('rallyBtn'), 'rally'], [document.getElementById('troopsBtn'), 'troops']
    ];

    // Logical viewport: fixed height, width follows the window's aspect ratio so wide screens
    // see more battlefield instead of bigger pixels.
    const GAME_HEIGHT = 400, MIN_GAME_WIDTH = 640, MAX_GAME_WIDTH = 1100;
    let GAME_WIDTH = MIN_GAME_WIDTH;
    const { WORLD_WIDTH, GROUND_Y, MAX_CARRY, MAX_BOMBS, MAX_ALLIES, UNITS, UPGRADES, AI } = Sim;
    const HIGH_SCORE_KEY = 'nqChopperHighScore';
    // Lockstep input latency in ticks. Starts at a guess per transport and adapts to the measured
    // round trip so the game neither stalls (delay too small) nor feels sluggish (delay too big).
    const P2P_DELAY = 5, RELAY_DELAY = 18, MIN_DELAY = 3, MAX_DELAY = 30;
    let INPUT_DELAY = P2P_DELAY;

    const forceTouch = !!(window.location && /[?&]touch=1\b/.test(window.location.search || ''));
    const isTouch = forceTouch || window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
    const playArea = document.getElementById('playArea') || canvasWrapper;
    const shopEl = document.getElementById('shop');
    const nav = window.navigator || {};
    const canFS = !!(playArea.requestFullscreen || playArea.webkitRequestFullscreen) && document.fullscreenEnabled !== false && document.webkitFullscreenEnabled !== false;
    const isIOS = /iP(hone|od)/.test(nav.userAgent || '') || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1);
    const standalone = nav.standalone === true || !!(window.matchMedia && window.matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches);
    const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } };
    const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } };
    function toast(msg, ms) {
        if (!document.createElement || !canvasWrapper.appendChild) return;
        const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
        canvasWrapper.appendChild(t); setTimeout(() => { if (t.remove) t.remove(); }, ms || 4000);
    }
    if (isTouch) {
        document.body.classList.add('touch');
        touchControls.style.display = 'block';
        document.getElementById('keyHelp').style.display = 'none';
        document.getElementById('touchHelp').style.display = '';
        // The shop becomes a pop-up drawer inside the play area so it survives fullscreen
        if (shopEl && canvasWrapper.appendChild) { canvasWrapper.appendChild(shopEl); shopEl.classList.add('drawer'); }
        // Sound, fullscreen and share move into the overlay too, so they stay reachable in fullscreen
        const sys = document.getElementById('sysGroup');
        if (sys && sys.appendChild) ['muteBtn', 'fullscreenBtn', 'shareBtn'].forEach(id => { const el = document.getElementById(id); if (el) sys.appendChild(el); });
        muteBtn.textContent = '🔊'; muteBtn.setAttribute('aria-label', 'Sound');
        fullscreenBtn.textContent = '⛶'; fullscreenBtn.setAttribute('aria-label', 'Fullscreen');
        // iPhone Safari cannot fullscreen a page element: offer Add to Home Screen instead
        if (!canFS) {
            if (standalone) fullscreenBtn.style.display = 'none';
            else if (isIOS) {
                fullscreenBtn.addEventListener('click', () => toast('For full screen: tap Share, then Add to Home Screen'));
                if (lsGet('nqA2hs', '0') !== '1') { lsSet('nqA2hs', '1'); setTimeout(() => toast('Tip: Share → Add to Home Screen plays full screen', 5000), 1500); }
            } else fullscreenBtn.style.display = 'none';
        }
        // Pause button and pause menu (solo): Resume / Restart / Menu
        if (document.createElement && sys && sys.insertBefore) {
            const pb = document.createElement('button'); pb.id = 'pauseBtn'; pb.type = 'button'; pb.textContent = '⏸';
            if (pb.setAttribute) pb.setAttribute('aria-label', 'Pause');
            sys.insertBefore(pb, sys.firstChild);
            const pm = document.createElement('div'); pm.id = 'pauseMenu';
            pm.innerHTML = '<button type="button" class="pm-btn pm-solo" id="pmResume">Resume</button><button type="button" class="pm-btn pm-solo" id="pmRestart">Restart</button><button type="button" class="pm-btn" id="pmMenu">Menu</button>';
            canvasWrapper.appendChild(pm);
        }
    }
    // Analog thumbstick state (touch only). x/y in [-1, 1]. Vertical input goes through a predictive
    // speed controller (touchVertical); horizontal speed is pulse-width modulated via accX.
    const stick = { enabled: isTouch, active: false, x: 0, y: 0, accX: 0, lastKey: 0, holdY: null, wasLocked: false, tie: 0, reset: null };
    // Auto-fire is on by default on touch (frees the right thumb for bombs and boost); remembered per device
    let autoFire = isTouch ? lsGet('nqAuto', '1') === '1' : false;
    let tapFireFrames = 0;
    // First-run touch coach: which lessons the player has already completed (bitmask, per device)
    const COACH_BOARD = 1, COACH_HOME = 2, COACH_PAD = 4, COACH_SHOP = 8;
    let coachBits = parseInt(lsGet('nqCoach', '0'), 10) || 0;
    function coachSet(bit) { if (!(coachBits & bit)) { coachBits |= bit; lsSet('nqCoach', String(coachBits)); } }
    function buzz(pattern) { try { if (isTouch && !Sound.muted && navigator.vibrate) navigator.vibrate(pattern); } catch (e) { /* ignore */ } }

    // ---------------------------------------------------------------------
    // Presentation: fit to window, fullscreen (letterboxed logical view)
    // ---------------------------------------------------------------------
    const view = { scale: 1, ox: 0, oy: 0, dpr: 1, cssPerUnit: 1 };
    let needsRender = true;
    function isFullscreen() { return !!(document.fullscreenElement || document.webkitFullscreenElement); }
    let lastFitKey = '';
    function fitCanvas() {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const wrapper = document.getElementById('gameWrapper');
        // On touch the wrapper padding carries the safe-area insets; read it instead of guessing
        let padX = 24, padTop = 0, padBottom = 16;
        if (isTouch && wrapper && window.getComputedStyle) {
            const cs = window.getComputedStyle(wrapper);
            padX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
            padTop = parseFloat(cs.paddingTop) || 0; padBottom = parseFloat(cs.paddingBottom) || 0;
        }
        let cssW, cssH;
        if (isFullscreen()) {
            cssW = window.innerWidth - (isTouch ? padX : 0); cssH = window.innerHeight - (isTouch ? padTop + padBottom : 0);
            canvasWrapper.style.width = cssW + 'px'; canvasWrapper.style.height = cssH + 'px';
        } else {
            // Measure the page chrome above the canvas rather than guessing its height
            const above = wrapper && wrapper.getBoundingClientRect ? wrapper.getBoundingClientRect().top + (window.scrollY || 0) + padTop : 150;
            const below = padBottom;
            const maxW = Math.max(320, window.innerWidth - padX);
            const maxH = Math.max(200, window.innerHeight - above - below);
            cssH = Math.min(maxH, maxW / (MIN_GAME_WIDTH / GAME_HEIGHT));
            cssW = Math.min(maxW, cssH * (MAX_GAME_WIDTH / GAME_HEIGHT));
        }
        GAME_WIDTH = Math.round(Math.max(MIN_GAME_WIDTH, Math.min(MAX_GAME_WIDTH, GAME_HEIGHT * cssW / cssH)));
        if (!isFullscreen()) {
            cssW = Math.round(cssH * GAME_WIDTH / GAME_HEIGHT); // exact aspect: no letterbox in the page
            canvasWrapper.style.width = cssW + 'px'; canvasWrapper.style.height = Math.round(cssH) + 'px';
        }
        const key = [Math.round(cssW), Math.round(cssH), dpr, GAME_WIDTH, isFullscreen()].join();
        if (key !== lastFitKey) {
            lastFitKey = key;
            canvas.style.transform = 'none';
            canvas.style.width = cssW + 'px'; canvas.style.height = Math.round(cssH) + 'px';
            canvas.width = Math.round(cssW * dpr); canvas.height = Math.round(cssH * dpr);
            view.scale = Math.min(canvas.width / GAME_WIDTH, canvas.height / GAME_HEIGHT);
            view.ox = (canvas.width - GAME_WIDTH * view.scale) / 2;
            view.oy = (canvas.height - GAME_HEIGHT * view.scale) / 2;
            view.dpr = dpr; view.cssPerUnit = view.scale / dpr;
            needsRender = true;
        }
        // Turned to portrait mid-run on a phone: pause until it comes back to landscape
        if (isTouch && window.innerHeight > window.innerWidth && typeof screen === 'string' && mode === 'solo' && screen === 'playing') togglePause();
    }
    window.addEventListener('resize', fitCanvas);
    window.addEventListener('orientationchange', () => setTimeout(fitCanvas, 200));
    ['fullscreenchange', 'webkitfullscreenchange'].forEach(ev => document.addEventListener(ev, fitCanvas));
    // Fullscreen the whole play area (canvas + touch controls + shop drawer), then lock landscape on phones.
    // Note: `screen` is shadowed by the game-state variable below, so use window.screen explicitly.
    function goFullscreen() {
        if (!canFS || isFullscreen()) return;
        const req = playArea.requestFullscreen || playArea.webkitRequestFullscreen;
        if (!req) return;
        try {
            const r = req.call(playArea, { navigationUI: 'hide' });
            const lock = () => { const o = window.screen && window.screen.orientation; if (isTouch && o && o.lock) o.lock('landscape').catch(() => {}); };
            if (r && r.then) r.then(lock).catch(() => {}); else lock();
        } catch (e) { /* ignore */ }
    }
    fullscreenBtn.addEventListener('click', goFullscreen);

    // ---------------------------------------------------------------------
    // Sound (synthesised, no assets)
    // ---------------------------------------------------------------------
    const Sound = (() => {
        let ac = null, muted = false, primed = false, lastResume = 0;
        function get() {
            if (!ac) { try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { ac = null; } }
            if (ac && ac.state !== 'running' && ac.state !== 'closed') {
                const now = performance.now();
                if (now - lastResume > 500) { lastResume = now; try { const r = ac.resume(); if (r && r.catch) r.catch(() => {}); } catch (e) { /* ignore */ } }
            }
            return ac;
        }
        // Called from user gestures: resume, and play one silent buffer so iOS unlocks output
        function unlock() {
            const a = get(); if (!a) return;
            if (a.state !== 'running') { try { const r = a.resume(); if (r && r.catch) r.catch(() => {}); } catch (e) { /* ignore */ } }
            if (!primed) { try { const b = a.createBuffer(1, 1, 22050), src = a.createBufferSource(); src.buffer = b; src.connect(a.destination); src.start(0); primed = true; } catch (e) { /* ignore */ } }
        }
        function tone(type, f0, f1, dur, vol, delay) {
            const a = get(); if (!a || muted) return;
            const t = a.currentTime + (delay || 0);
            const o = a.createOscillator(), g = a.createGain();
            o.type = type;
            o.frequency.setValueAtTime(f0, t);
            o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
            g.gain.setValueAtTime(vol, t);
            g.gain.exponentialRampToValueAtTime(0.001, t + dur);
            o.connect(g).connect(a.destination);
            o.start(t); o.stop(t + dur + 0.05);
        }
        function noise(dur, vol, cutoff) {
            const a = get(); if (!a || muted) return;
            const n = Math.floor(a.sampleRate * dur);
            const buf = a.createBuffer(1, n, a.sampleRate);
            const d = buf.getChannelData(0);
            for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
            const src = a.createBufferSource(); src.buffer = buf;
            const f = a.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cutoff || 1200;
            const g = a.createGain(); g.gain.value = vol;
            src.connect(f).connect(g).connect(a.destination);
            src.start();
        }
        return {
            unlock,
            resumeQuiet() { if (ac && ac.state !== 'running' && ac.state !== 'closed') { try { const r = ac.resume(); if (r && r.catch) r.catch(() => {}); } catch (e) { /* ignore */ } } },
            shoot() { tone('square', 900, 250, 0.07, 0.06); },
            enemyShoot() { tone('square', 400, 150, 0.08, 0.03); },
            bomb() { tone('sine', 300, 80, 0.3, 0.1); },
            explode(big) { noise(big ? 0.5 : 0.3, big ? 0.5 : 0.3, 900); tone('sawtooth', 140, 30, big ? 0.5 : 0.3, 0.2); },
            hit() { noise(0.12, 0.25, 2500); tone('square', 200, 80, 0.12, 0.1); },
            pickup() { tone('triangle', 500, 900, 0.12, 0.12); },
            dropoff() { [523, 659, 784, 1047].forEach((f, i) => tone('triangle', f, f, 0.16, 0.12, i * 0.09)); },
            heal() { tone('sine', 700, 900, 0.05, 0.04); },
            deploy() { [440, 660].forEach((f, i) => tone('square', f, f, 0.08, 0.08, i * 0.08)); },
            rifle() { tone('square', 1400, 500, 0.04, 0.03); },
            shell() { noise(0.1, 0.15, 1800); tone('square', 300, 120, 0.1, 0.05); },
            denied() { tone('sawtooth', 200, 150, 0.12, 0.06); },
            wave() { [392, 523, 659, 784].forEach((f, i) => tone('square', f, f, 0.2, 0.08, i * 0.12)); },
            die() { noise(0.9, 0.5, 600); tone('sawtooth', 220, 20, 1.0, 0.25); },
            toggleMute() { muted = !muted; return muted; },
            get muted() { return muted; }
        };
    })();
    function toggleMute() { const m = Sound.toggleMute(); muteBtn.textContent = document.body.classList.contains('touch') ? (m ? '🔇' : '🔊') : (m ? 'Sound: Off' : 'Sound: On'); muteBtn.setAttribute('aria-pressed', m ? 'true' : 'false'); }
    muteBtn.addEventListener('click', toggleMute);
    // Unlock audio on every kind of activation gesture (iOS needs touchend/pointerup, not pointerdown)
    ['pointerup', 'touchend', 'click', 'keydown'].forEach(ev => document.addEventListener(ev, () => Sound.unlock(), { capture: true, passive: true }));
    try { if (nav.audioSession) nav.audioSession.type = 'playback'; } catch (e) { /* ignore */ }

    // ---------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const rand = (a, b) => a + Math.random() * (b - a);
    const pick = arr => arr[Math.floor(Math.random() * arr.length)];
    const cx = o => o.x + o.width / 2, cy = o => o.y + o.height / 2;
    function loadHighScore() { try { return parseInt(localStorage.getItem(HIGH_SCORE_KEY), 10) || 0; } catch (e) { return 0; } }
    function saveHighScore(v) { try { localStorage.setItem(HIGH_SCORE_KEY, String(v)); } catch (e) { /* ignore */ } }
    const TEAM_COLORS = { 0: { body: '#3c3', glass: '#9ff', unit: '#5a7a3a', unitDark: '#3d5a28', cloth: '#4b7a3a', ui: '#8f8' },
        1: { body: '#39f', glass: '#dff', unit: '#3a5a8a', unitDark: '#28405e', cloth: '#3a5a8a', ui: '#9cf' },
        [AI]: { body: '#d33', glass: '#fff', unit: '#b22', unitDark: '#801515', cloth: '#a33', ui: '#f66' } };
    const colorsOf = team => TEAM_COLORS[team] || TEAM_COLORS[0];

    // =====================================================================
    // Session state
    // =====================================================================
    const mode = match ? 'versus' : 'solo';
    let sim = null;
    let screen = 'title';         // solo: title | playing | paused | gameover    versus: lobby | countdown | playing | over
    let screenTimer = 0, frame = 0;
    let highScore = loadHighScore(), newBest = false, submitStatus = '';
    let localId = match && match.role === 'guest' ? 1 : 0;
    let cameraX = 0, shake = 0, particles = [], floatTexts = [];
    const input = { left: false, right: false, up: false, down: false, fire: false, boost: false };
    let bombQueued = false, buyQueued = null;
    const local = () => sim ? sim.players[localId] : null;

    // Scenery generated once
    const clouds = [];
    for (let i = 0; i < 12; i++) clouds.push({ x: rand(0, WORLD_WIDTH), y: rand(20, 150), w: rand(50, 110), speed: rand(0.05, 0.15) });
    const mountainPeriod = 480;
    const farMountains = [], mountains = [], hills = [];
    for (let i = 0; i < 4; i++) farMountains.push({ x: i * 120 + rand(-30, 30), h: rand(90, 170), w: rand(160, 260) });
    for (let i = 0; i < 6; i++) mountains.push({ x: i * 80 + rand(-20, 20), h: rand(50, 120), w: rand(90, 160) });
    for (let i = 0; i < 5; i++) hills.push({ x: i * 100 + rand(-20, 20), h: rand(18, 42), w: rand(90, 160) });
    const trees = [], grass = [], rocks = [];
    for (let x = 160; x < WORLD_WIDTH - 160; x += rand(60, 140)) if (Math.random() < 0.7) trees.push({ x, h: rand(26, 46), palm: Math.random() < 0.5, lean: rand(-0.15, 0.15) });
    for (let x = 0; x < WORLD_WIDTH; x += rand(14, 30)) grass.push({ x, h: rand(3, 7), ph: rand(0, 6) });
    for (let x = 0; x < WORLD_WIDTH; x += rand(90, 220)) rocks.push({ x, w: rand(6, 14), h: rand(3, 6) });
    const stars = [];
    for (let i = 0; i < 100; i++) stars.push({ x: rand(0, MAX_GAME_WIDTH), y: rand(0, 200), r: rand(0.5, 1.4), tw: rand(0, 6) });
    // Client-only effect lists
    let rings = [], screenFlash = 0;
    const MAX_PARTICLES = 350;
    // Cached gradients and sprites (gradient objects are expensive to create every frame)
    const cache = {};
    function cached(key, make) { return cache[key] || (cache[key] = make()); }
    function makeSprite(size, draw) { const c = document.createElement('canvas'); c.width = c.height = size; const g = c.getContext('2d'); if (g) draw(g, size); return c; }
    const glowSprite = (col) => cached('glow' + col, () => makeSprite(16, (g, n) => { const r = g.createRadialGradient(n / 2, n / 2, 1, n / 2, n / 2, n / 2); r.addColorStop(0, col); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, n, n); }));
    const isVisible = (x, margin) => x > cameraX - (margin || 60) && x < cameraX + GAME_WIDTH + (margin || 60);
    function rrect(x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
    function panel(x, y, w, h) { ctx.fillStyle = 'rgba(8,12,20,0.66)'; rrect(x, y, w, h, 6); ctx.fill(); ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 1; ctx.stroke(); ctx.fillStyle = 'rgba(255,255,255,0.06)'; rrect(x, y, w, Math.min(10, h / 3), 6); ctx.fill(); }
    let craters = [];
    const MAX_CRATERS = 40;
    const birds = [];
    for (let i = 0; i < 4; i++) birds.push({ x: rand(0, WORLD_WIDTH), y: rand(40, 140), n: 3 + Math.floor(rand(0, 4)), speed: rand(0.3, 0.6), ph: rand(0, 6) });
    const SHIRTS = ['#fd4', '#f88', '#8cf', '#fff', '#fb6', '#cfc'];
    const shirtOf = h => SHIRTS[Math.floor(Math.abs(h.x * 7.13)) % SHIRTS.length];

    // =====================================================================
    // Effects (client-only, fed by sim.fx)
    // =====================================================================
    function spawnParticles(x, y, n, o) {
        if (!isVisible(x, 120)) return;
        if (particles.length > MAX_PARTICLES) n = Math.min(n, 3);
        for (let i = 0; i < n; i++) {
            const a = Math.random() * Math.PI * 2, s = o.speed * (0.3 + Math.random());
            const life = o.life * (0.6 + Math.random() * 0.6);
            particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - (o.up || 0), life, maxLife: life,
                color: pick(o.colors), size: o.size * (0.5 + Math.random()), gravity: o.gravity || 0, grow: o.grow || 0, streak: !!o.streak, debris: !!o.debris, rot: Math.random() * 6, spin: rand(-0.3, 0.3) });
        }
    }
    function explosionFx(x, y, big) {
        spawnParticles(x, y, big ? 45 : 18, { speed: big ? 5 : 3, colors: ['#ff3', '#f80', '#f33', '#fff'], size: big ? 6 : 4, life: 35, gravity: 0.08 });
        spawnParticles(x, y, big ? 22 : 8, { speed: 1.2, colors: ['#555', '#777', '#333', '#444'], size: big ? 14 : 10, life: big ? 110 : 70, up: 0.9, grow: 0.12 });
        spawnParticles(x, y, big ? 10 : 4, { speed: 4, colors: ['#ffd', '#fc6'], size: 2, life: 25, gravity: 0.15, streak: true });
        rings.push({ x, y, r: 4, max: big ? 90 : 45, life: 1, color: big ? '255,200,80' : '255,230,150' });
        if (y > GROUND_Y - 30) { craters.push({ x, w: big ? 44 : 26, age: 0 }); if (craters.length > MAX_CRATERS) craters.shift(); }
        if (big) spawnParticles(x, y, 8, { speed: 4, colors: ['#333', '#555', '#222'], size: 5, life: 60, gravity: 0.2, up: 2, debris: true });
        rings.push({ x, y, r: 2, max: big ? 40 : 22, life: 1, color: '255,255,255', fill: true });
        if (Math.abs(x - (cameraX + GAME_WIDTH / 2)) < 500) { shake = Math.max(shake, big ? 14 : 6); if (big) screenFlash = Math.max(screenFlash, 0.5); }
        Sound.explode(big);
    }
    function addText(x, y, text, color, big) {
        ctx.font = (big ? 'bold 18px' : 'bold 12px') + ' Arial';
        const m = ctx.measureText && ctx.measureText(text), w = (m && m.width) || text.length * (big ? 10 : 7), gap = big ? 22 : 16;
        // Don't stack texts on top of each other: nudge the new one up past any overlapping live text
        for (let k = 0; k < 6; k++) {
            const hit = floatTexts.some(o => o.life > 20 && Math.abs(o.y - y) < gap && Math.abs(o.x - x) < (o.w + w) / 2);
            if (!hit) break;
            y -= gap;
        }
        floatTexts.push({ x, y, text, color: color || '#fff', life: 70, big: !!big, w });
    }
    function consumeFx() {
        const near = x => x === undefined || Math.abs(x - (cameraX + GAME_WIDTH / 2)) < 760;
        sim.bullets.forEach(b => { if (b.life === 60) spawnMuzzleFlash(b.x + (b.vx > 0 ? 6 : 2), b.y + 1, b.vx > 0 ? 1 : -1); });
        sim.shells.forEach(b => { if (b.kind === 'rifle' && b.life === 40) spawnMuzzleFlash(b.x, b.y, b.vx > 0 ? 1 : -1); if (b.kind === 'shell' && b.life === 90) spawnMuzzleFlash(b.x, b.y, b.vx > 0 ? 1 : -1); });
        for (const ev of sim.fx) {
            if (ev.t === 'snd') { if (Sound[ev.name]) Sound[ev.name](); if (ev.name === 'die' && local() && !local().alive) buzz([80, 40, 160]); }
            else if (ev.t === 'txt') addText(ev.x, ev.y, ev.msg, ev.color, ev.big);
            else if (ev.t === 'p') spawnParticles(ev.x, ev.y, ev.n, ev.o);
            else if (ev.t === 'x') { if (near(ev.x)) { explosionFx(ev.x, ev.y, ev.big); if (ev.big && Math.abs(ev.x - (cameraX + GAME_WIDTH / 2)) < 400) buzz(40); } }
            else if (ev.t === 'shake') { if (ev.team === undefined || ev.team === localId) { shake = Math.max(shake, ev.v); if (ev.team === localId) buzz(25); } }
        }
    }
    function updateEffects() {
        if (particles.length > MAX_PARTICLES + 100) particles.splice(0, particles.length - MAX_PARTICLES);
        for (let i = particles.length - 1; i >= 0; i--) {
            const p = particles[i];
            p.x += p.vx; p.y += p.vy; p.vy += p.gravity; p.vx *= 0.98; p.life--; p.size += p.grow;
            if (p.y > GROUND_Y + 4) { p.y = GROUND_Y + 4; p.vy *= -0.3; }
            if (p.life <= 0) particles.splice(i, 1);
        }
        for (let i = floatTexts.length - 1; i >= 0; i--) {
            const t = floatTexts[i]; t.y -= 0.5; t.life--;
            if (t.life <= 0) floatTexts.splice(i, 1);
        }
        for (let i = rings.length - 1; i >= 0; i--) {
            const r = rings[i]; r.r += (r.max - r.r) * 0.18; r.life -= 0.06;
            if (r.life <= 0) rings.splice(i, 1);
        }
        if (screenFlash > 0) screenFlash = Math.max(0, screenFlash - 0.05);
        if (reducedMotion) shake = 0;
        if (shake > 0) shake *= 0.85;
        if (shake < 0.5) shake = 0;
        if (sim) { emitTrails(); emitWeather(); }
    }
    // Ambient weather per biome: blowing sand, snowfall, rising embers
    function emitWeather() {
        if (!sim || lowDetail || particles.length > MAX_PARTICLES - 40) return;
        const w = biome().weather;
        if (!w || frame % (w === 'snow' ? 1 : 2)) return;
        const x = cameraX + rand(-40, GAME_WIDTH + 40);
        if (w === 'sand') particles.push({ x, y: rand(GROUND_Y - 70, GROUND_Y), vx: rand(2, 4), vy: rand(-0.3, 0.1), life: 50, maxLife: 50, color: 'rgba(230,200,140,0.6)', size: rand(1.5, 3), gravity: 0 });
        else if (w === 'snow') particles.push({ x, y: -5, vx: rand(-0.4, 0.4), vy: rand(0.6, 1.3), life: 400, maxLife: 400, color: 'rgba(255,255,255,0.9)', size: rand(1.5, 3), gravity: 0, grow: 0 });
        else if (w === 'ember') particles.push({ x, y: GROUND_Y + 2, vx: rand(-0.3, 0.3), vy: -rand(0.6, 1.4), life: 90, maxLife: 90, color: pick(['#ff7a2a', '#ffb347', '#ff4a1a']), size: rand(1.5, 2.5), gravity: -0.005 });
    }
    // Smoke trails behind shells and bombs, exhaust behind fast choppers
    function emitTrails() {
        if (frame % 2 || particles.length > (lowDetail ? 120 : MAX_PARTICLES) || lowDetail && frame % 4) return;
        sim.shells.forEach(b => { if (isVisible(b.x) && (b.kind === 'shell' || b.kind === 'aa' || b.kind === 'heli')) particles.push({ x: b.x, y: b.y, vx: rand(-0.2, 0.2), vy: rand(-0.3, 0), life: 22, maxLife: 22, color: b.kind === 'heli' ? '#8ff' : '#bbb', size: 3, gravity: -0.01, grow: 0.08 }); });
        sim.bombs.forEach(b => isVisible(b.x) && particles.push({ x: b.x, y: b.y - 6, vx: rand(-0.2, 0.2), vy: -0.4, life: 26, maxLife: 26, color: '#ccc', size: 3, gravity: -0.01, grow: 0.08 }));
        sim.players.forEach(p => {
            // Rotor wash kicks up dust when hovering low
            const alt = GROUND_Y - (p.y + p.height);
            if (p.alive && alt < 70 && isVisible(p.x) && particles.length < MAX_PARTICLES) {
                const k = 1 - alt / 70, side = Math.random() < 0.5 ? -1 : 1;
                particles.push({ x: cx(p) + side * rand(10, 30), y: GROUND_Y - 1, vx: side * rand(0.8, 2.2) * k, vy: -rand(0.2, 0.9) * k, life: 28, maxLife: 28, color: pick(['#c9a874', '#b89a68', '#d8c090']), size: 3 + k * 3, gravity: 0.01, grow: 0.1 });
            }
        });
        sim.players.forEach(p => { if (p.alive && p.boosting && isVisible(p.x)) for (let i = 0; i < 2; i++) particles.push({ x: cx(p) - p.dir * (28 + i * 6), y: p.y + 6 + rand(-2, 2), vx: -p.dir * rand(3, 5), vy: rand(-0.4, 0.4), life: 14, maxLife: 14, color: pick(['#ff9a3c', '#ffd27a', '#fff3c4']), size: 4 - i, gravity: 0 }); });
        sim.players.forEach(p => { if (p.alive && Math.abs(p.vx) > 2.2 && isVisible(p.x)) particles.push({ x: cx(p) - p.dir * 26, y: p.y + 8, vx: -p.dir * 0.6, vy: -0.5, life: 20, maxLife: 20, color: '#8899aa', size: 3, gravity: -0.02, grow: 0.1 }); });
    }
    function spawnMuzzleFlash(x, y, dir) {
        rings.push({ x, y, r: 1, max: 9, life: 0.6, color: '255,240,160', fill: true });
        spawnParticles(x + dir * 4, y, 3, { speed: 2, colors: ['#ffa', '#fc8'], size: 2, life: 8 });
    }

    // =====================================================================
    // Input capture -> sim input struct
    // =====================================================================
    // ---- Touch flight controller -----------------------------------------------------------
    // Client-side input shaping only: it chooses the same u/d/l/r bits a keyboard could send, so the
    // simulation and online lockstep are untouched. The stick sets a target climb/sink RATE instead
    // of raw thrust: centre/release holds altitude, pushing sets a speed, descent is capped near the
    // ground so touchdowns are soft, and a landed chopper stays parked until a clear upward push.
    const VDZ = 0.15, DOWN_MAX = 3.6, UP_MAX = 4.5, HOLD_GAIN = 0.06, HOLD_MAX = 1.5, TAKEOFF = -0.25, TAKEOFF_LOCKED = -0.35;
    // Mirrors the vertical rules of updatePlayer() in sim.js (u -0.5, gravity +0.25, d +0.3, clamp, ceiling, ground).
    function vstep(st, u, d, h) {
        let vy = clamp(st.vy - (u ? 0.5 : 0) + 0.25 + (d ? 0.3 : 0), -4.5, 5), y = st.y + vy, landed = false;
        if (y < 26) { y = 26; vy = Math.max(0, vy); }
        if (y + h >= GROUND_Y) { y = GROUND_Y - h; vy = 0; landed = true; }
        return { y, vy, landed };
    }
    // Online, our inputs apply INPUT_DELAY frames late: predict where the chopper will be by then
    function predictLocal(p) {
        let st = { y: p.y, vy: p.vy, landed: p.landed };
        if (mode !== 'solo' && sim) for (let g = sim.frame; g < sim.frame + INPUT_DELAY; g++) { const q = net.localInputs[g]; if (!q) break; st = vstep(st, q.u, q.d, p.height); }
        return st;
    }
    function touchVertical(stk, pr, h) {
        const ay = Math.abs(stk.y);
        const yy = stk.active && ay > VDZ ? Math.sign(stk.y) * (ay - VDZ) / (1 - VDZ) : 0;
        if (pr.landed && !(stk.active && stk.y < (stk.wasLocked ? TAKEOFF_LOCKED : TAKEOFF))) { stk.wasLocked = true; stk.holdY = null; return { u: 0, d: 0 }; }
        stk.wasLocked = false;
        let target;
        if (stk.active && yy !== 0) { target = yy > 0 ? yy * DOWN_MAX : yy * UP_MAX; stk.holdY = null; }
        else if (stk.holdY === null) { target = 0; if (Math.abs(pr.vy) <= 0.5) stk.holdY = pr.y; }
        else target = clamp((stk.holdY - pr.y) * HOLD_GAIN, -HOLD_MAX, HOLD_MAX);
        const alt = GROUND_Y - (pr.y + h);
        target = Math.min(target, 1.2 + 0.04 * alt, 4.0);
        let best = { u: 0, d: 0 }, bestErr = Infinity;
        for (const c of [[0, 0], [1, 0], [0, 1]]) {
            const err = Math.abs(clamp(pr.vy - 0.5 * c[0] + 0.25 + 0.3 * c[1], -4.5, 5) - target);
            if (err < bestErr - 1e-9) { best = { u: c[0], d: c[1] }; bestErr = err; }
            else if (Math.abs(err - bestErr) <= 1e-9 && c[0] === 1 && best.u === 0 && best.d === 0) { stk.tie ^= 1; if (stk.tie) best = { u: 1, d: 0 }; }
        }
        return best;
    }
    function captureInput() {
        const o = { l: input.left ? 1 : 0, r: input.right ? 1 : 0, u: input.up ? 1 : 0, d: input.down ? 1 : 0, f: (input.fire || autoFire || tapFireFrames > 0) ? 1 : 0, b: bombQueued ? 1 : 0, bo: input.boost ? 1 : 0, buy: buyQueued };
        bombQueued = false; buyQueued = null;
        if (tapFireFrames > 0) tapFireFrames--;
        // Touch thumbstick, unless the keyboard was used in the last 8 s
        if (stick.enabled && Date.now() - stick.lastKey > 8000) {
            const p = local();
            if (p && p.alive) { const v = touchVertical(stick, predictLocal(p), p.height); o.u = v.u; o.d = v.d; }
            else { stick.holdY = null; o.u = o.d = 0; }
            let hx = stick.active ? clamp((Math.abs(stick.x) - 0.18) / 0.7, 0, 1) : 0;
            if (input.boost && hx > 0 && p && !p.landed) { hx = 1; stick.accX = 0; } // boosting means full speed
            stick.accX += hx;
            const pulse = stick.accX >= 1 ? 1 : 0; if (pulse) stick.accX -= 1;
            o.l = stick.x < 0 && pulse ? 1 : 0; o.r = stick.x > 0 && pulse ? 1 : 0;
            // Boost with the stick centred: sprint the way the chopper is facing
            if (input.boost && hx === 0 && p && !p.landed) { if (p.dir < 0) o.l = 1; else o.r = 1; }
        }
        return o;
    }
    const packInput = i => [(i.l ? 1 : 0) | (i.r ? 2 : 0) | (i.u ? 4 : 0) | (i.d ? 8 : 0) | (i.f ? 16 : 0) | (i.b ? 32 : 0) | (i.bo ? 64 : 0), i.buy || 0];
    const unpackInput = a => ({ l: a[0] & 1, r: a[0] & 2, u: a[0] & 4, d: a[0] & 8, f: a[0] & 16, b: a[0] & 32, bo: a[0] & 64, buy: a[1] || null });
    const clearInput = () => { Object.keys(input).forEach(k => input[k] = false); bombQueued = false; buyQueued = null; tapFireFrames = 0; };

    // =====================================================================
    // Solo mode
    // =====================================================================
    function startSolo() {
        sim = Sim.createGame({ mode: 'solo', seed: daily ? daily.seed | 0 : (Date.now() ^ (Math.random() * 0x7fffffff)) | 0 });
        particles = []; floatTexts = []; rings = []; craters = []; screenFlash = 0; newBest = false; submitStatus = '';
        if (shareBtn) shareBtn.style.display = 'none';
        track('game_start', { mode: daily ? 'daily' : 'solo' });
        screen = 'playing'; screenTimer = 0;
        consumeFx();
    }
    function togglePause() {
        if (mode !== 'solo') return;
        if (screen === 'playing') { screen = 'paused'; clearInput(); closeShop(); resetTouch(); }
        else if (screen === 'paused') screen = 'playing';
        needsRender = true;
    }
    // Back to the title screen (touch pause menu / game over menu)
    function quitToMenu() {
        closeShop(); resetTouch(); clearInput();
        sim = Sim.createGame({ mode: 'solo', seed: 1 }); sim.fx = [];
        screen = 'title'; screenTimer = 0; particles = []; floatTexts = []; rings = []; craters = [];
        try { const ex = document.exitFullscreen || document.webkitExitFullscreen; if (isFullscreen() && ex) { const r = ex.call(document); if (r && r.catch) r.catch(() => {}); } } catch (e) { /* ignore */ }
        try { const o = window.screen && window.screen.orientation; if (o && o.unlock) o.unlock(); } catch (e) { /* ignore */ }
        needsRender = true;
    }
    function primaryAction() {
        if (isTouch && (screen === 'title' || screen === 'lobby')) goFullscreen();
        if (mode === 'solo') {
            if (screen === 'title') startSolo();
            else if (screen === 'gameover') { if (screenTimer > 30) startSolo(); }
            else if (screen === 'paused') togglePause();
        } else if (screen === 'over' && screenTimer > 60) {
            window.location.href = match.urls.lobby;
        }
    }
    function soloTick() {
        if (screen !== 'playing') return;
        Sim.step(sim, [captureInput()]);
        consumeFx();
        if (sim.status === 'over') {
            screen = 'gameover'; screenTimer = 0; clearInput();
            const p = local();
            if (p.score > highScore) { highScore = p.score; newBest = true; saveHighScore(highScore); }
            submitScore(p);
            if (shareBtn) shareBtn.style.display = '';
            track('game_over', { mode: daily ? 'daily' : 'solo', score: p.score, wave: sim.wave, rescued: p.rescued, new_best: newBest });
            setTimeout(() => { board.fetchedAt = 0; }, 1500);
        }
    }
    if (cfg.pingUrl && typeof fetch === 'function') {
        setInterval(() => { if (!document.hidden) fetch(cfg.pingUrl, { credentials: 'same-origin', headers: { 'Accept': 'application/json' } }).catch(() => {}); }, 5 * 60 * 1000);
    }
    function submitScore(p) {
        if (!cfg.scoreUrl || typeof fetch !== 'function') return;
        submitStatus = 'SAVING SCORE...';
        fetch(cfg.scoreUrl, { method: 'POST', credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'X-CSRF-TOKEN': cfg.csrf },
            body: JSON.stringify({ score: p.score, wave: sim.wave, rescued: p.rescued, mode: daily ? 'daily' : 'solo', day: daily ? daily.day : null }) })
            .then(r => r.ok ? r.json() : Promise.reject(r.status))
            .then(d => { submitStatus = (daily ? 'DAILY RANK #' : 'SCORE SAVED  ·  RANK #') + d.rank + '  ·  ' + (daily ? 'TODAY\'S BEST ' : 'ONLINE BEST ') + d.best; })
            .catch(() => { submitStatus = 'COULD NOT SAVE SCORE'; });
    }

    // =====================================================================
    // Versus mode: lobby + lockstep
    // =====================================================================
    const net = { link: null, status: '', level: '', transport: null, rtt: 0, pings: {}, lastPing: 0, localInputs: [], remoteInputs: [], remoteHashes: {}, localHashes: {}, stalled: 0, desync: false, posted: false, opponent: match ? match.opponent : null };
    function startVersus() {
        if (match.status === 'finished') { net.status = 'THIS MATCH HAS ALREADY FINISHED'; net.level = 'error'; screen = 'lobby'; return; }
        screen = 'lobby';
        net.link = window.NQNet.createLink({
            code: match.code, role: match.role, urls: match.urls, csrf: cfg.csrf, opponent: match.opponent, ice: match.ice,
            onStatus(msg, level) { net.status = msg; net.level = level || ''; },
            onOpponent(op) { net.opponent = op; },
            onOpen(kind) { net.transport = kind; if (kind === 'relay') INPUT_DELAY = RELAY_DELAY; if (!sim) beginMatch(); },
            onTransport(kind) { net.transport = kind; net.rtt = 0; if (kind === 'relay' && INPUT_DELAY < RELAY_DELAY) INPUT_DELAY = RELAY_DELAY; },
            onMessage(m) { onNetMessage(m); },
            onClose(msg) { onNetClosed(msg); }
        });
    }
    function beginMatch() {
        const names = match.role === 'host' ? [match.me.name, net.opponent ? net.opponent.name : 'GUEST'] : [net.opponent ? net.opponent.name : 'HOST', match.me.name];
        sim = Sim.createGame({ mode: match.mode === 'coop' ? 'coop' : 'versus', seed: match.seed, names });
        for (let f = 0; f < INPUT_DELAY; f++) { net.localInputs[f] = Sim.EMPTY; net.remoteInputs[f] = Sim.EMPTY; }
        particles = []; floatTexts = []; consumeFx();
        screen = 'countdown'; screenTimer = 0;
        Sound.wave();
        track('match_start', { mode: sim.mode, role: match.role, transport: net.transport || 'unknown' });
    }
    function onNetMessage(m) {
        if (m.t === 'i') net.remoteInputs[m.f] = unpackInput(m.i);
        else if (m.t === 'p') net.link.send({ t: 'q', s: m.s });
        else if (m.t === 'q') { const sent = net.pings[m.s]; if (sent) { delete net.pings[m.s]; const r = performance.now() - sent; net.rtt = net.rtt ? net.rtt * 0.7 + r * 0.3 : r; } }
        else if (m.t === 'h') {
            net.remoteHashes[m.f] = m.h;
            if (net.localHashes[m.f] !== undefined && net.localHashes[m.f] !== m.h) flagDesync();
        }
    }
    function flagDesync() {
        if (net.desync) return;
        net.desync = true;
        if (sim && sim.status !== 'over') { sim.status = 'over'; sim.winner = null; sim.endReason = 'DESYNC'; }
    }
    function onNetClosed(msg) {
        if (!sim || screen === 'over') return;
        if (screen === 'countdown' || screen === 'playing') {
            if (sim.status !== 'over') { sim.status = 'over'; sim.winner = localId; sim.endReason = msg || 'OPPONENT DISCONNECTED'; }
        }
    }
    function versusTick() {
        if (screen === 'countdown') {
            if (++screenTimer >= 180) { screen = 'playing'; screenTimer = 0; }
            return;
        }
        if (screen !== 'playing') return;
        const f = sim.frame;
        // Ping once a second and retune the delay: half the RTT plus a safety margin, in ticks
        if (f - net.lastPing >= 60) {
            net.lastPing = f; const id = f; net.pings[id] = performance.now(); net.link.send({ t: 'p', s: id });
            for (const k of Object.keys(net.pings)) if (k < f - 600) delete net.pings[k];
            if (net.rtt || net.transport === 'relay') {
                const want = net.rtt ? clamp(Math.ceil((net.rtt / 2 + (net.transport === 'relay' ? 160 : 25)) / STEP) + 1, MIN_DELAY, MAX_DELAY) : RELAY_DELAY;
                if (want > INPUT_DELAY + 1 || want < INPUT_DELAY - 2) {
                    // Growing the delay must not leave a gap of frames the opponent never receives
                    const cur = captureInput();
                    for (let g = f + INPUT_DELAY; g < f + want; g++) if (net.localInputs[g] === undefined) { net.localInputs[g] = cur; net.link.send({ t: 'i', f: g, i: packInput(cur) }); }
                    INPUT_DELAY = want;
                }
            }
        }
        if (net.localInputs[f + INPUT_DELAY] === undefined) {
            const inp = captureInput();
            net.localInputs[f + INPUT_DELAY] = inp;
            net.link.send({ t: 'i', f: f + INPUT_DELAY, i: packInput(inp) });
        }
        if (net.remoteInputs[f] === undefined) { net.stalled++; return; }
        net.stalled = 0;
        const inputs = localId === 0 ? [net.localInputs[f], net.remoteInputs[f]] : [net.remoteInputs[f], net.localInputs[f]];
        Sim.step(sim, inputs);
        delete net.localInputs[f]; delete net.remoteInputs[f];
        consumeFx();
        if (sim.frame % 60 === 0) {
            const h = Sim.hash(sim);
            net.localHashes[sim.frame] = h;
            net.link.send({ t: 'h', f: sim.frame, h });
            if (net.remoteHashes[sim.frame] !== undefined && net.remoteHashes[sim.frame] !== h) flagDesync();
            for (const k of Object.keys(net.localHashes)) if (k < sim.frame - 600) { delete net.localHashes[k]; delete net.remoteHashes[k]; }
        }
    }
    function postMatchResult() {
        if (net.posted || typeof fetch !== 'function') return;
        net.posted = true;
        fetch(match.urls.result, { method: 'POST', credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'X-CSRF-TOKEN': cfg.csrf },
            body: JSON.stringify({ winner: sim.mode === 'coop' ? null : sim.winner, reason: (sim.endReason || 'FINISHED').slice(0, 40), scores: sim.players.map(p => p.score), wave: sim.mode === 'coop' ? sim.wave : null }) }).catch(() => {});
    }

    // =====================================================================
    // Main update (fixed 60 Hz)
    // =====================================================================
    let lastScreenAttr = null, shopWave = 0;
    function update() {
        frame++;
        // Shopping on a phone: solo time runs at half speed while the drawer is open
        if (mode === 'solo') { if (!(isTouch && shopOpen() && screen === 'playing' && (frame & 1))) soloTick(); }
        else versusTick();
        if (shopOpen() && (screen !== 'playing' || (sim && sim.wave !== shopWave))) closeShop();
        if (sim && mode === 'versus' && sim.status === 'over' && screen !== 'over') {
            screen = 'over'; screenTimer = 0; clearInput();
            postMatchResult();
            track('match_end', { mode: sim.mode, result: sim.mode === 'coop' ? 'mission_over' : sim.winner === localId ? 'win' : sim.winner === null ? 'draw' : 'loss', reason: sim.endReason || '', wave: sim.wave, transport: net.transport || 'unknown' });
            setTimeout(() => net.link && net.link.close(), 1500);
        }
        if (screen !== 'playing' && screen !== 'countdown') screenTimer++;
        if (screen !== 'paused') updateEffects();
        // Camera follows the local chopper
        if (sim) {
            const p = local();
            const targetCam = cx(p) - GAME_WIDTH / 2 + p.dir * 110;
            cameraX += (targetCam - cameraX) * 0.08;
            cameraX = clamp(cameraX, 0, WORLD_WIDTH - GAME_WIDTH);
            if (isTouch) feelTick(p);
        }
        if (frame % 15 === 0) { updateDomScore(); announceScreen(); }
        if (screen !== lastScreenAttr) {
            lastScreenAttr = screen;
            const b = document.body; if (b && b.dataset) { b.dataset.screen = screen; b.dataset.mode = mode; }
        }
        syncWakeLock();
    }
    // Keep the screen awake while playing, counting down or waiting in a lobby
    let wakeLock = null, wakePending = false;
    function syncWakeLock() {
        const wl = nav.wakeLock;
        if (!wl || !wl.request) return;
        const want = !document.hidden && (screen === 'playing' || screen === 'countdown' || screen === 'lobby');
        if (want && !wakeLock && !wakePending) {
            wakePending = true;
            wl.request('screen').then(l => { wakePending = false; wakeLock = l; if (l.addEventListener) l.addEventListener('release', () => { if (wakeLock === l) wakeLock = null; }); }).catch(() => { wakePending = false; });
        } else if (!want && wakeLock) { const l = wakeLock; wakeLock = null; try { const r = l.release(); if (r && r.catch) r.catch(() => {}); } catch (e) { /* ignore */ } }
    }
    function announceScreen() {
        const p = local();
        if (screen === 'title') announce('Title screen. Press Space or tap to start.');
        else if (screen === 'paused') announce('Paused.');
        else if (screen === 'gameover' && p) announce(`Game over. Score ${p.score}, wave ${sim.wave}, ${p.rescued} rescued. Press R or Space to retry.`);
        else if (screen === 'lobby') announce('Online lobby. ' + net.status.toLowerCase());
        else if (screen === 'over' && p) announce((sim.mode === 'coop' ? 'Mission over. ' : sim.winner === localId ? 'Victory. ' : sim.winner === null ? 'Draw. ' : 'Defeat. ') + (sim.endReason || ''));
        else if (screen === 'playing' && sim.mode === 'solo' && sim.status === 'waveclear') announce(`Wave ${sim.wave} clear. Get ready for wave ${sim.wave + 1}.`);
        else if (screen === 'playing' && sim.mode === 'solo' && sim.statusTimer === 0 && sim.frame < 20) announce(`Wave ${sim.wave}, ${biome().name.toLowerCase()} terrain. Rescue the hostages.`);
    }
    function updateDomScore() {
        const p = local();
        if (!p || screen === 'title' || screen === 'lobby') {
            scoreDiv.textContent = mode === 'solo' ? (daily ? `Daily Challenge ${daily.day} | Best: ${highScore}` : `Best: ${highScore}`) : `Online match ${match.code}`;
        } else if (mode === 'solo') {
            scoreDiv.textContent = `Wave ${sim.wave} | Score: ${p.score} | Credits: $${p.credits} | Rescued: ${p.rescued} | Lost: ${p.lost} | Best: ${highScore}`;
        } else if (sim.mode === 'coop') {
            const o = sim.players[1 - localId];
            scoreDiv.textContent = `Co-op Wave ${sim.wave} | Lives ${sim.lives} | ${p.name} ${p.score} + ${o.name} ${o.score} | Credits: $${p.credits}`;
        } else {
            const o = sim.players[1 - localId];
            scoreDiv.textContent = `${p.name} ${p.score} | ${o.name} ${o.score} | Credits: $${p.credits} | Rescued: ${p.rescued}`;
        }
        if (creditsSpan) creditsSpan.textContent = '$' + (p ? p.credits : 0);
        if (isTouch) {
            const live = p && (screen === 'playing' || screen === 'paused');
            const sb = document.getElementById('btnShop'), tb = document.getElementById('btnTroops');
            if (sb) sb.textContent = live ? '$' + p.credits : 'Shop';
            if (tb) {
                const near = live && p.landed && p.troops < Sim.MAX_TROOPS && sim.units.some(u => u.team === p.team && u.type === 'soldier' && Math.abs(cx(u) - cx(p)) < Sim.LOAD_RANGE);
                const can = live && (p.landed ? near : p.troops > 0);
                tb.textContent = !live ? 'Troops' : p.landed ? 'Load ' + p.troops + '/' + Sim.MAX_TROOPS : 'Para ' + p.troops;
                if (tb.classList && tb.classList.toggle) tb.classList.toggle('ctx-off', !can);
                if (tb.setAttribute) tb.setAttribute('aria-disabled', can ? 'false' : 'true');
            }
        }
        const playing = screen === 'playing' && p && p.alive;
        shopButtons.forEach(([btn, type]) => {
            if (!btn) return;
            if (UNITS[type]) {
                btn.disabled = !playing || p.credits < UNITS[type].cost || sim.units.filter(u => u.team === p.team).length >= MAX_ALLIES;
            } else if (type === 'strike') {
                const cd = p ? p.strikeCooldown : 0;
                btn.disabled = !playing || cd > 0 || p.credits < Sim.AIRSTRIKE.cost;
                btn.querySelector('.price').textContent = cd > 0 ? Math.ceil(cd / 60) + 's' : '$' + Sim.AIRSTRIKE.cost;
            } else if (type === 'rally') {
                btn.disabled = !playing;
                btn.textContent = p && p.rally !== null ? 'Release troops' : 'Hold troops here';
            } else if (type === 'troops') {
                btn.disabled = !playing;
                btn.querySelector('.price').textContent = (p ? p.troops : 0) + '/' + Sim.MAX_TROOPS;
                const lbl = btn.querySelector('.lbl'); if (lbl) lbl.textContent = p && p.landed ? 'Load troops' : 'Drop trooper';
            } else {
                const cost = p ? Sim.upgradeCost(p, type) : UPGRADES[type].costs[0], lvl = p ? p.upgrades[type] : 0;
                btn.disabled = !playing || cost === null || p.credits < cost;
                btn.querySelector('.price').textContent = cost === null ? 'MAX' : '$' + cost;
                btn.querySelector('.lvl').textContent = lvl ? ' L' + lvl : '';
            }
        });
    }

    // =====================================================================
    // Rendering
    // =====================================================================
    // Terrain changes every wave (jungle, desert, arctic, volcanic); time of day steps every four waves.
    // Versus matches pick a biome from the shared seed so both players see the same world.
    const BIOMES = [
        { key: 'jungle', name: 'JUNGLE', sky: ['#1b4f9c', '#5fb8f0', '#a8e0ff'], far: 'rgba(90,120,170,0.55)', mtn: '#3c5a86', hills: '#2f7a4a', haze: 'rgba(220,235,255,0.35)',
          grass: ['#3fa63f', '#5ac25a', '#2f8a2f'], soil: ['#6b4a2b', '#3e2a16'], strata: '#5a3d22', rock: '#7a6a5a', trees: ['palm', 'leafy'], density: 1, weather: null },
        { key: 'desert', name: 'DESERT', sky: ['#2a6fb8', '#8fd0f5', '#f6e3b4'], far: 'rgba(200,160,110,0.5)', mtn: '#b98a5a', hills: '#d9b276', haze: 'rgba(255,235,200,0.45)',
          grass: ['#d9b276', '#eacc90', '#b8925c'], soil: ['#c9a06a', '#8a6a3c'], strata: '#a8824e', rock: '#9a8468', trees: ['cactus', 'shrub'], density: 0.55, weather: 'sand' },
        { key: 'arctic', name: 'ARCTIC', sky: ['#5a7fb0', '#b8d4ee', '#eef5ff'], far: 'rgba(170,190,220,0.6)', mtn: '#8fa4c4', hills: '#dbe6f2', haze: 'rgba(255,255,255,0.5)',
          grass: ['#e8f0f8', '#ffffff', '#c7d6e6'], soil: ['#8fa0b4', '#5a6a80'], strata: '#7a8aa0', rock: '#9fb0c4', trees: ['pine', 'pine'], density: 0.8, weather: 'snow' },
        { key: 'volcanic', name: 'VOLCANIC', sky: ['#1a0a10', '#5a1a1a', '#b84a2a'], far: 'rgba(80,40,40,0.7)', mtn: '#3a2424', hills: '#4a2a22', haze: 'rgba(255,120,60,0.18)',
          grass: ['#4a3a34', '#5a4a44', '#3a2a24'], soil: ['#2a1a16', '#120a08'], strata: '#3a2420', rock: '#2a2020', trees: ['dead', 'spire'], density: 0.5, weather: 'ember' }
    ];
    function biome() {
        if (!sim) return BIOMES[0];
        if (sim.mode === 'versus') return BIOMES[Math.abs(sim.seed) % BIOMES.length];
        return BIOMES[(sim.wave - 1) % BIOMES.length];
    }
    function dayPhase() { return sim && sim.mode !== 'versus' ? (Math.floor((sim.wave - 1) / 4) % 4) / 4 : 0.2; }
    const SKIES = [
        ['#1b4f9c', '#5fb8f0', '#a8e0ff'], ['#2a2a6a', '#e07a4a', '#ffd38a'],
        ['#05081c', '#141a3c', '#2b3560'], ['#3a2a5a', '#d87a8a', '#ffd6c2']
    ];
    function drawSky() {
        const ph = dayPhase(), idx = Math.round(ph * 4) % 4, bm = biome();
        const sky = idx === 0 ? bm.sky : SKIES[idx];
        ctx.fillStyle = cached('sky' + idx + bm.key, () => { const g = ctx.createLinearGradient(0, 0, 0, GAME_HEIGHT); g.addColorStop(0, sky[0]); g.addColorStop(0.65, sky[1]); g.addColorStop(1, sky[2]); return g; });
        ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
        if (bm.key === 'volcanic') { ctx.fillStyle = cached('volglow', () => { const g = ctx.createLinearGradient(0, GROUND_Y - 160, 0, GROUND_Y); g.addColorStop(0, 'rgba(255,90,30,0)'); g.addColorStop(1, 'rgba(255,90,30,0.35)'); return g; }); ctx.fillRect(0, GROUND_Y - 160, GAME_WIDTH, 160); }
        const night = ph >= 0.45 && ph < 0.8;
        if (night) {
            stars.forEach(st => { ctx.globalAlpha = 0.5 + 0.5 * Math.abs(Math.sin(frame / 40 + st.tw)); ctx.fillStyle = '#fff'; ctx.fillRect(st.x, st.y, st.r, st.r); });
            ctx.globalAlpha = 1;
        }
        // Sun / moon with glow
        const sx = GAME_WIDTH - 200 - cameraX * 0.02, sy = night ? 100 : 95;
        const glowSize = night ? 140 : 240;
        ctx.drawImage(cached('sunglow' + night, () => makeSprite(glowSize, (g, n) => { const r = g.createRadialGradient(n / 2, n / 2, n * 0.05, n / 2, n / 2, n / 2); r.addColorStop(0, night ? 'rgba(220,230,255,0.35)' : 'rgba(255,240,180,0.55)'); r.addColorStop(1, 'rgba(255,240,180,0)'); g.fillStyle = r; g.fillRect(0, 0, n, n); })), sx - glowSize / 2, sy - glowSize / 2);
        ctx.fillStyle = night ? '#e8ecff' : '#ffe680';
        ctx.beginPath(); ctx.arc(sx, sy, night ? 18 : 26, 0, Math.PI * 2); ctx.fill();
        if (night) { ctx.fillStyle = sky[0]; ctx.beginPath(); ctx.arc(sx + 8, sy - 4, 15, 0, Math.PI * 2); ctx.fill(); }
        if (!night && !lowDetail) {
            ctx.strokeStyle = 'rgba(30,30,40,0.6)'; ctx.lineWidth = 1.2;
            birds.forEach(b => {
                const bx = ((b.x - cameraX * 0.4 + frame * b.speed) % (WORLD_WIDTH + 300) + WORLD_WIDTH + 300) % (WORLD_WIDTH + 300) - 150;
                if (bx < -40 || bx > GAME_WIDTH + 40) return;
                for (let i = 0; i < b.n; i++) { const x = bx + i * 9, y = b.y + Math.abs(i - (b.n - 1) / 2) * 4, f = Math.sin(frame / 6 + b.ph + i) * 2.5; ctx.beginPath(); ctx.moveTo(x - 4, y + f); ctx.lineTo(x, y); ctx.lineTo(x + 4, y + f); ctx.stroke(); }
            });
        }
        ctx.fillStyle = night ? 'rgba(200,205,230,0.35)' : 'rgba(255,255,255,0.85)';
        clouds.forEach(c => {
            const x = ((c.x - cameraX * 0.3 + frame * c.speed) % (WORLD_WIDTH + 200) + WORLD_WIDTH + 200) % (WORLD_WIDTH + 200) - 100;
            if (x < -c.w || x > GAME_WIDTH + c.w) return;
            ctx.beginPath();
            ctx.ellipse(x, c.y, c.w / 2, 12, 0, 0, Math.PI * 2);
            ctx.ellipse(x - c.w / 4, c.y + 4, c.w / 4, 10, 0, 0, Math.PI * 2);
            ctx.ellipse(x + c.w / 4, c.y + 3, c.w / 4, 11, 0, 0, Math.PI * 2);
            ctx.fill();
        });
    }
    // Snow caps or lava tips on the mountain peaks
    function drawCaps(items, factor, color) {
        const off = (cameraX * factor) % mountainPeriod;
        ctx.fillStyle = color;
        for (let k = -1; k <= Math.ceil(GAME_WIDTH / mountainPeriod) + 1; k++) {
            const sx = k * mountainPeriod - off;
            items.forEach(m => {
                const capH = m.h * 0.28, capW = m.w * 0.28;
                ctx.beginPath(); ctx.moveTo(sx + m.x - capW / 2, GROUND_Y - m.h + capH); ctx.lineTo(sx + m.x, GROUND_Y - m.h); ctx.lineTo(sx + m.x + capW / 2, GROUND_Y - m.h + capH);
                ctx.lineTo(sx + m.x + capW / 4, GROUND_Y - m.h + capH * 0.8); ctx.lineTo(sx + m.x, GROUND_Y - m.h + capH * 1.1); ctx.lineTo(sx + m.x - capW / 4, GROUND_Y - m.h + capH * 0.8); ctx.closePath(); ctx.fill();
            });
        }
    }
    function drawLayer(items, factor, color, baseY) {
        const off = (cameraX * factor) % mountainPeriod;
        ctx.fillStyle = color;
        for (let k = -1; k <= Math.ceil(GAME_WIDTH / mountainPeriod) + 1; k++) {
            const sx = k * mountainPeriod - off;
            items.forEach(m => {
                ctx.beginPath();
                ctx.moveTo(sx + m.x - m.w / 2, baseY); ctx.lineTo(sx + m.x, baseY - m.h); ctx.lineTo(sx + m.x + m.w / 2, baseY);
                ctx.closePath(); ctx.fill();
            });
        }
    }
    function drawTree(t) {
        const bm = biome(), kind = bm.trees[t.palm ? 0 : 1];
        ctx.save(); ctx.translate(t.x, GROUND_Y); ctx.rotate(t.lean);
        if (kind === 'cactus') {
            ctx.fillStyle = '#4f8a3a'; rrect(-3, -t.h, 6, t.h, 3); ctx.fill();
            rrect(-12, -t.h * 0.6, 5, t.h * 0.35, 2.5); ctx.fill(); ctx.fillRect(-12, -t.h * 0.6, 10, 4);
            rrect(7, -t.h * 0.75, 5, t.h * 0.45, 2.5); ctx.fill(); ctx.fillRect(2, -t.h * 0.75 + t.h * 0.45 - 4, 10, 4);
            ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, -t.h + 3); ctx.lineTo(0, -2); ctx.stroke();
        } else if (kind === 'shrub') {
            ctx.strokeStyle = '#8a6a3a'; ctx.lineWidth = 1.5;
            for (let i = 0; i < 5; i++) { const a = -Math.PI / 2 + (i - 2) * 0.35; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * t.h * 0.4, Math.sin(a) * t.h * 0.4); ctx.stroke(); }
        } else if (kind === 'pine') {
            ctx.fillStyle = '#4a3a2a'; ctx.fillRect(-2, -t.h * 0.35, 4, t.h * 0.35);
            for (let i = 0; i < 3; i++) { const yy = -t.h * (0.3 + i * 0.22), w = t.h * (0.5 - i * 0.12); ctx.fillStyle = '#2d5a3a'; ctx.beginPath(); ctx.moveTo(-w / 2, yy); ctx.lineTo(0, yy - t.h * 0.3); ctx.lineTo(w / 2, yy); ctx.closePath(); ctx.fill();
                ctx.fillStyle = '#eef6ff'; ctx.beginPath(); ctx.moveTo(-w / 2 + 2, yy); ctx.lineTo(0, yy - t.h * 0.12); ctx.lineTo(w / 2 - 2, yy); ctx.closePath(); ctx.fill(); }
        } else if (kind === 'dead') {
            ctx.strokeStyle = '#1e1414'; ctx.lineWidth = 3; ctx.lineCap = 'round';
            ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -t.h); ctx.moveTo(0, -t.h * 0.55); ctx.lineTo(-t.h * 0.3, -t.h * 0.8); ctx.moveTo(0, -t.h * 0.7); ctx.lineTo(t.h * 0.25, -t.h * 0.95); ctx.stroke();
        } else if (kind === 'spire') {
            ctx.fillStyle = '#241818'; ctx.beginPath(); ctx.moveTo(-6, 0); ctx.lineTo(-1, -t.h * 1.2); ctx.lineTo(1, -t.h * 1.2); ctx.lineTo(7, 0); ctx.closePath(); ctx.fill();
            ctx.fillStyle = 'rgba(255,100,40,' + (0.4 + 0.4 * Math.abs(Math.sin(frame / 30 + t.x))) + ')'; ctx.fillRect(-1, -t.h * 1.2, 2, 4);
        } else if (kind === 'palm') {
            ctx.strokeStyle = '#7a5a30'; ctx.lineWidth = 4; ctx.lineCap = 'round';
            ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(6, -t.h * 0.6, 2, -t.h); ctx.stroke();
            ctx.strokeStyle = '#2f8a3f'; ctx.lineWidth = 3;
            for (let i = 0; i < 6; i++) { const a = -Math.PI / 2 + (i - 2.5) * 0.55 + Math.sin(frame / 50 + i) * 0.05; ctx.beginPath(); ctx.moveTo(2, -t.h); ctx.quadraticCurveTo(2 + Math.cos(a) * 16, -t.h + Math.sin(a) * 16 - 4, 2 + Math.cos(a) * 24, -t.h + Math.sin(a) * 24 + 8); ctx.stroke(); }
        } else {
            ctx.fillStyle = '#5a3a1a'; ctx.fillRect(-2, -t.h * 0.5, 4, t.h * 0.5);
            ctx.fillStyle = '#2d7a35'; ctx.beginPath(); ctx.arc(0, -t.h * 0.62, t.h * 0.34, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#3a9a44'; ctx.beginPath(); ctx.arc(-t.h * 0.18, -t.h * 0.56, t.h * 0.24, 0, Math.PI * 2); ctx.arc(t.h * 0.16, -t.h * 0.7, t.h * 0.22, 0, Math.PI * 2); ctx.fill();
        }
        ctx.restore();
    }
    function drawGround() {
        const bm = biome();
        const left = cameraX - 40, right = cameraX + GAME_WIDTH + 40;
        trees.forEach((t, i) => { if (t.x > left && t.x < right && ((i * 7919) % 100) / 100 < bm.density) drawTree(t); });
        const startX = Math.floor(cameraX / 40) * 40 - 40;
        ctx.fillStyle = cached('soil' + bm.key, () => { const g = ctx.createLinearGradient(0, GROUND_Y + 8, 0, GAME_HEIGHT); g.addColorStop(0, bm.soil[0]); g.addColorStop(1, bm.soil[1]); return g; });
        ctx.fillRect(left, GROUND_Y + 8, GAME_WIDTH + 80, GAME_HEIGHT - GROUND_Y);
        ctx.fillStyle = bm.grass[0]; ctx.fillRect(left, GROUND_Y, GAME_WIDTH + 80, 8);
        ctx.fillStyle = bm.grass[1]; ctx.fillRect(left, GROUND_Y, GAME_WIDTH + 80, 2);
        ctx.fillStyle = bm.strata;
        for (let x = startX; x < right; x += 40) { ctx.fillRect(x + ((x / 40) % 2) * 12, GROUND_Y + 12, 16, 3); ctx.fillRect(x + 6, GROUND_Y + 17, 8, 2); }
        if (bm.key === 'volcanic') { ctx.fillStyle = 'rgba(255,110,40,' + (0.5 + 0.3 * Math.sin(frame / 20)) + ')'; for (let x = startX; x < right; x += 80) ctx.fillRect(x + 30, GROUND_Y + 10, 20, 1.5); }
        craters.forEach(c => {
            if (!isVisible(c.x)) return;
            ctx.fillStyle = 'rgba(20,12,6,0.55)'; ctx.beginPath(); ctx.ellipse(c.x, GROUND_Y + 2, c.w / 2, 4, 0, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#3a2a16'; ctx.beginPath(); ctx.ellipse(c.x, GROUND_Y + 3, c.w / 2 - 4, 2.5, 0, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.ellipse(c.x, GROUND_Y + 1, c.w / 2 + 6, 2, 0, 0, Math.PI * 2); ctx.fill();
        });
        ctx.fillStyle = bm.rock;
        rocks.forEach(r => { if (r.x > left && r.x < right) { ctx.beginPath(); ctx.ellipse(r.x, GROUND_Y + 1, r.w / 2, r.h, 0, Math.PI, 0); ctx.fill(); } });
        ctx.strokeStyle = bm.grass[2]; ctx.lineWidth = 1.5;
        ctx.beginPath();
        if (!lowDetail && bm.key !== 'arctic') grass.forEach(gb => { if (gb.x > left && gb.x < right) { const sway = Math.sin(frame / 25 + gb.ph) * 1.5; ctx.moveTo(gb.x, GROUND_Y + 1); ctx.lineTo(gb.x + sway, GROUND_Y - gb.h); ctx.moveTo(gb.x + 3, GROUND_Y + 1); ctx.lineTo(gb.x + 3 + sway, GROUND_Y - gb.h * 0.7); } });
        ctx.stroke();
    }
    function drawRubble(b) {
        ctx.fillStyle = '#3a3a40';
        ctx.beginPath(); ctx.moveTo(b.x - 4, GROUND_Y); ctx.lineTo(b.x + 18, b.y + 22); ctx.lineTo(b.x + 40, b.y + 34); ctx.lineTo(b.x + 62, b.y + 16);
        ctx.lineTo(b.x + 84, b.y + 30); ctx.lineTo(b.x + b.width - 16, b.y + 20); ctx.lineTo(b.x + b.width + 4, GROUND_Y); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#222'; ctx.fillRect(b.x + 30, b.y + 36, 14, 14); ctx.fillRect(b.x + 70, b.y + 40, 10, 10);
        if (frame % 4 === 0) particles.push({ x: b.x + rand(10, b.width - 10), y: b.y + 20, vx: rand(-0.2, 0.2), vy: -0.6, life: 50, maxLife: 50, color: pick(['#333', '#555']), size: 6, gravity: -0.005 });
    }
    function drawBaseHealth(b) {
        if (b.health >= b.maxHealth || b.destroyed) return;
        const pct = clamp(b.health / b.maxHealth, 0, 1);
        ctx.fillStyle = '#0008'; ctx.fillRect(b.x - 1, GROUND_Y - 100, b.width + 2, 7);
        ctx.fillStyle = `hsl(${pct * 110},80%,50%)`; ctx.fillRect(b.x, GROUND_Y - 99, Math.round(b.width * pct), 5);
    }
    function drawPad(b, team) {
        const c = colorsOf(team);
        if (b.destroyed) { drawRubble(b); return; }
        ctx.fillStyle = '#666'; ctx.fillRect(b.x - 6, GROUND_Y - 5, b.width + 12, 6);
        ctx.strokeStyle = c.ui; ctx.lineWidth = 2; ctx.strokeRect(b.x, GROUND_Y - 4, b.width, 4);
        ctx.strokeStyle = '#fff'; ctx.beginPath(); ctx.arc(b.x + b.width / 2, GROUND_Y - 2, 12, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = '#fff'; ctx.font = 'bold 14px Arial'; ctx.textAlign = 'center';
        ctx.fillText('H', b.x + b.width / 2, GROUND_Y + 3);
        const right = b.x > WORLD_WIDTH / 2;
        const tx = right ? b.x - 30 : b.x + b.width + 12;
        // Hangar and fuel tanks behind the pad
        const hx = right ? b.x + b.width + 8 : b.x - 70;
        if (hx > -80 && hx < WORLD_WIDTH) {
            ctx.fillStyle = '#6f7580'; ctx.beginPath(); ctx.moveTo(hx, GROUND_Y); ctx.lineTo(hx, GROUND_Y - 26); ctx.quadraticCurveTo(hx + 30, GROUND_Y - 52, hx + 60, GROUND_Y - 26); ctx.lineTo(hx + 60, GROUND_Y); ctx.closePath(); ctx.fill();
            ctx.fillStyle = '#2b2f36'; ctx.fillRect(hx + 18, GROUND_Y - 24, 24, 24);
            ctx.fillStyle = '#9aa'; for (let i = 0; i < 3; i++) ctx.fillRect(hx + 4 + i * 8, GROUND_Y - 30 - i * 0, 4, 3);
        }
        ctx.fillStyle = '#c8c8cc'; ctx.beginPath(); ctx.arc(tx + 9, GROUND_Y - 70, 9, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#8a8f99'; ctx.fillRect(tx, GROUND_Y - 60, 18, 60);
        ctx.fillStyle = '#5a5f69'; ctx.fillRect(tx, GROUND_Y - 60, 4, 60);
        ctx.fillStyle = '#4bb1ff'; ctx.fillRect(tx + 3, GROUND_Y - 56, 12, 8);
        ctx.fillStyle = '#fff'; ctx.fillRect(tx + 5, GROUND_Y - 55, 3, 2);
        // Windsock
        const wx = right ? b.x + b.width + 2 : b.x - 10;
        ctx.strokeStyle = '#ddd'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(wx, GROUND_Y); ctx.lineTo(wx, GROUND_Y - 30); ctx.stroke();
        ctx.fillStyle = '#f60'; ctx.beginPath(); ctx.moveTo(wx, GROUND_Y - 30); ctx.lineTo(wx + 14, GROUND_Y - 28 + Math.sin(frame / 20) * 2); ctx.lineTo(wx + 14, GROUND_Y - 24 + Math.sin(frame / 20) * 2); ctx.lineTo(wx, GROUND_Y - 25); ctx.closePath(); ctx.fill();
        // Pad floodlights at night
        if (dayPhase() >= 0.45 && dayPhase() < 0.8) ctx.drawImage(cached('flood', () => makeSprite(180, (g, n) => { const r = g.createRadialGradient(n / 2, n / 2, 4, n / 2, n / 2, n / 2); r.addColorStop(0, 'rgba(255,255,200,0.35)'); r.addColorStop(1, 'rgba(255,255,200,0)'); g.fillStyle = r; g.fillRect(0, 0, n, n); })), b.x + b.width / 2 - 90, GROUND_Y - 92, 180, 92);
        ctx.fillStyle = '#ccc'; ctx.fillRect(tx + 8, GROUND_Y - 80, 2, 20);
        ctx.fillStyle = c.ui; ctx.fillRect(tx + 10, GROUND_Y - 80, 12 + Math.sin(frame / 8) * 2, 7);
        ctx.font = 'bold 12px Arial';
        const label = sim.mode === 'versus' && sim.players[team] ? sim.players[team].name.toUpperCase().slice(0, 10) : 'BASE';
        ctx.fillText(label, tx + 9, GROUND_Y - 86);
        ctx.textAlign = 'left';
        drawBaseHealth(b);
    }
    function drawFortress(b) {
        if (b.destroyed) { drawRubble(b); return; }
        ctx.fillStyle = '#4a4a55'; ctx.fillRect(b.x, b.y, b.width, b.height);
        ctx.fillStyle = '#5a5a66'; ctx.fillRect(b.x, b.y, b.width, 4);
        ctx.fillStyle = '#3a3a45';
        for (let i = 0; i < 6; i++) ctx.fillRect(b.x + i * 20, b.y - 8, 12, 8);
        // Sandbags, barbed wire and gun slits
        ctx.fillStyle = '#9a8a5a'; for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.ellipse(b.x - 14 + (i % 2) * 6, GROUND_Y - 4 - Math.floor(i / 2) * 7, 8, 4, 0, 0, Math.PI * 2); ctx.fill(); }
        ctx.strokeStyle = '#999'; ctx.lineWidth = 1; ctx.beginPath(); for (let x = b.x - 30; x < b.x - 4; x += 4) { ctx.moveTo(x, GROUND_Y - 22); ctx.lineTo(x + 2, GROUND_Y - 26); ctx.lineTo(x + 4, GROUND_Y - 22); } ctx.stroke();
        ctx.fillStyle = '#111'; for (let i = 0; i < 3; i++) ctx.fillRect(b.x + 12 + i * 36, b.y + 26, 14, 4);
        ctx.fillStyle = '#f33'; ctx.globalAlpha = 0.5 + 0.5 * Math.sin(frame / 10); ctx.fillRect(b.x + 6, b.y + 6, 3, 3); ctx.globalAlpha = 1;
        ctx.fillStyle = '#222'; ctx.fillRect(b.x + b.width / 2 - 12, b.y + 20, 24, 30);
        ctx.fillStyle = '#ccc'; ctx.fillRect(b.x + b.width - 20, b.y - 34, 2, 26);
        ctx.fillStyle = '#e33'; ctx.fillRect(b.x + b.width - 18, b.y - 34, 14 + Math.sin(frame / 8) * 2, 8);
        ctx.fillStyle = '#f55'; ctx.font = 'bold 12px Arial'; ctx.textAlign = 'center';
        ctx.fillText('ENEMY', b.x + b.width / 2, b.y + 14);
        ctx.textAlign = 'left';
        drawBaseHealth(b);
    }
    function drawHuts() {
        sim.huts.forEach(h => {
            if (!isVisible(h.x + 40, 120)) return;
            ctx.fillStyle = '#b08050'; ctx.fillRect(h.x, GROUND_Y - h.h, h.w, h.h);
            ctx.fillStyle = '#7a4a20';
            ctx.beginPath(); ctx.moveTo(h.x - 6, GROUND_Y - h.h); ctx.lineTo(h.x + h.w / 2, GROUND_Y - h.h - 18); ctx.lineTo(h.x + h.w + 6, GROUND_Y - h.h); ctx.closePath(); ctx.fill();
            ctx.fillStyle = '#442'; ctx.fillRect(h.x + h.w / 2 - 6, GROUND_Y - 20, 12, 20);
            ctx.fillStyle = dayPhase() >= 0.45 && dayPhase() < 0.8 ? '#ffb347' : '#ffd'; ctx.fillRect(h.x + 8, GROUND_Y - h.h + 10, 10, 8);
            ctx.fillStyle = '#8a6a4a'; for (let i = 0; i < 3; i++) ctx.fillRect(h.x + 2 + i * 18, GROUND_Y - h.h + 6, 2, h.h - 6);
            ctx.fillStyle = '#553'; ctx.fillRect(h.x + h.w - 14, GROUND_Y - h.h - 10, 5, 12);
            if (frame % 6 === 0) particles.push({ x: h.x + h.w - 11, y: GROUND_Y - h.h - 12, vx: rand(-0.1, 0.3), vy: -0.4, life: 60, maxLife: 60, color: '#ccc', size: 2, gravity: -0.004, grow: 0.06 });
            if (h.garrison) {
                const c = colorsOf(h.garrison.team), door = h.x + h.w / 2;
                // Flag on the roof
                ctx.strokeStyle = '#ddd'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(door, GROUND_Y - h.h - 18); ctx.lineTo(door, GROUND_Y - h.h - 40); ctx.stroke();
                ctx.fillStyle = c.body; ctx.beginPath(); ctx.moveTo(door, GROUND_Y - h.h - 40); ctx.lineTo(door + 14, GROUND_Y - h.h - 36 + Math.sin(frame / 12) * 2); ctx.lineTo(door, GROUND_Y - h.h - 31); ctx.closePath(); ctx.fill();
                // Helmets and rifle barrels in the window and doorway
                for (let i = 0; i < h.garrison.count; i++) {
                    const hx = i === 0 ? h.x + 13 : door + (i - 1.5) * 7, hy = i === 0 ? GROUND_Y - h.h + 13 : GROUND_Y - 14;
                    ctx.fillStyle = c.unitDark; ctx.beginPath(); ctx.arc(hx, hy, 3, Math.PI, 0); ctx.fill();
                    ctx.fillStyle = '#ffd9b3'; ctx.fillRect(hx - 2, hy, 4, 2);
                }
                ctx.strokeStyle = '#333'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(h.x + 16, GROUND_Y - h.h + 15); ctx.lineTo(h.x + 24, GROUND_Y - h.h + 13); ctx.stroke();
                ctx.fillStyle = '#fff'; ctx.font = 'bold 10px Arial'; ctx.textAlign = 'center';
                ctx.fillText(h.garrison.count + ' HELD', door, GROUND_Y - h.h - 44); ctx.textAlign = 'left';
            }
        });
    }
    function groundShadow(x, w) { ctx.fillStyle = 'rgba(0,0,0,0.22)'; ctx.beginPath(); ctx.ellipse(x, GROUND_Y + 2, w / 2, 2.5, 0, 0, Math.PI * 2); ctx.fill(); }
    function drawHostages() {
        const px = cx(local());
        sim.hostages.forEach(h => {
            if (h.state !== 'waiting' && h.state !== 'running' || !isVisible(h.x)) return;
            const running = h.state === 'running', near = Math.abs(px - h.x) < 320;
            groundShadow(h.x, 10);
            ctx.save();
            ctx.translate(h.x, GROUND_Y + (running ? Math.abs(Math.sin(h.anim * 0.5)) * -1.5 : 0));
            if (h.dir < 0) ctx.scale(-1, 1);
            ctx.strokeStyle = '#3a3a5a'; ctx.lineWidth = 2.2; ctx.lineCap = 'round';
            const swing = running ? Math.sin(h.anim * 0.5) * 4 : 0;
            ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(-2 + swing, 0); ctx.moveTo(0, -9); ctx.lineTo(2 - swing, 0); ctx.stroke();
            ctx.fillStyle = shirtOf(h); ctx.fillRect(-3.5, -19, 7, 11);
            ctx.fillStyle = 'rgba(0,0,0,0.15)'; ctx.fillRect(1, -19, 2.5, 11);
            ctx.fillStyle = '#ffd9b3'; ctx.beginPath(); ctx.arc(0, -22, 3.5, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#4a3020'; ctx.beginPath(); ctx.arc(0, -23, 3.6, Math.PI, 0); ctx.fill();
            ctx.strokeStyle = '#ffd9b3';
            ctx.beginPath();
            if (!running && near) { const w = Math.sin(h.anim * 0.3) * 3; ctx.moveTo(0, -17); ctx.lineTo(-5, -26 + w); ctx.moveTo(0, -17); ctx.lineTo(5, -26 - w); }
            else if (running) { ctx.moveTo(0, -17); ctx.lineTo(4 + swing, -13); ctx.moveTo(0, -17); ctx.lineTo(-4 - swing, -13); }
            else { ctx.moveTo(0, -17); ctx.lineTo(-4, -10); ctx.moveTo(0, -17); ctx.lineTo(4, -10); }
            ctx.stroke();
            ctx.restore();
        });
    }
    function drawUnits() {
        sim.units.forEach(u => {
            if (!isVisible(u.x)) return;
            const c = colorsOf(u.team);
            groundShadow(cx(u), u.type === 'tank' ? 30 : u.type === 'aa' ? 32 : 10);
            ctx.save();
            if (u.type === 'aa') {
                ctx.translate(u.x, u.y);
                // Sandbag ring, base plate, twin-barrel mount
                ctx.fillStyle = '#9a8a5a'; for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.ellipse(-2 + i * 6, 14 - (i % 2) * 3, 5, 3, 0, 0, Math.PI * 2); ctx.fill(); }
                ctx.fillStyle = '#444'; ctx.fillRect(6, 6, 14, 8);
                ctx.fillStyle = '#b22'; ctx.beginPath(); ctx.arc(13, 6, 5, 0, Math.PI * 2); ctx.fill();
                ctx.save(); ctx.translate(13, 6); ctx.rotate(u.angle);
                ctx.fillStyle = '#777'; ctx.fillRect(0, -3.2, 16, 2.2); ctx.fillRect(0, 1, 16, 2.2); ctx.fillStyle = '#333'; ctx.fillRect(13, -3.6, 3, 7.2);
                ctx.restore();
                ctx.fillStyle = '#f33'; ctx.globalAlpha = 0.5 + 0.5 * Math.sin(frame / 8); ctx.fillRect(2, 2, 2, 2); ctx.globalAlpha = 1;
                if (u.fireTimer > Math.max(40, Sim.AA.fireRate) - 4) { ctx.fillStyle = '#ff6'; ctx.fillRect(13 + Math.cos(u.angle) * 17 - 2, 6 + Math.sin(u.angle) * 17 - 2, 4, 4); }
            } else if (u.type === 'soldier') {
                const bob = u.moving ? Math.abs(Math.sin(u.anim * 0.4)) * -1.2 : 0;
                ctx.translate(cx(u), GROUND_Y + bob);
                if (u.dir < 0) ctx.scale(-1, 1);
                const swing = u.moving ? Math.sin(u.anim * 0.4) * 4 : 0;
                // Legs with boots
                ctx.strokeStyle = c.unitDark; ctx.lineWidth = 2.4; ctx.lineCap = 'round';
                ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(-2 + swing, -1); ctx.moveTo(0, -9); ctx.lineTo(2 - swing, -1); ctx.stroke();
                ctx.fillStyle = '#222'; ctx.fillRect(-4 + swing, -2, 4, 2); ctx.fillRect(0 - swing, -2, 4, 2);
                // Torso, belt, backpack
                ctx.fillStyle = c.cloth; ctx.fillRect(-3.5, -19, 7, 11);
                ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.fillRect(1, -19, 2.5, 11);
                ctx.fillStyle = '#5a4a2a'; ctx.fillRect(-3.5, -11, 7, 1.5);
                ctx.fillStyle = c.unitDark; ctx.fillRect(-6.5, -17, 3, 7);
                // Head and helmet
                ctx.fillStyle = '#ffd9b3'; ctx.beginPath(); ctx.arc(0, -22, 3.5, 0, Math.PI * 2); ctx.fill();
                ctx.fillStyle = c.unitDark; ctx.beginPath(); ctx.arc(0, -23, 4.2, Math.PI, 0); ctx.fill(); ctx.fillRect(-4.2, -23.5, 8.4, 1.5);
                // Rifle held in both hands
                ctx.strokeStyle = '#2a2a2a'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-3, -14); ctx.lineTo(9, -16.5); ctx.stroke();
                ctx.strokeStyle = '#ffd9b3'; ctx.lineWidth = 1.8; ctx.beginPath(); ctx.moveTo(1, -17); ctx.lineTo(3, -15.5); ctx.moveTo(-1, -16); ctx.lineTo(6, -16); ctx.stroke();
                if (!u.moving && u.fireTimer > UNITS.soldier.fireRate - 4) { ctx.fillStyle = '#ff6'; ctx.fillRect(9, -18.5, 5, 4); }
            } else {
                ctx.translate(u.x, u.y);
                const flip = u.dir < 0;
                if (flip) { ctx.translate(u.width, 0); ctx.scale(-1, 1); }
                const roll = u.moving ? (u.anim * 0.35) : 0;
                // Tracks with road wheels
                ctx.fillStyle = '#2b2b2b'; rrect(-1, 13, u.width + 2, 9, 4); ctx.fill();
                ctx.fillStyle = '#555';
                for (let i = 0; i < 4; i++) { const wx = 3 + i * 6.6; ctx.beginPath(); ctx.arc(wx, 17.5, 2.6, 0, Math.PI * 2); ctx.fill(); }
                ctx.strokeStyle = '#888'; ctx.lineWidth = 1;
                for (let i = 0; i < 4; i++) { const wx = 3 + i * 6.6; ctx.beginPath(); ctx.moveTo(wx, 17.5); ctx.lineTo(wx + Math.cos(roll) * 2.2, 17.5 + Math.sin(roll) * 2.2); ctx.stroke(); }
                ctx.fillStyle = '#666'; for (let i = 0; i < 6; i++) ctx.fillRect(((i * 5 + (u.moving ? Math.floor(u.anim / 3) : 0)) % 28) - 1, 13, 2, 1.5);
                // Sloped hull with highlight
                ctx.fillStyle = c.unit; ctx.beginPath(); ctx.moveTo(0, 14); ctx.lineTo(2, 7); ctx.lineTo(u.width - 4, 7); ctx.lineTo(u.width + 1, 11); ctx.lineTo(u.width + 1, 14); ctx.closePath(); ctx.fill();
                ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.fillRect(3, 7.5, u.width - 8, 1.5);
                ctx.fillStyle = 'rgba(0,0,0,0.2)'; ctx.fillRect(0, 12, u.width + 1, 2);
                // Turret dome, hatch and barrel with muzzle brake
                ctx.fillStyle = c.unitDark; ctx.beginPath(); ctx.moveTo(6, 7); ctx.lineTo(9, 1); ctx.lineTo(19, 1); ctx.lineTo(22, 7); ctx.closePath(); ctx.fill();
                ctx.fillStyle = 'rgba(255,255,255,0.15)'; ctx.fillRect(10, 1.5, 7, 1.2);
                ctx.fillStyle = '#222'; ctx.fillRect(12, -1, 5, 2);
                const ang = flip ? Math.PI - u.angle : u.angle;
                ctx.save(); ctx.translate(14, 4); ctx.rotate(ang);
                ctx.fillStyle = '#777'; ctx.fillRect(0, -1.6, 15, 3.2); ctx.fillStyle = '#444'; ctx.fillRect(12, -2.2, 3.5, 4.4);
                ctx.restore();
                if (!u.ai) { ctx.fillStyle = '#fff'; ctx.fillRect(3, 9, 3, 2.5); }
            }
            ctx.restore();
            if (u.health < u.maxHealth) {
                const pct = clamp(u.health / u.maxHealth, 0, 1), w = u.type === 'tank' ? 26 : 12;
                const x = cx(u) - w / 2, y = u.y - 8;
                ctx.fillStyle = '#0008'; ctx.fillRect(x - 1, y - 1, w + 2, 5);
                ctx.fillStyle = `hsl(${pct * 110},80%,50%)`; ctx.fillRect(x, y, Math.round(w * pct), 3);
            }
        });
    }
    function drawHeli(h, body, glass, flash) {
        ctx.save();
        ctx.translate(cx(h), cy(h));
        ctx.rotate((h.spin || 0) + (h.tilt || 0));
        if (flash) ctx.globalAlpha = 0.45;
        const d = h.dir;
        const shade = cached('heli' + body, () => { const g = ctx.createLinearGradient(0, -12, 0, 12); g.addColorStop(0, '#ffffff'); g.addColorStop(0.35, body); g.addColorStop(1, '#000000'); return g; });
        // Tail boom and fin
        ctx.fillStyle = body;
        ctx.beginPath(); ctx.moveTo(d * -2, -5); ctx.lineTo(d * -30, -3); ctx.lineTo(d * -30, 2); ctx.lineTo(d * -2, 4); ctx.closePath(); ctx.fill();
        ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.moveTo(d * -2, 1); ctx.lineTo(d * -30, 0); ctx.lineTo(d * -30, 2); ctx.lineTo(d * -2, 4); ctx.closePath(); ctx.fill();
        ctx.fillStyle = body; ctx.beginPath(); ctx.moveTo(d * -27, -3); ctx.lineTo(d * -32, -13); ctx.lineTo(d * -26, -13); ctx.lineTo(d * -23, -3); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#333'; ctx.beginPath(); ctx.arc(d * -30, -6, 1.6, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#ddd'; ctx.lineWidth = 2;
        const tr = Math.cos(frame * 0.9) * 6;
        ctx.beginPath(); ctx.moveTo(d === 1 ? -30 : 30, -6 - tr); ctx.lineTo(d === 1 ? -30 : 30, -6 + tr); ctx.stroke();
        // Main body with vertical shading, then flat colour where the gradient is too strong
        ctx.fillStyle = body; ctx.beginPath(); ctx.ellipse(d * 4, 0, 22, 12, 0, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha *= 0.35; ctx.fillStyle = shade; ctx.beginPath(); ctx.ellipse(d * 4, 0, 22, 12, 0, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = flash ? 0.45 : 1;
        // Weapon pod and winch
        ctx.fillStyle = '#444'; rrect(d * -6 - 7, 8, 14, 4, 2); ctx.fill(); ctx.fillStyle = '#222'; ctx.fillRect(d * -6 - 5, 9, 2, 2); ctx.fillRect(d * -6 + 1, 9, 2, 2);
        ctx.fillStyle = '#333'; ctx.fillRect(d * 6 - 2, 10, 4, 3);
        // Cockpit glass with frame
        ctx.fillStyle = glass; ctx.beginPath(); ctx.ellipse(d * 14, -2, 9, 7, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.ellipse(d * 14, -2, 9, 7, 0, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = 'rgba(0,40,80,0.25)'; ctx.beginPath(); ctx.ellipse(d * 13, 1, 7, 3.5, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#222'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(-16, 14); ctx.lineTo(22, 14); ctx.moveTo(-8, 10); ctx.lineTo(-8, 14); ctx.moveTo(12, 10); ctx.lineTo(12, 14); ctx.stroke();
        // Door, panel line and exhaust
        ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(d * -4, -8); ctx.lineTo(d * -4, 8); ctx.moveTo(d * -12, -6); ctx.lineTo(d * -12, 6); ctx.stroke();
        ctx.fillStyle = '#333'; ctx.fillRect(d === 1 ? -10 : 4, -13, 6, 3);
        // Cockpit glint
        ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.beginPath(); ctx.ellipse(d * 16, -5, 4, 2, d * 0.5, 0, Math.PI * 2); ctx.fill();
        // Mast + rotor: translucent disc with two blurred blades
        ctx.fillStyle = '#222'; ctx.fillRect(-2, -16, 4, 6);
        ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.beginPath(); ctx.ellipse(0, -17, 36, 3, 0, 0, Math.PI * 2); ctx.fill();
        const rw = 6 + 30 * Math.abs(Math.cos(frame * 0.55)), rw2 = 6 + 30 * Math.abs(Math.sin(frame * 0.55));
        ctx.fillStyle = 'rgba(230,230,230,0.85)'; ctx.fillRect(-rw, -18, rw * 2, 3);
        ctx.fillStyle = 'rgba(230,230,230,0.35)'; ctx.fillRect(-rw2, -18, rw2 * 2, 3);
        // Navigation lights
        const blink = frame % 40 < 6;
        ctx.fillStyle = blink ? '#f33' : 'rgba(255,60,60,0.3)'; ctx.fillRect(d === 1 ? -31 : 28, -13, 3, 3);
        ctx.fillStyle = (frame + 20) % 40 < 6 ? '#3f3' : 'rgba(60,255,60,0.3)'; ctx.fillRect(d * 20 - 1, 4, 3, 3);
        ctx.restore();
    }
    function drawShadow(h) {
        ctx.save();
        const warn = sinkWarn && sim && h === local();
        ctx.globalAlpha = warn ? 0.45 + 0.35 * Math.abs(Math.sin(frame / 4)) : 0.2 * clamp(1 - (GROUND_Y - (h.y + h.height)) / 400, 0.3, 1);
        ctx.fillStyle = warn ? '#f22' : '#000';
        ctx.beginPath(); ctx.ellipse(cx(h), GROUND_Y + 3, h.width / 2 + (warn ? 6 : 0), warn ? 6 : 4, 0, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
    }
    // Client-side feel state for the local pilot: sink-rate warning and touchdown feedback
    let sinkWarn = false, wasLanded = true, coachPrev = { carrying: 0, rescued: 0 };
    function feelTick(p) {
        if (!p || !p.alive || screen !== 'playing') { sinkWarn = false; return; }
        const alt = GROUND_Y - (p.y + p.height);
        const danger = !p.landed && p.vy >= 4.5 && alt / Math.max(p.vy, 0.1) < 30;
        if (danger && !sinkWarn) buzz([10, 30, 10]);
        if (danger) sinkWarn = true; else if (p.vy < 3 || p.landed) sinkWarn = false;
        if (p.landed && !wasLanded) buzz(8);
        wasLanded = p.landed;
        // Coach progress: first boarding, first rescue
        if (p.carrying > coachPrev.carrying) coachSet(COACH_BOARD);
        if (p.rescued > coachPrev.rescued) { coachSet(COACH_HOME); coachSet(COACH_PAD); }
        coachPrev = { carrying: p.carrying, rescued: p.rescued };
    }
    // Where a bomb dropped now would land (mirrors dropBomb/bomb physics in sim.js), touch only
    function drawBombMarker(p) {
        let x = cx(p), y = p.y + p.height + 4, vx = p.vx * 0.8, vy = 1, t = 0;
        while (y < GROUND_Y - 4 && t < 240) { vy += 0.28; x += vx; y += vy; t++; }
        const tooLow = Math.hypot(cx(p) + p.vx * t * 0.6 - x, cy(p) - (GROUND_Y - 4)) < 45;
        ctx.save();
        ctx.strokeStyle = tooLow ? 'rgba(255,60,60,0.8)' : 'rgba(255,200,80,0.55)'; ctx.lineWidth = 1.5; ctx.setLineDash([3, 5]);
        ctx.beginPath(); ctx.moveTo(cx(p), p.y + p.height + 4); ctx.quadraticCurveTo(cx(p) + (x - cx(p)) * 0.5, p.y + p.height + 4, x, GROUND_Y - 4); ctx.stroke();
        ctx.setLineDash([]); ctx.beginPath(); ctx.ellipse(x, GROUND_Y - 2, 10, 3, 0, 0, Math.PI * 2); ctx.stroke();
        if (tooLow) { ctx.fillStyle = '#f66'; ctx.font = 'bold 12px Arial'; ctx.textAlign = 'center'; ctx.fillText('TOO LOW', x, GROUND_Y - 12); }
        ctx.restore();
    }
    function drawHealthBar(h, w) {
        const pct = clamp(h.health / h.maxHealth, 0, 1);
        const x = cx(h) - w / 2, y = h.y - 24;
        ctx.fillStyle = '#0008'; ctx.fillRect(x - 1, y - 1, w + 2, 6);
        ctx.fillStyle = `hsl(${pct * 110},80%,50%)`; ctx.fillRect(x, y, Math.round(w * pct), 4);
    }
    function drawPickups() {
        sim.pickups.forEach(k => {
            if (!isVisible(k.x)) return;
            const def = Sim.PICKUPS[k.type], y = k.y + Math.sin(k.bob / 10) * 2;
            const fade = k.life < 120 && Math.floor(k.life / 6) % 2 === 0;
            if (fade) return;
            ctx.drawImage(glowSprite(def.color), k.x - 8, y - 8);
            groundShadow(k.x, 10);
            ctx.fillStyle = '#eee'; rrect(k.x - 6, y - 6, 12, 12, 2); ctx.fill();
            ctx.fillStyle = def.color;
            if (k.type === 'health') { ctx.fillRect(k.x - 1.5, y - 4, 3, 8); ctx.fillRect(k.x - 4, y - 1.5, 8, 3); }
            else if (k.type === 'bombs') { ctx.beginPath(); ctx.arc(k.x, y + 1, 3, 0, Math.PI * 2); ctx.fill(); ctx.fillRect(k.x - 1, y - 5, 2, 3); }
            else { ctx.font = 'bold 9px Arial'; ctx.textAlign = 'center'; ctx.fillText('$', k.x, y + 3.5); ctx.textAlign = 'left'; }
        });
    }
    function drawStrikesAndParas() {
        sim.strikes.forEach(k => {
            if (!isVisible(k.x, 120)) return;
            ctx.save(); ctx.translate(k.x, k.y); if (k.dir < 0) ctx.scale(-1, 1);
            ctx.fillStyle = '#9aa3ad'; ctx.beginPath(); ctx.moveTo(-26, 0); ctx.lineTo(22, -3); ctx.lineTo(30, 0); ctx.lineTo(22, 3); ctx.closePath(); ctx.fill();
            ctx.fillStyle = '#7d868f'; ctx.beginPath(); ctx.moveTo(-6, -1); ctx.lineTo(8, -1); ctx.lineTo(2, -14); ctx.lineTo(-8, -14); ctx.closePath(); ctx.fill();
            ctx.beginPath(); ctx.moveTo(-6, 1); ctx.lineTo(8, 1); ctx.lineTo(2, 12); ctx.lineTo(-8, 12); ctx.closePath(); ctx.fill();
            ctx.fillStyle = '#5a636c'; ctx.beginPath(); ctx.moveTo(-26, 0); ctx.lineTo(-18, -9); ctx.lineTo(-14, 0); ctx.closePath(); ctx.fill();
            ctx.fillStyle = '#9ff'; ctx.fillRect(16, -2.5, 6, 2);
            ctx.restore();
            if (frame % 2 === 0 && !lowDetail) particles.push({ x: k.x - k.dir * 26, y: k.y, vx: -k.dir * 1.2, vy: 0, life: 40, maxLife: 40, color: '#eee', size: 3, gravity: 0, grow: 0.12 });
        });
        sim.paras.forEach(k => {
            if (!isVisible(k.x)) return;
            const c = colorsOf(k.team), open = k.anim >= 12, sway = Math.sin(k.anim / 14) * 3;
            ctx.save(); ctx.translate(k.x + sway, k.y);
            if (open) {
                ctx.fillStyle = k.team === 0 ? '#e8e8e8' : '#cfe3ff'; ctx.beginPath(); ctx.arc(0, -26, 16, Math.PI, 0); ctx.closePath(); ctx.fill();
                ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 1; for (let i = -12; i <= 12; i += 8) { ctx.beginPath(); ctx.moveTo(i, -26); ctx.lineTo(0, -8); ctx.stroke(); }
                ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.beginPath(); ctx.arc(0, -26, 16, Math.PI, 0); ctx.closePath(); ctx.fill();
            }
            ctx.fillStyle = c.cloth; ctx.fillRect(-3, -8, 6, 10);
            ctx.fillStyle = '#ffd9b3'; ctx.beginPath(); ctx.arc(0, -11, 3.2, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = c.unitDark; ctx.beginPath(); ctx.arc(0, -12, 3.8, Math.PI, 0); ctx.fill();
            ctx.strokeStyle = c.unitDark; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-2, 2); ctx.lineTo(-3, 9); ctx.moveTo(2, 2); ctx.lineTo(3, 9); ctx.stroke();
            ctx.restore();
        });
        sim.balloons.forEach(b => {
            if (!isVisible(b.x)) return;
            const hostileToMe = sim.mode === 'versus' ? b.team !== localId : b.team === AI;
            // Tether to the roof
            ctx.strokeStyle = 'rgba(40,40,40,0.7)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(b.hut.x + b.hut.w / 2 + 10, GROUND_Y - b.hut.h - 18); ctx.lineTo(b.x, b.y + 11); ctx.stroke();
            // Envelope with a team stripe and a small instrument box
            ctx.fillStyle = '#e6e6e6'; ctx.beginPath(); ctx.arc(b.x, b.y, 11, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = hostileToMe ? '#d33' : '#39f'; ctx.beginPath(); ctx.arc(b.x, b.y, 11, 0.25, Math.PI - 0.25); ctx.fill();
            ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.beginPath(); ctx.arc(b.x - 4, b.y - 4, 3.5, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#333'; ctx.fillRect(b.x - 2, b.y + 11, 4, 4);
            if (hostileToMe) { ctx.fillStyle = 'rgba(255,60,60,0.25)'; ctx.beginPath(); ctx.arc(b.x, b.y, 15 + Math.sin(frame / 8) * 2, 0, Math.PI * 2); ctx.fill(); }
        });
        sim.players.forEach(p => {
            if (p.rally === null || !isVisible(p.rally)) return;
            const c = colorsOf(p.team), x = p.rally;
            ctx.strokeStyle = c.ui; ctx.lineWidth = 1.5; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(x, GROUND_Y); ctx.lineTo(x, GROUND_Y - 60); ctx.stroke(); ctx.setLineDash([]);
            ctx.fillStyle = c.body; ctx.beginPath(); ctx.moveTo(x, GROUND_Y - 60); ctx.lineTo(x + 16, GROUND_Y - 55 + Math.sin(frame / 10) * 2); ctx.lineTo(x, GROUND_Y - 50); ctx.closePath(); ctx.fill();
            ctx.fillStyle = '#fff'; ctx.font = 'bold 9px Arial'; ctx.textAlign = 'center'; ctx.fillText('HOLD', x, GROUND_Y - 64); ctx.textAlign = 'left';
        });
    }
    function drawChoppers() {
        if (sim.mode === 'solo' && sim.ai.alive) {
            const a = sim.ai, c = colorsOf(AI);
            drawShadow(a);
            if (a.boss) {
                ctx.save(); ctx.translate(cx(a), cy(a)); ctx.scale(1.3, 1.25); ctx.translate(-cx(a), -cy(a));
                drawHeli({ x: cx(a) - 30, y: cy(a) - 12, width: 60, height: 24, dir: a.dir, tilt: a.tilt }, '#6a1a1a', '#f99', false);
                ctx.restore();
                ctx.fillStyle = '#f66'; ctx.font = 'bold 10px Arial'; ctx.textAlign = 'center'; ctx.fillText('GUNSHIP', cx(a), a.y - 28); ctx.textAlign = 'left';
                drawHealthBar(a, 60);
            } else { drawHeli(a, c.body, c.glass, false); drawHealthBar(a, 40); }
        }
        sim.players.forEach(p => {
            const c = colorsOf(p.team), isLocal = p.id === localId;
            if (!p.alive && p.respawn > 120) return; // wreck gone until redeploy
            drawShadow(p);
            drawHeli(p, c.body, c.glass, p.alive && p.invuln > 0 && frame % 6 < 3);
            if (!isLocal && p.alive) {
                drawHealthBar(p, 40);
                ctx.fillStyle = '#fff'; ctx.font = 'bold 10px Arial'; ctx.textAlign = 'center';
                ctx.fillText(p.name.toUpperCase().slice(0, 12), cx(p), p.y - 28); ctx.textAlign = 'left';
            }
        });
    }
    function drawProjectiles() {
        sim.bullets.forEach(b => {
            if (!isVisible(b.x)) return;
            ctx.fillStyle = 'rgba(255,200,80,0.35)'; ctx.fillRect(Math.min(b.x - b.vx * 2.2, b.x + b.width), b.y + 0.5, Math.abs(b.vx * 2.2) + b.width, b.height - 1);
            ctx.fillStyle = b.team === AI ? '#f88' : '#ffe'; ctx.fillRect(b.x, b.y, b.width, b.height);
        });
        sim.shells.forEach(b => {
            if (b.kind === 'rocket') {
                if (!isVisible(b.x)) return;
                ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(Math.atan2(b.vy, b.vx));
                ctx.fillStyle = '#ddd'; rrect(-7, -2.5, 14, 5, 2); ctx.fill(); ctx.fillStyle = '#f44'; ctx.fillRect(4, -2.5, 3, 5); ctx.fillStyle = '#ff8'; ctx.fillRect(-11, -1.5, 4, 3);
                ctx.restore();
                if (frame % 2 === 0) particles.push({ x: b.x - b.vx, y: b.y - b.vy, vx: rand(-0.3, 0.3), vy: rand(-0.3, 0.3), life: 18, maxLife: 18, color: '#999', size: 3, gravity: -0.01, grow: 0.15 });
                return;
            }
            if (b.kind === 'rifle') { if (!isVisible(b.x)) return; ctx.fillStyle = b.team === AI ? '#f88' : '#ff8'; ctx.fillRect(b.x - 2.5, b.y - 1, 5, 2); return; }
            if (!isVisible(b.x)) return;
            const col = b.kind === 'heli' ? '#0ff' : b.team === AI ? '#ff0' : '#ddd';
            ctx.drawImage(glowSprite(col), b.x - 8, b.y - 8);
            ctx.fillStyle = col; ctx.beginPath(); ctx.arc(b.x, b.y, 3, 0, Math.PI * 2); ctx.fill();
        });
        sim.bombs.forEach(b => {
            ctx.fillStyle = '#333'; ctx.beginPath(); ctx.ellipse(b.x, b.y, 4, 7, 0, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#f90'; ctx.fillRect(b.x - 3, b.y - 9, 6, 3);
        });
    }
    function drawParticles() {
        particles.forEach(p => {
            ctx.globalAlpha = clamp(p.life / p.maxLife, 0, 1) * (p.grow ? 0.7 : 1);
            if (p.streak) { ctx.strokeStyle = p.color; ctx.lineWidth = p.size; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 3, p.y - p.vy * 3); ctx.stroke(); }
            else if (p.debris) { p.rot += p.spin; ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillStyle = p.color; ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2); ctx.restore(); }
            else if (p.grow) { ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, p.size / 2, 0, Math.PI * 2); ctx.fill(); }
            else { ctx.fillStyle = p.color; ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size); }
        });
        ctx.globalAlpha = 1;
        rings.forEach(r => {
            const a = clamp(r.life, 0, 1);
            if (r.fill) { ctx.fillStyle = `rgba(${r.color},${a * 0.8})`; ctx.beginPath(); ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2); ctx.fill(); }
            else { ctx.strokeStyle = `rgba(${r.color},${a})`; ctx.lineWidth = 3 * a + 1; ctx.beginPath(); ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2); ctx.stroke(); }
        });
    }
    function drawPost() {
        if (lowDetail) { if (screenFlash > 0) { ctx.fillStyle = `rgba(255,240,200,${screenFlash})`; ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT); } return; }
        const ph = dayPhase();
        if (ph >= 0.45 && ph < 0.8) { ctx.fillStyle = 'rgba(10,15,50,0.28)'; ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT); }
        else if (ph >= 0.2 && ph < 0.45) { ctx.fillStyle = 'rgba(255,120,40,0.08)'; ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT); }
        if (screenFlash > 0) { ctx.fillStyle = `rgba(255,240,200,${screenFlash})`; ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT); }
        ctx.fillStyle = cached('vignette', () => { const v = ctx.createRadialGradient(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_HEIGHT * 0.55, GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_HEIGHT * 1.05); v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.45)'); return v; });
        ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
        if (sim) {
            const p = local(); const pct = p.health / p.maxHealth;
            if (p.alive && pct < 0.3 && screen === 'playing') {
                ctx.globalAlpha = clamp((0.3 - pct) * 2.6 * (0.6 + 0.4 * Math.sin(frame / 6)), 0, 1);
                ctx.fillStyle = cached('damage', () => { const dg = ctx.createRadialGradient(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_HEIGHT * 0.4, GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_HEIGHT); dg.addColorStop(0, 'rgba(255,0,0,0)'); dg.addColorStop(1, 'rgba(200,0,0,0.8)'); return dg; });
                ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT); ctx.globalAlpha = 1;
            }
        }
    }
    function drawFloatTexts() {
        ctx.textAlign = 'center';
        floatTexts.forEach(t => {
            ctx.globalAlpha = clamp(t.life / 30, 0, 1);
            ctx.font = (t.big ? 'bold 18px' : 'bold 12px') + ' Arial';
            // Keep the whole text on screen, and on touch out from under the resting thumbstick
            // Texts anchored well off-screen are not shown (pinning them to the edge was misleading)
            if (t.x < cameraX - 80 || t.x > cameraX + GAME_WIDTH + 80) return;
            const hw = (t.w || 0) / 2 + 8;
            const sx = clamp(t.x, cameraX + hw, cameraX + GAME_WIDTH - hw);
            // On touch, lift low texts out from under the thumbstick and the button cluster (keeping their spacing)
            const underControls = isTouch && t.y > 260 && ((sx - cameraX) < 190 || (sx - cameraX) > GAME_WIDTH - 230);
            const sy = underControls ? t.y - 90 : t.y;
            ctx.lineWidth = 3; ctx.strokeStyle = '#000'; ctx.strokeText(t.text, sx, sy);
            ctx.fillStyle = t.color; ctx.fillText(t.text, sx, sy);
        });
        ctx.globalAlpha = 1; ctx.textAlign = 'left';
    }
    function comboText(p) { return p.combo > 1 ? 'COMBO x' + Math.min(3, 1 + (p.combo - 1) * 0.25) : ''; }
    function ownBaseOf(p) { return sim.bases.find(b => b.team === p.team) || (sim.mode === 'coop' ? sim.bases[0] : null); }
    // Chevrons at the screen edge for things that matter but are off-screen: hostages, home, the enemy chopper
    function drawEdgeIndicators() {
        const p = local();
        if (!p || !p.alive || screen !== 'playing') return;
        const marks = [];
        if (p.carrying < MAX_CARRY && sim.mode !== 'versus' || sim.mode === 'versus') {
            let best = null, bd = Infinity, count = 0;
            sim.hostages.forEach(h => { if (h.state === 'waiting' || h.state === 'running') { const d = Math.abs(h.x - cx(p)); if (d < bd) { bd = d; best = h; } } });
            if (best && p.carrying < MAX_CARRY) {
                count = sim.hostages.filter(h => (h.state === 'waiting' || h.state === 'running') && Math.abs(h.x - best.x) < 120).length;
                marks.push({ x: best.x, y: GROUND_Y - 30, color: '#fd4', label: count + '' });
            }
        }
        const home = ownBaseOf(p);
        if (home && !home.destroyed && (p.carrying > 0 || p.health / p.maxHealth < 0.3)) marks.push({ x: cx(home), y: GROUND_Y - 40, color: '#8f8', label: 'BASE' });
        const foe = sim.mode === 'versus' ? sim.players.find(o => o.id !== localId && o.alive) : (sim.ai.alive ? sim.ai : null);
        if (foe && Math.abs(cx(foe) - cx(p)) < GAME_WIDTH * 1.5) marks.push({ x: cx(foe), y: cy(foe), color: '#f55', label: sim.ai && foe === sim.ai && sim.ai.boss ? 'GUNSHIP' : '!', pulse: true });
        const used = { l: 0, r: 0 };
        ctx.save();
        marks.forEach(m => {
            if (m.x >= cameraX && m.x <= cameraX + GAME_WIDTH) return;
            const left = m.x < cameraX, side = left ? 'l' : 'r';
            // On touch keep arrows above the thumbstick and the button cluster
            const y = clamp(m.y, 130, GAME_HEIGHT - (isTouch ? 190 : 150)) + used[side]++ * 34;
            const x = left ? 8 : GAME_WIDTH - 8, dx = Math.abs(m.x - (cameraX + GAME_WIDTH / 2));
            ctx.globalAlpha = m.pulse ? 0.55 + 0.45 * Math.abs(Math.sin(frame / 8)) : 0.9;
            ctx.fillStyle = m.color; ctx.strokeStyle = '#000'; ctx.lineWidth = 2;
            ctx.beginPath();
            if (left) { ctx.moveTo(x, y); ctx.lineTo(x + 16, y - 12); ctx.lineTo(x + 16, y + 12); }
            else { ctx.moveTo(x, y); ctx.lineTo(x - 16, y - 12); ctx.lineTo(x - 16, y + 12); }
            ctx.closePath(); ctx.stroke(); ctx.fill();
            ctx.globalAlpha = 1; ctx.font = hudFont(10); ctx.textAlign = left ? 'left' : 'right';
            const tx = left ? x + 20 : x - 20;
            ctx.lineWidth = 3; ctx.strokeText(m.label + ' ' + (dx / GAME_WIDTH).toFixed(1) + 'x', tx, y + 4);
            ctx.fillText(m.label + ' ' + (dx / GAME_WIDTH).toFixed(1) + 'x', tx, y + 4);
        });
        ctx.restore();
    }
    // First-run touch coach: one short contextual tip at a time until the rescue loop is learned
    function drawCoach() {
        const p = local();
        const sb = document.getElementById('btnShop');
        let tip = null, shopPulse = false;
        if (isTouch && p && p.alive && screen === 'playing' && !shopOpen() && sim.status !== 'waveclear' && sim.mode !== 'versus') {
            let nearest = Infinity;
            sim.hostages.forEach(h => { if (h.state === 'waiting' || h.state === 'running') nearest = Math.min(nearest, Math.abs(h.x - cx(p))); });
            const home = ownBaseOf(p), padDist = home ? Math.abs(cx(home) - cx(p)) : Infinity;
            if (!(coachBits & COACH_BOARD)) {
                if (nearest === Infinity) tip = null;
                else if (p.landed && nearest < 300) tip = 'Hold still - they are running aboard';
                else if (nearest < 300) tip = 'Pull the stick down to land beside the hut';
                else tip = 'Fly to the hostages (follow the yellow arrow)';
            } else if (p.carrying > 0 && !(coachBits & COACH_PAD)) {
                if (padDist < 200) tip = 'Land on the pad - unloads and repairs';
                else if (p.carrying === MAX_CARRY || nearest > 300) tip = 'Take them home: return to BASE';
            } else if (!(coachBits & COACH_SHOP) && p.credits >= UNITS.soldier.cost && (coachBits & COACH_PAD)) {
                tip = 'Tap $ to buy troops and upgrades'; shopPulse = true;
            }
        }
        if (sb && sb.classList && sb.classList.toggle) sb.classList.toggle('pulse', shopPulse);
        if (tip) bigText(tip, 146, 16, '#ff8');
    }
    function drawHUD() {
        const p = local();
        ctx.save();
        ctx.font = 'bold 13px Arial';
        // Left block: hull, bombs, aboard
        panel(8, 8, 154, 62);
        ctx.fillStyle = '#fff'; ctx.fillText('HULL', 14, 22);
        const pct = clamp(p.health / p.maxHealth, 0, 1);
        ctx.fillStyle = '#222'; rrect(56, 12, 96, 10, 3); ctx.fill();
        ctx.fillStyle = `hsl(${pct * 110},80%,50%)`; if (pct > 0) { rrect(56, 12, Math.max(6, Math.round(96 * pct)), 10, 3); ctx.fill(); }
        ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fillRect(57, 13, Math.max(0, Math.round(96 * pct) - 2), 3);
        if (p.upgrades.armor) { ctx.fillStyle = '#8f8'; ctx.font = isTouch ? 'bold 10px Arial' : 'bold 9px Arial'; ctx.fillText('+' + p.upgrades.armor, 154, 21); ctx.font = 'bold 13px Arial'; }
        // Booster meter just under the hull bar
        const bpct = clamp(p.boost / Sim.BOOST.max, 0, 1);
        ctx.fillStyle = '#222'; ctx.fillRect(56, 24, 96, 4);
        ctx.fillStyle = p.boosting ? '#ffb347' : bpct >= 1 ? '#6cf' : '#48a'; ctx.fillRect(56, 24, Math.round(96 * bpct), 4);
        if (!isTouch) { ctx.fillStyle = '#9cf'; ctx.font = 'bold 8px Arial'; ctx.fillText('JET', 36, 29); }
        ctx.font = 'bold 13px Arial';
        ctx.fillStyle = '#fff'; ctx.fillText('BOMBS', 14, 42);
        for (let i = 0; i < MAX_BOMBS; i++) { ctx.fillStyle = i < p.bombs ? '#f90' : '#444'; ctx.beginPath(); ctx.arc(70 + i * 15, 38, 5, 0, Math.PI * 2); ctx.fill(); }
        ctx.fillStyle = '#fff'; ctx.fillText('ABOARD', 14, 62);
        for (let i = 0; i < MAX_CARRY; i++) {
            ctx.fillStyle = i < p.carrying ? '#fd4' : '#444';
            ctx.beginPath(); ctx.arc(80 + i * 15, 56, 3, 0, Math.PI * 2); ctx.fill(); ctx.fillRect(77 + i * 15, 59, 6, 7);
        }
        // Troop bay (paratroopers) next to the hostage seats
        for (let i = 0; i < Sim.MAX_TROOPS; i++) {
            ctx.fillStyle = i < p.troops ? '#9cf' : '#444';
            ctx.beginPath(); ctx.arc(112 + i * 11, 56, 2.6, 0, Math.PI * 2); ctx.fill(); ctx.fillRect(109.5 + i * 11, 59, 5, 6);
        }
        // Right block: score, credits, troops
        const myUnits = sim.units.filter(u => u.team === p.team).length;
        const sn = hudSize(11), yB = 84 + sn + 4, yC = yB + sn + 3;
        ctx.textAlign = 'right';
        panel(GAME_WIDTH - 158, 8, 150, (sim.mode === 'versus' ? yB : yC) + 6 - 8);
        ctx.fillStyle = '#fff'; ctx.font = 'bold 16px Arial';
        ctx.fillText(String(p.score).padStart(6, '0'), GAME_WIDTH - 14, 26);
        ctx.font = 'bold 12px Arial'; ctx.fillStyle = '#ccc';
        if (sim.mode === 'solo') { ctx.fillText('BEST ' + highScore, GAME_WIDTH - 14, 44); ctx.fillStyle = '#ff0'; ctx.fillText('WAVE ' + sim.wave + ' · ' + biome().name, GAME_WIDTH - 14, 62); }
        else if (sim.mode === 'coop') { const o = sim.players[1 - localId]; ctx.fillText(o.name.toUpperCase().slice(0, 10) + ' ' + o.score, GAME_WIDTH - 14, 44); ctx.fillStyle = '#ff0'; ctx.fillText('WAVE ' + sim.wave + ' · ' + biome().name + '  LIVES ' + sim.lives, GAME_WIDTH - 14, 62); }
        else { const o = sim.players[1 - localId]; ctx.fillText(o.name.toUpperCase().slice(0, 10) + ' ' + o.score, GAME_WIDTH - 14, 44); ctx.fillStyle = '#ff0'; ctx.fillText('DOWNED ' + p.deaths + ' / ' + o.deaths, GAME_WIDTH - 14, 62); }
        ctx.fillStyle = '#8f8'; ctx.font = 'bold 18px Arial'; ctx.fillText('$' + p.credits, GAME_WIDTH - 14, 84);
        ctx.textAlign = 'left'; ctx.font = hudFont(11);
        ctx.fillText('CREDITS', GAME_WIDTH - 152, 84);
        ctx.fillStyle = '#ccc'; ctx.fillText('TROOPS ' + myUnits + '/' + MAX_ALLIES, GAME_WIDTH - 152, yB);
        if (sim.mode !== 'versus') {
            const fmtK = n => n >= 10000 ? (n / 1000).toFixed(1) + 'k' : String(n);
            ctx.fillStyle = '#fc6'; ctx.fillText('THREAT x' + Sim.threat(sim).toFixed(1), GAME_WIDTH - 152, yC, 66);
            ctx.fillStyle = '#f99'; ctx.textAlign = 'right'; ctx.fillText('ENEMY $' + fmtK(Math.floor(sim.aiCredits)), GAME_WIDTH - 14, yC, 66); ctx.textAlign = 'left';
        }
        // Radar strip
        const rx = 170, ry = 10, rw = GAME_WIDTH - 340, rh = isTouch ? 18 : 12, rowShift = isTouch ? 6 : 0;
        ctx.fillStyle = 'rgba(8,12,20,0.7)'; rrect(rx - 2, ry - 2, rw + 4, rh + 4, 4); ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 1; ctx.stroke();
        ctx.fillStyle = 'rgba(0,255,120,0.05)'; ctx.fillRect(rx, ry, rw, rh);
        const mx = x => rx + (x / WORLD_WIDTH) * rw;
        sim.bases.forEach(b => { ctx.fillStyle = b.destroyed ? '#555' : colorsOf(b.team).ui; ctx.fillRect(mx(b.x), ry, 3, rh); });
        sim.huts.forEach(h => { if (h.garrison) { ctx.fillStyle = h.garrison.team === AI || (sim.mode === 'versus' && h.garrison.team !== p.team) ? '#f66' : '#8f8'; ctx.fillRect(mx(h.x + 20) - 1, ry + 1, 4, 3); } });
        ctx.fillStyle = '#fd4';
        sim.hostages.forEach(h => { if (h.state === 'waiting' || h.state === 'running') ctx.fillRect(mx(h.x), ry + 3, 2, 6); });
        sim.units.forEach(u => { ctx.fillStyle = u.team === p.team ? '#8f8' : (sim.mode === 'coop' && u.team !== AI) ? '#9cf' : '#f33'; ctx.fillRect(mx(u.x), ry + 4, u.type === 'tank' ? 3 : 2, 4); });
        if (sim.mode !== 'versus' && sim.ai.alive) { ctx.fillStyle = sim.ai.boss ? '#f44' : '#f0f'; ctx.fillRect(mx(sim.ai.x), ry + 2, sim.ai.boss ? 6 : 4, isTouch ? 6 : 4); }
        sim.pickups.forEach(k => { ctx.fillStyle = Sim.PICKUPS[k.type].color; ctx.fillRect(mx(k.x), ry + 9, 2, 2); });
        sim.paras.forEach(k => { ctx.fillStyle = '#9cf'; ctx.fillRect(mx(k.x), ry + 1, 2, 3); });
        sim.balloons.forEach(b => { ctx.fillStyle = (sim.mode === 'versus' ? b.team !== localId : b.team === AI) ? '#f66' : '#9cf'; ctx.beginPath(); ctx.arc(mx(b.x) + 1, ry + 3, 1.6, 0, Math.PI * 2); ctx.fill(); });
        sim.players.forEach(o => { if (o.alive && o.id !== localId) { ctx.fillStyle = sim.mode === 'coop' ? '#9cf' : '#f0f'; ctx.fillRect(mx(o.x), ry + 2, 4, 4); } });
        ctx.fillStyle = '#0f0'; ctx.fillRect(mx(p.x), ry + 2, 4, rh - 4);
        ctx.strokeStyle = '#fff6'; ctx.lineWidth = 1; ctx.strokeRect(mx(cameraX), ry, (GAME_WIDTH / WORLD_WIDTH) * rw, rh);
        // Centre lines
        ctx.fillStyle = '#fff'; ctx.font = hudFont(11); ctx.textAlign = 'center';
        if (sim.mode !== 'versus') {
            const remaining = sim.hostages.filter(h => h.state === 'waiting' || h.state === 'running' || h.state === 'aboard').length;
            const rescued = sim.mode === 'coop' ? sim.players.reduce((a, q) => a + q.rescued, 0) : p.rescued;
            ctx.fillText(`RESCUED ${rescued}   LOST ${sim.waveLost}   REMAINING ${remaining}`, GAME_WIDTH / 2, 36 + rowShift, GAME_WIDTH - 340);
        } else {
            // Base hull bars
            const mine = sim.bases[localId], theirs = sim.bases[1 - localId];
            const bar = (b, x, label, align) => {
                const pc = clamp(b.health / b.maxHealth, 0, 1);
                ctx.fillStyle = '#0007'; ctx.fillRect(x, 28, 140, 12);
                ctx.fillStyle = `hsl(${pc * 110},80%,45%)`; ctx.fillRect(x + 1, 29, Math.round(138 * pc), 10);
                ctx.fillStyle = '#fff'; ctx.textAlign = align; ctx.fillText(label + ' BASE ' + Math.ceil(b.health), align === 'left' ? x + 4 : x + 136, 38);
            };
            ctx.save(); ctx.translate(0, rowShift); bar(mine, 170, 'YOUR', 'left'); bar(theirs, GAME_WIDTH - 310, 'ENEMY', 'right'); ctx.restore();
            ctx.textAlign = 'center';
        }
        const gc = Sim.upgradeCost(p, 'gun'), ac = Sim.upgradeCost(p, 'armor');
        ctx.fillStyle = '#8f8';
        const cd = p.strikeCooldown > 0 ? Math.ceil(p.strikeCooldown / 60) + 'S' : '$' + Sim.AIRSTRIKE.cost;
        // Key hint between the HUD panels (desktop); falls back to a short form when the view is narrow.
        // On touch the first-run coach and the $ chip replace it.
        if (!isTouch) {
            const avail = GAME_WIDTH - 340;
            const long = `[1] SOLDIER $${UNITS.soldier.cost}  [2] TANK $${UNITS.tank.cost}  [3] GUNS ${gc === null ? 'MAX' : '$' + gc}  [4] ARMOR ${ac === null ? 'MAX' : '$' + ac}  [5] AIRSTRIKE ${cd}  [6] ${p.rally !== null ? 'RELEASE' : 'HOLD'}  [7] ${p.landed ? 'LOAD' : 'DROP'} ${p.troops}/${Sim.MAX_TROOPS}`;
            const lm = ctx.measureText && ctx.measureText(long);
            const hint = lm && lm.width > avail ? `[1-4] BUY  [5] AIRSTRIKE ${cd}  [6] ${p.rally !== null ? 'RELEASE' : 'HOLD'}  [7] TROOPS ${p.troops}` : long;
            ctx.fillText(hint, GAME_WIDTH / 2, 52, avail);
        }
        if (Sound.muted) { ctx.fillStyle = '#ccc'; ctx.fillText('MUTED', GAME_WIDTH / 2, 66 + rowShift); }
        if (comboText(p)) { ctx.fillStyle = '#ff0'; ctx.font = 'bold 16px Arial'; ctx.fillText(comboText(p), GAME_WIDTH / 2, 100); }
        if (screen === 'playing' && p.alive && pct < 0.3 && Math.floor(frame / 15) % 2 === 0) {
            const home = ownBaseOf(p), dx = home ? cx(home) - cx(p) : 0;
            const dir = Math.abs(dx) < GAME_WIDTH / 2 ? '' : (dx < 0 ? ' ◄ ' : ' ► ') + (Math.abs(dx) / GAME_WIDTH).toFixed(1) + 'x';
            ctx.fillStyle = '#f44'; ctx.font = 'bold 14px Arial'; ctx.fillText('HULL CRITICAL - RETURN TO BASE' + dir, GAME_WIDTH / 2, isTouch ? 120 : GAME_HEIGHT - 14);
        }
        if (sim.mode !== 'solo' && !p.alive && screen === 'playing') {
            ctx.fillStyle = '#f88'; ctx.font = 'bold 16px Arial';
            ctx.fillText(p.canRespawn === false ? 'NO LIVES LEFT - YOUR PARTNER FIGHTS ON' : 'SHOT DOWN - REDEPLOYING IN ' + Math.max(0, Math.ceil((301 - p.respawn) / 60)), GAME_WIDTH / 2, 130);
        }
        if (sim.mode !== 'solo') { ctx.fillStyle = net.transport === 'relay' ? '#fc6' : '#9cf'; ctx.font = hudFont(10); ctx.fillText((net.transport === 'relay' ? 'SERVER RELAY  ' : '') + 'PING ' + Math.round(net.rtt) + 'ms  DELAY ' + INPUT_DELAY, GAME_WIDTH / 2, 112); }
        if (sim.mode === 'versus' && net.stalled > 20 && screen === 'playing') {
            ctx.fillStyle = '#fc6'; ctx.font = 'bold 14px Arial'; ctx.fillText('WAITING FOR OPPONENT...', GAME_WIDTH / 2, GAME_HEIGHT - 30);
        }
        ctx.restore();
    }
    function overlay(alpha) { ctx.fillStyle = `rgba(0,0,0,${alpha})`; ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT); }
    function bigText(text, y, size, color) {
        ctx.textAlign = 'center'; ctx.font = `bold ${size}px Arial`;
        ctx.lineWidth = Math.max(2, size / 8); ctx.strokeStyle = '#000'; ctx.strokeText(text, GAME_WIDTH / 2, y);
        ctx.fillStyle = color; ctx.fillText(text, GAME_WIDTH / 2, y);
        ctx.textAlign = 'left';
    }
    function drawOverlays() {
        const prompt = isTouch ? 'TAP TO ' : 'PRESS SPACE TO ';
        const blink = Math.floor(frame / 30) % 2 === 0;
        if (screen === 'title') {
            overlay(0.45);
            // Demo flyby
            const fx = ((frame * 1.6) % (GAME_WIDTH + 200)) - 100, bobY = 70 + Math.sin(frame / 40) * 6;
            drawHeli({ x: fx - 30, y: bobY - 12, width: 60, height: 24, dir: 1, tilt: 0.15 }, '#3c3', '#9ff', false);
            // Logo with gradient fill and shadow
            ctx.save(); ctx.textAlign = 'center'; ctx.font = 'bold 52px Arial';
            ctx.lineWidth = 8; ctx.strokeStyle = '#000'; ctx.strokeText('NQ CHOPPER', GAME_WIDTH / 2, 122);
            ctx.fillStyle = cached('logo', () => { const g = ctx.createLinearGradient(0, 80, 0, 125); g.addColorStop(0, '#fff6a0'); g.addColorStop(0.5, '#ffd000'); g.addColorStop(1, '#e07000'); return g; });
            ctx.fillText('NQ CHOPPER', GAME_WIDTH / 2, 122);
            ctx.restore();
            if (daily) bigText('DAILY CHALLENGE ' + daily.day + ' · SAME WORLD FOR EVERYONE · ONE BOARD PER DAY', 138, 12, '#fc6');
            bigText('Rescue the hostages and bring them home', 155, 16, '#fff');
            if (isTouch) {
                bigText('Land by the hostages, fly them home, land on BASE', 194, 14, '#ddd');
                bigText('Left thumb flies · right thumb fires · $ shop · AUTO fires for you', 216, 14, '#8f8');
                const fsTip = canFS ? 'Tap to start in full screen' : (isIOS && !standalone ? 'Tip: Share → Add to Home Screen for full screen' : '');
                if (fsTip) bigText(fsTip, 238, 12, '#9cf');
            } else {
                bigText('Land near hostages so they can run aboard · 4 seats · Return to BASE to unload', 200, 12, '#ddd');
                bigText('Bombs hit ground targets · Bullets for the enemy chopper · Base repairs and rearms', 220, 12, '#ddd');
                bigText('Watch out: tanks crush hostages running in the open, and so do your bombs', 240, 12, '#f99');
                bigText('Press 1 / 2 to buy Soldiers ($' + UNITS.soldier.cost + ') and Tanks ($' + UNITS.tank.cost + ') · They march on the enemy base', 262, 12, '#8f8');
                bigText('Press 3 / 4 to upgrade Guns and Armor · 5 Airstrike · 6 Hold troops · 7 Load and paradrop soldiers', 278, 12, '#8f8');
            }
            if (blink) bigText(prompt + 'START', 310, 20, '#0f0');
            if (highScore > 0) bigText('BEST ' + highScore, 345, 14, '#ccc');
            if (!isTouch) bigText('Hold SHIFT while flying to engage the jet booster', 362, 11, '#9cf');
            loadBoard(); drawBoardPanel(GAME_WIDTH - 200, 8, daily ? 'TODAY\'S TOP PILOTS' : 'TOP PILOTS');
        } else if (screen === 'playing' && isTouch && shopOpen() && mode === 'solo') {
            bigText('SHOP · SLOW-MO', 84, 12, '#8f8');
        } else if (screen === 'paused') {
            overlay(0.5);
            bigText('PAUSED', 190, 40, '#fff');
            if (!isTouch) bigText('PRESS P TO RESUME', 230, 16, '#ccc');
        } else if (screen === 'playing' && sim.status === 'waveclear' && sim.mode !== 'versus') {
            overlay(Math.min(0.5, sim.statusTimer / 60));
            bigText('WAVE ' + sim.wave + ' CLEAR', 150, 40, '#ff0');
            bigText(`RESCUED ${sim.waveRescued}   LOST ${sim.waveLost}`, 195, 18, '#fff');
            bigText('BONUS +' + sim.waveBonus + (sim.waveLost === 0 ? '  PERFECT!' : ''), 225, 18, sim.waveLost === 0 ? '#0f0' : '#ff0');
            bigText('GET READY FOR WAVE ' + (sim.wave + 1) + ((sim.wave + 1) % Sim.BOSS_EVERY === 0 ? '  ·  GUNSHIP WAVE' : ''), 280, 16, (sim.wave + 1) % Sim.BOSS_EVERY === 0 ? '#f66' : '#ccc');
            bigText('THREAT RISES TO x' + Sim.threat({ wave: sim.wave + 1 }).toFixed(1) + ' · tougher armour, harder hits, richer enemy', 302, 12, '#fc6');
            bigText('NEXT TERRAIN: ' + BIOMES[sim.wave % BIOMES.length].name, 322, 13, '#9cf');
        } else if (screen === 'gameover') {
            const p = local();
            overlay(Math.min(0.55, screenTimer / 40));
            bigText(daily ? 'DAILY RUN OVER' : 'CHOPPER DOWN', 140, 44, '#f44');
            bigText('SCORE ' + p.score, 190, 24, '#fff');
            bigText(`RESCUED ${p.rescued}   LOST ${p.lost}   WAVE ${sim.wave}`, 220, 16, '#ccc');
            if (newBest) bigText('NEW BEST SCORE!', 255, 20, '#ff0'); else bigText('BEST ' + highScore, 255, 16, '#ccc');
            if (submitStatus) bigText(submitStatus, 285, 13, '#8f8');
            if (screenTimer > 30 && blink) bigText(isTouch ? 'TAP TO RETRY' : 'PRESS R OR SPACE TO RETRY', 310, 18, '#0f0');
            loadBoard(); drawBoardPanel(GAME_WIDTH - 200, 8, daily ? 'TODAY\'S TOP PILOTS' : 'TOP PILOTS');
        } else if (screen === 'lobby') {
            overlay(0.55);
            bigText('ONLINE MATCH', 90, 36, '#ff0');
            bigText('MATCH CODE', 135, 14, '#ccc');
            bigText(match.code, 175, 44, '#fff');
            if (match.role === 'host' && !net.opponent) bigText('Send this code, or use "Copy invite link" above. They can join with one click.', 210, 13, '#ddd');
            else bigText('Opponent: ' + (net.opponent ? net.opponent.name : '...'), 210, 15, '#9cf');
            bigText(net.status + (net.level === 'error' ? '' : (blink ? '' : ' ')), 255, 16, net.level === 'error' ? '#f66' : net.level === 'warn' ? '#fc6' : '#8f8');
            if (net.level === 'error') bigText('Open the Lobby link above to try again', 285, 13, '#ccc');
            else if (net.level !== 'ok' && net.opponent) bigText('Trying a direct connection first, then the server relay if needed', 285, 12, '#aaa');
            bigText(match.mode === 'coop' ? 'Co-op: one base, shared lives, survive the waves together' : 'First pilot to destroy the other base wins · Rescue hostages for credits', 330, 12, '#ddd');
        } else if (screen === 'countdown') {
            overlay(0.35);
            const n = Math.ceil((180 - screenTimer) / 60);
            const o = sim.players[1 - localId];
            bigText((sim.mode === 'coop' ? 'CO-OP WITH ' : 'VS ') + o.name.toUpperCase(), 120, 28, '#9cf');
            bigText(n > 0 ? String(n) : 'GO!', 200, 72, '#ff0');
            bigText(sim.mode === 'coop' ? 'SHARED BASE ON THE LEFT · ' + sim.lives + ' LIVES · SURVIVE THE WAVES' : localId === 0 ? 'YOUR BASE IS ON THE LEFT' : 'YOUR BASE IS ON THE RIGHT', 260, 16, '#fff');
        } else if (screen === 'over') {
            const p = local(), o = sim.players[1 - localId];
            overlay(Math.min(0.6, screenTimer / 40));
            const won = sim.winner === localId, draw = sim.winner === null;
            if (sim.mode === 'coop') {
                bigText('MISSION OVER', 130, 52, '#f66');
                bigText(sim.endReason || '', 170, 16, '#ddd');
                bigText(`SQUAD SCORE ${p.score + o.score}   ·   WAVE ${sim.wave}`, 210, 22, '#ff0');
                bigText(`${p.name.toUpperCase()} ${p.score}   ·   ${o.name.toUpperCase()} ${o.score}   ·   RESCUED ${p.rescued + o.rescued}`, 240, 14, '#ccc');
            } else {
                bigText(draw ? 'DRAW' : won ? 'VICTORY' : 'DEFEAT', 130, 52, draw ? '#ccc' : won ? '#0f0' : '#f44');
                bigText(sim.endReason || '', 170, 16, '#ddd');
                bigText(`${p.name.toUpperCase()} ${p.score}   ·   ${o.name.toUpperCase()} ${o.score}`, 210, 20, '#fff');
                bigText(`RESCUED ${p.rescued}   TIMES DOWNED ${p.deaths}`, 240, 14, '#ccc');
            }
            if (screenTimer > 60 && blink) bigText(prompt + 'RETURN TO LOBBY', 300, 18, '#0f0');
        }
    }
    function render() {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = '#000'; ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.setTransform(view.scale, 0, 0, view.scale, view.ox, view.oy);
        ctx.save();
        ctx.beginPath(); ctx.rect(0, 0, GAME_WIDTH, GAME_HEIGHT); ctx.clip();
        drawSky();
        const bm = biome();
        drawLayer(farMountains, 0.12, bm.far, GROUND_Y - 10);
        drawLayer(mountains, 0.25, bm.mtn, GROUND_Y);
        if (bm.key === 'arctic' || bm.key === 'volcanic') drawCaps(mountains, 0.25, bm.key === 'arctic' ? '#ffffff' : '#ff6a2a');
        // Haze band between layers
        ctx.fillStyle = cached('haze' + bm.key, () => { const h = ctx.createLinearGradient(0, GROUND_Y - 120, 0, GROUND_Y); h.addColorStop(0, 'rgba(255,255,255,0)'); h.addColorStop(1, bm.haze); return h; });
        ctx.fillRect(0, GROUND_Y - 120, GAME_WIDTH, 120);
        drawLayer(hills, 0.5, bm.hills, GROUND_Y);
        if (sim) {
            const sx = shake > 0 ? (Math.random() - 0.5) * shake : 0, sy = shake > 0 ? (Math.random() - 0.5) * shake : 0;
            ctx.save();
            ctx.translate(-Math.round(cameraX) + sx, sy);
            drawGround();
            sim.bases.forEach(b => { if (isVisible(b.x + b.width / 2, 200)) (b.team === AI ? drawFortress(b) : drawPad(b, b.team)); });
            drawHuts();
            drawHostages();
            drawUnits();
            drawPickups();
            drawStrikesAndParas();
            drawChoppers();
            if (isTouch && screen === 'playing' && sim && local() && local().alive && !local().landed && local().bombs > 0) drawBombMarker(local());
            drawProjectiles();
            drawParticles();
            drawFloatTexts();
            ctx.restore();
            drawPost();
            if (screen !== 'title' && screen !== 'lobby' && screen !== 'gameover') { drawEdgeIndicators(); drawHUD(); drawCoach(); }
        } else {
            ctx.save(); ctx.translate(-Math.round(cameraX), 0); drawGround(); ctx.restore();
            drawPost();
        }
        drawOverlays();
        ctx.restore();
    }

    // =====================================================================
    // Input
    // =====================================================================
    const KEYMAP = { ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', Space: 'fire', ShiftLeft: 'boost', ShiftRight: 'boost' };
    const BUYKEYS = { Digit1: 'soldier', Numpad1: 'soldier', Digit2: 'tank', Numpad2: 'tank', Digit3: 'gun', Numpad3: 'gun', Digit4: 'armor', Numpad4: 'armor',
        Digit5: 'strike', Numpad5: 'strike', Digit6: 'rally', Numpad6: 'rally', Digit7: 'troops', Numpad7: 'troops' };
    const inPlay = () => screen === 'playing';
    document.addEventListener('keydown', e => {
        Sound.unlock();
        stick.lastKey = Date.now();
        const k = KEYMAP[e.code];
        if (k) { e.preventDefault(); if (inPlay()) input[k] = true; }
        if (e.repeat) return;
        if (e.code === 'Space' || e.code === 'Enter') { if (!inPlay()) primaryAction(); }
        if (e.code === 'KeyB' && inPlay()) bombQueued = true;
        if (BUYKEYS[e.code] && inPlay()) buyQueued = BUYKEYS[e.code];
        if (e.code === 'KeyP' || e.code === 'Escape') togglePause();
        if (e.code === 'KeyM') toggleMute();
        if (e.code === 'KeyR' && mode === 'solo' && (screen === 'gameover' || screen === 'paused')) startSolo();
    });
    document.addEventListener('keyup', e => { const k = KEYMAP[e.code]; if (k) input[k] = false; });
    window.addEventListener('blur', () => { clearInput(); resetTouch(); if (mode === 'solo' && screen === 'playing') togglePause(); });
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) { resetTouch(); if (mode === 'solo' && screen === 'playing') togglePause(); }
        else Sound.resumeQuiet();
        syncWakeLock();
    });
    window.addEventListener('pagehide', () => resetTouch());
    window.addEventListener('pageshow', e => { if (e && e.persisted) { resetTouch(); Sound.resumeQuiet(); } });
    // Touch state must never stay stuck after the OS steals a touch, the tab hides or the game pauses
    let canvasReset = null;
    function resetTouch() { if (stick.reset) stick.reset(); if (canvasReset) canvasReset(); tapFireFrames = 0; input.fire = false; input.boost = false; }
    function shopOpen() { return !!(shopEl && shopEl.classList && shopEl.classList.contains && shopEl.classList.contains('open')); }
    let shopOpenedAt = 0;
    function closeShop() {
        if (!shopOpen()) return;
        shopEl.classList.remove('open');
        const b = document.getElementById('btnShop'); if (b && b.setAttribute) b.setAttribute('aria-expanded', 'false');
        needsRender = true;
    }

    function bindControl(el, onDown, onUp) {
        if (!el) return;
        const active = new Set();
        el.addEventListener('pointerdown', e => { e.preventDefault(); Sound.unlock(); active.add(e.pointerId); onDown(); });
        ['pointerup', 'pointercancel', 'pointerout', 'pointerleave'].forEach(ev => el.addEventListener(ev, e => {
            if (active.has(e.pointerId)) { active.delete(e.pointerId); e.preventDefault(); onUp(); }
        }));
        el.addEventListener('touchstart', e => e.preventDefault(), { passive: false });
        el.addEventListener('contextmenu', e => e.preventDefault());
    }
    const press = (id, on) => { const el = document.getElementById(id); if (el && el.classList) el.classList.toggle('active', on); };
    bindControl(document.getElementById('btnShoot'), () => { if (!inPlay()) primaryAction(); input.fire = true; press('btnShoot', true); }, () => { input.fire = false; press('btnShoot', false); });
    bindControl(document.getElementById('btnBomb'), () => { if (inPlay()) { bombQueued = true; buzz(15); } press('btnBomb', true); }, () => press('btnBomb', false));
    bindControl(document.getElementById('btnBoost'), () => { input.boost = true; press('btnBoost', true); }, () => { input.boost = false; press('btnBoost', false); });
    bindControl(document.getElementById('btnTroops'), () => { if (inPlay()) buyQueued = 'troops'; }, () => {});
    const setAutoAttr = () => { const b = document.getElementById('btnAuto'); if (b && b.setAttribute) b.setAttribute('aria-pressed', autoFire ? 'true' : 'false'); };
    setAutoAttr();
    bindControl(document.getElementById('btnAuto'), () => { autoFire = !autoFire; lsSet('nqAuto', autoFire ? '1' : '0'); setAutoAttr(); }, () => {});
    bindControl(document.getElementById('btnShop'), () => {
        if (!shopEl || !shopEl.classList) return;
        if (shopOpen()) { closeShop(); return; }
        if (!inPlay()) return;
        shopEl.classList.add('open'); shopOpenedAt = performance.now(); shopWave = sim ? sim.wave : 0; coachSet(COACH_SHOP);
        const b = document.getElementById('btnShop'); if (b && b.setAttribute) b.setAttribute('aria-expanded', 'true');
        needsRender = true;
    }, () => {});
    bindControl(document.getElementById('pauseBtn'), () => { if (mode === 'solo' && screen === 'playing') { togglePause(); buzz(10); } }, () => {});
    bindControl(document.getElementById('pmResume'), () => { if (screen === 'paused') togglePause(); }, () => {});
    bindControl(document.getElementById('pmRestart'), () => { if (mode === 'solo') startSolo(); }, () => {});
    bindControl(document.getElementById('pmMenu'), () => { if (mode === 'solo') quitToMenu(); else if (match) window.location.href = match.urls.lobby; }, () => {});
    // Floating thumbstick: appears where the left thumb lands, steers while dragged
    (function () {
        const zone = document.getElementById('stickZone'), base = document.getElementById('stickBase'), knob = document.getElementById('stickKnob');
        if (!isTouch || !zone || !base || !knob || !zone.getBoundingClientRect) return;
        const R = 46;
        let pid = null, ox = 0, oy = 0, st = 0, moved = false;
        const setKnob = (dx, dy) => { knob.style.transform = `translate(${dx}px, ${dy}px)`; };
        const reset = () => {
            if (pid !== null) { try { zone.releasePointerCapture(pid); } catch (err) { /* ignore */ } }
            pid = null; stick.active = false; stick.x = 0; stick.y = 0; stick.accX = 0; stick.holdY = null;
            setKnob(0, 0); base.classList.add('idle'); base.style.left = ''; base.style.top = '';
        };
        stick.reset = reset;
        zone.addEventListener('lostpointercapture', e => { if (e.pointerId === pid) reset(); });
        zone.addEventListener('pointerdown', e => {
            e.preventDefault();
            if (pid !== null) { if (e.isPrimary && e.pointerId !== pid) reset(); else return; } // a stale pointer: take over
            closeShop();
            pid = e.pointerId; ox = e.clientX; oy = e.clientY; st = Date.now(); moved = false; stick.holdY = null; stick.accX = 0;
            const r = zone.getBoundingClientRect();
            base.classList.remove('idle'); base.style.left = (e.clientX - r.left) + 'px'; base.style.top = (e.clientY - r.top) + 'px';
            setKnob(0, 0); stick.active = true; stick.x = 0; stick.y = 0;
            try { zone.setPointerCapture(pid); } catch (err) { /* ignore */ }
        });
        zone.addEventListener('pointermove', e => {
            if (e.pointerId !== pid) return;
            e.preventDefault();
            let dx = e.clientX - ox, dy = e.clientY - oy;
            const d = Math.hypot(dx, dy);
            if (d > 8) moved = true;
            if (d > R) { dx = dx / d * R; dy = dy / d * R; }
            setKnob(dx, dy); stick.x = dx / R; stick.y = dy / R;
        });
        const end = e => {
            if (e.pointerId !== pid) return;
            e.preventDefault(); pid = null;
            stick.active = false; stick.x = 0; stick.y = 0;
            setKnob(0, 0); base.classList.add('idle'); base.style.left = ''; base.style.top = '';
            if (!moved && Date.now() - st < 300 && !inPlay()) primaryAction();
        };
        zone.addEventListener('pointerup', end); zone.addEventListener('pointercancel', end);
        zone.addEventListener('touchstart', e => e.preventDefault(), { passive: false });
        zone.addEventListener('contextmenu', e => e.preventDefault());
    })();
    shopButtons.forEach(([btn, type]) => {
        if (!btn) return;
        btn.addEventListener('click', () => {
            if (isTouch && performance.now() - shopOpenedAt < 150) return; // ignore the tap that opened the drawer
            if (inPlay()) { buyQueued = type; if (isTouch) closeShop(); }
            if (btn.blur) btn.blur();
        });
    });
    if (shareBtn) shareBtn.addEventListener('click', () => {
        const p = local(); if (!p) return;
        const what = daily ? 'the NQ Chopper Daily Challenge (' + daily.day + ')' : 'NQ Chopper';
        const text = `I scored ${p.score.toLocaleString()} in ${what}: wave ${sim.wave}, ${p.rescued} hostages rescued. Beat me: ${shareBtn.getAttribute('data-url')}${daily ? '/play?daily=1' : '/play'}`;
        const done = () => { shareBtn.textContent = 'Copied!'; setTimeout(() => { shareBtn.textContent = 'Share score'; }, 2500); };
        if (navigator.share) navigator.share({ text }).catch(() => {});
        else if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, () => window.prompt('Copy your score', text));
        else window.prompt('Copy your score', text);
    });

    // Canvas gestures: drag to steer, tap to shoot/start, long-press to bomb
    (function () {
        let pid = null, sx = 0, sy = 0, st = 0, moved = false, lpTimer = null;
        const TAP_DIST = 12, TAP_TIME = 300, LONG_PRESS = 450, MOVE = 15;
        canvasReset = () => { pid = null; if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; } };
        function down(e) {
            e.preventDefault();
            if (pid !== null) { if (e.isPrimary && e.pointerId !== pid) canvasReset(); else return; }
            pid = e.pointerId; sx = e.clientX; sy = e.clientY; st = Date.now(); moved = false;
            if (lpTimer) clearTimeout(lpTimer);
            // Long-press to bomb is a mouse/desktop gesture; on touch, stray touches must not cost bombs
            if (!isTouch) lpTimer = setTimeout(() => { if (!moved && inPlay()) bombQueued = true; lpTimer = null; }, LONG_PRESS);
        }
        function move(e) {
            if (e.pointerId !== pid) return;
            e.preventDefault();
            const dx = e.clientX - sx, dy = e.clientY - sy;
            if (Math.abs(dx) > MOVE || Math.abs(dy) > MOVE) { moved = true; if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; } }
            if (inPlay() && !isTouch) { input.left = dx < -MOVE; input.right = dx > MOVE; input.up = dy < -MOVE; input.down = dy > MOVE; }
        }
        function up(e) {
            if (e.pointerId !== pid) return;
            e.preventDefault();
            const dt = Date.now() - st, d = Math.hypot(e.clientX - sx, e.clientY - sy);
            if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; }
            if (!moved && dt < TAP_TIME && d < TAP_DIST) { if (!inPlay()) primaryAction(); else if (!isTouch) tapFireFrames = 3; }
            if (!isTouch) input.left = input.right = input.up = input.down = false;
            pid = null;
        }
        canvas.addEventListener('pointerdown', down);
        canvas.addEventListener('pointermove', move);
        canvas.addEventListener('pointerup', up);
        canvas.addEventListener('pointercancel', up);
        canvas.addEventListener('touchstart', e => e.preventDefault(), { passive: false });
        canvas.addEventListener('touchmove', e => e.preventDefault(), { passive: false });
        canvas.addEventListener('contextmenu', e => e.preventDefault());
    })();

    // =====================================================================
    // Main loop: fixed 60 Hz simulation, render every animation frame
    // =====================================================================
    const STEP = 1000 / 60;
    let last = performance.now(), acc = 0, slowFrames = 0;
    let lowDetail = reducedMotion;
    function loop(now) {
        const dt = Math.min(now - last, 100);
        acc += dt;
        last = now;
        let steps = 0;
        while (acc >= STEP - 1) { update(); acc -= STEP; steps++; }
        // 90/120 Hz screens: only draw when the simulation advanced (or something asked for a redraw)
        if (steps || needsRender) { render(); needsRender = false; }
        // Auto low-detail: if the device keeps needing catch-up steps (< ~40 fps), drop the dearest cosmetics
        if (steps > 1) { if (++slowFrames > 90 && !lowDetail) { lowDetail = true; particles.length = Math.min(particles.length, 80); } } else if (slowFrames > 0) slowFrames--;
        requestAnimationFrame(loop);
    }

    // Read-only debug hook (used by automated play tests)
    window.__nq = { get sim() { return sim; }, get screen() { return screen; }, get mode() { return mode; }, get net() { return net; }, get localId() { return localId; },
        get state() { return screen; }, get score() { return local() ? local().score : 0; }, get credits() { return local() ? local().credits : 0; },
        input, startSolo, primaryAction, togglePause, quitToMenu, stick, touchVertical, predictLocal, get autoFire() { return autoFire; }, get frame() { return frame; } };

    fitCanvas();
    if (mode === 'solo') {
        sim = Sim.createGame({ mode: 'solo', seed: 1 }); // world behind the title screen
        sim.fx = [];
        screen = 'title';
        const hash = (window.location && window.location.hash) || '';
        if (hash.indexOf('#autostart') === 0) {
            startSolo(); input.up = true; input.right = true;
            setTimeout(() => { input.up = false; input.fire = true; }, 1500);
            const wm = /wave=(\d+)/.exec(hash); // screenshot helper: jump straight to a given wave
            if (wm && mode === 'solo') { sim.wave = Math.max(0, parseInt(wm[1], 10) - 1); sim.status = 'waveclear'; sim.statusTimer = 179; }
            if (hash.indexOf('shop') > 0 && shopEl && shopEl.classList) { shopEl.classList.add('open'); shopWave = sim.wave; }
            if (hash.indexOf('#autostart-demo') === 0) { // screenshot/demo helper: show troops near base
                sim.players[0].credits = 1000; input.right = false;
                setTimeout(() => { buyQueued = 'tank'; }, 300); setTimeout(() => { buyQueued = 'soldier'; }, 600); setTimeout(() => { buyQueued = 'soldier'; }, 900);
            }
        }
    } else {
        startVersus();
    }
    updateDomScore();
    if (document.body && document.body.dataset) { document.body.dataset.screen = screen; document.body.dataset.mode = mode; lastScreenAttr = screen; }
    requestAnimationFrame(loop);
})();
