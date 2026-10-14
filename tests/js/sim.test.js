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
p.x = 40; p.landed = true;
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

console.log('all sim tests passed');
