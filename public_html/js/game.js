(function () {
    'use strict';

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

    const GAME_WIDTH = 640, GAME_HEIGHT = 400;
    const WORLD_WIDTH = 2400;
    const GROUND_Y = 380;
    const MAX_CARRY = 4;
    const MAX_BOMBS = 5;
    const GRAVITY = 0.25;
    const HIGH_SCORE_KEY = 'nqChopperHighScore';

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
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
            canvas.style.transform = 'none';
            canvasWrapper.style.width = ''; canvasWrapper.style.height = '';
        } else {
            canvas.width = GAME_WIDTH;
            canvas.height = GAME_HEIGHT;
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
        const el = canvas;
        const req = el.requestFullscreen || el.webkitRequestFullscreen;
        if (req) req.call(el);
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
            wave() { [392, 523, 659, 784].forEach((f, i) => tone('square', f, f, 0.2, 0.08, i * 0.12)); },
            die() { noise(0.9, 0.5, 600); tone('sawtooth', 220, 20, 1.0, 0.25); },
            toggleMute() { muted = !muted; return muted; },
            get muted() { return muted; }
        };
    })();
    function toggleMute() {
        const m = Sound.toggleMute();
        muteBtn.textContent = m ? 'Sound: Off' : 'Sound: On';
    }
    muteBtn.addEventListener('click', toggleMute);

    // ---------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const rand = (a, b) => a + Math.random() * (b - a);
    const pick = arr => arr[Math.floor(Math.random() * arr.length)];
    function rectsOverlap(a, b) {
        return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
    }
    function loadHighScore() { try { return parseInt(localStorage.getItem(HIGH_SCORE_KEY), 10) || 0; } catch (e) { return 0; } }
    function saveHighScore(v) { try { localStorage.setItem(HIGH_SCORE_KEY, String(v)); } catch (e) { /* ignore */ } }

    // =====================================================================
    // Game state
    // =====================================================================
    let state = 'title';        // title | playing | paused | waveclear | dying | gameover
    let stateTimer = 0;
    let frame = 0;
    let wave = 0, score = 0, highScore = loadHighScore(), newBest = false;
    let rescued = 0, lost = 0, waveRescued = 0, waveLost = 0, waveBonus = 0;
    let cameraX = 0, shake = 0;
    let hostages = [], tanks = [], bullets = [], enemyBullets = [], bombs = [], particles = [], huts = [], floatTexts = [];
    let tankSpawnTimer = 0;

    const chopper = { x: 60, y: 200, width: 60, height: 24, vx: 0, vy: 0, dir: 1, speed: 3.4, carrying: 0,
        maxHealth: 100, health: 100, bombs: MAX_BOMBS, invuln: 0, landed: false, fireCooldown: 0, tilt: 0, spin: 0 };
    const enemyChopper = { x: 0, y: 120, width: 60, height: 24, vx: 0, vy: 0, dir: -1, speed: 2, shootCooldown: 0,
        maxHealth: 150, health: 150, alive: false, respawn: 0, tilt: 0 };

    const base = { x: 20, y: GROUND_Y - 40, width: 110, height: 40 };
    const enemyBase = { x: WORLD_WIDTH - 140, y: GROUND_Y - 50, width: 120, height: 50 };

    const input = { left: false, right: false, up: false, down: false, fire: false };

    // Scenery generated once
    const clouds = [];
    for (let i = 0; i < 12; i++) clouds.push({ x: rand(0, WORLD_WIDTH), y: rand(20, 150), w: rand(50, 110), speed: rand(0.05, 0.15) });
    const mountainPeriod = 480;
    const mountains = [];
    for (let i = 0; i < 6; i++) mountains.push({ x: i * 80 + rand(-20, 20), h: rand(50, 120), w: rand(90, 160) });
    const hills = [];
    for (let i = 0; i < 5; i++) hills.push({ x: i * 100 + rand(-20, 20), h: rand(18, 42), w: rand(90, 160) });

    // =====================================================================
    // Effects
    // =====================================================================
    function spawnParticles(x, y, n, o) {
        for (let i = 0; i < n; i++) {
            const a = Math.random() * Math.PI * 2, s = o.speed * (0.3 + Math.random());
            const life = o.life * (0.6 + Math.random() * 0.6);
            particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - (o.up || 0), life, maxLife: life,
                color: pick(o.colors), size: o.size * (0.5 + Math.random()), gravity: o.gravity || 0 });
        }
    }
    function explosion(x, y, big) {
        spawnParticles(x, y, big ? 45 : 18, { speed: big ? 5 : 3, colors: ['#ff3', '#f80', '#f33', '#fff'], size: big ? 6 : 4, life: 35, gravity: 0.08 });
        spawnParticles(x, y, big ? 16 : 6, { speed: 1.4, colors: ['#555', '#777', '#333'], size: 9, life: 70, up: 0.8 });
        shake = Math.max(shake, big ? 14 : 6);
        Sound.explode(big);
    }
    function addText(x, y, text, color, big) {
        floatTexts.push({ x, y, text, color: color || '#fff', life: 70, big: !!big });
    }
    function updateEffects() {
        for (let i = particles.length - 1; i >= 0; i--) {
            const p = particles[i];
            p.x += p.vx; p.y += p.vy; p.vy += p.gravity; p.vx *= 0.98; p.life--;
            if (p.y > GROUND_Y + 4) { p.y = GROUND_Y + 4; p.vy *= -0.3; }
            if (p.life <= 0) particles.splice(i, 1);
        }
        for (let i = floatTexts.length - 1; i >= 0; i--) {
            const t = floatTexts[i];
            t.y -= 0.5; t.life--;
            if (t.life <= 0) floatTexts.splice(i, 1);
        }
        if (shake > 0) shake *= 0.85;
        if (shake < 0.5) shake = 0;
    }

    // =====================================================================
    // Wave / game setup
    // =====================================================================
    function resetChopper() {
        chopper.x = base.x + base.width / 2 - chopper.width / 2;
        chopper.y = GROUND_Y - chopper.height;
        chopper.vx = 0; chopper.vy = 0; chopper.dir = 1; chopper.carrying = 0;
        chopper.health = chopper.maxHealth; chopper.bombs = MAX_BOMBS;
        chopper.invuln = 0; chopper.landed = true; chopper.fireCooldown = 0; chopper.tilt = 0; chopper.spin = 0;
        cameraX = 0;
    }
    function spawnEnemyChopper() {
        enemyChopper.x = enemyBase.x - 80;
        enemyChopper.y = 110;
        enemyChopper.vx = -enemyChopper.speed;
        enemyChopper.dir = -1;
        enemyChopper.shootCooldown = 90;
        enemyChopper.maxHealth = 150 + (wave - 1) * 40;
        enemyChopper.health = enemyChopper.maxHealth;
        enemyChopper.speed = 2 + (wave - 1) * 0.25;
        enemyChopper.alive = true;
        enemyChopper.respawn = 0;
    }
    function setupWave(n) {
        wave = n;
        waveRescued = 0; waveLost = 0; waveBonus = 0;
        hostages = []; tanks = []; bullets = []; enemyBullets = []; bombs = []; huts = []; floatTexts = [];
        tankSpawnTimer = 0;
        resetChopper();
        // Hostage groups
        const groups = Math.min(2 + n, 5);
        const span = (WORLD_WIDTH - 900) / groups;
        for (let g = 0; g < groups; g++) {
            const gx = 480 + g * span + rand(40, span - 120);
            huts.push({ x: gx, w: 54, h: 36 });
            const count = 3 + Math.floor(Math.random() * 2);
            for (let i = 0; i < count; i++) {
                hostages.push({ x: gx + 60 + i * 14 + rand(-3, 3), state: 'waiting', dir: -1, anim: Math.random() * 100 });
            }
        }
        // Tanks
        const tankCount = 2 + n;
        for (let i = 0; i < tankCount; i++) {
            let tx = rand(380, WORLD_WIDTH - 260), tries = 0;
            while (tries++ < 20 && huts.some(h => Math.abs(h.x + 40 - tx) < 160)) tx = rand(380, WORLD_WIDTH - 260);
            tanks.push(makeTank(tx, pick([-1, 1]) * (0.8 + n * 0.15)));
        }
        spawnEnemyChopper();
    }
    function makeTank(x, vx) {
        return { x, y: GROUND_Y - 22, width: 26, height: 22, vx, shootTimer: rand(60, 160), angle: -Math.PI / 2 };
    }
    function startGame() {
        score = 0; rescued = 0; lost = 0; newBest = false;
        particles = [];
        setupWave(1);
        state = 'playing'; stateTimer = 0;
        addText(chopper.x + 30, chopper.y - 30, 'WAVE 1', '#ff0', true);
        Sound.wave();
    }
    function nextWave() {
        setupWave(wave + 1);
        state = 'playing'; stateTimer = 0;
        addText(chopper.x + 30, chopper.y - 30, 'WAVE ' + wave, '#ff0', true);
        Sound.wave();
    }
    function togglePause() {
        if (state === 'playing') { state = 'paused'; }
        else if (state === 'paused') { state = 'playing'; }
    }
    function primaryAction() {
        if (state === 'title') startGame();
        else if (state === 'gameover') { if (stateTimer > 30) startGame(); }
        else if (state === 'paused') togglePause();
        else if (state === 'playing') shoot();
    }

    // =====================================================================
    // Player
    // =====================================================================
    function shoot() {
        if (state !== 'playing' || chopper.fireCooldown > 0) return;
        const bx = chopper.dir === 1 ? chopper.x + chopper.width : chopper.x - 8;
        bullets.push({ x: bx, y: chopper.y + chopper.height / 2 - 1, vx: chopper.dir * 9 + chopper.vx * 0.5, width: 8, height: 3, life: 60 });
        chopper.fireCooldown = 9;
        Sound.shoot();
    }
    function dropBomb() {
        if (state !== 'playing' || chopper.bombs <= 0 || chopper.landed) return;
        bombs.push({ x: chopper.x + chopper.width / 2, y: chopper.y + chopper.height + 4, vx: chopper.vx * 0.8, vy: 1 });
        chopper.bombs--;
        Sound.bomb();
    }
    function damageChopper(amount, why) {
        if (state !== 'playing' || chopper.invuln > 0) return;
        chopper.health = Math.max(0, chopper.health - amount);
        chopper.invuln = 40;
        shake = Math.max(shake, 5);
        Sound.hit();
        spawnParticles(chopper.x + chopper.width / 2, chopper.y + chopper.height / 2, 6, { speed: 2, colors: ['#ff0', '#f80'], size: 3, life: 20 });
        if (why) addText(chopper.x + chopper.width / 2, chopper.y - 20, why, '#f66');
        if (chopper.health <= 0) {
            state = 'dying'; stateTimer = 0;
            explosion(chopper.x + chopper.width / 2, chopper.y + chopper.height / 2, false);
            Sound.die();
        }
    }
    function updateChopper() {
        const targetVx = input.left ? -chopper.speed : input.right ? chopper.speed : 0;
        if (input.left) chopper.dir = -1; else if (input.right) chopper.dir = 1;
        chopper.vx += (targetVx - chopper.vx) * 0.12;
        if (input.up) chopper.vy -= 0.5;
        chopper.vy += GRAVITY;
        if (input.down) chopper.vy += 0.3;
        chopper.vy = clamp(chopper.vy, -4.5, 5);
        chopper.x += chopper.vx;
        chopper.y += chopper.vy;
        chopper.x = clamp(chopper.x, 0, WORLD_WIDTH - chopper.width);
        if (chopper.y < 26) { chopper.y = 26; chopper.vy = Math.max(0, chopper.vy); }
        if (chopper.y + chopper.height >= GROUND_Y) {
            if (chopper.vy >= 4.9 && !chopper.landed) damageChopper(10, 'HARD LANDING');
            chopper.y = GROUND_Y - chopper.height;
            chopper.vy = 0;
            chopper.vx *= 0.8;
            chopper.landed = true;
        } else {
            chopper.landed = false;
        }
        chopper.tilt += ((chopper.vx / chopper.speed) * 0.2 - chopper.tilt) * 0.1;
        if (chopper.invuln > 0) chopper.invuln--;
        if (chopper.fireCooldown > 0) chopper.fireCooldown--;
        if (input.fire) shoot();
        if (chopper.health < 40 && frame % 5 === 0) {
            particles.push({ x: chopper.x + chopper.width / 2 + rand(-6, 6), y: chopper.y + 6, vx: rand(-0.3, 0.3), vy: -0.8, life: 40, maxLife: 40, color: '#444', size: 5, gravity: -0.01 });
        }
        // At base: unload, repair, rearm
        if (chopper.landed && rectsOverlap(chopper, base)) {
            if (chopper.carrying > 0) {
                const n = chopper.carrying;
                hostages.forEach(h => { if (h.state === 'aboard') h.state = 'saved'; });
                rescued += n; waveRescued += n;
                let pts = n * 100;
                if (n === MAX_CARRY) pts += 200;
                score += pts;
                chopper.carrying = 0;
                addText(chopper.x + chopper.width / 2, chopper.y - 24, '+' + pts + (n === MAX_CARRY ? ' FULL LOAD' : ''), '#ff0', true);
                Sound.dropoff();
            }
            if (chopper.health < chopper.maxHealth && frame % 6 === 0) { chopper.health++; if (frame % 30 === 0) Sound.heal(); }
            if (chopper.bombs < MAX_BOMBS && frame % 20 === 0) chopper.bombs++;
        }
    }

    // =====================================================================
    // Hostages
    // =====================================================================
    function updateHostages() {
        const cx = chopper.x + chopper.width / 2;
        hostages.forEach(h => {
            h.anim++;
            if (h.state !== 'waiting' && h.state !== 'running') return;
            const dx = cx - h.x;
            if (chopper.landed && Math.abs(dx) < 280 && chopper.carrying < MAX_CARRY) {
                h.state = 'running';
                h.dir = dx < 0 ? -1 : 1;
                h.x += h.dir * 1.3;
                if (Math.abs(dx) < 8) {
                    h.state = 'aboard';
                    chopper.carrying++;
                    addText(cx, chopper.y - 16, chopper.carrying + '/' + MAX_CARRY, '#ff0');
                    Sound.pickup();
                }
            } else {
                h.state = 'waiting';
            }
        });
    }
    function killHostage(h, why) {
        h.state = 'dead';
        lost++; waveLost++;
        spawnParticles(h.x, GROUND_Y - 10, 8, { speed: 2, colors: ['#fd4', '#fff'], size: 3, life: 30, gravity: 0.1 });
        addText(h.x, GROUND_Y - 40, why || 'HOSTAGE LOST', '#f55');
    }

    // =====================================================================
    // Enemies
    // =====================================================================
    function updateTanks() {
        const cx = chopper.x + chopper.width / 2, cy = chopper.y + chopper.height / 2;
        tanks.forEach(t => {
            t.x += t.vx;
            if (t.x < 200 || t.x + t.width > WORLD_WIDTH - 30) t.vx *= -1;
            if (Math.random() < 0.003) t.vx *= -1;
            const tx = t.x + t.width / 2, ty = t.y;
            const dx = cx - tx, dy = cy - ty;
            const inRange = Math.abs(dx) < 320 && dy < -10;
            const targetAngle = inRange ? Math.atan2(dy, dx) : -Math.PI / 2;
            t.angle += (targetAngle - t.angle) * 0.1;
            t.shootTimer--;
            if (t.shootTimer <= 0 && inRange && state === 'playing') {
                let vx = 0, vy = -5;
                if (wave >= 2) {
                    const mag = Math.hypot(dx, dy), s = 3.5 + wave * 0.3;
                    vx = dx / mag * s; vy = dy / mag * s;
                }
                enemyBullets.push({ x: tx + Math.cos(t.angle) * 14, y: ty + Math.sin(t.angle) * 14, vx, vy, dmg: 12 });
                t.shootTimer = Math.max(50, 140 - wave * 10) + rand(0, 40);
                Sound.enemyShoot();
            }
            // Tanks run over hostages caught in the open (waiting hostages shelter by their hut)
            hostages.forEach(h => {
                if (h.state === 'running' && Math.abs(h.x - tx) < 14) killHostage(h, 'CRUSHED');
            });
        });
        // Enemy base spawns reinforcements
        tankSpawnTimer++;
        const interval = Math.max(220, 480 - wave * 30);
        if (tankSpawnTimer >= interval) {
            tankSpawnTimer = 0;
            if (tanks.length < 3 + wave * 2) {
                tanks.push(makeTank(enemyBase.x - 30, -(0.8 + wave * 0.15)));
                spawnParticles(enemyBase.x - 20, GROUND_Y - 10, 6, { speed: 1, colors: ['#888', '#aaa'], size: 5, life: 30, up: 0.5 });
            }
        }
    }
    function killTank(i, pts) {
        const t = tanks[i];
        explosion(t.x + t.width / 2, t.y + t.height / 2, false);
        addText(t.x + t.width / 2, t.y - 10, '+' + pts, '#fff');
        score += pts;
        tanks.splice(i, 1);
    }
    function updateEnemyChopper() {
        const ec = enemyChopper;
        if (!ec.alive) {
            if (ec.respawn > 0) { ec.respawn--; if (ec.respawn === 0) spawnEnemyChopper(); }
            return;
        }
        const dx = chopper.x - ec.x, dy = chopper.y - ec.y;
        const dist = Math.abs(dx);
        let targetX;
        if (dist < 480) {
            targetX = chopper.x - Math.sign(dx || 1) * 150;
            ec.y += clamp(dy, -1.6, 1.6) * 0.8;
        } else {
            // patrol near enemy base
            const patrolL = enemyBase.x - 320, patrolR = enemyBase.x + 40;
            if (ec.x < patrolL) ec.patrolDir = 1;
            if (ec.x > patrolR) ec.patrolDir = -1;
            if (!ec.patrolDir) ec.patrolDir = -1;
            targetX = ec.x + ec.patrolDir * 200;
            ec.y += (110 + Math.sin(frame / 60) * 20 - ec.y) * 0.03;
        }
        const desiredVx = clamp((targetX - ec.x) * 0.05, -ec.speed, ec.speed);
        ec.vx += (desiredVx - ec.vx) * 0.06;
        ec.x += ec.vx;
        ec.x = clamp(ec.x, 150, WORLD_WIDTH - ec.width);
        ec.y = clamp(ec.y, 26, GROUND_Y - 70);
        if (Math.abs(ec.vx) > 0.3) ec.dir = ec.vx < 0 ? -1 : 1;
        ec.tilt += ((ec.vx / ec.speed) * 0.2 - ec.tilt) * 0.1;
        ec.shootCooldown--;
        if (ec.shootCooldown <= 0 && dist < 380 && state === 'playing') {
            const sx = ec.x + ec.width / 2, sy = ec.y + ec.height / 2;
            const tx = chopper.x + chopper.width / 2 + chopper.vx * 10, ty = chopper.y + chopper.height / 2;
            const mag = Math.hypot(tx - sx, ty - sy) || 1;
            const s = 6;
            enemyBullets.push({ x: sx, y: sy, vx: (tx - sx) / mag * s, vy: (ty - sy) / mag * s, dmg: 18, heli: true });
            ec.shootCooldown = Math.max(35, 75 - wave * 5);
            Sound.enemyShoot();
        }
        if (ec.health < ec.maxHealth * 0.35 && frame % 5 === 0) {
            particles.push({ x: ec.x + ec.width / 2 + rand(-6, 6), y: ec.y + 6, vx: rand(-0.3, 0.3), vy: -0.8, life: 40, maxLife: 40, color: '#444', size: 5, gravity: -0.01 });
        }
    }
    function damageEnemyChopper(amount) {
        const ec = enemyChopper;
        if (!ec.alive) return;
        ec.health -= amount;
        spawnParticles(ec.x + ec.width / 2, ec.y + ec.height / 2, 5, { speed: 2, colors: ['#ff0', '#fff'], size: 3, life: 18 });
        if (ec.health <= 0) {
            ec.alive = false;
            ec.respawn = Math.max(420, 1000 - wave * 80);
            const pts = 500;
            score += pts;
            explosion(ec.x + ec.width / 2, ec.y + ec.height / 2, true);
            addText(ec.x + ec.width / 2, ec.y - 20, '+' + pts, '#ff0', true);
        }
    }

    // =====================================================================
    // Projectiles
    // =====================================================================
    function explodeBomb(x, y) {
        explosion(x, y, false);
        for (let i = tanks.length - 1; i >= 0; i--) {
            const t = tanks[i];
            if (Math.hypot(t.x + t.width / 2 - x, t.y + t.height / 2 - y) < 48) killTank(i, 150);
        }
        const ec = enemyChopper;
        if (ec.alive && Math.hypot(ec.x + ec.width / 2 - x, ec.y + ec.height / 2 - y) < 50) damageEnemyChopper(90);
        hostages.forEach(h => {
            if ((h.state === 'waiting' || h.state === 'running') && Math.abs(h.x - x) < 30) killHostage(h, 'FRIENDLY FIRE');
        });
        if (Math.hypot(chopper.x + chopper.width / 2 - x, chopper.y + chopper.height / 2 - y) < 45) damageChopper(20, 'TOO LOW');
    }
    function updateProjectiles() {
        // Player bullets
        for (let i = bullets.length - 1; i >= 0; i--) {
            const b = bullets[i];
            b.x += b.vx; b.life--;
            let hit = b.life <= 0 || b.x < 0 || b.x > WORLD_WIDTH;
            if (!hit) {
                for (let j = tanks.length - 1; j >= 0; j--) {
                    if (rectsOverlap(tanks[j], b)) { killTank(j, 100); hit = true; break; }
                }
            }
            if (!hit && enemyChopper.alive && rectsOverlap(enemyChopper, b)) { damageEnemyChopper(35); hit = true; }
            if (hit) bullets.splice(i, 1);
        }
        // Enemy bullets
        for (let i = enemyBullets.length - 1; i >= 0; i--) {
            const b = enemyBullets[i];
            b.x += b.vx; b.y += b.vy;
            let gone = b.x < 0 || b.x > WORLD_WIDTH || b.y < -10;
            if (b.y >= GROUND_Y) {
                gone = true;
                spawnParticles(b.x, GROUND_Y, 3, { speed: 1, colors: ['#a86'], size: 2, life: 15, up: 1 });
            }
            if (!gone && rectsOverlap(chopper, { x: b.x - 4, y: b.y - 4, width: 8, height: 8 })) {
                gone = true;
                damageChopper(b.dmg);
            }
            if (gone) enemyBullets.splice(i, 1);
        }
        // Bombs
        for (let i = bombs.length - 1; i >= 0; i--) {
            const b = bombs[i];
            b.vy += 0.28; b.x += b.vx; b.y += b.vy;
            let boom = b.y >= GROUND_Y - 4;
            const bRect = { x: b.x - 6, y: b.y - 6, width: 12, height: 12 };
            if (!boom && tanks.some(t => rectsOverlap(t, bRect))) boom = true;
            if (!boom && enemyChopper.alive && rectsOverlap(enemyChopper, bRect)) boom = true;
            if (boom) { bombs.splice(i, 1); explodeBomb(b.x, Math.min(b.y, GROUND_Y - 4)); }
        }
    }

    // =====================================================================
    // Collisions & wave progress
    // =====================================================================
    function checkCollisions() {
        for (const t of tanks) {
            if (rectsOverlap(chopper, t)) { damageChopper(30, 'COLLISION'); chopper.vy = -3; break; }
        }
        if (enemyChopper.alive && rectsOverlap(chopper, enemyChopper)) {
            damageChopper(50, 'COLLISION');
            damageEnemyChopper(60);
            chopper.vx = -Math.sign(enemyChopper.x - chopper.x) * 4;
        }
    }
    function checkWaveClear() {
        if (hostages.length === 0) return;
        const done = hostages.every(h => h.state === 'saved' || h.state === 'dead');
        if (done && chopper.carrying === 0) {
            waveBonus = waveRescued * 50 * wave + (waveLost === 0 ? 500 : 0);
            score += waveBonus;
            state = 'waveclear'; stateTimer = 0;
            Sound.dropoff();
        }
    }

    // =====================================================================
    // Main update
    // =====================================================================
    function update() {
        frame++;
        if (state === 'playing') {
            updateChopper();
            updateHostages();
            updateTanks();
            updateEnemyChopper();
            updateProjectiles();
            checkCollisions();
            checkWaveClear();
        } else if (state === 'dying') {
            stateTimer++;
            chopper.vy += GRAVITY; chopper.vx *= 0.98;
            chopper.x += chopper.vx; chopper.y += chopper.vy;
            chopper.spin += 0.15;
            if (frame % 3 === 0) particles.push({ x: chopper.x + chopper.width / 2, y: chopper.y, vx: rand(-0.5, 0.5), vy: -0.5, life: 30, maxLife: 30, color: pick(['#333', '#f60']), size: 6, gravity: 0 });
            if (chopper.y + chopper.height >= GROUND_Y || stateTimer > 120) {
                chopper.y = GROUND_Y - chopper.height;
                explosion(chopper.x + chopper.width / 2, chopper.y + chopper.height / 2, true);
                state = 'gameover'; stateTimer = 0;
                if (score > highScore) { highScore = score; newBest = true; saveHighScore(highScore); }
            }
        } else if (state === 'waveclear') {
            stateTimer++;
            if (stateTimer === 180) nextWave();
        } else if (state === 'gameover' || state === 'title') {
            stateTimer++;
        }
        if (state !== 'paused') updateEffects();
        // Camera
        const targetCam = chopper.x + chopper.width / 2 - GAME_WIDTH / 2 + chopper.dir * 110;
        cameraX += (targetCam - cameraX) * 0.08;
        cameraX = clamp(cameraX, 0, WORLD_WIDTH - GAME_WIDTH);
        if (frame % 15 === 0) updateDomScore();
    }
    function updateDomScore() {
        scoreDiv.textContent = state === 'title'
            ? `Best: ${highScore}`
            : `Wave ${wave} | Score: ${score} | Rescued: ${rescued} | Lost: ${lost} | Best: ${highScore}`;
    }

    // =====================================================================
    // Rendering
    // =====================================================================
    function drawSky() {
        const g = ctx.createLinearGradient(0, 0, 0, GAME_HEIGHT);
        g.addColorStop(0, '#1b4f9c'); g.addColorStop(0.7, '#5fb8f0'); g.addColorStop(1, '#a8e0ff');
        ctx.fillStyle = g; ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
        // Sun
        ctx.fillStyle = '#ffe680';
        ctx.beginPath(); ctx.arc(560 - cameraX * 0.02, 60, 26, 0, Math.PI * 2); ctx.fill();
        // Clouds (slow parallax)
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
                ctx.moveTo(sx + m.x - m.w / 2, baseY);
                ctx.lineTo(sx + m.x, baseY - m.h);
                ctx.lineTo(sx + m.x + m.w / 2, baseY);
                ctx.closePath(); ctx.fill();
            });
        }
    }
    function drawGround() {
        // world-space; called inside camera translate
        const startX = Math.floor(cameraX / 40) * 40 - 40;
        ctx.fillStyle = '#3fa63f'; ctx.fillRect(cameraX - 20, GROUND_Y, GAME_WIDTH + 40, 8);
        ctx.fillStyle = '#6b4a2b'; ctx.fillRect(cameraX - 20, GROUND_Y + 8, GAME_WIDTH + 40, GAME_HEIGHT - GROUND_Y);
        ctx.fillStyle = '#5a3d22';
        for (let x = startX; x < cameraX + GAME_WIDTH + 40; x += 40) ctx.fillRect(x + ((x / 40) % 2) * 12, GROUND_Y + 12, 16, 3);
        ctx.fillStyle = '#2f8a2f';
        for (let x = startX; x < cameraX + GAME_WIDTH + 40; x += 40) ctx.fillRect(x + 20, GROUND_Y, 6, 3);
    }
    function drawBase() {
        // Helipad
        ctx.fillStyle = '#666';
        ctx.fillRect(base.x - 6, GROUND_Y - 5, base.width + 12, 6);
        ctx.strokeStyle = '#0ff'; ctx.lineWidth = 2;
        ctx.strokeRect(base.x, GROUND_Y - 4, base.width, 4);
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(base.x + base.width / 2, GROUND_Y - 2, 12, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = '#fff'; ctx.font = 'bold 14px Arial'; ctx.textAlign = 'center';
        ctx.fillText('H', base.x + base.width / 2, GROUND_Y + 3);
        // Control tower beside the pad
        const tx = base.x + base.width + 12;
        ctx.fillStyle = '#8a8f99'; ctx.fillRect(tx, GROUND_Y - 60, 18, 60);
        ctx.fillStyle = '#4bb1ff'; ctx.fillRect(tx + 3, GROUND_Y - 56, 12, 8);
        ctx.fillStyle = '#ccc'; ctx.fillRect(tx + 8, GROUND_Y - 80, 2, 20);
        ctx.fillStyle = '#0ff'; ctx.fillRect(tx + 10, GROUND_Y - 80, 12 + Math.sin(frame / 8) * 2, 7);
        ctx.fillStyle = '#0ff'; ctx.font = 'bold 12px Arial';
        ctx.fillText('BASE', tx + 9, GROUND_Y - 86);
        ctx.textAlign = 'left';
    }
    function drawEnemyBase() {
        const b = enemyBase;
        ctx.fillStyle = '#4a4a55'; ctx.fillRect(b.x, b.y, b.width, b.height);
        ctx.fillStyle = '#3a3a45';
        for (let i = 0; i < 6; i++) ctx.fillRect(b.x + i * 20, b.y - 8, 12, 8);
        ctx.fillStyle = '#222'; ctx.fillRect(b.x + b.width / 2 - 12, b.y + 20, 24, 30);
        ctx.fillStyle = '#ccc'; ctx.fillRect(b.x + b.width - 20, b.y - 34, 2, 26);
        ctx.fillStyle = '#e33'; ctx.fillRect(b.x + b.width - 18, b.y - 34, 14 + Math.sin(frame / 8) * 2, 8);
        ctx.fillStyle = '#f55'; ctx.font = 'bold 12px Arial'; ctx.textAlign = 'center';
        ctx.fillText('ENEMY', b.x + b.width / 2, b.y + 14);
        ctx.textAlign = 'left';
    }
    function drawHuts() {
        huts.forEach(h => {
            ctx.fillStyle = '#b08050'; ctx.fillRect(h.x, GROUND_Y - h.h, h.w, h.h);
            ctx.fillStyle = '#7a4a20';
            ctx.beginPath(); ctx.moveTo(h.x - 6, GROUND_Y - h.h); ctx.lineTo(h.x + h.w / 2, GROUND_Y - h.h - 18); ctx.lineTo(h.x + h.w + 6, GROUND_Y - h.h); ctx.closePath(); ctx.fill();
            ctx.fillStyle = '#442'; ctx.fillRect(h.x + h.w / 2 - 6, GROUND_Y - 20, 12, 20);
            ctx.fillStyle = '#ffd'; ctx.fillRect(h.x + 8, GROUND_Y - h.h + 10, 10, 8);
        });
    }
    function drawHostages() {
        const cx = chopper.x + chopper.width / 2;
        hostages.forEach(h => {
            if (h.state !== 'waiting' && h.state !== 'running') return;
            const running = h.state === 'running';
            const near = Math.abs(cx - h.x) < 320;
            ctx.save();
            ctx.translate(h.x, GROUND_Y);
            if (h.dir < 0) ctx.scale(-1, 1);
            ctx.strokeStyle = '#ffe'; ctx.lineWidth = 2; ctx.lineCap = 'round';
            const swing = running ? Math.sin(h.anim * 0.5) * 4 : 0;
            ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(-2 + swing, 0); ctx.moveTo(0, -9); ctx.lineTo(2 - swing, 0); ctx.stroke();
            ctx.fillStyle = '#fd4'; ctx.fillRect(-3, -19, 6, 11);
            ctx.fillStyle = '#ffd9b3'; ctx.beginPath(); ctx.arc(0, -22, 3.5, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath();
            if (!running && near) {
                const w = Math.sin(h.anim * 0.3) * 3;
                ctx.moveTo(0, -17); ctx.lineTo(-5, -26 + w); ctx.moveTo(0, -17); ctx.lineTo(5, -26 - w);
            } else if (running) {
                ctx.moveTo(0, -17); ctx.lineTo(4 + swing, -13); ctx.moveTo(0, -17); ctx.lineTo(-4 - swing, -13);
            } else {
                ctx.moveTo(0, -17); ctx.lineTo(-4, -10); ctx.moveTo(0, -17); ctx.lineTo(4, -10);
            }
            ctx.stroke();
            ctx.restore();
        });
    }
    function drawTanks() {
        tanks.forEach(t => {
            ctx.save();
            ctx.translate(t.x, t.y);
            ctx.fillStyle = '#333'; ctx.fillRect(0, 14, t.width, 8);
            ctx.fillStyle = '#555';
            for (let i = 0; i < 4; i++) ctx.fillRect(2 + i * 6 + (Math.floor(frame * Math.abs(t.vx) / 4) % 6) * 0, 16, 3, 4);
            ctx.fillStyle = '#b22'; ctx.fillRect(1, 6, t.width - 2, 9);
            ctx.fillStyle = '#801515'; ctx.fillRect(7, 0, 12, 8);
            ctx.strokeStyle = '#999'; ctx.lineWidth = 3;
            ctx.beginPath(); ctx.moveTo(13, 4); ctx.lineTo(13 + Math.cos(t.angle) * 14, 4 + Math.sin(t.angle) * 14); ctx.stroke();
            ctx.restore();
        });
    }
    function drawHeli(h, body, cockpit, flash) {
        ctx.save();
        ctx.translate(h.x + h.width / 2, h.y + h.height / 2);
        ctx.rotate((h.spin || 0) + (h.tilt || 0));
        if (flash) ctx.globalAlpha = 0.45;
        const d = h.dir;
        // Shadow drawn separately; here only the body
        // Tail boom
        ctx.fillStyle = body;
        ctx.fillRect(d === 1 ? -30 : 2, -4, 28, 7);
        // Tail fin & rotor
        ctx.fillRect(d === 1 ? -32 : 26, -12, 6, 12);
        ctx.strokeStyle = '#ddd'; ctx.lineWidth = 2;
        const tr = Math.cos(frame * 0.9) * 6;
        ctx.beginPath(); ctx.moveTo(d === 1 ? -30 : 30, -6 - tr); ctx.lineTo(d === 1 ? -30 : 30, -6 + tr); ctx.stroke();
        // Main body
        ctx.fillStyle = body;
        ctx.beginPath();
        ctx.ellipse(d * 4, 0, 22, 12, 0, 0, Math.PI * 2);
        ctx.fill();
        // Cockpit glass
        ctx.fillStyle = cockpit;
        ctx.beginPath();
        ctx.ellipse(d * 14, -2, 9, 7, 0, 0, Math.PI * 2);
        ctx.fill();
        // Skids
        ctx.strokeStyle = '#222'; ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(-16, 14); ctx.lineTo(22, 14);
        ctx.moveTo(-8, 10); ctx.lineTo(-8, 14);
        ctx.moveTo(12, 10); ctx.lineTo(12, 14);
        ctx.stroke();
        // Mast + main rotor
        ctx.fillStyle = '#222'; ctx.fillRect(-2, -16, 4, 6);
        const rw = 6 + 30 * Math.abs(Math.cos(frame * 0.55));
        ctx.fillStyle = 'rgba(230,230,230,0.9)';
        ctx.fillRect(-rw, -18, rw * 2, 3);
        ctx.restore();
    }
    function drawShadow(h) {
        ctx.save();
        ctx.globalAlpha = 0.2 * clamp(1 - (GROUND_Y - (h.y + h.height)) / 400, 0.3, 1);
        ctx.fillStyle = '#000';
        ctx.beginPath(); ctx.ellipse(h.x + h.width / 2, GROUND_Y + 3, h.width / 2, 4, 0, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
    }
    function drawHealthBar(h, w) {
        const pct = clamp(h.health / h.maxHealth, 0, 1);
        const x = h.x + h.width / 2 - w / 2, y = h.y - 24;
        ctx.fillStyle = '#0008'; ctx.fillRect(x - 1, y - 1, w + 2, 6);
        ctx.fillStyle = `hsl(${pct * 110},80%,50%)`; ctx.fillRect(x, y, Math.round(w * pct), 4);
    }
    function drawProjectiles() {
        ctx.fillStyle = '#ffe';
        bullets.forEach(b => { ctx.fillRect(b.x, b.y, b.width, b.height); });
        enemyBullets.forEach(b => {
            ctx.fillStyle = b.heli ? '#0ff' : '#ff0';
            ctx.beginPath(); ctx.arc(b.x, b.y, 3.5, 0, Math.PI * 2); ctx.fill();
        });
        bombs.forEach(b => {
            ctx.fillStyle = '#333';
            ctx.beginPath(); ctx.ellipse(b.x, b.y, 4, 7, 0, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#f90'; ctx.fillRect(b.x - 3, b.y - 9, 6, 3);
        });
    }
    function drawParticles() {
        particles.forEach(p => {
            ctx.globalAlpha = clamp(p.life / p.maxLife, 0, 1);
            ctx.fillStyle = p.color;
            ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
        });
        ctx.globalAlpha = 1;
    }
    function drawFloatTexts() {
        ctx.textAlign = 'center';
        floatTexts.forEach(t => {
            ctx.globalAlpha = clamp(t.life / 30, 0, 1);
            ctx.font = (t.big ? 'bold 18px' : 'bold 12px') + ' Arial';
            ctx.lineWidth = 3; ctx.strokeStyle = '#000';
            ctx.strokeText(t.text, t.x, t.y);
            ctx.fillStyle = t.color; ctx.fillText(t.text, t.x, t.y);
        });
        ctx.globalAlpha = 1; ctx.textAlign = 'left';
    }
    function drawHUD() {
        ctx.save();
        ctx.font = 'bold 13px Arial';
        // Health
        ctx.fillStyle = '#0006'; ctx.fillRect(8, 8, 154, 62);
        ctx.fillStyle = '#fff'; ctx.fillText('HULL', 14, 22);
        const pct = clamp(chopper.health / chopper.maxHealth, 0, 1);
        ctx.fillStyle = '#222'; ctx.fillRect(56, 12, 96, 10);
        ctx.fillStyle = `hsl(${pct * 110},80%,50%)`; ctx.fillRect(56, 12, Math.round(96 * pct), 10);
        // Bombs
        ctx.fillStyle = '#fff'; ctx.fillText('BOMBS', 14, 42);
        for (let i = 0; i < MAX_BOMBS; i++) {
            ctx.fillStyle = i < chopper.bombs ? '#f90' : '#444';
            ctx.beginPath(); ctx.arc(70 + i * 15, 38, 5, 0, Math.PI * 2); ctx.fill();
        }
        // Aboard
        ctx.fillStyle = '#fff'; ctx.fillText('ABOARD', 14, 62);
        for (let i = 0; i < MAX_CARRY; i++) {
            ctx.fillStyle = i < chopper.carrying ? '#fd4' : '#444';
            ctx.beginPath(); ctx.arc(80 + i * 15, 56, 3, 0, Math.PI * 2); ctx.fill();
            ctx.fillRect(77 + i * 15, 59, 6, 7);
        }
        // Score block
        ctx.textAlign = 'right';
        ctx.fillStyle = '#0006'; ctx.fillRect(GAME_WIDTH - 158, 8, 150, 62);
        ctx.fillStyle = '#fff'; ctx.font = 'bold 16px Arial';
        ctx.fillText(String(score).padStart(6, '0'), GAME_WIDTH - 14, 26);
        ctx.font = 'bold 12px Arial'; ctx.fillStyle = '#ccc';
        ctx.fillText('BEST ' + highScore, GAME_WIDTH - 14, 44);
        ctx.fillStyle = '#ff0';
        ctx.fillText('WAVE ' + wave, GAME_WIDTH - 14, 62);
        ctx.textAlign = 'left';
        // Radar strip
        const rx = 170, ry = 10, rw = GAME_WIDTH - 340, rh = 12;
        ctx.fillStyle = '#0007'; ctx.fillRect(rx, ry, rw, rh);
        const mx = x => rx + (x / WORLD_WIDTH) * rw;
        ctx.fillStyle = '#0ff'; ctx.fillRect(mx(base.x), ry, 3, rh);
        ctx.fillStyle = '#f55'; ctx.fillRect(mx(enemyBase.x), ry, 3, rh);
        ctx.fillStyle = '#fd4';
        hostages.forEach(h => { if (h.state === 'waiting' || h.state === 'running') ctx.fillRect(mx(h.x), ry + 3, 2, 6); });
        ctx.fillStyle = '#f33';
        tanks.forEach(t => ctx.fillRect(mx(t.x), ry + 4, 3, 4));
        if (enemyChopper.alive) { ctx.fillStyle = '#f0f'; ctx.fillRect(mx(enemyChopper.x), ry + 2, 4, 4); }
        ctx.fillStyle = '#0f0'; ctx.fillRect(mx(chopper.x), ry + 2, 4, 8);
        ctx.strokeStyle = '#fff6'; ctx.lineWidth = 1;
        ctx.strokeRect(mx(cameraX), ry, (GAME_WIDTH / WORLD_WIDTH) * rw, rh);
        // Rescue counter under radar
        ctx.fillStyle = '#fff'; ctx.font = 'bold 11px Arial'; ctx.textAlign = 'center';
        const remaining = hostages.filter(h => h.state === 'waiting' || h.state === 'running' || h.state === 'aboard').length;
        ctx.fillText(`RESCUED ${rescued}   LOST ${lost}   REMAINING ${remaining}`, GAME_WIDTH / 2, 36);
        if (Sound.muted) { ctx.fillStyle = '#ccc'; ctx.fillText('MUTED', GAME_WIDTH / 2, 50); }
        ctx.restore();
    }
    function overlay(alpha) {
        ctx.fillStyle = `rgba(0,0,0,${alpha})`; ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    }
    function bigText(text, y, size, color) {
        ctx.textAlign = 'center';
        ctx.font = `bold ${size}px Arial`;
        ctx.lineWidth = Math.max(2, size / 8); ctx.strokeStyle = '#000';
        ctx.strokeText(text, GAME_WIDTH / 2, y);
        ctx.fillStyle = color; ctx.fillText(text, GAME_WIDTH / 2, y);
        ctx.textAlign = 'left';
    }
    function drawOverlays() {
        const prompt = isTouch ? 'TAP TO ' : 'PRESS SPACE TO ';
        if (state === 'title') {
            overlay(0.45);
            bigText('NQ CHOPPER', 120, 48, '#ff0');
            bigText('Rescue the hostages and bring them home', 155, 16, '#fff');
            bigText('Land near hostages so they can run aboard · 4 seats · Return to BASE to unload', 200, 12, '#ddd');
            bigText('Bombs hit ground targets · Bullets for the enemy chopper · Base repairs and rearms', 220, 12, '#ddd');
            bigText('Watch out: tanks crush hostages running in the open, and so do your bombs', 240, 12, '#f99');
            if (Math.floor(frame / 30) % 2 === 0) bigText(prompt + 'START', 300, 20, '#0f0');
            if (highScore > 0) bigText('BEST ' + highScore, 340, 14, '#ccc');
        } else if (state === 'paused') {
            overlay(0.5);
            bigText('PAUSED', 190, 40, '#fff');
            bigText(isTouch ? 'TAP TO RESUME' : 'PRESS P TO RESUME', 230, 16, '#ccc');
        } else if (state === 'waveclear') {
            overlay(Math.min(0.5, stateTimer / 60));
            bigText('WAVE ' + wave + ' CLEAR', 150, 40, '#ff0');
            bigText(`RESCUED ${waveRescued}   LOST ${waveLost}`, 195, 18, '#fff');
            bigText('BONUS +' + waveBonus + (waveLost === 0 ? '  PERFECT!' : ''), 225, 18, waveLost === 0 ? '#0f0' : '#ff0');
            bigText('GET READY FOR WAVE ' + (wave + 1), 280, 16, '#ccc');
        } else if (state === 'gameover') {
            overlay(Math.min(0.55, stateTimer / 40));
            bigText('CHOPPER DOWN', 140, 44, '#f44');
            bigText('SCORE ' + score, 190, 24, '#fff');
            bigText(`RESCUED ${rescued}   LOST ${lost}   WAVE ${wave}`, 220, 16, '#ccc');
            if (newBest) bigText('NEW BEST SCORE!', 255, 20, '#ff0');
            else bigText('BEST ' + highScore, 255, 16, '#ccc');
            if (stateTimer > 30 && Math.floor(frame / 30) % 2 === 0) bigText(isTouch ? 'TAP TO RETRY' : 'PRESS R OR SPACE TO RETRY', 310, 18, '#0f0');
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
        const sx = shake > 0 ? (Math.random() - 0.5) * shake : 0;
        const sy = shake > 0 ? (Math.random() - 0.5) * shake : 0;
        ctx.save();
        ctx.translate(-Math.round(cameraX) + sx, sy);
        drawGround();
        drawBase();
        drawEnemyBase();
        drawHuts();
        drawHostages();
        drawTanks();
        if (enemyChopper.alive) { drawShadow(enemyChopper); drawHeli(enemyChopper, '#d33', '#fff', false); drawHealthBar(enemyChopper, 40); }
        if (state !== 'gameover') {
            drawShadow(chopper);
            drawHeli(chopper, '#3c3', '#9ff', chopper.invuln > 0 && frame % 6 < 3);
        }
        drawProjectiles();
        drawParticles();
        drawFloatTexts();
        ctx.restore();
        drawHUD();
        drawOverlays();
        ctx.restore();
    }

    // =====================================================================
    // Input
    // =====================================================================
    const KEYMAP = { ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', Space: 'fire' };
    document.addEventListener('keydown', e => {
        Sound.unlock();
        const k = KEYMAP[e.code];
        if (k) { e.preventDefault(); if (state === 'playing') input[k] = true; }
        if (e.repeat) return;
        if (e.code === 'Space' || e.code === 'Enter') { if (state !== 'playing') primaryAction(); }
        if (e.code === 'KeyB') dropBomb();
        if (e.code === 'KeyP' || e.code === 'Escape') togglePause();
        if (e.code === 'KeyM') toggleMute();
        if (e.code === 'KeyR' && (state === 'gameover' || state === 'paused')) startGame();
    });
    document.addEventListener('keyup', e => {
        const k = KEYMAP[e.code];
        if (k) input[k] = false;
    });
    window.addEventListener('blur', () => { Object.keys(input).forEach(k => input[k] = false); if (state === 'playing') togglePause(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'playing') togglePause(); });

    // On-screen buttons
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
    bindControl(document.getElementById('btnShoot'), () => { if (state !== 'playing') primaryAction(); input.fire = true; }, () => input.fire = false);
    bindControl(document.getElementById('btnBomb'), () => dropBomb(), () => {});

    // Canvas gestures: drag to steer, tap to shoot/start, long-press to bomb
    (function () {
        let pid = null, sx = 0, sy = 0, st = 0, moved = false, lpTimer = null;
        const TAP_DIST = 12, TAP_TIME = 300, LONG_PRESS = 450, MOVE = 15;
        function down(e) {
            e.preventDefault(); Sound.unlock();
            if (pid !== null) return;
            pid = e.pointerId; sx = e.clientX; sy = e.clientY; st = Date.now(); moved = false;
            if (lpTimer) clearTimeout(lpTimer);
            lpTimer = setTimeout(() => { if (!moved) dropBomb(); lpTimer = null; }, LONG_PRESS);
        }
        function move(e) {
            if (e.pointerId !== pid) return;
            e.preventDefault();
            const dx = e.clientX - sx, dy = e.clientY - sy;
            if (Math.abs(dx) > MOVE || Math.abs(dy) > MOVE) { moved = true; if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; } }
            if (state === 'playing') {
                input.left = dx < -MOVE; input.right = dx > MOVE; input.up = dy < -MOVE; input.down = dy > MOVE;
            }
        }
        function up(e) {
            if (e.pointerId !== pid) return;
            e.preventDefault();
            const dt = Date.now() - st, dist = Math.hypot(e.clientX - sx, e.clientY - sy);
            if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; }
            if (!moved && dt < TAP_TIME && dist < TAP_DIST) primaryAction();
            input.left = input.right = input.up = input.down = false;
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
    window.__nq = { get state() { return state; }, get score() { return score; }, get wave() { return wave; }, get rescued() { return rescued; },
        get lost() { return lost; }, chopper, enemyChopper, get hostages() { return hostages; }, get tanks() { return tanks; }, input, get frame() { return frame; } };

    fitCanvas();
    setupWave(1);          // populate the world behind the title screen
    state = 'title';
    updateDomScore();
    requestAnimationFrame(loop);
})();
