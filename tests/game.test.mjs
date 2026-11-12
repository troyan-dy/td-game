// node --test tests/*.test.mjs — забег на сгенерированной карте: команды, шаг времени, детерминизм, сейв, демо; боты — по tests/runs.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { SIM, play, smart } from './bots.mjs';
import { RUNS, resultOf, results, describe } from './runs.mjs';
const require = createRequire(import.meta.url);
const MAPGEN = require('../live/mapgen.js');
const C = SIM.CONFIG;

const T = C.TOWERS;
const freeCell = (S) => SIM.rankCells(S, 3)[0];
const run = (S, sec) => { const n = Math.round(sec / S.dt); for (let i = 0; i < n; i++) SIM.step(S, null); };
const hudCells = (S) => { const out = []; for (let i = 0; i < S.map.cols * S.map.rows; i++) { const x = i % S.map.cols, y = Math.floor(i / S.map.cols);
  if (C.MAP.keepout.some(([kx, ky, kw, kh]) => x >= kx && y >= ky && x < kx + kw && y < ky + kh)) out.push(i); } return out; };

test('забег создаётся от сида: карта генератора, сид и версия состояния', () => {
  const S = SIM.create(42);
  assert.equal(S.seed, 42);
  assert.equal(S.v, 2);
  assert.deepEqual(S.map, MAPGEN.generate(42));
  assert.notDeepEqual(SIM.create(43).map.road, S.map.road);
});

test('постройка на свободной клетке; отказ на дороге, на занятой клетке и без душ', () => {
  const S = SIM.create(5), road = S.map.road[10], free = freeCell(S);
  S.souls = 1000;
  assert.deepEqual(SIM.canBuild(S, road, 'bones'), { ok: false, reason: 'road', cost: T.bones.cost[0] });
  SIM.step(S, { cmds: [{ k: 'build', cell: road, type: 'bones' }] });
  assert.equal(S.towers[road], null);
  const cb = SIM.canBuild(S, free, 'bones');
  assert.equal(cb.ok, true);
  SIM.step(S, { cmds: [{ k: 'build', cell: free, type: 'bones' }] });
  assert.equal(S.towers[free].type, 'bones'); assert.equal(S.souls, 1000 - cb.cost); assert.equal(S.towers[free].invested, cb.cost);
  assert.equal(SIM.canBuild(S, free, 'dark').reason, 'occupied');
  SIM.step(S, { cmds: [{ k: 'build', cell: free, type: 'dark' }] });
  assert.equal(S.towers[free].type, 'bones'); assert.equal(S.souls, 1000 - cb.cost);
  const other = freeCell(S); S.souls = T.bones.cost[0] - 1;
  assert.equal(SIM.canBuild(S, other, 'bones').reason, 'souls');
  SIM.step(S, { cmds: [{ k: 'build', cell: other, type: 'bones' }] }); assert.equal(S.towers[other], null);
  assert.equal(SIM.canBuild(S, -1, 'bones').reason, 'bounds');
  assert.equal(SIM.canBuild(S, S.map.cols * S.map.rows, 'bones').reason, 'bounds');
});

test('продажа возвращает 70% вложенного и освобождает клетку', () => {
  const S = SIM.create(3), cell = freeCell(S); S.souls = 1000;
  SIM.step(S, { cmds: [{ k: 'build', cell, type: 'dark' }, { k: 'upgrade', cell }] });
  const invested = T.dark.cost[0] + T.dark.cost[1];
  assert.equal(S.towers[cell].lvl, 2); assert.equal(S.towers[cell].invested, invested);
  const before = S.souls;
  SIM.step(S, { cmds: [{ k: 'sell', cell }] });
  assert.equal(S.souls - before, Math.floor(invested * C.SELL_REFUND)); assert.equal(C.SELL_REFUND, 0.7);
  assert.equal(S.towers[cell], null);
  assert.equal(SIM.canBuild(S, cell, 'bones').ok, true);
});

test('под интерфейсом не строится: клетки под HUD, кнопкой волны и карточками', () => {
  const S = SIM.create(5); S.souls = 1e6; const hud = hudCells(S);
  assert.ok(hud.includes(0) && hud.length >= 25);
  for (const cell of hud) assert.equal(SIM.canBuild(S, cell, 'bones').reason, 'hud', 'клетка ' + cell);
  SIM.step(S, { cmds: hud.map((cell) => ({ k: 'build', cell, type: 'bones' })) });
  assert.ok(hud.every((c) => !S.towers[c]));
  assert.ok(SIM.rankCells(S, 3).every((c) => !hud.includes(c)));
});

test('радиусы башен в прежних единицах по 48 px; радиус будущей башни отдаёт логика', () => {
  assert.equal(C.UNIT, 48);
  const S = SIM.create(1), cell = freeCell(S); S.souls = 1000;
  for (const type of C.TOWER_ORDER) assert.equal(SIM.buildRangePx(S, cell, type), T[type].range[0] * 48);
  SIM.step(S, { cmds: [{ k: 'build', cell, type: 'bones' }] });
  assert.equal(SIM.rangePx(S.towers[cell]), T.bones.range[0] * 48);
});

test('снаряды и облака помнят свою башню, а не клетку: продажа и новая башня на той же клетке', () => {
  const S = SIM.create(4), cell = freeCell(S); S.souls = 1e5;
  SIM.step(S, { cmds: [{ k: 'build', cell, type: 'plague' }, { k: 'call' }] });
  const plagueId = S.towers[cell].id;
  for (let i = 0; i < 120 * 120 && !S.shots.some((s) => s.k === 'blob'); i++) SIM.step(S, null);
  assert.ok(S.shots.some((s) => s.k === 'blob'), 'котёл не выстрелил');
  SIM.step(S, { cmds: [{ k: 'sell', cell }, { k: 'build', cell, type: 'bones' }] });
  const bonesId = S.towers[cell].id;
  for (let i = 0; i < 120 && !S.clouds.length; i++) SIM.step(S, null);
  assert.ok(S.clouds.length, 'облако не появилось');
  for (const c of S.clouds) assert.ok(Number.isFinite(c.dps) && c.dps === T.plague.dps[0], 'dps облака ' + c.dps);
  run(S, 1);
  for (const e of S.enemies) { assert.ok(Number.isFinite(e.hp)); for (const p of Object.values(e.poison)) assert.notEqual(p.tw, bonesId); }
  assert.notEqual(plagueId, bonesId);
});

// пронзающий болт против одного замороженного врага: смещение болта поперёк пути off, шаг времени dt
const pierceHits = (dt, off, startDx) => {
  const S = SIM.create(1, { dt }); SIM.step(S, { cmds: [{ k: 'call' }] });
  S.queue = []; S.qi = 0; const e = S.enemies[0]; e.d = 600; e.freezeT = 1e9; e.hp = e.max = 1e6; SIM.step(S, null);
  S.shots.push({ k: 'bolt', x: e.x + startDx, y: e.y - 14 + off, dx: 1, dy: 0, left: 1000, dmg: 10, sp: T.bones.boltSpeed, tw: -1, pierce: 4, hit: [] });
  run(S, 0.5);
  return e.hp < e.max;
};
test('пронзающий болт: при шаге 1/120 радиус попадания прежний (18 px), при 1/30 не проскакивает врага', () => {
  assert.equal(pierceHits(1 / 120, 17, -106), true);
  assert.equal(pierceHits(1 / 120, 20, -106), false);
  assert.equal(pierceHits(1 / 30, 12, -106), true);       // точки болта за шаг: −16 и +14 от врага — обе дальше 18 px
});

test('сейв: годным считается только полное состояние текущей версии с годной картой', () => {
  const S = SIM.create(1);
  assert.equal(SIM.loadable(S), true);
  assert.equal(SIM.loadable(JSON.parse(JSON.stringify(S))), true);
  assert.equal(SIM.loadable({ v: C.VERSION, wave: 3, phase: 'prep' }), false);
  assert.equal(SIM.loadable(Object.assign({}, S, { v: 1 })), false);
  assert.equal(SIM.loadable(Object.assign({}, S, { map: Object.assign({}, S.map, { road: S.map.road.slice(0, 10) }) })), false);
  assert.equal(SIM.loadable(Object.assign({}, S, { towers: [] })), false);
  assert.equal(SIM.loadable(Object.assign({}, S, { dt: 0 })), false);
  assert.equal(SIM.loadable(null), false);
  assert.equal(SIM.loadable('мусор'), false);
});

test('шаг времени — параметр забега: враг проходит одно и то же расстояние за секунду при любом шаге', () => {
  const dist = (dt) => { const S = SIM.create(9, { dt }); assert.equal(S.dt, dt);
    SIM.step(S, { cmds: [{ k: 'call' }] }); run(S, 1.2); const e = S.enemies[0]; return [e.d, S.t]; };
  const [a, ta] = dist(1 / 120), [b, tb] = dist(1 / 30);
  assert.ok(Math.abs(ta - tb) < 0.05, `время ${ta} против ${tb}`);
  assert.ok(Math.abs(a - b) < C.ENEMIES.militia.speed / 30 + 1e-6, `путь ${a} против ${b}`);
  assert.equal(SIM.create(9).dt, C.DT);
});

test('враги идут по клеткам дороги и поворачивают без рывков', () => {
  const S = SIM.create(11), road = new Set(S.map.road); SIM.step(S, { cmds: [{ k: 'call' }] });
  const last = new Map(); let checked = 0;
  for (let i = 0; i < 120 * 60; i++) {
    SIM.step(S, null);
    for (const e of S.enemies) {
      const c = MAPGEN.cellAt(S.map, e.x, e.y);
      if (c >= 0) assert.ok(road.has(c), `враг ${e.id} на клетке ${c} вне дороги`);
      const p = last.get(e.id);
      if (p) { const dx = e.x - p.x, dy = e.y - p.y, step = Math.hypot(dx, dy);
        assert.ok(step <= C.ENEMIES[e.type].speed * S.dt * 1.6 + 1e-6, `рывок ${step.toFixed(2)} px`);
        if (p.dx !== undefined && step > 0.05) { const turn = Math.abs(Math.atan2(p.dx * dy - p.dy * dx, p.dx * dx + p.dy * dy));
          assert.ok(turn < 0.35, `резкий поворот ${(turn * 57.3).toFixed(0)}°`); checked++; }
        last.set(e.id, { x: e.x, y: e.y, dx, dy }); } else last.set(e.id, { x: e.x, y: e.y });
    }
  }
  assert.ok(checked > 1000);
});

test('детерминизм: тот же сид и те же команды — тот же итог', () => {
  const a = play(smart, 7, 900), b = play(smart, 7, 900);
  assert.deepEqual(a, b);
  const c = play(smart, 8, 900); assert.notDeepEqual(a.towers, c.towers);
});
for (const R of RUNS) test(`бот ${R.name}: ${R.want}`, () => {        // партии и ожидания — tests/runs.mjs
  const r = resultOf(R.name); assert.ok(R.ok(r, results), `${R.name}: ${describe(r)}`);
});

test('состояние сериализуется в JSON без потерь (сейв)', () => {
  const S = SIM.create(3), cell = SIM.rankCells(S, 3)[0]; S.souls = 1000;
  SIM.step(S, { cmds: [{ k: 'build', cell, type: 'plague' }, { k: 'call' }] });
  run(S, 20);
  const R = JSON.parse(JSON.stringify(S)); for (let i = 0; i < 120 * 30; i++) { SIM.step(S, null); SIM.step(R, null); }
  assert.deepEqual(R, S);
});

test('титульное демо: на большей части петли по дороге идут враги', () => {
  let busy = 0, n = 0;
  for (let t = 0.25; t < 2 * SIM.L; t += 0.5) { const S = SIM.at(t); n++; if (S.enemies.length >= 3) busy++;
    assert.ok(S.map.road.length >= 45 && S.demo); }
  assert.ok(busy / n >= 0.85, `враги в кадре только в ${busy} из ${n} моментов`);
});
