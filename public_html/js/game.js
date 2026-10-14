/*
 * NQ Chopper client: rendering, input, sound and online lockstep.
 * All gameplay lives in sim.js; this file only feeds it inputs and draws it.
 */
(function () {
    'use strict';

    const Sim = window.NQSim;
    const cfg = window.NQ_CONFIG || {};
    const match = cfg.match || null;

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
    const shopButtons = [
        [document.getElementById('buySoldier'), 'soldier'], [document.getElementById('buyTank'), 'tank'],
        [document.getElementById('buyGun'), 'gun'], [document.getElementById('buyArmor'), 'armor']
    ];

    const GAME_WIDTH = 640, GAME_HEIGHT = 400;
    const { WORLD_WIDTH, GROUND_Y, MAX_CARRY, MAX_BOMBS, MAX_ALLIES, UNITS, UPGRADES, AI } = Sim;
    const HIGH_SCORE_KEY = 'nqChopperHighScore';
    const INPUT_DELAY = 4; // lockstep input latency in ticks (~67 ms)

    const isTouch = window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
    if (isTouch) {
        document.body.classList.add('touch');
        touchControls.style.display = 'flex';
        document.getElementById('keyHelp').style.display = 'none';
        document.getElementById('touchHelp').style.display = '';
    }

    // ---------------------------------------------------------------------
    // Presentation: fit to window, fullscreen (letterboxed logical view)
    // ---------------------------------------------------------------------
    const view = { scale: 1, ox: 0, oy: 0 };
    function isFullscreen() { return !!(document.fullscreenElement || document.webkitFullscreenElement); }
    function fitCanvas() {
        if (isFullscreen()) {
            canvas.width = window.innerWidth; canvas.height = window.innerHeight;
            canvas.style.transform = 'none';
            canvasWrapper.style.width = ''; canvasWrapper.style.height = '';
        } else {
            canvas.width = GAME_WIDTH; canvas.height = GAME_HEIGHT;
            const reserve = isTouch ? 200 : 110;
            const scale = Math.min(window.innerWidth / GAME_WIDTH, (window.innerHeight - reserve) / GAME_HEIGHT, 1);
            canvas.style.transform = `scale(${scale})`;
            canvasWrapper.style.width = (GAME_WIDTH * scale) + 'px';
            canvasWrapper.style.height = (GAME_HEIGHT * scale) + 'px';
        }
        view.scale = Math.min(canvas.width / GAME_WIDTH, canvas.height / GAME_HEIGHT);
        view.ox = (canvas.width - GAME_WIDTH * view.scale) / 2;
        view.oy = (canvas.height - GAME_HEIGHT * view.scale) / 2;
    }
    window.addEventListener('resize', fitCanvas);
    window.addEventListener('orientationchange', () => setTimeout(fitCanvas, 200));
    ['fullscreenchange', 'webkitfullscreenchange'].forEach(ev => document.addEventListener(ev, fitCanvas));
    fullscreenBtn.addEventListener('click', () => {
        const req = canvas.requestFullscreen || canvas.webkitRequestFullscreen;
        if (req) req.call(canvas);
    });

    // ---------------------------------------------------------------------
    // Sound (synthesised, no assets)
    // ---------------------------------------------------------------------
    const Sound = (() => {
        let ac = null, muted = false;
        function get() {
            if (!ac) { try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { ac = null; } }
            if (ac && ac.state === 'suspended') ac.resume();
            return ac;
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
            unlock: get,
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
    function toggleMute() { muteBtn.textContent = Sound.toggleMute() ? 'Sound: Off' : 'Sound: On'; }
    muteBtn.addEventListener('click', toggleMute);

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
    const input = { left: false, right: false, up: false, down: false, fire: false };
    let bombQueued = false, buyQueued = null;
    const local = () => sim ? sim.players[localId] : null;

    // Scenery generated once
    const clouds = [];
    for (let i = 0; i < 12; i++) clouds.push({ x: rand(0, WORLD_WIDTH), y: rand(20, 150), w: rand(50, 110), speed: rand(0.05, 0.15) });
    const mountainPeriod = 480;
    const mountains = [], hills = [];
    for (let i = 0; i < 6; i++) mountains.push({ x: i * 80 + rand(-20, 20), h: rand(50, 120), w: rand(90, 160) });
    for (let i = 0; i < 5; i++) hills.push({ x: i * 100 + rand(-20, 20), h: rand(18, 42), w: rand(90, 160) });

    // =====================================================================
    // Effects (client-only, fed by sim.fx)
    // =====================================================================
    function spawnParticles(x, y, n, o) {
        for (let i = 0; i < n; i++) {
            const a = Math.random() * Math.PI * 2, s = o.speed * (0.3 + Math.random());
            const life = o.life * (0.6 + Math.random() * 0.6);
            particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - (o.up || 0), life, maxLife: life,
                color: pick(o.colors), size: o.size * (0.5 + Math.random()), gravity: o.gravity || 0 });
        }
    }
    function explosionFx(x, y, big) {
        spawnParticles(x, y, big ? 45 : 18, { speed: big ? 5 : 3, colors: ['#ff3', '#f80', '#f33', '#fff'], size: big ? 6 : 4, life: 35, gravity: 0.08 });
        spawnParticles(x, y, big ? 16 : 6, { speed: 1.4, colors: ['#555', '#777', '#333'], size: 9, life: 70, up: 0.8 });
        if (Math.abs(x - (cameraX + GAME_WIDTH / 2)) < 500) shake = Math.max(shake, big ? 14 : 6);
        Sound.explode(big);
    }
    function addText(x, y, text, color, big) { floatTexts.push({ x, y, text, color: color || '#fff', life: 70, big: !!big }); }
    function consumeFx() {
        const near = x => x === undefined || Math.abs(x - (cameraX + GAME_WIDTH / 2)) < 760;
        for (const ev of sim.fx) {
            if (ev.t === 'snd') { if (Sound[ev.name]) Sound[ev.name](); }
            else if (ev.t === 'txt') addText(ev.x, ev.y, ev.msg, ev.color, ev.big);
            else if (ev.t === 'p') spawnParticles(ev.x, ev.y, ev.n, ev.o);
            else if (ev.t === 'x') { if (near(ev.x)) explosionFx(ev.x, ev.y, ev.big); }
            else if (ev.t === 'shake') { if (ev.team === undefined || ev.team === localId) shake = Math.max(shake, ev.v); }
        }
    }
    function updateEffects() {
        for (let i = particles.length - 1; i >= 0; i--) {
            const p = particles[i];
            p.x += p.vx; p.y += p.vy; p.vy += p.gravity; p.vx *= 0.98; p.life--;
            if (p.y > GROUND_Y + 4) { p.y = GROUND_Y + 4; p.vy *= -0.3; }
            if (p.life <= 0) particles.splice(i, 1);
        }
        for (let i = floatTexts.length - 1; i >= 0; i--) {
            const t = floatTexts[i]; t.y -= 0.5; t.life--;
            if (t.life <= 0) floatTexts.splice(i, 1);
        }
        if (shake > 0) shake *= 0.85;
        if (shake < 0.5) shake = 0;
    }

    // =====================================================================
    // Input capture -> sim input struct
    // =====================================================================
    function captureInput() {
        const o = { l: input.left ? 1 : 0, r: input.right ? 1 : 0, u: input.up ? 1 : 0, d: input.down ? 1 : 0, f: input.fire ? 1 : 0, b: bombQueued ? 1 : 0, buy: buyQueued };
        bombQueued = false; buyQueued = null;
        return o;
    }
    const packInput = i => [(i.l ? 1 : 0) | (i.r ? 2 : 0) | (i.u ? 4 : 0) | (i.d ? 8 : 0) | (i.f ? 16 : 0) | (i.b ? 32 : 0), i.buy || 0];
    const unpackInput = a => ({ l: a[0] & 1, r: a[0] & 2, u: a[0] & 4, d: a[0] & 8, f: a[0] & 16, b: a[0] & 32, buy: a[1] || null });
    const clearInput = () => { Object.keys(input).forEach(k => input[k] = false); bombQueued = false; buyQueued = null; };

    // =====================================================================
    // Solo mode
    // =====================================================================
    function startSolo() {
        sim = Sim.createGame({ mode: 'solo', seed: (Date.now() ^ (Math.random() * 0x7fffffff)) | 0 });
        particles = []; floatTexts = []; newBest = false; submitStatus = '';
        screen = 'playing'; screenTimer = 0;
        consumeFx();
    }
    function togglePause() {
        if (mode !== 'solo') return;
        if (screen === 'playing') { screen = 'paused'; clearInput(); }
        else if (screen === 'paused') screen = 'playing';
    }
    function primaryAction() {
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
        }
    }
    function submitScore(p) {
        if (!cfg.scoreUrl || typeof fetch !== 'function') return;
        submitStatus = 'SAVING SCORE...';
        fetch(cfg.scoreUrl, { method: 'POST', credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'X-CSRF-TOKEN': cfg.csrf },
            body: JSON.stringify({ score: p.score, wave: sim.wave, rescued: p.rescued }) })
            .then(r => r.ok ? r.json() : Promise.reject(r.status))
            .then(d => { submitStatus = 'SCORE SAVED  ·  RANK #' + d.rank + '  ·  ONLINE BEST ' + d.best; })
            .catch(() => { submitStatus = 'COULD NOT SAVE SCORE'; });
    }

    // =====================================================================
    // Versus mode: lobby + lockstep
    // =====================================================================
    const net = { link: null, status: '', level: '', localInputs: [], remoteInputs: [], remoteHashes: {}, localHashes: {}, stalled: 0, desync: false, posted: false, opponent: match ? match.opponent : null };
    function startVersus() {
        if (match.status === 'finished') { net.status = 'THIS MATCH HAS ALREADY FINISHED'; net.level = 'error'; screen = 'lobby'; return; }
        screen = 'lobby';
        net.link = window.NQNet.createLink({
            code: match.code, role: match.role, urls: match.urls, csrf: cfg.csrf, opponent: match.opponent,
            onStatus(msg, level) { net.status = msg; net.level = level || ''; },
            onOpponent(op) { net.opponent = op; },
            onOpen() { beginMatch(); },
            onMessage(m) { onNetMessage(m); },
            onClose(msg) { onNetClosed(msg); }
        });
    }
    function beginMatch() {
        const names = match.role === 'host' ? [match.me.name, net.opponent ? net.opponent.name : 'GUEST'] : [net.opponent ? net.opponent.name : 'HOST', match.me.name];
        sim = Sim.createGame({ mode: 'versus', seed: match.seed, names });
        for (let f = 0; f < INPUT_DELAY; f++) { net.localInputs[f] = Sim.EMPTY; net.remoteInputs[f] = Sim.EMPTY; }
        particles = []; floatTexts = []; consumeFx();
        screen = 'countdown'; screenTimer = 0;
        Sound.wave();
    }
    function onNetMessage(m) {
        if (m.t === 'i') net.remoteInputs[m.f] = unpackInput(m.i);
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
            body: JSON.stringify({ winner: sim.winner, reason: sim.endReason || 'FINISHED', scores: sim.players.map(p => p.score) }) }).catch(() => {});
    }

    // =====================================================================
    // Main update (fixed 60 Hz)
    // =====================================================================
    function update() {
        frame++;
        if (mode === 'solo') soloTick(); else versusTick();
        if (sim && mode === 'versus' && sim.status === 'over' && screen !== 'over') {
            screen = 'over'; screenTimer = 0; clearInput();
            postMatchResult();
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
        }
        if (frame % 15 === 0) updateDomScore();
    }
    function updateDomScore() {
        const p = local();
        if (!p || screen === 'title' || screen === 'lobby') {
            scoreDiv.textContent = mode === 'solo' ? `Best: ${highScore}` : `Online match ${match.code}`;
        } else if (mode === 'solo') {
            scoreDiv.textContent = `Wave ${sim.wave} | Score: ${p.score} | Credits: $${p.credits} | Rescued: ${p.rescued} | Lost: ${p.lost} | Best: ${highScore}`;
        } else {
            const o = sim.players[1 - localId];
            scoreDiv.textContent = `${p.name} ${p.score} | ${o.name} ${o.score} | Credits: $${p.credits} | Rescued: ${p.rescued}`;
        }
        if (creditsSpan) creditsSpan.textContent = '$' + (p ? p.credits : 0);
        const playing = screen === 'playing' && p && p.alive;
        shopButtons.forEach(([btn, type]) => {
            if (!btn) return;
            if (UNITS[type]) {
                btn.disabled = !playing || p.credits < UNITS[type].cost || sim.units.filter(u => u.team === p.team).length >= MAX_ALLIES;
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
    function drawSky() {
        const g = ctx.createLinearGradient(0, 0, 0, GAME_HEIGHT);
        g.addColorStop(0, '#1b4f9c'); g.addColorStop(0.7, '#5fb8f0'); g.addColorStop(1, '#a8e0ff');
        ctx.fillStyle = g; ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
        ctx.fillStyle = '#ffe680';
        ctx.beginPath(); ctx.arc(560 - cameraX * 0.02, 60, 26, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
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
    function drawGround() {
        const startX = Math.floor(cameraX / 40) * 40 - 40;
        ctx.fillStyle = '#3fa63f'; ctx.fillRect(cameraX - 20, GROUND_Y, GAME_WIDTH + 40, 8);
        ctx.fillStyle = '#6b4a2b'; ctx.fillRect(cameraX - 20, GROUND_Y + 8, GAME_WIDTH + 40, GAME_HEIGHT - GROUND_Y);
        ctx.fillStyle = '#5a3d22';
        for (let x = startX; x < cameraX + GAME_WIDTH + 40; x += 40) ctx.fillRect(x + ((x / 40) % 2) * 12, GROUND_Y + 12, 16, 3);
        ctx.fillStyle = '#2f8a2f';
        for (let x = startX; x < cameraX + GAME_WIDTH + 40; x += 40) ctx.fillRect(x + 20, GROUND_Y, 6, 3);
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
        ctx.fillStyle = '#8a8f99'; ctx.fillRect(tx, GROUND_Y - 60, 18, 60);
        ctx.fillStyle = '#4bb1ff'; ctx.fillRect(tx + 3, GROUND_Y - 56, 12, 8);
        ctx.fillStyle = '#ccc'; ctx.fillRect(tx + 8, GROUND_Y - 80, 2, 20);
        ctx.fillStyle = c.ui; ctx.fillRect(tx + 10, GROUND_Y - 80, 12 + Math.sin(frame / 8) * 2, 7);
        ctx.font = 'bold 12px Arial';
        const label = sim.mode === 'versus' ? (sim.players[team] ? sim.players[team].name.toUpperCase().slice(0, 10) : 'BASE') : 'BASE';
        ctx.fillText(label, tx + 9, GROUND_Y - 86);
        ctx.textAlign = 'left';
        drawBaseHealth(b);
    }
    function drawFortress(b) {
        if (b.destroyed) { drawRubble(b); return; }
        ctx.fillStyle = '#4a4a55'; ctx.fillRect(b.x, b.y, b.width, b.height);
        ctx.fillStyle = '#3a3a45';
        for (let i = 0; i < 6; i++) ctx.fillRect(b.x + i * 20, b.y - 8, 12, 8);
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
            ctx.fillStyle = '#b08050'; ctx.fillRect(h.x, GROUND_Y - h.h, h.w, h.h);
            ctx.fillStyle = '#7a4a20';
            ctx.beginPath(); ctx.moveTo(h.x - 6, GROUND_Y - h.h); ctx.lineTo(h.x + h.w / 2, GROUND_Y - h.h - 18); ctx.lineTo(h.x + h.w + 6, GROUND_Y - h.h); ctx.closePath(); ctx.fill();
            ctx.fillStyle = '#442'; ctx.fillRect(h.x + h.w / 2 - 6, GROUND_Y - 20, 12, 20);
            ctx.fillStyle = '#ffd'; ctx.fillRect(h.x + 8, GROUND_Y - h.h + 10, 10, 8);
        });
    }
    function drawHostages() {
        const px = cx(local());
        sim.hostages.forEach(h => {
            if (h.state !== 'waiting' && h.state !== 'running') return;
            const running = h.state === 'running', near = Math.abs(px - h.x) < 320;
            ctx.save();
            ctx.translate(h.x, GROUND_Y);
            if (h.dir < 0) ctx.scale(-1, 1);
            ctx.strokeStyle = '#ffe'; ctx.lineWidth = 2; ctx.lineCap = 'round';
            const swing = running ? Math.sin(h.anim * 0.5) * 4 : 0;
            ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(-2 + swing, 0); ctx.moveTo(0, -9); ctx.lineTo(2 - swing, 0); ctx.stroke();
            ctx.fillStyle = '#fd4'; ctx.fillRect(-3, -19, 6, 11);
            ctx.fillStyle = '#ffd9b3'; ctx.beginPath(); ctx.arc(0, -22, 3.5, 0, Math.PI * 2); ctx.fill();
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
            const c = colorsOf(u.team);
            ctx.save();
            if (u.type === 'soldier') {
                ctx.translate(cx(u), GROUND_Y);
                if (u.dir < 0) ctx.scale(-1, 1);
                const swing = u.moving ? Math.sin(u.anim * 0.4) * 4 : 0;
                ctx.strokeStyle = c.unitDark; ctx.lineWidth = 2; ctx.lineCap = 'round';
                ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(-2 + swing, 0); ctx.moveTo(0, -9); ctx.lineTo(2 - swing, 0); ctx.stroke();
                ctx.fillStyle = c.cloth; ctx.fillRect(-3, -19, 6, 11);
                ctx.fillStyle = '#ffd9b3'; ctx.beginPath(); ctx.arc(0, -22, 3.5, 0, Math.PI * 2); ctx.fill();
                ctx.fillStyle = c.unitDark; ctx.beginPath(); ctx.arc(0, -23, 4, Math.PI, 0); ctx.fill();
                ctx.strokeStyle = '#333'; ctx.lineWidth = 2;
                ctx.beginPath(); ctx.moveTo(-2, -15); ctx.lineTo(8, -17); ctx.stroke();
                if (!u.moving && u.fireTimer > UNITS.soldier.fireRate - 4) { ctx.fillStyle = '#ff6'; ctx.fillRect(8, -19, 4, 4); }
            } else {
                ctx.translate(u.x, u.y);
                ctx.fillStyle = '#333'; ctx.fillRect(0, 14, u.width, 8);
                ctx.fillStyle = '#666';
                const roll = u.moving ? Math.floor(u.anim / 4) % 6 : 0;
                for (let i = 0; i < 4; i++) ctx.fillRect(2 + ((i * 6 + roll) % 24), 16, 3, 4);
                ctx.fillStyle = c.unit; ctx.fillRect(1, 6, u.width - 2, 9);
                ctx.fillStyle = c.unitDark; ctx.fillRect(7, 0, 12, 8);
                if (!u.ai) { ctx.fillStyle = '#fff'; ctx.fillRect(3, 8, 3, 3); }
                ctx.strokeStyle = '#999'; ctx.lineWidth = 3;
                ctx.beginPath(); ctx.moveTo(13, 4); ctx.lineTo(13 + Math.cos(u.angle) * 15, 4 + Math.sin(u.angle) * 15); ctx.stroke();
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
        ctx.fillStyle = body;
        ctx.fillRect(d === 1 ? -30 : 2, -4, 28, 7);
        ctx.fillRect(d === 1 ? -32 : 26, -12, 6, 12);
        ctx.strokeStyle = '#ddd'; ctx.lineWidth = 2;
        const tr = Math.cos(frame * 0.9) * 6;
        ctx.beginPath(); ctx.moveTo(d === 1 ? -30 : 30, -6 - tr); ctx.lineTo(d === 1 ? -30 : 30, -6 + tr); ctx.stroke();
        ctx.fillStyle = body;
        ctx.beginPath(); ctx.ellipse(d * 4, 0, 22, 12, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = glass;
        ctx.beginPath(); ctx.ellipse(d * 14, -2, 9, 7, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#222'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(-16, 14); ctx.lineTo(22, 14); ctx.moveTo(-8, 10); ctx.lineTo(-8, 14); ctx.moveTo(12, 10); ctx.lineTo(12, 14); ctx.stroke();
        ctx.fillStyle = '#222'; ctx.fillRect(-2, -16, 4, 6);
        const rw = 6 + 30 * Math.abs(Math.cos(frame * 0.55));
        ctx.fillStyle = 'rgba(230,230,230,0.9)'; ctx.fillRect(-rw, -18, rw * 2, 3);
        ctx.restore();
    }
    function drawShadow(h) {
        ctx.save();
        ctx.globalAlpha = 0.2 * clamp(1 - (GROUND_Y - (h.y + h.height)) / 400, 0.3, 1);
        ctx.fillStyle = '#000';
        ctx.beginPath(); ctx.ellipse(cx(h), GROUND_Y + 3, h.width / 2, 4, 0, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
    }
    function drawHealthBar(h, w) {
        const pct = clamp(h.health / h.maxHealth, 0, 1);
        const x = cx(h) - w / 2, y = h.y - 24;
        ctx.fillStyle = '#0008'; ctx.fillRect(x - 1, y - 1, w + 2, 6);
        ctx.fillStyle = `hsl(${pct * 110},80%,50%)`; ctx.fillRect(x, y, Math.round(w * pct), 4);
    }
    function drawChoppers() {
        if (sim.mode === 'solo' && sim.ai.alive) {
            const a = sim.ai, c = colorsOf(AI);
            drawShadow(a); drawHeli(a, c.body, c.glass, false); drawHealthBar(a, 40);
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
        ctx.fillStyle = '#ffe';
        sim.bullets.forEach(b => { ctx.fillStyle = b.team === AI ? '#f88' : '#ffe'; ctx.fillRect(b.x, b.y, b.width, b.height); });
        sim.shells.forEach(b => {
            if (b.kind === 'rifle') { ctx.fillStyle = b.team === AI ? '#f88' : '#ff8'; ctx.fillRect(b.x - 2.5, b.y - 1, 5, 2); return; }
            ctx.fillStyle = b.kind === 'heli' ? '#0ff' : b.team === AI ? '#ff0' : '#ddd';
            ctx.beginPath(); ctx.arc(b.x, b.y, 3.5, 0, Math.PI * 2); ctx.fill();
        });
        sim.bombs.forEach(b => {
            ctx.fillStyle = '#333'; ctx.beginPath(); ctx.ellipse(b.x, b.y, 4, 7, 0, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#f90'; ctx.fillRect(b.x - 3, b.y - 9, 6, 3);
        });
    }
    function drawParticles() {
        particles.forEach(p => {
            ctx.globalAlpha = clamp(p.life / p.maxLife, 0, 1);
            ctx.fillStyle = p.color; ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
        });
        ctx.globalAlpha = 1;
    }
    function drawFloatTexts() {
        ctx.textAlign = 'center';
        floatTexts.forEach(t => {
            ctx.globalAlpha = clamp(t.life / 30, 0, 1);
            ctx.font = (t.big ? 'bold 18px' : 'bold 12px') + ' Arial';
            ctx.lineWidth = 3; ctx.strokeStyle = '#000'; ctx.strokeText(t.text, t.x, t.y);
            ctx.fillStyle = t.color; ctx.fillText(t.text, t.x, t.y);
        });
        ctx.globalAlpha = 1; ctx.textAlign = 'left';
    }
    function comboText(p) { return p.combo > 1 ? 'COMBO x' + Math.min(3, 1 + (p.combo - 1) * 0.25) : ''; }
    function drawHUD() {
        const p = local();
        ctx.save();
        ctx.font = 'bold 13px Arial';
        // Left block: hull, bombs, aboard
        ctx.fillStyle = '#0006'; ctx.fillRect(8, 8, 154, 62);
        ctx.fillStyle = '#fff'; ctx.fillText('HULL', 14, 22);
        const pct = clamp(p.health / p.maxHealth, 0, 1);
        ctx.fillStyle = '#222'; ctx.fillRect(56, 12, 96, 10);
        ctx.fillStyle = `hsl(${pct * 110},80%,50%)`; ctx.fillRect(56, 12, Math.round(96 * pct), 10);
        if (p.upgrades.armor) { ctx.fillStyle = '#8f8'; ctx.font = 'bold 9px Arial'; ctx.fillText('+' + p.upgrades.armor, 154, 21); ctx.font = 'bold 13px Arial'; }
        ctx.fillStyle = '#fff'; ctx.fillText('BOMBS', 14, 42);
        for (let i = 0; i < MAX_BOMBS; i++) { ctx.fillStyle = i < p.bombs ? '#f90' : '#444'; ctx.beginPath(); ctx.arc(70 + i * 15, 38, 5, 0, Math.PI * 2); ctx.fill(); }
        ctx.fillStyle = '#fff'; ctx.fillText('ABOARD', 14, 62);
        for (let i = 0; i < MAX_CARRY; i++) {
            ctx.fillStyle = i < p.carrying ? '#fd4' : '#444';
            ctx.beginPath(); ctx.arc(80 + i * 15, 56, 3, 0, Math.PI * 2); ctx.fill(); ctx.fillRect(77 + i * 15, 59, 6, 7);
        }
        // Right block: score, credits, troops
        const myUnits = sim.units.filter(u => u.team === p.team).length;
        ctx.textAlign = 'right';
        ctx.fillStyle = '#0006'; ctx.fillRect(GAME_WIDTH - 158, 8, 150, 92);
        ctx.fillStyle = '#fff'; ctx.font = 'bold 16px Arial';
        ctx.fillText(String(p.score).padStart(6, '0'), GAME_WIDTH - 14, 26);
        ctx.font = 'bold 12px Arial'; ctx.fillStyle = '#ccc';
        if (sim.mode === 'solo') { ctx.fillText('BEST ' + highScore, GAME_WIDTH - 14, 44); ctx.fillStyle = '#ff0'; ctx.fillText('WAVE ' + sim.wave, GAME_WIDTH - 14, 62); }
        else { const o = sim.players[1 - localId]; ctx.fillText(o.name.toUpperCase().slice(0, 10) + ' ' + o.score, GAME_WIDTH - 14, 44); ctx.fillStyle = '#ff0'; ctx.fillText('DOWNED ' + p.deaths + ' / ' + o.deaths, GAME_WIDTH - 14, 62); }
        ctx.fillStyle = '#8f8'; ctx.font = 'bold 18px Arial'; ctx.fillText('$' + p.credits, GAME_WIDTH - 14, 84);
        ctx.textAlign = 'left'; ctx.font = 'bold 11px Arial';
        ctx.fillText('CREDITS', GAME_WIDTH - 152, 84);
        ctx.fillStyle = '#ccc'; ctx.fillText('TROOPS ' + myUnits + '/' + MAX_ALLIES, GAME_WIDTH - 152, 97);
        // Radar strip
        const rx = 170, ry = 10, rw = GAME_WIDTH - 340, rh = 12;
        ctx.fillStyle = '#0007'; ctx.fillRect(rx, ry, rw, rh);
        const mx = x => rx + (x / WORLD_WIDTH) * rw;
        sim.bases.forEach(b => { ctx.fillStyle = b.destroyed ? '#555' : colorsOf(b.team).ui; ctx.fillRect(mx(b.x), ry, 3, rh); });
        ctx.fillStyle = '#fd4';
        sim.hostages.forEach(h => { if (h.state === 'waiting' || h.state === 'running') ctx.fillRect(mx(h.x), ry + 3, 2, 6); });
        sim.units.forEach(u => { ctx.fillStyle = u.team === p.team ? '#8f8' : '#f33'; ctx.fillRect(mx(u.x), ry + 4, u.type === 'tank' ? 3 : 2, 4); });
        if (sim.mode === 'solo' && sim.ai.alive) { ctx.fillStyle = '#f0f'; ctx.fillRect(mx(sim.ai.x), ry + 2, 4, 4); }
        sim.players.forEach(o => { if (o.alive && o.id !== localId) { ctx.fillStyle = '#f0f'; ctx.fillRect(mx(o.x), ry + 2, 4, 4); } });
        ctx.fillStyle = '#0f0'; ctx.fillRect(mx(p.x), ry + 2, 4, 8);
        ctx.strokeStyle = '#fff6'; ctx.lineWidth = 1; ctx.strokeRect(mx(cameraX), ry, (GAME_WIDTH / WORLD_WIDTH) * rw, rh);
        // Centre lines
        ctx.fillStyle = '#fff'; ctx.font = 'bold 11px Arial'; ctx.textAlign = 'center';
        if (sim.mode === 'solo') {
            const remaining = sim.hostages.filter(h => h.state === 'waiting' || h.state === 'running' || h.state === 'aboard').length;
            ctx.fillText(`RESCUED ${p.rescued}   LOST ${p.lost}   REMAINING ${remaining}`, GAME_WIDTH / 2, 36);
        } else {
            // Base hull bars
            const mine = sim.bases[localId], theirs = sim.bases[1 - localId];
            const bar = (b, x, label, align) => {
                const pc = clamp(b.health / b.maxHealth, 0, 1);
                ctx.fillStyle = '#0007'; ctx.fillRect(x, 28, 140, 12);
                ctx.fillStyle = `hsl(${pc * 110},80%,45%)`; ctx.fillRect(x + 1, 29, Math.round(138 * pc), 10);
                ctx.fillStyle = '#fff'; ctx.textAlign = align; ctx.fillText(label + ' BASE ' + Math.ceil(b.health), align === 'left' ? x + 4 : x + 136, 38);
            };
            bar(mine, 170, 'YOUR', 'left'); bar(theirs, GAME_WIDTH - 310, 'ENEMY', 'right');
            ctx.textAlign = 'center';
        }
        const gc = Sim.upgradeCost(p, 'gun'), ac = Sim.upgradeCost(p, 'armor');
        ctx.fillStyle = '#8f8';
        ctx.fillText(isTouch ? 'BUY TROOPS AND UPGRADES BELOW' : `[1] SOLDIER $${UNITS.soldier.cost}  [2] TANK $${UNITS.tank.cost}  [3] GUNS ${gc === null ? 'MAX' : '$' + gc}  [4] ARMOR ${ac === null ? 'MAX' : '$' + ac}`, GAME_WIDTH / 2, 52);
        if (Sound.muted) { ctx.fillStyle = '#ccc'; ctx.fillText('MUTED', GAME_WIDTH / 2, 66); }
        if (comboText(p)) { ctx.fillStyle = '#ff0'; ctx.font = 'bold 16px Arial'; ctx.fillText(comboText(p), GAME_WIDTH / 2, 100); }
        if (screen === 'playing' && p.alive && pct < 0.3 && Math.floor(frame / 15) % 2 === 0) {
            ctx.fillStyle = '#f44'; ctx.font = 'bold 14px Arial'; ctx.fillText('HULL CRITICAL - RETURN TO BASE', GAME_WIDTH / 2, GAME_HEIGHT - 14);
        }
        if (sim.mode === 'versus' && !p.alive && screen === 'playing') {
            ctx.fillStyle = '#f88'; ctx.font = 'bold 16px Arial';
            ctx.fillText('SHOT DOWN - REDEPLOYING IN ' + Math.max(0, Math.ceil((301 - p.respawn) / 60)), GAME_WIDTH / 2, 130);
        }
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
            bigText('NQ CHOPPER', 120, 48, '#ff0');
            bigText('Rescue the hostages and bring them home', 155, 16, '#fff');
            bigText('Land near hostages so they can run aboard · 4 seats · Return to BASE to unload', 200, 12, '#ddd');
            bigText('Bombs hit ground targets · Bullets for the enemy chopper · Base repairs and rearms', 220, 12, '#ddd');
            bigText('Watch out: tanks crush hostages running in the open, and so do your bombs', 240, 12, '#f99');
            bigText((isTouch ? 'Buy ' : 'Press 1 / 2 to buy ') + 'Soldiers ($' + UNITS.soldier.cost + ') and Tanks ($' + UNITS.tank.cost + ') · They march on the enemy base', 262, 12, '#8f8');
            bigText((isTouch ? 'Upgrade ' : 'Press 3 / 4 to upgrade ') + 'Guns and Armor · Chain kills for combo points', 278, 12, '#8f8');
            if (blink) bigText(prompt + 'START', 310, 20, '#0f0');
            if (highScore > 0) bigText('BEST ' + highScore, 345, 14, '#ccc');
        } else if (screen === 'paused') {
            overlay(0.5);
            bigText('PAUSED', 190, 40, '#fff');
            bigText(isTouch ? 'TAP TO RESUME' : 'PRESS P TO RESUME', 230, 16, '#ccc');
        } else if (screen === 'playing' && sim.status === 'waveclear') {
            overlay(Math.min(0.5, sim.statusTimer / 60));
            bigText('WAVE ' + sim.wave + ' CLEAR', 150, 40, '#ff0');
            bigText(`RESCUED ${sim.waveRescued}   LOST ${sim.waveLost}`, 195, 18, '#fff');
            bigText('BONUS +' + sim.waveBonus + (sim.waveLost === 0 ? '  PERFECT!' : ''), 225, 18, sim.waveLost === 0 ? '#0f0' : '#ff0');
            bigText('GET READY FOR WAVE ' + (sim.wave + 1), 280, 16, '#ccc');
        } else if (screen === 'gameover') {
            const p = local();
            overlay(Math.min(0.55, screenTimer / 40));
            bigText('CHOPPER DOWN', 140, 44, '#f44');
            bigText('SCORE ' + p.score, 190, 24, '#fff');
            bigText(`RESCUED ${p.rescued}   LOST ${p.lost}   WAVE ${sim.wave}`, 220, 16, '#ccc');
            if (newBest) bigText('NEW BEST SCORE!', 255, 20, '#ff0'); else bigText('BEST ' + highScore, 255, 16, '#ccc');
            if (submitStatus) bigText(submitStatus, 285, 13, '#8f8');
            if (screenTimer > 30 && blink) bigText(isTouch ? 'TAP TO RETRY' : 'PRESS R OR SPACE TO RETRY', 310, 18, '#0f0');
        } else if (screen === 'lobby') {
            overlay(0.55);
            bigText('ONLINE MATCH', 90, 36, '#ff0');
            bigText('MATCH CODE', 135, 14, '#ccc');
            bigText(match.code, 175, 44, '#fff');
            if (match.role === 'host' && !net.opponent) bigText('Send this code to your opponent. They enter it under Multiplayer > Join.', 210, 13, '#ddd');
            else bigText('Opponent: ' + (net.opponent ? net.opponent.name : '...'), 210, 15, '#9cf');
            bigText(net.status + (net.level === 'error' ? '' : (blink ? '' : ' ')), 255, 16, net.level === 'error' ? '#f66' : net.level === 'warn' ? '#fc6' : '#8f8');
            if (net.level === 'error') bigText('Open the Lobby link above to try again', 285, 13, '#ccc');
            bigText('First pilot to destroy the other base wins · Rescue hostages for credits', 330, 12, '#ddd');
        } else if (screen === 'countdown') {
            overlay(0.35);
            const n = Math.ceil((180 - screenTimer) / 60);
            const o = sim.players[1 - localId];
            bigText('VS ' + o.name.toUpperCase(), 120, 28, '#9cf');
            bigText(n > 0 ? String(n) : 'GO!', 200, 72, '#ff0');
            bigText(localId === 0 ? 'YOUR BASE IS ON THE LEFT' : 'YOUR BASE IS ON THE RIGHT', 260, 16, '#fff');
        } else if (screen === 'over') {
            const p = local(), o = sim.players[1 - localId];
            overlay(Math.min(0.6, screenTimer / 40));
            const won = sim.winner === localId, draw = sim.winner === null;
            bigText(draw ? 'DRAW' : won ? 'VICTORY' : 'DEFEAT', 130, 52, draw ? '#ccc' : won ? '#0f0' : '#f44');
            bigText(sim.endReason || '', 170, 16, '#ddd');
            bigText(`${p.name.toUpperCase()} ${p.score}   ·   ${o.name.toUpperCase()} ${o.score}`, 210, 20, '#fff');
            bigText(`RESCUED ${p.rescued}   TIMES DOWNED ${p.deaths}`, 240, 14, '#ccc');
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
        drawLayer(mountains, 0.25, '#3c5a86', GROUND_Y);
        drawLayer(hills, 0.5, '#2f7a4a', GROUND_Y);
        if (sim) {
            const sx = shake > 0 ? (Math.random() - 0.5) * shake : 0, sy = shake > 0 ? (Math.random() - 0.5) * shake : 0;
            ctx.save();
            ctx.translate(-Math.round(cameraX) + sx, sy);
            drawGround();
            sim.bases.forEach(b => b.team === AI ? drawFortress(b) : drawPad(b, b.team));
            drawHuts();
            drawHostages();
            drawUnits();
            drawChoppers();
            drawProjectiles();
            drawParticles();
            drawFloatTexts();
            ctx.restore();
            if (screen !== 'title' && screen !== 'lobby') drawHUD();
        } else {
            ctx.save(); ctx.translate(-Math.round(cameraX), 0); drawGround(); ctx.restore();
        }
        drawOverlays();
        ctx.restore();
    }

    // =====================================================================
    // Input
    // =====================================================================
    const KEYMAP = { ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', Space: 'fire' };
    const BUYKEYS = { Digit1: 'soldier', Numpad1: 'soldier', Digit2: 'tank', Numpad2: 'tank', Digit3: 'gun', Numpad3: 'gun', Digit4: 'armor', Numpad4: 'armor' };
    const inPlay = () => screen === 'playing';
    document.addEventListener('keydown', e => {
        Sound.unlock();
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
    window.addEventListener('blur', () => { clearInput(); if (mode === 'solo' && screen === 'playing') togglePause(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden && mode === 'solo' && screen === 'playing') togglePause(); });

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
    bindControl(document.getElementById('btnLeft'), () => input.left = true, () => input.left = false);
    bindControl(document.getElementById('btnRight'), () => input.right = true, () => input.right = false);
    bindControl(document.getElementById('btnUp'), () => input.up = true, () => input.up = false);
    bindControl(document.getElementById('btnDown'), () => input.down = true, () => input.down = false);
    bindControl(document.getElementById('btnShoot'), () => { if (!inPlay()) primaryAction(); input.fire = true; }, () => input.fire = false);
    bindControl(document.getElementById('btnBomb'), () => { if (inPlay()) bombQueued = true; }, () => {});
    shopButtons.forEach(([btn, type]) => {
        if (!btn) return;
        btn.addEventListener('click', () => { Sound.unlock(); if (inPlay()) buyQueued = type; btn.blur(); });
    });

    // Canvas gestures: drag to steer, tap to shoot/start, long-press to bomb
    (function () {
        let pid = null, sx = 0, sy = 0, st = 0, moved = false, lpTimer = null;
        const TAP_DIST = 12, TAP_TIME = 300, LONG_PRESS = 450, MOVE = 15;
        function down(e) {
            e.preventDefault(); Sound.unlock();
            if (pid !== null) return;
            pid = e.pointerId; sx = e.clientX; sy = e.clientY; st = Date.now(); moved = false;
            if (lpTimer) clearTimeout(lpTimer);
            lpTimer = setTimeout(() => { if (!moved && inPlay()) bombQueued = true; lpTimer = null; }, LONG_PRESS);
        }
        function move(e) {
            if (e.pointerId !== pid) return;
            e.preventDefault();
            const dx = e.clientX - sx, dy = e.clientY - sy;
            if (Math.abs(dx) > MOVE || Math.abs(dy) > MOVE) { moved = true; if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; } }
            if (inPlay()) { input.left = dx < -MOVE; input.right = dx > MOVE; input.up = dy < -MOVE; input.down = dy > MOVE; }
        }
        function up(e) {
            if (e.pointerId !== pid) return;
            e.preventDefault();
            const dt = Date.now() - st, d = Math.hypot(e.clientX - sx, e.clientY - sy);
            if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; }
            if (!moved && dt < TAP_TIME && d < TAP_DIST) { if (inPlay()) input.fire = true; else primaryAction(); }
            input.left = input.right = input.up = input.down = false;
            setTimeout(() => { input.fire = false; }, 50);
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
    let last = performance.now(), acc = 0;
    function loop(now) {
        acc += Math.min(now - last, 100);
        last = now;
        while (acc >= STEP) { update(); acc -= STEP; }
        render();
        requestAnimationFrame(loop);
    }

    // Read-only debug hook (used by automated play tests)
    window.__nq = { get sim() { return sim; }, get screen() { return screen; }, get mode() { return mode; }, get net() { return net; }, get localId() { return localId; },
        get state() { return screen; }, get score() { return local() ? local().score : 0; }, get credits() { return local() ? local().credits : 0; },
        input, startSolo, primaryAction, get frame() { return frame; } };

    fitCanvas();
    if (mode === 'solo') {
        sim = Sim.createGame({ mode: 'solo', seed: 1 }); // world behind the title screen
        sim.fx = [];
        screen = 'title';
    } else {
        startVersus();
    }
    updateDomScore();
    requestAnimationFrame(loop);
})();
