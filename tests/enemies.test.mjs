// node --test tests/*.test.mjs — особые враги: разведчик (первое попадание — промах) и знаменосец (ускоряет соседей).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const SIM = require('../live/sim.js');
const WAVEGEN = require('../live/wavegen.js');
const C = SIM.CONFIG, EN = C.ENEMIES, RUN = SIM.waveCount();

const run = (S, sec) => { const n = Math.round(sec / S.dt); for (let i = 0; i < n; i++) SIM.step(S, null); };
const json = (S) => JSON.parse(JSON.stringify(S));
const findWave = (pred, from = 1, to = RUN) => { for (let s = 1; s < 2000; s++) for (let n = from; n <= to; n++) { const w = WAVEGEN.wave(s, n); if (pred(w)) return { seed: s, n, w }; } throw new Error('нет такой волны'); };
const has = (type) => (w) => w.squads.some((q) => q.type === type);
const ALL_SEEN = Object.fromEntries(Object.keys(EN).map((k) => [k, 1]));
// забег перед волной n, волна вызвана; враги выходят как в бою
const startAt = (seed, n) => { const S = SIM.create(seed); S.hp = 1e9; S.wave = n - 1; S.seen = Object.assign({}, ALL_SEEN); SIM.step(S, { cmds: [{ k: 'call' }] }); return S; };
const enemyOf = (S, f) => { for (let i = 0; i < 120 * 300; i++) { const e = S.enemies.find((x) => !x.dead && f(x)); if (e) return e; SIM.step(S, null); } throw new Error('враг не вышел'); };
// на дороге остаются только эти враги, новых не выходит
const only = (S, ...list) => { S.enemies = list; S.qi = S.queue.length; };
const shot = (S, e, k, dmg) => S.shots.push({ k, x: e.x - 20, y: e.y - 14, tid: e.id, dmg, sp: 900, tw: -1, lx: e.x, ly: e.y, bounces: 0, hit: [], born: S.t, seed: 0 });
const misses = (S) => S.ev.filter((x) => x.k === 'miss').length;

// ---------------------------------------------------------------- генератор и разведка
test('разведчик и знаменосец — строки конфига врагов с ценой угрозы, минимальной волной, весом и способностью', () => {
  for (const k of ['scout', 'banner']) {
    const d = EN[k]; assert.ok(d, 'нет врага ' + k);
    assert.ok(d.threat > 0 && Number.isInteger(d.minWave) && d.minWave > 1 && d.minWave <= RUN && d.weight > 0, k);
    assert.ok(d.ability && d.desc && d.name, k + ': нет описания способности');
  }
  assert.ok(EN.scout.speed > 1.5 * EN.militia.speed, 'разведчик не очень быстрый');
  assert.ok(EN.scout.ward >= 1 && EN.banner.haste > 0 && EN.banner.hasteR > 0);
});

test('оба выходят в волнах забега не раньше своей минимальной волны, в превью — способность с цифрами', () => {
  const seen = { scout: 0, banner: 0 };
  for (let s = 1; s <= 100; s++) for (let n = 1; n <= RUN; n++) for (const q of WAVEGEN.wave(s, n).squads) if (q.type in seen) {
    assert.ok(n >= EN[q.type].minWave, `сид ${s}: ${q.type} на волне ${n}`); seen[q.type]++;
    assert.ok(q.ability && q.ability.length > 10 && !q.ability.includes('?'), `${q.type}: способность «${q.ability}»`);
  }
  assert.ok(seen.scout > 50 && seen.banner > 50, JSON.stringify(seen));
  assert.match(findWave(has('banner')).w.squads.find((q) => q.type === 'banner').ability, /\d+%/);
});

// ---------------------------------------------------------------- разведчик
test('разведчик: первое попадание не наносит урона и видно событием промаха, следующие — наносят', () => {
  for (const [k, type] of [['bolt', 'phys'], ['ghost', 'magic']]) {
    const { seed, n } = findWave(has('scout'));
    const S = startAt(seed, n), e = enemyOf(S, (x) => x.type === 'scout'); only(S, e);
    e.freezeT = 1e9; e.hp = e.max = 1e4; SIM.step(S, null);
    shot(S, e, k, 100); run(S, 0.3);
    assert.equal(e.hp, 1e4, `${type}: первое попадание нанесло урон`);
    assert.equal(misses(S), 1, `${type}: нет события промаха`);
    shot(S, e, k, 100); run(S, 0.3);
    assert.ok(e.hp < 1e4, `${type}: второе попадание не нанесло урона`);
    shot(S, e, k, 100); const hp = e.hp; run(S, 0.3);
    assert.ok(e.hp < hp && misses(S) === 1, `${type}: промахов больше одного`);
  }
});

test('разведчик: промах работает для каждой башни — болт, призрак, яд облака, луч тьмы', () => {
  const { seed, n } = findWave(has('scout'));
  for (const type of C.TOWER_ORDER.filter((t) => C.TOWERS[t].attack)) {   // башня без атаки (Алтарь) не стреляет
    const S = startAt(seed, n), e = enemyOf(S, (x) => x.type === 'scout'); only(S, e);
    e.freezeT = 1e9; e.speed = 0; e.hp = e.max = 1e5; S.souls = 1e5;   // стоит на месте: котёл целится с упреждением по скорости
    const cell = SIM.rankCells(S, 3)[0], [cx, cy] = SIM.cellXY(S, cell);
    // разведчик — в ближайшей к башне точке дороги
    let best = 0; for (let d = 0, bd = Infinity; d < SIM.pathLen(S); d += 4) { const p = SIM.posAt(S, d), dd = Math.hypot(p.x - cx, p.y - cy); if (dd < bd) { bd = dd; best = d; } }
    e.d = best; SIM.step(S, { cmds: [{ k: 'build', cell, type }] });
    let missHp = null;
    for (let i = 0; i < 120 * 6 && e.hp === e.max; i++) { SIM.step(S, null); if (misses(S) && missHp === null) missHp = e.hp; }
    assert.equal(missHp, e.max, `${type}: первым был не промах`);
    run(S, 3);
    assert.ok(e.hp < e.max, `${type}: после промаха урона нет`);
    assert.equal(S.ev.filter((x) => x.k === 'miss').length <= 1, true);
  }
});

test('разведчик: промах переживает сейв — нетронутый щит после JSON гасит удар, сбитый — нет', () => {
  const { seed, n } = findWave(has('scout'));
  let S = startAt(seed, n), e = enemyOf(S, (x) => x.type === 'scout'); only(S, e);
  e.freezeT = 1e9; e.hp = e.max = 1e4; SIM.step(S, null);
  S = json(S); assert.equal(SIM.loadable(S), true); e = S.enemies[0];
  shot(S, e, 'bolt', 100); run(S, 0.3); assert.equal(e.hp, 1e4, 'после загрузки первое попадание нанесло урон');
  S = json(S); assert.equal(SIM.loadable(S), true); e = S.enemies[0];
  shot(S, e, 'bolt', 100); run(S, 0.3); assert.ok(e.hp < 1e4, 'после загрузки сбитый щит снова гасит удар');
  for (const bad of [-1, 'x', null, 1.5e300]) { const B = json(S); B.enemies[0].ward = bad; assert.equal(SIM.loadable(B), false, 'щит ' + bad); }
});

// ---------------------------------------------------------------- знаменосец
// скорость врага за один шаг, px/с (без замедления и оков)
const speedOf = (S, e) => { const d = e.d; SIM.step(S, null); return (e.d - d) / S.dt; };
test('знаменосец ускоряет врагов в радиусе, но не себя и не тех, кто дальше; с его смертью ускорение пропадает', () => {
  const { seed, n } = findWave((w) => has('banner')(w) && !w.trait);
  const S = startAt(seed, n), b = enemyOf(S, (x) => x.type === 'banner'), m = enemyOf(S, (x) => x !== b && x.type !== 'banner' && !EN[x.type].boss);
  const far = enemyOf(S, (x) => x !== b && x !== m && x.type !== 'banner' && !EN[x.type].boss);
  only(S, b, m, far);
  const R = EN.banner.hasteR * C.UNIT;
  b.d = 600; m.d = 600; far.d = 600 + R * 3; for (const e of [b, m, far]) { e.lane = 0; e.hp = e.max = 1e6; }
  SIM.step(S, null);
  assert.ok(Math.abs(speedOf(S, m) - m.speed * (1 + EN.banner.haste)) < 1e-6, 'сосед знаменосца не ускорен');
  assert.ok(Math.abs(speedOf(S, b) - b.speed) < 1e-6, 'знаменосец ускорил сам себя');
  assert.ok(Math.abs(speedOf(S, far) - far.speed) < 1e-6, 'ускорен враг вне радиуса');
  assert.ok(m.haste > 0 && far.haste === 0);
  b.hp = 1; shot(S, b, 'bolt', 1e3); for (let i = 0; i < 120 && !b.dead; i++) SIM.step(S, null);
  assert.ok(b.dead, 'знаменосец не убит');
  assert.ok(Math.abs(speedOf(S, m) - m.speed) < 1e-6, 'ускорение не пропало со смертью знаменосца');
  assert.equal(m.haste, 0);
});
