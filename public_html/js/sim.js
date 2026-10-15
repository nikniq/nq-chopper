/*
 * NQ Chopper simulation.
 *
 * Pure, deterministic game logic shared by the browser client and Node tests,
 * and run in lockstep on both peers of an online match. No DOM, no sound, no
 * Math.random: all randomness comes from the seeded generator in the state,
 * and only IEEE-exact operations (sqrt, basic arithmetic) decide gameplay so
 * two browsers produce identical states from identical inputs.
 *
 * Cosmetic output (particles, floating text, sounds) is emitted as `state.fx`
 * events each step for the client to render.
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.NQSim = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    'use strict';

    const WORLD_WIDTH = 2400, GROUND_Y = 380, MAX_CARRY = 4, MAX_BOMBS = 5, GRAVITY = 0.25;
    const MAX_ALLIES = 12;
    const GARRISON_CAP = { player: 3, ai: 2 };
    const GARRISON_RANGE = 170;
    const PICKUPS = { health: { amount: 35, color: '#f55' }, bombs: { amount: MAX_BOMBS, color: '#f90' }, credits: { amount: 60, color: '#8f8' } };
    const BOSS_EVERY = 3;
    const UNITS = {
        soldier: { name: 'SOLDIER', cost: 50, width: 8, height: 20, speed: 0.9, health: 24, range: 130, fireRate: 45, dmg: 8 },
        tank:    { name: 'TANK',    cost: 200, width: 26, height: 22, speed: 0.6, health: 120, range: 210, fireRate: 95, dmg: 35 }
    };
    const UPGRADES = {
        gun:   { name: 'GUNS',  costs: [150, 250, 400], cooldown: [9, 7, 5, 4], dmg: [35, 42, 50, 60] },
        armor: { name: 'ARMOR', costs: [150, 250, 400], bonus: 40 }
    };
    const AI = -1; // team id of the computer opponent in solo mode

    // ---------------------------------------------------------------------
    // Deterministic helpers
    // ---------------------------------------------------------------------
    function rnd(s) {
        s.rs = (s.rs + 0x6D2B79F5) | 0;
        let t = Math.imul(s.rs ^ (s.rs >>> 15), 1 | s.rs);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    const rand = (s, a, b) => a + rnd(s) * (b - a);
    const pick = (s, arr) => arr[Math.floor(rnd(s) * arr.length)];
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const sign = v => (v < 0 ? -1 : 1);
    const dist = (dx, dy) => Math.sqrt(dx * dx + dy * dy);
    function overlap(a, b) {
        return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
    }
    const cx = o => o.x + o.width / 2, cy = o => o.y + o.height / 2;
    // Deterministic triangle wave in [-1, 1] with the given period (replaces Math.sin for gameplay).
    const tri = (t, period) => { const p = ((t % period) + period) % period / period; return p < 0.5 ? p * 4 - 1 : 3 - p * 4; };

    // Cosmetic events for the client
    const fx = (s, ev) => { s.fx.push(ev); };
    const snd = (s, name) => fx(s, { t: 'snd', name });
    const text = (s, x, y, msg, color, big) => fx(s, { t: 'txt', x, y, msg, color: color || '#fff', big: !!big });
    const parts = (s, x, y, n, o) => fx(s, { t: 'p', x, y, n, o });
    const explosion = (s, x, y, big) => fx(s, { t: 'x', x, y, big: !!big });

    // ---------------------------------------------------------------------
    // Construction
    // ---------------------------------------------------------------------
    function makeBase(team, side) {
        return side === 1
            ? { team, x: 20, y: GROUND_Y - 40, width: 110, height: 40, maxHealth: 1, health: 1, destroyed: false }
            : { team, x: WORLD_WIDTH - 140, y: GROUND_Y - 50, width: 120, height: 50, maxHealth: 1, health: 1, destroyed: false };
    }
    function makePlayer(id, side, name) {
        return { id, team: id, side, name: name || ('P' + (id + 1)), x: 60, y: 200, width: 60, height: 24, vx: 0, vy: 0, dir: side,
            speed: 3.4, carrying: 0, maxHealth: 100, health: 100, bombs: MAX_BOMBS, invuln: 0, landed: false, fireCooldown: 0, tilt: 0, spin: 0,
            alive: true, respawn: 0, deaths: 0, score: 0, credits: 0, rescued: 0, lost: 0,
            upgrades: { gun: 0, armor: 0 }, combo: 0, comboTimer: 0 };
    }
    function makeTank(s, team, x, vx) {
        const def = UNITS.tank;
        const hp = team === AI ? 30 + s.wave * 6 : def.health;
        return { team, type: 'tank', x, y: GROUND_Y - def.height, width: def.width, height: def.height, vx: vx || 0, dir: vx ? sign(vx) : 1,
            speed: def.speed, health: hp, maxHealth: hp, range: def.range, fireTimer: rand(s, 60, 160), angle: -Math.PI / 2, anim: 0, moving: true, ai: team === AI };
    }
    function makeSoldier(s, team, x, dir) {
        const def = UNITS.soldier;
        return { team, type: 'soldier', x, y: GROUND_Y - def.height, width: def.width, height: def.height, vx: 0, dir,
            speed: def.speed * rand(s, 0.9, 1.1), health: def.health, maxHealth: def.health, range: def.range, fireTimer: rand(s, 10, def.fireRate), angle: 0, anim: 0, moving: true, ai: false };
    }

    function createGame(opts) {
        opts = opts || {};
        const mode = opts.mode === 'versus' ? 'versus' : 'solo';
        const s = {
            mode, seed: opts.seed | 0, rs: opts.seed | 0, frame: 0,
            status: 'playing', statusTimer: 0, winner: null, endReason: '',
            wave: 0, waveRescued: 0, waveLost: 0, waveBonus: 0,
            players: [], bases: [], hostages: [], huts: [], units: [], bullets: [], shells: [], bombs: [], pickups: [],
            ai: { team: AI, x: 0, y: 120, width: 60, height: 24, vx: 0, vy: 0, dir: -1, speed: 2, shootCooldown: 0, maxHealth: 150, health: 150, alive: false, respawn: 0, tilt: 0, patrolDir: -1, boss: false, burst: 0 },
            tankSpawnTimer: 0, soldierSpawnTimer: 0, hostageTimer: 0, fx: []
        };
        const names = opts.names || [];
        s.players.push(makePlayer(0, 1, names[0]));
        s.bases.push(makeBase(0, 1));
        if (mode === 'versus') {
            s.players.push(makePlayer(1, -1, names[1]));
            s.bases.push(makeBase(1, -1));
            s.bases.forEach(b => { b.maxHealth = b.health = 1500; });
            s.players.forEach(p => { p.credits = 300; });
            setupVersus(s);
        } else {
            s.bases.push(makeBase(AI, -1));
            s.players[0].credits = 100;
            setupWave(s, 1);
        }
        return s;
    }

    function resetPlayer(s, p) {
        const b = s.bases[p.id];
        p.x = b.x + b.width / 2 - p.width / 2;
        p.y = GROUND_Y - p.height;
        p.vx = 0; p.vy = 0; p.dir = p.side; p.carrying = 0;
        p.health = p.maxHealth; p.bombs = MAX_BOMBS;
        p.invuln = 0; p.landed = true; p.fireCooldown = 0; p.tilt = 0; p.spin = 0; p.alive = true; p.respawn = 0;
    }
    function spawnHostageGroup(s, gx) {
        s.huts.push({ x: gx, w: 54, h: 36, garrison: null, fireTimer: 0, warnTimer: 0 });
        const count = 3 + Math.floor(rnd(s) * 2);
        for (let i = 0; i < count; i++) s.hostages.push({ x: gx + 60 + i * 14 + rand(s, -3, 3), state: 'waiting', dir: -1, anim: Math.floor(rnd(s) * 100), carrier: -1 });
    }
    function spawnAiHeli(s) {
        const a = s.ai, base = s.bases[1];
        a.boss = s.wave % BOSS_EVERY === 0;
        a.x = base.x - 80; a.y = 110; a.vx = -a.speed; a.dir = -1; a.shootCooldown = 90; a.burst = 0;
        a.maxHealth = (150 + (s.wave - 1) * 40) * (a.boss ? 3 : 1); a.health = a.maxHealth;
        a.speed = 2 + (s.wave - 1) * 0.25 + (a.boss ? 0.4 : 0); a.alive = true; a.respawn = 0;
        a.width = a.boss ? 78 : 60; a.height = a.boss ? 30 : 24;
        if (a.boss) { text(s, a.x, a.y - 30, 'GUNSHIP INBOUND', '#f66', true); snd(s, 'die'); }
    }
    function setupWave(s, n) {
        s.wave = n; s.waveRescued = 0; s.waveLost = 0; s.waveBonus = 0;
        s.hostages = []; s.huts = []; s.bullets = []; s.shells = []; s.bombs = []; s.pickups = [];
        s.units = s.units.filter(u => u.team !== AI);
        s.tankSpawnTimer = 0;
        const eb = s.bases[1];
        eb.maxHealth = 400 + (n - 1) * 150; eb.health = eb.maxHealth; eb.destroyed = false;
        resetPlayer(s, s.players[0]);
        const groups = Math.min(2 + n, 5);
        const span = (WORLD_WIDTH - 900) / groups;
        for (let g = 0; g < groups; g++) spawnHostageGroup(s, 480 + g * span + rand(s, 40, span - 120));
        const tankCount = 2 + n;
        for (let i = 0; i < tankCount; i++) {
            let tx = rand(s, 380, WORLD_WIDTH - 260), tries = 0;
            while (tries++ < 20 && s.huts.some(h => Math.abs(h.x + 40 - tx) < 160)) tx = rand(s, 380, WORLD_WIDTH - 260);
            s.units.push(makeTank(s, AI, tx, pick(s, [-1, 1]) * (0.8 + n * 0.15)));
        }
        spawnAiHeli(s);
        text(s, s.players[0].x + 30, s.players[0].y - 30, 'WAVE ' + n, '#ff0', true);
        snd(s, 'wave');
    }
    function setupVersus(s) {
        s.players.forEach(p => resetPlayer(s, p));
        for (let g = 0; g < 4; g++) spawnHostageGroup(s, 640 + g * 300 + rand(s, 0, 120));
        s.hostageTimer = 0;
        text(s, WORLD_WIDTH / 2, 150, 'DESTROY THE ENEMY BASE', '#ff0', true);
        snd(s, 'wave');
    }

    // ---------------------------------------------------------------------
    // Queries
    // ---------------------------------------------------------------------
    function choppers(s) {
        const list = s.players.filter(p => p.alive);
        if (s.mode === 'solo' && s.ai.alive) list.push(s.ai);
        return list;
    }
    function enemyBase(s, team) { return s.bases.find(b => b.team !== team && !b.destroyed) || null; }
    function ownBase(s, team) { return s.bases.find(b => b.team === team); }
    function marchDir(s, team) { return team === 0 ? 1 : -1; }
    const hutDoor = h => h.x + h.w / 2;
    function hutOf(s, x) {
        let best = null, bestD = 110;
        s.huts.forEach(h => { const d = Math.abs(x - (h.x + 80)); if (d < bestD) { bestD = d; best = h; } });
        return best;
    }
    const hutBlocks = (h, team) => !!(h && h.garrison && h.garrison.team !== team);

    // ---------------------------------------------------------------------
    // Economy
    // ---------------------------------------------------------------------
    function earn(s, p, amount, x, y) {
        p.credits += amount;
        if (x !== undefined) text(s, x, y, '+$' + amount, '#8f8');
    }
    function comboPoints(p, pts) {
        p.comboTimer = 150; p.combo++;
        return Math.round(pts * Math.min(3, 1 + (p.combo - 1) * 0.25));
    }
    function comboLabel(p) { return p.combo > 1 ? '  x' + String(Math.min(3, 1 + (p.combo - 1) * 0.25)).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '') : ''; }
    function award(s, p, pts, x, y, cash, big) {
        const final = comboPoints(p, pts);
        p.score += final;
        if (cash) p.credits += cash;
        text(s, x, y, '+' + final + (cash ? ' +$' + cash : '') + comboLabel(p), p.combo > 1 ? '#ff0' : '#fff', big);
    }
    function buyUnit(s, p, type) {
        const def = UNITS[type];
        if (!def || !p.alive) return false;
        const mine = s.units.filter(u => u.team === p.team).length;
        if (p.credits < def.cost || mine >= MAX_ALLIES) {
            text(s, cx(p), p.y - 30, p.credits < def.cost ? 'NEED $' + def.cost : 'TROOP LIMIT', '#f66');
            snd(s, 'denied');
            return false;
        }
        p.credits -= def.cost;
        const b = ownBase(s, p.team), dir = marchDir(s, p.team);
        const x = dir === 1 ? b.x + b.width + 42 + rand(s, -8, 8) : b.x - 42 - def.width + rand(s, -8, 8);
        s.units.push(type === 'tank' ? Object.assign(makeTank(s, p.team, x, 0), { dir, angle: dir === 1 ? 0 : Math.PI }) : makeSoldier(s, p.team, x, dir));
        parts(s, x, GROUND_Y - 4, 6, { speed: 1, colors: ['#9c9', '#cfc'], size: 3, life: 25, up: 0.6 });
        text(s, cx(p), p.y - 30, def.name + ' DEPLOYED  -$' + def.cost, '#8f8');
        snd(s, 'deploy');
        return true;
    }
    function upgradeCost(p, type) {
        const def = UPGRADES[type];
        return p.upgrades[type] >= def.costs.length ? null : def.costs[p.upgrades[type]];
    }
    function buyUpgrade(s, p, type) {
        const def = UPGRADES[type];
        if (!def || !p.alive) return false;
        const cost = upgradeCost(p, type), x = cx(p), y = p.y - 30;
        if (cost === null) { text(s, x, y, def.name + ' MAXED', '#f66'); snd(s, 'denied'); return false; }
        if (p.credits < cost) { text(s, x, y, 'NEED $' + cost, '#f66'); snd(s, 'denied'); return false; }
        p.credits -= cost;
        p.upgrades[type]++;
        if (type === 'armor') { p.maxHealth += def.bonus; p.health += def.bonus; }
        parts(s, x, cy(p), 14, { speed: 2.5, colors: ['#8f8', '#fff', '#ff0'], size: 3, life: 30 });
        text(s, x, y, def.name + ' LEVEL ' + p.upgrades[type] + '  -$' + cost, '#8f8', true);
        snd(s, 'dropoff');
        return true;
    }

    // ---------------------------------------------------------------------
    // Players
    // ---------------------------------------------------------------------
    function shoot(s, p) {
        if (p.fireCooldown > 0) return;
        const bx = p.dir === 1 ? p.x + p.width : p.x - 8;
        s.bullets.push({ team: p.team, x: bx, y: p.y + p.height / 2 - 1, vx: p.dir * 9 + p.vx * 0.5, width: 8, height: 3, life: 60 });
        p.fireCooldown = UPGRADES.gun.cooldown[p.upgrades.gun];
        snd(s, 'shoot');
    }
    function dropBomb(s, p) {
        if (p.bombs <= 0 || p.landed) return;
        s.bombs.push({ team: p.team, x: cx(p), y: p.y + p.height + 4, vx: p.vx * 0.8, vy: 1 });
        p.bombs--;
        snd(s, 'bomb');
    }
    function damagePlayer(s, p, amount, why) {
        if (!p.alive || p.invuln > 0 || s.status !== 'playing') return;
        p.health = Math.max(0, p.health - amount);
        p.invuln = 40;
        fx(s, { t: 'shake', v: 5, team: p.team });
        snd(s, 'hit');
        parts(s, cx(p), cy(p), 6, { speed: 2, colors: ['#ff0', '#f80'], size: 3, life: 20 });
        if (why) text(s, cx(p), p.y - 20, why, '#f66');
        if (p.health <= 0) killPlayer(s, p);
    }
    function killPlayer(s, p) {
        p.alive = false; p.deaths++; p.spin = 0; p.respawn = 0;
        explosion(s, cx(p), cy(p), false);
        snd(s, 'die');
        // Anyone aboard is lost
        s.hostages.forEach(h => { if (h.state === 'aboard' && h.carrier === p.id) { h.state = 'dead'; p.lost++; s.waveLost++; } });
        p.carrying = 0;
        if (s.mode === 'solo') { s.status = 'dying'; s.statusTimer = 0; }
        else { s.status === 'playing' && text(s, cx(p), p.y - 40, p.name + ' DOWN', '#f66', true); }
    }
    function updateDyingPlayer(s, p) {
        p.vy += GRAVITY; p.vx *= 0.98; p.x += p.vx; p.y += p.vy; p.spin += 0.15; p.respawn++;
        if (p.respawn % 3 === 0) parts(s, cx(p), p.y, 1, { speed: 0.5, colors: ['#333', '#f60'], size: 6, life: 30, up: 0.5 });
        if (p.y + p.height >= GROUND_Y || p.respawn > 120) {
            p.y = GROUND_Y - p.height; p.vy = 0; p.vx = 0;
            if (p.respawn <= 120) { explosion(s, cx(p), cy(p), true); p.respawn = 121; }
        }
        if (s.mode === 'versus' && p.respawn >= 121 + 180) {
            resetPlayer(s, p);
            p.invuln = 90;
            text(s, cx(p), p.y - 30, 'REDEPLOYED', '#8f8');
        }
    }
    function updatePlayer(s, p, inp) {
        if (!p.alive) { if (s.mode === 'versus') updateDyingPlayer(s, p); return; }
        const targetVx = inp.l ? -p.speed : inp.r ? p.speed : 0;
        if (inp.l) p.dir = -1; else if (inp.r) p.dir = 1;
        p.vx += (targetVx - p.vx) * 0.12;
        if (inp.u) p.vy -= 0.5;
        p.vy += GRAVITY;
        if (inp.d) p.vy += 0.3;
        p.vy = clamp(p.vy, -4.5, 5);
        p.x += p.vx; p.y += p.vy;
        p.x = clamp(p.x, 0, WORLD_WIDTH - p.width);
        if (p.y < 26) { p.y = 26; p.vy = Math.max(0, p.vy); }
        if (p.y + p.height >= GROUND_Y) {
            if (p.vy >= 4.9 && !p.landed) damagePlayer(s, p, 10, 'HARD LANDING');
            p.y = GROUND_Y - p.height; p.vy = 0; p.vx *= 0.8; p.landed = true;
        } else p.landed = false;
        p.tilt += ((p.vx / p.speed) * 0.2 - p.tilt) * 0.1;
        if (p.invuln > 0) p.invuln--;
        if (p.fireCooldown > 0) p.fireCooldown--;
        if (p.comboTimer > 0 && --p.comboTimer === 0) p.combo = 0;
        if (inp.f) shoot(s, p);
        if (inp.b) dropBomb(s, p);
        if (inp.buy) { if (UNITS[inp.buy]) buyUnit(s, p, inp.buy); else if (UPGRADES[inp.buy]) buyUpgrade(s, p, inp.buy); }
        if (p.health < p.maxHealth * 0.4 && s.frame % 5 === 0) parts(s, cx(p) + rand(s, -6, 6), p.y + 6, 1, { speed: 0.3, colors: ['#444'], size: 5, life: 40, up: 0.8 });
        // At own base: unload, repair, rearm
        const b = ownBase(s, p.team);
        if (p.landed && overlap(p, b)) {
            if (p.carrying > 0) {
                const n = p.carrying;
                s.hostages.forEach(h => { if (h.state === 'aboard' && h.carrier === p.id) h.state = 'saved'; });
                p.rescued += n; s.waveRescued += n;
                let pts = n * 100; if (n === MAX_CARRY) pts += 200;
                p.score += pts; p.carrying = 0;
                text(s, cx(p), p.y - 24, '+' + pts + (n === MAX_CARRY ? ' FULL LOAD' : ''), '#ff0', true);
                earn(s, p, n * 40, cx(p), p.y - 44);
                snd(s, 'dropoff');
            }
            if (p.health < p.maxHealth && s.frame % 6 === 0) { p.health++; if (s.frame % 30 === 0) snd(s, 'heal'); }
            if (p.bombs < MAX_BOMBS && s.frame % 20 === 0) p.bombs++;
        }
    }

    // ---------------------------------------------------------------------
    // Hostages
    // ---------------------------------------------------------------------
    function updateHostages(s) {
        const landed = s.players.filter(p => p.alive && p.landed && p.carrying < MAX_CARRY);
        s.hostages.forEach(h => {
            h.anim++;
            if (h.state !== 'waiting' && h.state !== 'running') return;
            let best = null, bestD = 280;
            const hut = hutOf(s, h.x);
            landed.forEach(p => {
                const d = Math.abs(cx(p) - h.x);
                if (d >= bestD) return;
                if (hutBlocks(hut, p.team)) {
                    if (hut.warnTimer <= 0) { hut.warnTimer = 150; text(s, cx(p), p.y - 36, 'HUT HELD BY ENEMY SOLDIERS - SEND INFANTRY', '#f66'); }
                    return;
                }
                bestD = d; best = p;
            });
            if (best) {
                const dx = cx(best) - h.x;
                h.state = 'running'; h.dir = dx < 0 ? -1 : 1; h.x += h.dir * 1.3;
                if (Math.abs(dx) < 8) {
                    h.state = 'aboard'; h.carrier = best.id; best.carrying++;
                    text(s, cx(best), best.y - 16, best.carrying + '/' + MAX_CARRY, '#ff0');
                    snd(s, 'pickup');
                }
            } else h.state = 'waiting';
        });
        s.huts.forEach(h => { if (h.warnTimer > 0) h.warnTimer--; });
        if (s.mode === 'versus') {
            // Keep the middle of the map supplied with hostages
            const live = s.hostages.filter(h => h.state === 'waiting' || h.state === 'running').length;
            if (live < 6 && ++s.hostageTimer > 420) {
                s.hostageTimer = 0;
                const keep = s.huts.filter(h => h.garrison || s.hostages.some(o => (o.state === 'waiting' || o.state === 'running') && Math.abs(o.x - (h.x + 80)) < 90));
                s.huts = keep.length > 6 ? keep.filter(h => h.garrison).concat(keep.filter(h => !h.garrison).slice(-2)) : keep;
                spawnHostageGroup(s, rand(s, 620, 1660));
                text(s, s.huts[s.huts.length - 1].x + 30, GROUND_Y - 70, 'HOSTAGES SPOTTED', '#fd4');
            }
        }
    }
    function killHostage(s, h, why) {
        h.state = 'dead';
        s.waveLost++;
        if (s.mode === 'solo') s.players[0].lost++;
        parts(s, h.x, GROUND_Y - 10, 8, { speed: 2, colors: ['#fd4', '#fff'], size: 3, life: 30, gravity: 0.1 });
        text(s, h.x, GROUND_Y - 40, why || 'HOSTAGE LOST', '#f55');
    }

    // ---------------------------------------------------------------------
    // Ground units (AI tanks, player soldiers and tanks)
    // ---------------------------------------------------------------------
    function findTarget(s, u) {
        const ux = cx(u);
        let best = null, bestD = Infinity;
        s.units.forEach(o => {
            if (o.team === u.team) return;
            const d = Math.abs(cx(o) - ux);
            if (d < u.range && d < bestD) { bestD = d; best = { kind: 'unit', x: cx(o), y: cy(o), obj: o }; }
        });
        if (best) return best;
        const eb = enemyBase(s, u.team);
        if (eb && !u.ai) {
            const d = u.team === 0 ? eb.x - ux : ux - (eb.x + eb.width);
            if (d < u.range) return { kind: 'base', x: cx(eb), y: cy(eb), obj: eb };
        }
        if (u.type === 'tank') {
            let bh = null, bd = u.ai ? 320 : u.range;
            choppers(s).forEach(c => {
                if (c.team === u.team) return;
                const dx = cx(c) - ux, dy = cy(c) - u.y;
                const d = u.ai ? Math.abs(dx) : dist(dx, dy);
                if (d < bd && dy < -10) { bd = d; bh = { kind: 'heli', x: cx(c), y: cy(c), obj: c }; }
            });
            return bh;
        }
        return null;
    }
    function fireAt(s, u, target) {
        const def = UNITS[u.type], ux = cx(u);
        if (u.type === 'soldier') {
            s.shells.push({ team: u.team, x: ux + u.dir * 6, y: u.y + 7, vx: u.dir * 6, vy: 0, width: 5, height: 2, dmg: def.dmg, life: 40, kind: 'rifle' });
            snd(s, 'rifle');
        } else if (target.kind === 'heli') {
            const oy = u.y, dx = target.x - ux, dy = target.y - oy;
            let vx = 0, vy = -5, dmg = u.ai ? 12 : 20;
            if (!u.ai || s.wave >= 2) {
                const mag = dist(dx, dy) || 1, sp = u.ai ? 3.5 + s.wave * 0.3 : 5;
                vx = dx / mag * sp; vy = dy / mag * sp;
            }
            s.shells.push({ team: u.team, x: ux + vx * 2.5, y: oy + vy * 2.5, vx, vy, width: 7, height: 7, dmg, life: 140, kind: 'aa' });
            snd(s, 'enemyShoot');
        } else {
            const dir = target.x < ux ? -1 : 1;
            s.shells.push({ team: u.team, x: ux + dir * 16, y: u.y + 6, vx: dir * 4.5, vy: 0, width: 6, height: 6, dmg: u.ai ? 14 : def.dmg, life: 90, kind: 'shell' });
            snd(s, u.ai ? 'enemyShoot' : 'shell');
        }
    }
    function updateUnits(s) {
        for (let i = s.units.length - 1; i >= 0; i--) {
            const u = s.units[i];
            u.anim++;
            const ux = cx(u);
            if (u.type === 'soldier' && tryEnterHut(s, i)) continue;
            const target = findTarget(s, u);
            if (u.ai && u.type === 'tank') {
                // Patrol
                u.x += u.vx;
                if (u.x < 200 || u.x + u.width > WORLD_WIDTH - 30) u.vx *= -1;
                if (rnd(s) < 0.003) u.vx *= -1;
                u.dir = sign(u.vx);
                u.moving = true;
                const ta = target ? (target.kind === 'heli' ? Math.atan2(target.y - u.y, target.x - ux) : (target.x < ux ? Math.PI : 0)) : -Math.PI / 2;
                u.angle += (ta - u.angle) * 0.1;
                // Run over hostages caught in the open
                s.hostages.forEach(h => { if (h.state === 'running' && Math.abs(h.x - ux) < 14) killHostage(s, h, 'CRUSHED'); });
            } else {
                const dir = marchDir(s, u.team), eb = enemyBase(s, u.team);
                const stopX = eb ? (dir === 1 ? eb.x - 36 - u.width : eb.x + eb.width + 36) : (dir === 1 ? WORLD_WIDTH - 60 : 60);
                if (target) {
                    u.moving = false; u.dir = target.x < ux ? -1 : 1;
                    const ta = Math.atan2(target.y - (u.y + 4), target.x - ux);
                    u.angle += (ta - u.angle) * 0.15;
                } else {
                    u.moving = dir === 1 ? u.x < stopX : u.x > stopX;
                    u.dir = dir;
                    u.angle += ((dir === 1 ? 0 : Math.PI) - u.angle) * 0.15;
                    if (u.moving) u.x = dir === 1 ? Math.min(stopX, u.x + u.speed) : Math.max(stopX, u.x - u.speed);
                }
            }
            u.fireTimer--;
            if (target && u.fireTimer <= 0) {
                fireAt(s, u, target);
                if (u.ai) u.fireTimer = (target.kind === 'heli' ? Math.max(50, 140 - s.wave * 10) + rand(s, 0, 40) : Math.max(45, 120 - s.wave * 8) + rand(s, 0, 30));
                else u.fireTimer = UNITS[u.type].fireRate + rand(s, 0, 15);
            }
            // Tanks crush enemy soldiers
            if (u.type === 'soldier') {
                for (const o of s.units) {
                    if (o.team !== u.team && o.type === 'tank' && overlap(o, u)) { killUnit(s, i, 'CRUSHED'); break; }
                }
            }
        }
        updateGarrisons(s);
        // Solo: enemy base spawns reinforcements until destroyed
        if (s.mode === 'solo') {
            s.tankSpawnTimer++;
            const interval = Math.max(220, 480 - s.wave * 30), eb = s.bases[1];
            if (s.tankSpawnTimer >= interval && !eb.destroyed) {
                s.tankSpawnTimer = 0;
                if (s.units.filter(u => u.ai && u.type === 'tank').length < 3 + s.wave * 2) {
                    s.units.push(makeTank(s, AI, eb.x - 30, -(0.8 + s.wave * 0.15)));
                    parts(s, eb.x - 20, GROUND_Y - 10, 6, { speed: 1, colors: ['#888', '#aaa'], size: 5, life: 30, up: 0.5 });
                }
            }
            // From wave 2 the enemy sends infantry to seize huts and lock their hostages away
            if (s.wave >= 2 && !eb.destroyed && ++s.soldierSpawnTimer >= Math.max(360, 720 - s.wave * 40)) {
                s.soldierSpawnTimer = 0;
                if (s.units.filter(u => u.ai && u.type === 'soldier').length < Math.min(4, s.wave)) {
                    const sol = makeSoldier(s, AI, eb.x - 20, -1); sol.ai = true;
                    s.units.push(sol);
                    text(s, eb.x - 20, GROUND_Y - 50, 'ENEMY INFANTRY', '#f66');
                }
            }
        }
    }
    // A soldier reaching a hut door moves in. Friendly huts fill up to a cap; enemy-held huts are
    // stormed one defender per attacker. Garrisoned soldiers cannot be hurt by anything else.
    function tryEnterHut(s, i) {
        const u = s.units[i], ux = cx(u);
        for (const h of s.huts) {
            if (Math.abs(ux - hutDoor(h)) > 6) continue;
            const g = h.garrison;
            if (!g) {
                h.garrison = { team: u.team, count: 1 };
                text(s, hutDoor(h), GROUND_Y - h.h - 30, 'HUT SECURED', u.ai ? '#f66' : '#8f8');
                snd(s, 'pickup');
            } else if (g.team === u.team) {
                if (g.count >= (u.ai ? GARRISON_CAP.ai : GARRISON_CAP.player)) return false; // full: march on
                g.count++;
            } else {
                g.count--;
                parts(s, hutDoor(h), GROUND_Y - 16, 10, { speed: 2, colors: ['#ff0', '#f80', '#fff'], size: 3, life: 20 });
                snd(s, 'rifle'); snd(s, 'hit');
                if (g.count <= 0) { h.garrison = null; text(s, hutDoor(h), GROUND_Y - h.h - 30, 'HUT CLEARED', u.ai ? '#f66' : '#8f8'); }
                else text(s, hutDoor(h), GROUND_Y - h.h - 30, 'STORMED  ' + g.count + ' LEFT', '#fc6');
            }
            s.units.splice(i, 1);
            return true;
        }
        return false;
    }
    function updateGarrisons(s) {
        s.huts.forEach(h => {
            const g = h.garrison;
            if (!g) return;
            if (h.fireTimer > 0) { h.fireTimer--; return; }
            const door = hutDoor(h);
            let best = null, bestD = GARRISON_RANGE;
            s.units.forEach(u => { if (u.team === g.team) return; const d = Math.abs(cx(u) - door); if (d < bestD) { bestD = d; best = u; } });
            if (!best) return;
            const dir = cx(best) < door ? -1 : 1;
            s.shells.push({ team: g.team, x: door + dir * 10, y: GROUND_Y - h.h + 14, vx: dir * 6, vy: 0.35, width: 5, height: 2, dmg: UNITS.soldier.dmg, life: 40, kind: 'rifle' });
            fx(s, { t: 'p', x: door + dir * 12, y: GROUND_Y - h.h + 14, n: 2, o: { speed: 1.5, colors: ['#ffa'], size: 2, life: 6 } });
            snd(s, 'rifle');
            h.fireTimer = Math.max(18, Math.round(70 / g.count));
        });
    }
    function killUnit(s, i, why, killer) {
        const u = s.units[i];
        if (!u) return;
        if (u.type === 'tank') explosion(s, cx(u), cy(u), false);
        else parts(s, u.x + 4, GROUND_Y - 10, 8, { speed: 2, colors: [u.ai ? '#f88' : '#8c8', '#fff'], size: 3, life: 30, gravity: 0.1 });
        if (u.type === 'tank' && killer) maybeDrop(s, cx(u), u.y, u.ai ? 0.3 : 0.2);
        if (killer) {
            const byPlayerShot = killer.direct;
            const pts = u.ai ? (byPlayerShot ? killer.pts : 50) : (u.type === 'tank' ? 150 : 40);
            const cash = u.ai ? (byPlayerShot ? 30 : 20) : (u.type === 'tank' ? 40 : 10);
            if (byPlayerShot) award(s, killer.player, pts, cx(u), u.y - 10, cash);
            else { killer.player.score += pts; killer.player.credits += cash; text(s, cx(u), u.y - 10, '+' + pts + ' +$' + cash, '#fff'); }
        } else if (!u.ai) {
            text(s, cx(u), u.y - 14, (why ? why + ' - ' : '') + UNITS[u.type].name + ' LOST', '#f88');
        }
        s.units.splice(i, 1);
    }
    // killer: { player, direct: bool, pts } for kills credited to a player
    function damageUnit(s, i, amount, killer, why) {
        const u = s.units[i];
        if (!u) return;
        u.health -= amount;
        parts(s, cx(u), u.y + 8, 3, { speed: 1.5, colors: ['#ff0', '#fff'], size: 2, life: 15 });
        if (u.health <= 0) killUnit(s, i, why, killer);
    }
    function playerByTeam(s, team) { return s.players[team] || null; }
    function dropPickup(s, x, y, type) {
        s.pickups.push({ type, x, y: Math.min(y, GROUND_Y - 14), vy: -1.5, life: 900, bob: 0 });
    }
    function maybeDrop(s, x, y, chance) {
        if (rnd(s) >= chance) return;
        dropPickup(s, x, y, pick(s, ['health', 'bombs', 'credits', 'credits']));
    }
    function updatePickups(s) {
        for (let i = s.pickups.length - 1; i >= 0; i--) {
            const k = s.pickups[i];
            k.vy += 0.15; k.y += k.vy; k.bob++;
            if (k.y > GROUND_Y - 14) { k.y = GROUND_Y - 14; k.vy = 0; }
            if (--k.life <= 0) { s.pickups.splice(i, 1); continue; }
            const box = { x: k.x - 7, y: k.y - 7, width: 14, height: 14 };
            for (const p of s.players) {
                if (!p.alive || !overlap(p, box)) continue;
                const def = PICKUPS[k.type];
                if (k.type === 'health') { p.health = Math.min(p.maxHealth, p.health + def.amount); text(s, cx(p), p.y - 24, '+' + def.amount + ' HULL', def.color); }
                else if (k.type === 'bombs') { p.bombs = MAX_BOMBS; text(s, cx(p), p.y - 24, 'BOMBS REARMED', def.color); }
                else { earn(s, p, def.amount, cx(p), p.y - 24); }
                parts(s, k.x, k.y, 10, { speed: 2, colors: [def.color, '#fff'], size: 3, life: 20 });
                snd(s, 'pickup');
                s.pickups.splice(i, 1);
                break;
            }
        }
    }

    // ---------------------------------------------------------------------
    // AI helicopter (solo)
    // ---------------------------------------------------------------------
    function updateAiHeli(s) {
        const a = s.ai, p = s.players[0], eb = s.bases[1];
        if (!a.alive) {
            if (a.respawn > 0 && !eb.destroyed) { a.respawn--; if (a.respawn === 0) spawnAiHeli(s); }
            return;
        }
        const dx = p.x - a.x, dy = p.y - a.y, d = Math.abs(dx);
        let targetX;
        if (d < 480 && p.alive) {
            targetX = p.x - sign(dx || 1) * 150;
            a.y += clamp(dy, -1.6, 1.6) * 0.8;
        } else {
            const patrolL = eb.x - 320, patrolR = eb.x + 40;
            if (a.x < patrolL) a.patrolDir = 1;
            if (a.x > patrolR) a.patrolDir = -1;
            targetX = a.x + a.patrolDir * 200;
            a.y += (110 + tri(s.frame, 377) * 20 - a.y) * 0.03;
        }
        const desiredVx = clamp((targetX - a.x) * 0.05, -a.speed, a.speed);
        a.vx += (desiredVx - a.vx) * 0.06;
        a.x += a.vx;
        a.x = clamp(a.x, 150, WORLD_WIDTH - a.width);
        a.y = clamp(a.y, 26, GROUND_Y - 70);
        if (Math.abs(a.vx) > 0.3) a.dir = a.vx < 0 ? -1 : 1;
        a.tilt += ((a.vx / a.speed) * 0.2 - a.tilt) * 0.1;
        a.shootCooldown--;
        if (a.shootCooldown <= 0 && d < (a.boss ? 460 : 380) && p.alive) {
            const sx = cx(a), sy = cy(a), tx = cx(p) + p.vx * 10, ty = cy(p);
            const mag = dist(tx - sx, ty - sy) || 1;
            if (a.boss && a.burst > 0) {
                // Rocket salvo: slower, heavier, slightly spread
                a.burst--;
                const sp = 4.5, spread = (a.burst - 1) * 0.08;
                const vx = (tx - sx) / mag * sp, vy = (ty - sy) / mag * sp;
                s.shells.push({ team: AI, x: sx + a.dir * 20, y: sy + 8, vx: vx - vy * spread, vy: vy + vx * spread, width: 9, height: 9, dmg: 30, life: 160, kind: 'rocket' });
                a.shootCooldown = a.burst > 0 ? 7 : Math.max(60, 120 - s.wave * 5);
                snd(s, 'bomb');
            } else {
                const sp = 6;
                s.shells.push({ team: AI, x: sx, y: sy, vx: (tx - sx) / mag * sp, vy: (ty - sy) / mag * sp, width: 7, height: 7, dmg: 18, life: 200, kind: 'heli' });
                a.shootCooldown = Math.max(35, 75 - s.wave * 5);
                if (a.boss && rnd(s) < 0.5) { a.burst = 3; a.shootCooldown = 20; }
                snd(s, 'enemyShoot');
            }
        }
        if (a.health < a.maxHealth * 0.35 && s.frame % 5 === 0) parts(s, cx(a) + rand(s, -6, 6), a.y + 6, 1, { speed: 0.3, colors: ['#444'], size: 5, life: 40, up: 0.8 });
    }
    function damageChopper(s, c, amount, by, why) {
        // c is a player or the AI heli; `by` is the player responsible (or null)
        if (c.team === AI) {
            const a = s.ai;
            if (!a.alive) return;
            a.health -= amount;
            parts(s, cx(a), cy(a), 5, { speed: 2, colors: ['#ff0', '#fff'], size: 3, life: 18 });
            if (a.health <= 0) {
                a.alive = false;
                a.respawn = Math.max(420, 1000 - s.wave * 80) * (a.boss ? 2 : 1);
                explosion(s, cx(a), cy(a), true);
                if (a.boss) { explosion(s, cx(a) - 30, cy(a) + 10, false); explosion(s, cx(a) + 30, cy(a) - 10, false); }
                if (by) { award(s, by, a.boss ? 1500 : 500, cx(a), a.y - 20, 0, true); earn(s, by, a.boss ? 300 : 120, cx(a), a.y - 40); }
                dropPickup(s, cx(a), cy(a), 'credits');
                if (a.boss) { dropPickup(s, cx(a) - 30, cy(a), 'health'); dropPickup(s, cx(a) + 30, cy(a), 'bombs'); }
                else maybeDrop(s, cx(a) + 20, cy(a), 0.5);
            }
        } else damagePlayer(s, c, amount, why);
    }

    // ---------------------------------------------------------------------
    // Bases
    // ---------------------------------------------------------------------
    function damageBase(s, b, amount, x, y, by) {
        if (b.destroyed) return;
        b.health -= amount;
        parts(s, x, y, 4, { speed: 2, colors: ['#ff0', '#999'], size: 3, life: 18 });
        if (b.health <= 0) {
            b.health = 0; b.destroyed = true;
            explosion(s, cx(b), cy(b), true);
            explosion(s, cx(b) - 40, cy(b) + 10, false);
            explosion(s, cx(b) + 40, cy(b) + 10, false);
            fx(s, { t: 'shake', v: 18 });
            if (s.mode === 'solo') {
                const p = s.players[0];
                p.score += 1000; earn(s, p, 300);
                text(s, cx(b), b.y - 40, 'ENEMY BASE DESTROYED +1000 +$300', '#ff0', true);
                text(s, cx(p), p.y - 30, 'ENEMY BASE DESTROYED!', '#ff0', true);
            } else {
                const winner = s.players.find(p => p.team !== b.team);
                winner.score += 2000;
                endMatch(s, winner.id, 'BASE DESTROYED');
            }
        }
    }
    function endMatch(s, winner, reason) {
        if (s.status === 'over') return;
        s.status = 'over'; s.statusTimer = 0; s.winner = winner; s.endReason = reason;
        snd(s, 'dropoff');
    }

    // ---------------------------------------------------------------------
    // Projectiles
    // ---------------------------------------------------------------------
    function explodeBomb(s, b, x, y) {
        explosion(s, x, y, false);
        const owner = playerByTeam(s, b.team);
        for (let i = s.units.length - 1; i >= 0; i--) {
            const u = s.units[i];
            if (dist(cx(u) - x, cy(u) - y) < (u.team === b.team ? 44 : 48)) {
                if (u.team === b.team) damageUnit(s, i, 60, null, 'FRIENDLY FIRE');
                else damageUnit(s, i, u.ai ? 999 : 80, owner ? { player: owner, direct: true, pts: 150 } : null);
            }
        }
        choppers(s).forEach(c => {
            if (c.team === b.team) { if (dist(cx(c) - x, cy(c) - y) < 45) damagePlayer(s, c, 20, 'TOO LOW'); }
            else if (dist(cx(c) - x, cy(c) - y) < 50) damageChopper(s, c, 90, owner, 'BOMBED');
        });
        s.hostages.forEach(h => { if ((h.state === 'waiting' || h.state === 'running') && Math.abs(h.x - x) < 30) killHostage(s, h, 'FRIENDLY FIRE'); });
        const eb = enemyBase(s, b.team);
        if (eb && dist(cx(eb) - x, cy(eb) - y) < 80) damageBase(s, eb, 60, x, y, owner);
    }
    function updateProjectiles(s) {
        // Machine-gun bullets
        for (let i = s.bullets.length - 1; i >= 0; i--) {
            const b = s.bullets[i], owner = playerByTeam(s, b.team);
            b.x += b.vx; b.life--;
            let hit = b.life <= 0 || b.x < 0 || b.x > WORLD_WIDTH;
            if (!hit) for (let j = s.units.length - 1; j >= 0; j--) {
                const u = s.units[j];
                if (u.team !== b.team && overlap(u, b)) { damageUnit(s, j, u.ai || u.type === 'soldier' ? 999 : 20, owner ? { player: owner, direct: true, pts: 100 } : null); hit = true; break; }
            }
            if (!hit) for (const c of choppers(s)) {
                if (c.team !== b.team && overlap(c, b)) { damageChopper(s, c, UPGRADES.gun.dmg[owner ? owner.upgrades.gun : 0], owner); hit = true; break; }
            }
            if (!hit && s.mode === 'versus') { const eb = enemyBase(s, b.team); if (eb && overlap(eb, b)) { damageBase(s, eb, 3, b.x, b.y, owner); hit = true; } }
            if (hit) s.bullets.splice(i, 1);
        }
        // Shells: tank/soldier/AI-heli fire
        for (let i = s.shells.length - 1; i >= 0; i--) {
            const b = s.shells[i], owner = playerByTeam(s, b.team);
            b.x += b.vx; b.y += b.vy; b.life--;
            let gone = b.life <= 0 || b.x < 0 || b.x > WORLD_WIDTH || b.y < -10;
            if (b.y >= GROUND_Y) { gone = true; parts(s, b.x, GROUND_Y, 3, { speed: 1, colors: ['#a86'], size: 2, life: 15, up: 1 }); }
            const box = { x: b.x - b.width / 2, y: b.y - b.height / 2, width: b.width, height: b.height };
            if (!gone) for (const c of choppers(s)) {
                if (c.team !== b.team && overlap(c, box)) { damageChopper(s, c, b.dmg, owner); gone = true; break; }
            }
            if (!gone) for (let j = s.units.length - 1; j >= 0; j--) {
                const u = s.units[j];
                if (u.team !== b.team && overlap(u, box)) { damageUnit(s, j, b.dmg, owner ? { player: owner, direct: false } : null); gone = true; break; }
            }
            if (!gone && b.kind !== 'heli' && b.kind !== 'aa' && b.kind !== 'rocket') { const eb = enemyBase(s, b.team); if (eb && overlap(eb, box)) { damageBase(s, eb, b.dmg, b.x, b.y, owner); gone = true; } }
            if (gone) {
                if (b.kind === 'shell' && b.y < GROUND_Y + 1) parts(s, b.x, Math.min(b.y, GROUND_Y), 5, { speed: 1.5, colors: ['#ff0', '#f80'], size: 3, life: 15 });
                s.shells.splice(i, 1);
            }
        }
        // Bombs
        for (let i = s.bombs.length - 1; i >= 0; i--) {
            const b = s.bombs[i];
            b.vy += 0.28; b.x += b.vx; b.y += b.vy;
            let boom = b.y >= GROUND_Y - 4;
            const box = { x: b.x - 6, y: b.y - 6, width: 12, height: 12 };
            if (!boom && s.units.some(u => u.team !== b.team && overlap(u, box))) boom = true;
            if (!boom && choppers(s).some(c => c.team !== b.team && overlap(c, box))) boom = true;
            if (boom) { s.bombs.splice(i, 1); explodeBomb(s, b, b.x, Math.min(b.y, GROUND_Y - 4)); }
        }
    }

    // ---------------------------------------------------------------------
    // Collisions & progression
    // ---------------------------------------------------------------------
    function checkCollisions(s) {
        s.players.forEach(p => {
            if (!p.alive) return;
            for (const u of s.units) {
                if (u.team !== p.team && u.type === 'tank' && overlap(p, u)) { damagePlayer(s, p, 30, 'COLLISION'); p.vy = -3; break; }
            }
            choppers(s).forEach(c => {
                if (c === p || c.team === p.team || c.id < p.id) return; // handle each pair once
                if (overlap(p, c)) {
                    damagePlayer(s, p, 50, 'COLLISION');
                    damageChopper(s, c, c.team === AI ? 60 : 50, null, 'COLLISION');
                    p.vx = -sign(c.x - p.x) * 4;
                    if (c.team !== AI) c.vx = sign(c.x - p.x) * 4;
                }
            });
        });
    }
    function checkWaveClear(s) {
        if (s.hostages.length === 0) return;
        const p = s.players[0];
        if (s.hostages.every(h => h.state === 'saved' || h.state === 'dead') && p.carrying === 0) {
            s.waveBonus = s.waveRescued * 50 * s.wave + (s.waveLost === 0 ? 500 : 0);
            p.score += s.waveBonus;
            earn(s, p, 100 + (s.waveLost === 0 ? 100 : 0));
            s.status = 'waveclear'; s.statusTimer = 0;
            snd(s, 'dropoff');
        }
    }

    // ---------------------------------------------------------------------
    // Step
    // ---------------------------------------------------------------------
    const EMPTY = { l: 0, r: 0, u: 0, d: 0, f: 0, b: 0, buy: null };
    function step(s, inputs) {
        s.fx = [];
        s.frame++;
        if (s.status === 'playing') {
            s.players.forEach((p, i) => updatePlayer(s, p, (inputs && inputs[i]) || EMPTY));
            updateHostages(s);
            updateUnits(s);
            if (s.mode === 'solo') updateAiHeli(s);
            updateProjectiles(s);
            updatePickups(s);
            checkCollisions(s);
            if (s.mode === 'solo') checkWaveClear(s);
        } else if (s.status === 'dying') {
            s.statusTimer++;
            const p = s.players[0];
            updateDyingPlayer(s, p);
            if (p.respawn > 120) { s.status = 'over'; s.statusTimer = 0; s.endReason = 'CHOPPER DOWN'; }
        } else if (s.status === 'waveclear') {
            s.statusTimer++;
            if (s.statusTimer === 180) { setupWave(s, s.wave + 1); s.status = 'playing'; s.statusTimer = 0; }
        } else {
            s.statusTimer++;
        }
        return s;
    }

    // Cheap state fingerprint for desync detection between lockstep peers.
    function hash(s) {
        let h = 2166136261;
        const mix = v => { const n = Math.round(v * 1000) | 0; h ^= n; h = Math.imul(h, 16777619); };
        mix(s.frame); mix(s.rs);
        s.players.forEach(p => { mix(p.x); mix(p.y); mix(p.health); mix(p.credits); mix(p.score); mix(p.carrying); });
        s.bases.forEach(b => mix(b.health));
        s.units.forEach(u => { mix(u.x); mix(u.health); });
        mix(s.hostages.length); mix(s.bullets.length); mix(s.shells.length); mix(s.pickups.length);
        s.huts.forEach(h => mix(h.garrison ? h.garrison.team * 10 + h.garrison.count : -5));
        return h >>> 0;
    }

    return { createGame, step, hash, upgradeCost, UNITS, UPGRADES, PICKUPS, BOSS_EVERY, WORLD_WIDTH, GROUND_Y, MAX_CARRY, MAX_BOMBS, MAX_ALLIES, GARRISON_CAP, AI, EMPTY };
});
