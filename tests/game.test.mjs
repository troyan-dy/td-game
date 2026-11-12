// node --test tests/ — забег на сгенерированной карте: команды, шаг времени, детерминизм, сейв, боты.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { SIM, play, smart, idle } from './bots.mjs';
const require = createRequire(import.meta.url);
const MAPGEN = require('../live/mapgen.js');
const C = SIM.CONFIG;

const freeCell = (S) => { for (let i = 0; i < S.map.cols * S.map.rows; i++) if (!S.map.road.includes(i) && !S.towers[i]) return i; return -1; };
const run = (S, sec) => { const n = Math.round(sec / S.dt); for (let i = 0; i < n; i++) SIM.step(S, null); };

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
  assert.deepEqual(SIM.canBuild(S, road, 'bones'), { ok: false, reason: 'road', cost: 100 });
  SIM.step(S, { cmds: [{ k: 'build', cell: road, type: 'bones' }] });
  assert.equal(S.towers[road], null);
  assert.equal(SIM.canBuild(S, free, 'bones').ok, true);
  SIM.step(S, { cmds: [{ k: 'build', cell: free, type: 'bones' }] });
  assert.equal(S.towers[free].type, 'bones'); assert.equal(S.souls, 900);
  assert.equal(SIM.canBuild(S, free, 'dark').reason, 'occupied');
  SIM.step(S, { cmds: [{ k: 'build', cell: free, type: 'dark' }] });
  assert.equal(S.towers[free].type, 'bones'); assert.equal(S.souls, 900);
  const other = freeCell(S); S.souls = 50;
  assert.equal(SIM.canBuild(S, other, 'bones').reason, 'souls');
  SIM.step(S, { cmds: [{ k: 'build', cell: other, type: 'bones' }] }); assert.equal(S.towers[other], null);
  assert.equal(SIM.canBuild(S, -1, 'bones').reason, 'bounds');
  assert.equal(SIM.canBuild(S, S.map.cols * S.map.rows, 'bones').reason, 'bounds');
});

test('продажа возвращает 70% вложенного и освобождает клетку', () => {
  const S = SIM.create(3), cell = freeCell(S); S.souls = 1000;
  SIM.step(S, { cmds: [{ k: 'build', cell, type: 'dark' }, { k: 'upgrade', cell }] });
  assert.equal(S.towers[cell].lvl, 2); assert.equal(S.towers[cell].invested, 150 + 120);
  const before = S.souls;
  SIM.step(S, { cmds: [{ k: 'sell', cell }] });
  assert.equal(S.souls - before, 189); assert.equal(S.towers[cell], null);
  assert.equal(SIM.canBuild(S, cell, 'bones').ok, true);
});

test('радиусы башен в прежних единицах по 48 px', () => {
  assert.equal(C.UNIT, 48);
  const S = SIM.create(1), cell = freeCell(S); S.souls = 1000;
  SIM.step(S, { cmds: [{ k: 'build', cell, type: 'bones' }] });
  assert.equal(SIM.rangePx(S.towers[cell]), 3.6 * 48);
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

test('состояние сериализуется в JSON без потерь (сейв)', () => {
  const S = SIM.create(3), cell = SIM.rankCells(S, 3)[0]; S.souls = 1000;
  SIM.step(S, { cmds: [{ k: 'build', cell, type: 'plague' }, { k: 'call' }] });
  run(S, 20);
  const R = JSON.parse(JSON.stringify(S)); for (let i = 0; i < 120 * 30; i++) { SIM.step(S, null); SIM.step(R, null); }
  assert.deepEqual(R, S);
});

test('боты на клетках: без обороны проигрыш, разумная оборона проходит заметно дальше', () => {
  for (const seed of [1, 2, 3]) {
    const r0 = play(idle, seed), r1 = play(smart, seed);
    assert.equal(r0.phase, 'lost'); assert.ok(r0.wave <= 4, `seed ${seed}: idle wave ${r0.wave}`);
    assert.ok(r1.wave >= r0.wave + 8, `seed ${seed}: smart wave ${r1.wave}, idle ${r0.wave}`);
  }
});
