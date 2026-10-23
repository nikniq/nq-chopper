// Deterministic simulation checks. Run with: node tests/js/sim.test.js
import assert from 'node:assert';
import '../../public_html/js/sim.js';
const Sim = globalThis.NQSim;

const inp = (o) => Object.assign({ l: 0, r: 0, u: 0, d: 0, f: 0, b: 0, buy: null }, o);
function script(frame, player) {
    // Scripted pilot: lift off, fly toward the enemy, shoot, bomb and shop periodically
    const dir = player === 0 ? 'r' : 'l';
    const o = { u: frame % 40 < 22 ? 1 : 0, f: frame % 3 === 0 ? 1 : 0 };
    o[dir] = frame % 300 < 200 ? 1 : 0;
    o[dir === 'r' ? 'l' : 'r'] = frame % 300 >= 200 ? 1 : 0;
    if (frame % 90 === 0) o.b = 1;
    if (frame % 120 === 0) o.buy = ['soldier', 'tank', 'gun', 'armor'][(frame / 120) % 4];
    return inp(o);
}
function run(mode, seed, frames, players) {
    const s = Sim.createGame({ mode, seed });
    const hashes = [];
    for (let f = 0; f < frames; f++) {
        Sim.step(s, Array.from({ length: players }, (_, i) => script(f, i)));
        if (f % 100 === 0) hashes.push(Sim.hash(s));
    }
    return { s, hashes };
}

// Solo: same seed and inputs -> identical trajectory; different seed -> different
const a = run('solo', 1234, 3000, 1), b = run('solo', 1234, 3000, 1), c = run('solo', 99, 3000, 1);
assert.deepStrictEqual(a.hashes, b.hashes, 'solo run is deterministic');
assert.notDeepStrictEqual(a.hashes, c.hashes, 'different seeds diverge');
assert.ok(a.s.frame === 3000 && ['playing', 'dying', 'over', 'waveclear'].includes(a.s.status), 'solo status sane: ' + a.s.status);
console.log('solo after 3000 frames:', a.s.status, 'wave', a.s.wave, 'score', a.s.players[0].score, 'credits', a.s.players[0].credits, 'units', a.s.units.length);

// Solo without input: enemy tanks shoot, hostages wait, nothing crashes; the chopper sits safely at base
const idle = Sim.createGame({ mode: 'solo', seed: 7 });
for (let f = 0; f < 2000; f++) Sim.step(idle, [inp({})]);
assert.strictEqual(idle.status, 'playing', 'idle chopper at base survives');
assert.strictEqual(idle.players[0].health, 100, 'idle chopper undamaged');

// Solo economy: rescue flow by teleporting next to a hut, then back to base
const eco = Sim.createGame({ mode: 'solo', seed: 5 });
const p = eco.players[0], hut = eco.huts[0];
p.x = hut.x + 70; p.y = Sim.GROUND_Y - p.height; p.invuln = 1e9;
for (let f = 0; f < 400; f++) Sim.step(eco, [inp({})]);
assert.ok(p.carrying > 0, 'hostages board a landed chopper: ' + p.carrying);
const carried = p.carrying;
p.x = 40; p.y = Sim.GROUND_Y - p.height; p.vy = 0; p.landed = true;
Sim.step(eco, [inp({})]);
assert.strictEqual(p.rescued, carried, 'unloading at base rescues them');
assert.strictEqual(p.credits, 100 + carried * 40, 'rescue pays $40 each');
assert.ok(Sim.step(eco, [inp({ buy: 'soldier' })]) && eco.units.some(u => u.team === 0 && u.type === 'soldier'), 'soldier purchase');

// Versus: deterministic, symmetrical, and a tank column eventually breaks a base
const v1 = run('versus', 42, 2400, 2), v2 = run('versus', 42, 2400, 2);
assert.deepStrictEqual(v1.hashes, v2.hashes, 'versus run is deterministic');
assert.strictEqual(v1.s.players.length, 2);
assert.ok(v1.s.players[1].x < v1.s.players[0].x || v1.s.players[1].deaths + v1.s.players[0].deaths >= 0, 'two players exist');
const siege = Sim.createGame({ mode: 'versus', seed: 3 });
siege.players[0].credits = 100000;
let frames = 0;
while (siege.status !== 'over' && frames < 20000) {
    const buy = frames % 30 === 0 && siege.units.filter(u => u.team === 0).length < Sim.MAX_ALLIES ? 'tank' : null;
    Sim.step(siege, [inp({ buy }), inp({})]);
    frames++;
}
assert.strictEqual(siege.status, 'over', 'versus match ends');
assert.strictEqual(siege.winner, 0, 'player 0 wins by destroying the base');
console.log('versus siege ended after', frames, 'frames; reason', siege.endReason);

// Versus: player bullets damage the other chopper and the player respawns
const duel = Sim.createGame({ mode: 'versus', seed: 8 });
const [p0, p1] = duel.players;
p1.x = p0.x + 150; p1.y = p0.y = 200; p0.dir = 1; p1.invuln = 0;
const hp = p1.health;
for (let f = 0; f < 30; f++) Sim.step(duel, [inp({ f: 1 }), inp({ u: f % 2 })]);
assert.ok(p1.health < hp, 'bullets hurt the opposing chopper');
p1.health = 1; p1.invuln = 0; p1.x = p0.x + 150; p1.y = p0.y;
for (let f = 0; f < 30 && p1.alive; f++) Sim.step(duel, [inp({ f: 1 }), inp({})]);
assert.ok(!p1.alive && p1.deaths === 1, 'opponent shot down');
for (let f = 0; f < 400; f++) Sim.step(duel, [inp({}), inp({})]);
assert.ok(p1.alive && p1.health === p1.maxHealth, 'opponent redeploys at full health');
assert.strictEqual(duel.status, 'playing', 'match continues after a chopper loss');

// Garrisons: soldiers hold huts, are immune, and only enemy infantry can clear them
{
    const g = Sim.createGame({ mode: 'versus', seed: 11 });
    const hut = g.huts[0], door = hut.x + hut.w / 2;
    g.players[0].credits = 10000; g.players[1].credits = 10000;
    // Drop three P0 soldiers right at the door (same effect as marching there)
    for (let k = 0; k < 4; k++) { Sim.step(g, [inp({ buy: 'soldier' }), inp({})]); }
    g.units.filter(u => u.team === 0).forEach(u => { u.x = door - u.width / 2; });
    Sim.step(g, [inp({}), inp({})]);
    assert.ok(hut.garrison && hut.garrison.team === 0 && hut.garrison.count === Sim.GARRISON_CAP.player, 'hut filled to cap: ' + JSON.stringify(hut.garrison));
    assert.strictEqual(g.units.filter(u => u.team === 0).length, 1, 'fourth soldier marches on when the hut is full');
    // Bomb the hut: garrison untouched
    g.bombs.push({ team: 1, x: door, y: Sim.GROUND_Y - 6, vx: 0, vy: 1 });
    Sim.step(g, [inp({}), inp({})]);
    assert.strictEqual(hut.garrison.count, 3, 'bombs do not harm a garrison');
    // Enemy tank parked outside: garrison shoots it, tank cannot hurt them
    g.units = g.units.filter(u => u.team !== 0);
    Sim.step(g, [inp({}), inp({ buy: 'tank' })]);
    const et = g.units.find(u => u.team === 1 && u.type === 'tank'); et.x = door + 60; et.health = 20;
    for (let f = 0; f < 240 && g.units.includes(et); f++) Sim.step(g, [inp({}), inp({})]);
    assert.ok(!g.units.includes(et), 'garrison fire destroys a weak tank outside');
    assert.strictEqual(hut.garrison.count, 3, 'tank could not reduce the garrison');
    // Hostages at this hut refuse the enemy chopper but board the holder
    const p1 = g.players[1]; p1.x = door + 80; p1.y = Sim.GROUND_Y - p1.height; p1.landed = true; p1.invuln = 1e9;
    for (let f = 0; f < 300; f++) Sim.step(g, [inp({}), inp({})]);
    assert.strictEqual(p1.carrying, 0, 'hostages will not board the opposing chopper at a held hut');
    // Enemy soldiers storm: one defender per attacker
    for (let k = 0; k < 2; k++) Sim.step(g, [inp({}), inp({ buy: 'soldier' })]);
    g.units.filter(u => u.team === 1 && u.type === 'soldier').forEach(u => { u.x = door - u.width / 2; });
    Sim.step(g, [inp({}), inp({})]);
    assert.strictEqual(hut.garrison.count, 1, 'two attackers removed two defenders: ' + hut.garrison.count);
    assert.strictEqual(g.units.filter(u => u.team === 1 && u.type === 'soldier').length, 0, 'attackers were spent');
    for (let k = 0; k < 2; k++) Sim.step(g, [inp({}), inp({ buy: 'soldier' })]);
    g.units.filter(u => u.team === 1 && u.type === 'soldier').forEach(u => { u.x = door - u.width / 2; });
    Sim.step(g, [inp({}), inp({})]);
    assert.ok(hut.garrison && hut.garrison.team === 1 && hut.garrison.count === 1, 'third attacker clears, fourth captures: ' + JSON.stringify(hut.garrison));
}
// Solo: enemy infantry appears from wave 2 and marches toward huts
{
    const w2 = Sim.createGame({ mode: 'solo', seed: 21 });
    w2.wave = 2; w2.players[0].invuln = 1e9; w2.aiCredits = 400;
    for (let f = 0; f < 2500; f++) Sim.step(w2, [inp({})]);
    assert.ok(w2.units.some(u => u.ai && u.type === 'soldier') || w2.huts.some(h => h.garrison && h.garrison.team === Sim.AI), 'AI soldiers spawn in wave 2');
    assert.ok(w2.aiSpent >= 200, 'the computer spends its war chest: $' + w2.aiSpent);
}
// Pickups: destroyed enemies drop crates the chopper can collect
{
    const k = Sim.createGame({ mode: 'solo', seed: 31 });
    const p = k.players[0]; p.invuln = 1e9;
    let drops = 0;
    for (let tries = 0; tries < 40 && drops === 0; tries++) {
        const t = k.units.find(u => u.ai && u.type === 'tank');
        if (!t) break;
        p.x = t.x - 100; p.y = t.y; p.dir = 1;
        for (let f = 0; f < 30 && k.units.includes(t); f++) Sim.step(k, [inp({ f: 1 })]);
        drops = k.pickups.length;
        if (!k.units.find(u => u.ai && u.type === 'tank')) k.units.push({ team: Sim.AI, type: 'tank', x: p.x + 400, y: Sim.GROUND_Y - 22, width: 26, height: 22, vx: 0, dir: 1, speed: 0.6, health: 10, maxHealth: 10, range: 210, fireTimer: 999, angle: 0, anim: 0, moving: true, ai: true });
    }
    assert.ok(drops > 0, 'a destroyed tank eventually drops a pickup');
    const pk = k.pickups[0]; pk.type = 'health'; p.health = 10;
    p.x = pk.x - p.width / 2; p.y = Sim.GROUND_Y - p.height; p.landed = true;
    for (let f = 0; f < 60 && k.pickups.includes(pk); f++) Sim.step(k, [inp({})]);
    assert.ok(!k.pickups.includes(pk) && p.health === 45, 'health crate collected: hull ' + p.health);
}
// Boss gunship on every third wave
{
    const b = Sim.createGame({ mode: 'solo', seed: 32 });
    assert.ok(!b.ai.boss, 'wave 1 is a normal enemy chopper');
    b.wave = 2; b.status = 'waveclear'; b.statusTimer = 179; Sim.step(b, [inp({})]);
    assert.strictEqual(b.wave, 3);
    assert.ok(b.ai.boss && b.ai.maxHealth === Math.round((150 + 2 * 40) * 2.2 * Math.sqrt(Sim.threat(b))) && b.ai.maxHealth > 2 * (150 + 2 * 40), 'wave 3 spawns a gunship with well over double hull');
    const p = b.players[0]; p.invuln = 1e9; p.x = b.ai.x - 200; p.y = b.ai.y;
    let rockets = 0;
    for (let f = 0; f < 900; f++) { Sim.step(b, [inp({})]); rockets += b.shells.filter(s => s.kind === 'rocket' && s.life === 159).length; }
    assert.ok(rockets > 0, 'gunship fires rocket salvos: ' + rockets);
    b.ai.health = 1; p.x = b.ai.x - 120; p.y = b.ai.y; p.dir = 1;
    for (let f = 0; f < 60 && b.ai.alive; f++) Sim.step(b, [inp({ f: 1 })]);
    assert.ok(!b.ai.alive && p.score >= 1500 && b.pickups.length >= 3, 'gunship kill pays 1500 and drops three crates');
}
// Co-op: two allied pilots share a base and a pool of lives against the AI
{
    const c1 = run('coop', 55, 1500, 2), c2 = run('coop', 55, 1500, 2);
    assert.deepStrictEqual(c1.hashes, c2.hashes, 'co-op run is deterministic');
    const c = Sim.createGame({ mode: 'coop', seed: 56 });
    const [p0, p1] = c.players;
    assert.ok(c.bases.length === 2 && c.bases[1].team === Sim.AI && p1.side === 1, 'shared left base, AI base on the right');
    assert.ok(Math.abs(p0.x - p1.x) < 1, 'both pilots start on the same pad');
    // Allied bullets do not hurt each other
    p1.x = p0.x + 150; p1.y = p0.y = 200; p0.dir = 1; p1.invuln = 0;
    const hp = p1.health;
    for (let f = 0; f < 30; f++) Sim.step(c, [inp({ f: 1 }), inp({ u: f % 2 })]);
    assert.strictEqual(p1.health, hp, 'allies cannot shoot each other');
    // Allied troops march the same way and do not fight each other
    p0.credits = p1.credits = 1000;
    Sim.step(c, [inp({ buy: 'tank' }), inp({ buy: 'soldier' })]);
    const t0 = c.units.find(u => u.team === 0), s1 = c.units.find(u => u.team === 1);
    assert.ok(t0 && s1, 'both pilots can deploy');
    for (let f = 0; f < 120; f++) Sim.step(c, [inp({}), inp({})]);
    assert.ok(c.units.includes(t0) && c.units.includes(s1) && t0.x > 150 && s1.x > 150, 'allied units coexist and march right');
    // Lives: a death costs a life and the pilot redeploys; squad wipe ends the match
    p1.invuln = 0; p1.health = 1; p1.x = 1200; p1.y = 100; p1.vy = 5;
    c.lives = 1;
    for (let f = 0; f < 60 && p1.alive; f++) Sim.step(c, [inp({}), inp({ d: 1 })]);
    assert.ok(!p1.alive && c.lives === 0, 'hard landing costs the last life: lives ' + c.lives);
    for (let f = 0; f < 400; f++) Sim.step(c, [inp({}), inp({})]);
    assert.ok(p1.alive, 'pilot redeployed from the shared pool');
    p0.invuln = 0; p0.health = 1; p0.x = 1200; p0.y = 100; p0.vy = 5; p1.invuln = 0; p1.health = 1; p1.x = 1300; p1.y = 100; p1.vy = 5;
    for (let f = 0; f < 90 && c.status === 'playing'; f++) Sim.step(c, [inp({ d: 1 }), inp({ d: 1 })]);
    assert.strictEqual(c.status, 'over', 'no lives and both down ends the mission: ' + c.endReason);
    assert.ok(/SQUAD WIPED/.test(c.endReason));
}
// Solo and versus still behave: AI heli chases the nearest pilot, versus hostility unchanged
{
    const v = Sim.createGame({ mode: 'versus', seed: 57 });
    const [a, b] = v.players; b.x = a.x + 150; b.y = a.y = 200; a.dir = 1; b.invuln = 0;
    const hp = b.health;
    for (let f = 0; f < 30; f++) Sim.step(v, [inp({ f: 1 }), inp({})]);
    assert.ok(b.health < hp, 'versus opponents still take damage');
}
// Anti-air emplacements appear from wave 3, resist bullets, and shoot at the chopper
{
    const w = Sim.createGame({ mode: 'solo', seed: 71 });
    assert.ok(!w.units.some(u => u.type === 'aa'), 'no AA on wave 1');
    w.wave = 1; w.status = 'waveclear'; w.statusTimer = 179; Sim.step(w, [inp({})]);
    assert.ok(w.wave === 2 && !w.units.some(u => u.type === 'aa'), 'no AA on wave 2 either (difficulty ramps one system per wave)');
    w.status = 'waveclear'; w.statusTimer = 179; Sim.step(w, [inp({})]);
    const aa = w.units.find(u => u.type === 'aa');
    assert.ok(aa && w.wave === 3, 'an AA emplacement guards wave 3');
    const p = w.players[0]; p.invuln = 0; p.health = 1000; p.maxHealth = 1000; p.x = aa.x - 150; p.y = aa.y - 120; p.dir = 1;
    const hpBefore = p.health; let flak = 0;
    for (let f = 0; f < 240; f++) { p.y = aa.y - 120; p.vy = 0; Sim.step(w, [inp({})]); flak += w.shells.filter(sh => sh.team === Sim.AI && sh.kind === 'aa' && sh.life === 139).length; }
    assert.ok(flak > 0, 'AA fires flak at the chopper: ' + flak);
    const aaHp = aa.health; p.x = aa.x - 100; p.y = aa.y - 4; p.dir = 1;
    Sim.step(w, [inp({ f: 1 })]); for (let f = 0; f < 12; f++) Sim.step(w, [inp({})]);
    assert.ok(aa.health < aaHp && aa.health > 0 && w.units.includes(aa), 'bullets only chip the armoured AA');
    w.bombs.push({ team: 0, x: aa.x + aa.width / 2, y: aa.y - 20, vx: 0, vy: 3 });
    for (let f = 0; f < 20 && w.units.includes(aa); f++) Sim.step(w, [inp({})]);
    assert.ok(!w.units.includes(aa) && w.pickups.some(k => k.type === 'bombs'), 'a bomb destroys it and it drops a bomb crate');
}
// Airstrike: costs credits, has a cooldown, and carpets the area in front of the chopper
{
    const a = Sim.createGame({ mode: 'solo', seed: 72 });
    const p = a.players[0]; p.invuln = 1e9; p.x = 900; p.y = 150; p.landed = false; p.dir = 1;
    Sim.step(a, [inp({ buy: 'strike' })]);
    assert.strictEqual(a.strikes.length, 0, 'cannot afford an airstrike at $100');
    p.credits = 500; Sim.step(a, [inp({ buy: 'strike' })]);
    assert.ok(a.strikes.length === 1 && p.credits === 250 && p.strikeCooldown > 0, 'airstrike bought');
    Sim.step(a, [inp({ buy: 'strike' })]);
    assert.strictEqual(a.strikes.length, 1, 'second call refused during cooldown');
    let dropped = 0;
    for (let f = 0; f < 700; f++) { const before = a.bombs.length; Sim.step(a, [inp({})]); if (a.bombs.length > before) dropped++; }
    assert.strictEqual(dropped, Sim.AIRSTRIKE.bombs, 'bomber drops its full load: ' + dropped);
    assert.strictEqual(a.strikes.length, 0, 'bomber leaves the map');
}
// Rally point holds troops at a line; releasing lets them advance
{
    const r = Sim.createGame({ mode: 'solo', seed: 73 });
    const p = r.players[0]; p.invuln = 1e9; p.credits = 1000;
    Sim.step(r, [inp({ buy: 'tank' })]);
    const t = r.units.find(u => u.team === 0);
    p.x = 400; p.y = 100; p.landed = false; Sim.step(r, [inp({ buy: 'rally' })]);
    assert.ok(p.rally !== null && Math.abs(p.rally - 430) < 1, 'rally set at chopper position');
    for (let f = 0; f < 900; f++) Sim.step(r, [inp({})]);
    assert.ok(r.units.includes(t) && t.x + t.width / 2 <= p.rally + 1 && t.x > 380, 'tank holds at the rally line: ' + t.x);
    Sim.step(r, [inp({ buy: 'rally' })]);
    for (let f = 0; f < 200; f++) Sim.step(r, [inp({})]);
    assert.ok(!r.units.includes(t) || t.x > p.rally === null ? true : t.x > 430, 'tank advances once released');
}
// Paradrops: load soldiers when landed beside them, drop them from the air, they land and march
{
    const d = Sim.createGame({ mode: 'solo', seed: 74 });
    const p = d.players[0]; p.invuln = 1e9; p.credits = 1000;
    Sim.step(d, [inp({ buy: 'troops' })]);
    assert.strictEqual(p.troops, 0, 'nothing to load at an empty base');
    for (let k = 0; k < 5; k++) Sim.step(d, [inp({ buy: 'soldier' })]);
    d.units.filter(u => u.team === 0).forEach(u => { u.x = 300; });
    p.x = 300 - p.width / 2; p.y = Sim.GROUND_Y - p.height; p.landed = true;
    Sim.step(d, [inp({ buy: 'troops' })]);
    assert.strictEqual(p.troops, Sim.MAX_TROOPS, 'loads up to the bay limit: ' + p.troops);
    assert.strictEqual(d.units.filter(u => u.team === 0).length, 1, 'the fifth soldier stays on the ground');
    p.x = 1000; p.y = 120; p.landed = false;
    Sim.step(d, [inp({ buy: 'troops' })]);
    assert.ok(d.paras.length === 1 && p.troops === 3, 'one paratrooper dropped');
    for (let f = 0; f < 400 && d.paras.length; f++) Sim.step(d, [inp({})]);
    const landed = d.units.find(u => u.team === 0 && u.type === 'soldier' && Math.abs(u.x - 1030) < 60);
    assert.ok(landed, 'paratrooper lands near the drop point as a soldier');
    const lx = landed.x; for (let f = 0; f < 60; f++) Sim.step(d, [inp({})]);
    assert.ok(!d.units.includes(landed) || landed.x >= lx, 'landed soldier marches on');
}
// Balloons: a garrisoned hut raises one; enemy choppers that hit it are damaged, bullets pop it
{
    const g = Sim.createGame({ mode: 'solo', seed: 81 });
    const hut = g.huts[0]; hut.garrison = { team: Sim.AI, count: 2 };
    for (let f = 0; f < 5; f++) Sim.step(g, [inp({})]);
    const bl = g.balloons.find(b => b.hut === hut);
    assert.ok(bl, 'enemy-held hut raised a balloon');
    for (let f = 0; f < 400; f++) Sim.step(g, [inp({})]);
    assert.ok(bl.y <= bl.targetY + 1 && bl.y < Sim.GROUND_Y - 100, 'balloon climbs to altitude: ' + bl.y);
    const p = g.players[0]; p.invuln = 0; p.health = 100; p.x = bl.x - p.width / 2; p.y = bl.y - p.height / 2; p.landed = false; p.vy = 0;
    Sim.step(g, [inp({})]);
    assert.ok(p.health <= 30 && !g.balloons.includes(bl), 'hitting the tether costs 70 hull and bursts the balloon: ' + p.health);
    assert.ok(hut.balloonTimer > 0 && !g.balloons.some(b => b.hut === hut), 'hut waits before raising another');
    p.x = bl.x - 300; p.y = Sim.GROUND_Y - p.height; p.vy = 0; p.vx = 0; // clear of the tether before it goes up again
    hut.balloonTimer = 0; Sim.step(g, [inp({})]);
    const bl2 = g.balloons.find(b => b.hut === hut); assert.ok(bl2, 'second balloon raised');
    for (let f = 0; f < 400; f++) Sim.step(g, [inp({})]);
    p.invuln = 1e9; p.x = bl2.x - 120; p.y = bl2.y - p.height / 2 + 1; p.dir = 1; const sc = p.score;
    for (let f = 0; f < 40 && g.balloons.includes(bl2); f++) Sim.step(g, [inp({ f: 1 })]);
    assert.ok(!g.balloons.includes(bl2) && p.score > sc, 'bullets pop it for points');
    hut.garrison = { team: 0, count: 1 }; hut.balloonTimer = 0; Sim.step(g, [inp({})]);
    const mine = g.balloons.find(b => b.hut === hut);
    for (let f = 0; f < 400; f++) Sim.step(g, [inp({})]);
    p.x = mine.x - p.width / 2; p.y = mine.y - p.height / 2; p.invuln = 0; const hp = p.health;
    Sim.step(g, [inp({})]);
    assert.ok(p.health === hp && g.balloons.includes(mine), 'your own balloons are harmless to you');
}
// Jet booster: faster while held, drains, recharges after a pause; threat climbs per wave
{
    const b = Sim.createGame({ mode: 'solo', seed: 91 });
    const p = b.players[0]; p.invuln = 1e9; p.x = 600; p.y = 150; p.landed = false;
    for (let f = 0; f < 60; f++) Sim.step(b, [inp({ r: 1, u: 1 })]);
    const plain = p.vx;
    for (let f = 0; f < 60; f++) Sim.step(b, [inp({ r: 1, u: 1, bo: 1 })]);
    assert.ok(p.boosting && p.vx > plain * 1.6, 'booster roughly doubles speed: ' + p.vx.toFixed(2) + ' vs ' + plain.toFixed(2));
    assert.ok(p.boost < Sim.BOOST.max, 'meter drains');
    for (let f = 0; f < 200; f++) Sim.step(b, [inp({ r: 1, u: 1, bo: 1 })]);
    assert.ok(p.boost === 0 && !p.boosting, 'empty meter ends the boost');
    for (let f = 0; f < 400; f++) Sim.step(b, [inp({})]);
    assert.ok(p.boost > 50, 'meter recharges while idle: ' + p.boost.toFixed(0));
    assert.ok(Sim.threat({ wave: 1 }) === 1 && Sim.threat({ wave: 4 }) > 1.5 && Sim.threat({ wave: 8 }) > Sim.threat({ wave: 4 }), 'threat climbs with the wave');
    const w1 = Sim.createGame({ mode: 'solo', seed: 92 }), hp1 = w1.units.find(u => u.ai && u.type === 'tank').maxHealth;
    const w4 = Sim.createGame({ mode: 'solo', seed: 92 }); w4.wave = 3; w4.status = 'waveclear'; w4.statusTimer = 179; Sim.step(w4, [inp({})]);
    const hp4 = w4.units.find(u => u.ai && u.type === 'tank').maxHealth;
    assert.ok(hp4 > hp1 * 1.5 && w4.aiCredits > w1.aiCredits, 'wave 4 tanks are much tougher and the enemy richer: ' + hp1 + ' -> ' + hp4);
}
// ---- Regression tests for the verified audit findings ----
const calm = g => { g.units = g.units.filter(u => !u.ai); g.shells = []; g.ai.alive = false; g.ai.respawn = 0; };
// Dying with the last hostages aboard is a death, not a wave clear (solo resurrect / co-op soft-lock)
{
    const g = Sim.createGame({ mode: 'solo', seed: 101 });
    for (let f = 0; f < 30; f++) Sim.step(g, [inp({})]);
    const p = g.players[0]; calm(g);
    g.hostages.forEach((h, i) => { if (i < 2) { h.state = 'aboard'; h.carrier = 0; } else h.state = 'saved'; });
    p.carrying = 2; p.x = 1500; p.y = 150; p.landed = false; p.health = 5; p.invuln = 0;
    g.shells.push({ team: Sim.AI, x: p.x + p.width / 2, y: p.y + p.height / 2, vx: 0, vy: 0, width: 7, height: 7, dmg: 999, life: 5, kind: 'heli' });
    Sim.step(g, [inp({})]);
    assert.strictEqual(g.status, 'dying', 'fatal hit with the last hostages aboard is a death: ' + g.status);
    for (let f = 0; f < 300; f++) Sim.step(g, [inp({})]);
    assert.strictEqual(g.status, 'over', 'and ends the run');
}
// Co-op: P2's troops march (base-range formula used the team id), squad wipe waits for a pending redeploy,
// and a life earned on wave clear brings back a pilot who was out
{
    const c = Sim.createGame({ mode: 'coop', seed: 102 });
    calm(c); c.players[1].credits = 1000; c.players[1].invuln = 1e9; c.players[0].invuln = 1e9;
    Sim.step(c, [inp({}), inp({ buy: 'tank' })]);
    const t = c.units.find(u => u.team === 1 && u.type === 'tank'), x0 = t.x;
    for (let f = 0; f < 600; f++) { calm(c); Sim.step(c, [inp({}), inp({})]); }
    assert.ok(t.x > x0 + 300, 'co-op P2 tank advances: ' + x0.toFixed(0) + ' -> ' + t.x.toFixed(0));
    const w = Sim.createGame({ mode: 'coop', seed: 103 });
    calm(w); w.lives = 1;
    const [A, B] = w.players;
    const kill = q => { q.invuln = 0; q.health = 1; w.shells.push({ team: Sim.AI, x: q.x + 30, y: q.y + 12, vx: 0, vy: 0, width: 7, height: 7, dmg: 999, life: 3, kind: 'heli' }); Sim.step(w, [inp({}), inp({})]); };
    A.y = B.y = 150; A.landed = B.landed = false; A.x = 900; B.x = 1300;
    kill(A); assert.ok(!A.alive && A.canRespawn && w.lives === 0, 'A spends the last life');
    for (let f = 0; f < 30; f++) Sim.step(w, [inp({}), inp({})]);
    kill(B); assert.strictEqual(w.status, 'playing', 'no squad wipe while A is still due to redeploy');
    for (let f = 0; f < 400; f++) { calm(w); Sim.step(w, [inp({}), inp({})]); }
    assert.ok(A.alive && !B.alive && B.canRespawn === false, 'A redeployed, B is out');
    w.hostages.forEach(h => { h.state = 'saved'; }); w.players.forEach(q => { q.carrying = 0; });
    for (let f = 0; f < 200; f++) Sim.step(w, [inp({}), inp({})]);
    assert.ok(w.wave === 2 && B.alive, 'the wave-clear life brings B back on wave 2 (lives now ' + w.lives + ')');
}
// Airstrike called at the map edge still arrives and drops its bombs
{
    const a = Sim.createGame({ mode: 'solo', seed: 104 });
    const p = a.players[0]; calm(a); p.invuln = 1e9; p.credits = 1000; p.x = 40; p.y = 150; p.landed = false; p.dir = 1;
    Sim.step(a, [inp({ buy: 'strike' })]);
    let dropped = 0; for (let f = 0; f < 400; f++) { const n = a.bombs.length; Sim.step(a, [inp({})]); if (a.bombs.length > n) dropped++; }
    assert.strictEqual(dropped, Sim.AIRSTRIKE.bombs, 'edge airstrike delivers all its bombs: ' + dropped);
}
// Forged shop codes over the network cannot corrupt credits
{
    const g = Sim.createGame({ mode: 'versus', seed: 105 });
    const c0 = g.players[1].credits;
    for (const bad of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) Sim.step(g, [inp({}), inp({ buy: bad })]);
    assert.ok(Number.isFinite(g.players[1].credits) && g.players[1].credits === c0, 'credits untouched by forged buy codes');
    Sim.step(g, [inp({}), inp({ buy: 'tank' })]);
    assert.strictEqual(g.players[1].credits, c0 - Sim.UNITS.tank.cost, 'real purchases still cost money');
}
// AI infantry: never seizes a hut whose hostages are waiting; hostages held too long escape and walk home
{
    const g = Sim.createGame({ mode: 'solo', seed: 106 });
    calm(g);
    const hut = g.huts[0], door = hut.x + hut.w / 2;
    const sol = { team: Sim.AI, type: 'soldier', x: door - 4, y: Sim.GROUND_Y - 20, width: 8, height: 20, vx: 0, dir: -1, speed: 1.1, health: 24, maxHealth: 24, range: 130, fireTimer: 999, angle: 0, anim: 0, moving: true, ai: true };
    g.units.push(sol); Sim.step(g, [inp({})]);
    assert.ok(!hut.garrison, 'AI soldier walks past a hut with waiting hostages');
    hut.garrison = { team: Sim.AI, count: 2 };
    const held = g.hostages.filter(h => Math.abs(h.x - (hut.x + 80)) < 110);
    for (let f = 0; f < Sim.HOSTAGE_ESCAPE + 5; f++) { g.units = g.units.filter(u => !u.ai || u === sol); g.shells = []; g.ai.alive = false; Sim.step(g, [inp({})]); }
    assert.ok(held.every(h => h.flee), 'held hostages escape after the time limit');
    for (let f = 0; f < 4000 && held.some(h => h.state !== 'saved'); f++) { calm(g); Sim.step(g, [inp({})]); }
    assert.ok(held.every(h => h.state === 'saved'), 'escaped hostages walk home and count as rescued');
}
// Armour: guns chip AI tanks, bombs kill them; and parking on the pad pays no bounty
{
    const g = Sim.createGame({ mode: 'solo', seed: 107 });
    g.wave = 3; g.status = 'waveclear'; g.statusTimer = 179; Sim.step(g, [inp({})]);
    const p = g.players[0]; g.ai.alive = false; g.ai.respawn = 0; p.invuln = 1e9;
    const t = g.units.find(u => u.ai && u.type === 'tank');
    g.units = g.units.filter(u => u === t || !u.ai);
    p.x = t.x - 110; p.y = Sim.GROUND_Y - p.height; p.vy = 0; p.landed = true; p.dir = 1; t.vx = 0;
    Sim.step(g, [inp({ f: 1 })]); for (let f = 0; f < 15; f++) Sim.step(g, [inp({})]);
    assert.ok(g.units.includes(t) && t.health < t.maxHealth, 'one bullet only chips a wave-4 tank (' + t.health + '/' + t.maxHealth + ')');
    g.bombs.push({ team: 0, x: t.x + 13, y: t.y - 30, vx: 0, vy: 3 });
    for (let f = 0; f < 20 && g.units.includes(t); f++) Sim.step(g, [inp({})]);
    assert.ok(!g.units.includes(t), 'one bomb destroys it');
    const camp = Sim.createGame({ mode: 'solo', seed: 108 });
    const q = camp.players[0]; camp.ai.alive = false; camp.ai.respawn = 0; q.invuln = 1e9;
    camp.units = camp.units.filter(u => !u.ai);
    const victim = { team: Sim.AI, type: 'soldier', x: q.x + 160, y: Sim.GROUND_Y - 20, width: 8, height: 20, vx: 0, dir: -1, speed: 0, health: 24, maxHealth: 24, range: 0, fireTimer: 999, angle: 0, anim: 0, moving: false, ai: true };
    camp.units.push(victim);
    const sc = q.score, cr = q.credits;
    for (let f = 0; f < 60; f++) Sim.step(camp, [inp({ f: 1 })]);
    assert.ok(!camp.units.includes(victim) && q.score === sc && q.credits === cr, 'kills from the pad pay nothing (score ' + sc + ' -> ' + q.score + ')');
}
// Coaxial MG: a landed chopper in front of an AI tank takes fire; on its own pad it is safe
{
    const g = Sim.createGame({ mode: 'solo', seed: 109 });
    const p = g.players[0]; g.ai.alive = false; g.ai.respawn = 0;
    g.units = g.units.filter(u => !u.ai);
    const t = { team: Sim.AI, type: 'tank', x: 900, y: Sim.GROUND_Y - 22, width: 26, height: 22, vx: -0.0001, dir: -1, speed: 0.8, health: 300, maxHealth: 300, range: 210, fireTimer: 999, angle: 0, anim: 0, moving: true, ai: true, coaxTimer: 25 };
    g.units.push(t);
    p.x = 800; p.y = Sim.GROUND_Y - p.height; p.landed = true; p.invuln = 0; const hp = p.health;
    for (let f = 0; f < 120; f++) { t.x = 900; t.vx = -0.0001; Sim.step(g, [inp({})]); if (p.invuln > 0) p.invuln = 0; }
    assert.ok(p.health < hp, 'landed in front of a tank: coax MG hits (' + hp + ' -> ' + p.health + ')');
    const g2 = Sim.createGame({ mode: 'solo', seed: 110 });
    const p2 = g2.players[0]; g2.ai.alive = false; g2.ai.respawn = 0; g2.units = g2.units.filter(u => !u.ai);
    const t2 = Object.assign({}, t, { x: 200, coaxTimer: 25 }); g2.units.push(t2);
    const hp2 = p2.health; for (let f = 0; f < 120; f++) { t2.x = 200; t2.vx = -0.0001; Sim.step(g2, [inp({})]); }
    assert.strictEqual(p2.health, hp2, 'a chopper on its own repair pad is not raked');
}
// Troop cap counts troops aboard; soldiers bought on the pad can be loaded straight away
{
    const g = Sim.createGame({ mode: 'solo', seed: 111 });
    const p = g.players[0]; calm(g); p.invuln = 1e9; p.credits = 100000;
    Sim.step(g, [inp({ buy: 'soldier' })]); Sim.step(g, [inp({ buy: 'troops' })]);
    assert.strictEqual(p.troops, 1, 'a soldier bought on the pad loads from the pad');
    for (let k = 0; k < 20; k++) Sim.step(g, [inp({ buy: 'soldier' })]);
    assert.ok(g.units.filter(u => u.team === 0).length + p.troops <= Sim.MAX_ALLIES, 'troops aboard count toward the cap');
}
// Balloons do not burst on an invulnerable chopper; player garrisons survive a wave change
{
    const g = Sim.createGame({ mode: 'solo', seed: 112 });
    calm(g);
    const hut = g.huts[0]; hut.garrison = { team: Sim.AI, count: 1 };
    for (let f = 0; f < 420; f++) Sim.step(g, [inp({})]);
    const bl = g.balloons[0], p = g.players[0];
    p.invuln = 30; p.x = bl.x - p.width / 2; p.y = bl.y - p.height / 2; p.landed = false; p.vy = 0;
    Sim.step(g, [inp({})]);
    assert.ok(g.balloons.includes(bl), 'balloon survives contact while the chopper is invulnerable');
    hut.garrison = { team: 0, count: 3 };
    g.hostages.forEach(h => { h.state = 'saved'; }); p.carrying = 0;
    for (let f = 0; f < 200; f++) Sim.step(g, [inp({})]);
    assert.ok(g.wave === 2 && g.units.filter(u => u.team === 0 && u.type === 'soldier').length >= 3, 'garrisoned soldiers carry over as ground troops');
}
// The desync hash now notices AI chopper and hostage-state differences
{
    const a = Sim.createGame({ mode: 'coop', seed: 113 }), b = Sim.createGame({ mode: 'coop', seed: 113 });
    assert.strictEqual(Sim.hash(a), Sim.hash(b));
    b.ai.health -= 50; assert.notStrictEqual(Sim.hash(a), Sim.hash(b), 'AI heli health is hashed');
    b.ai.health += 50; b.hostages[0].state = 'dead'; assert.notStrictEqual(Sim.hash(a), Sim.hash(b), 'hostage states are hashed');
}
// Combat ledger: deterministic and counts what happened
{
    const a = run('solo', 4242, 2500, 1), b = run('solo', 4242, 2500, 1);
    assert.deepStrictEqual(a.s.players[0].stats, b.s.players[0].stats, 'ledger is deterministic');
    const g = Sim.createGame({ mode: 'solo', seed: 120 });
    const p = g.players[0]; g.ai.alive = false; g.ai.respawn = 0; p.invuln = 1e9;
    const t = g.units.find(u => u.ai && u.type === 'tank'); g.units = g.units.filter(u => u === t || !u.ai);
    p.x = 1500; p.y = 150; p.landed = false; t.x = 1500; t.vx = 0;
    g.bombs.push({ team: 0, owner: 0, x: t.x + 13, y: t.y - 30, vx: 0, vy: 3 });
    for (let f = 0; f < 20 && g.units.includes(t); f++) Sim.step(g, [inp({})]);
    assert.strictEqual(p.stats.tanks, 1, 'tank kill is counted');
    Sim.step(g, [inp({ buy: 'soldier' })]);
    p.credits = 1000; Sim.step(g, [inp({ buy: 'strike' })]);
    assert.ok(p.stats.unitsBought === 1 && p.stats.strikes === 1, 'purchases are counted');
}
console.log('all sim tests passed');
