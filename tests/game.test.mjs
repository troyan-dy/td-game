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
// свободная клетка у дороги без бонуса особой клетки
const freeCell = (S) => SIM.rankCells(S, 3).find((c) => !S.map.specials.some((s) => s.cell === c));
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
  assert.deepEqual(SIM.canBuild(S, road, 'bones'), { ok: false, reason: 'road', cost: T.bones.cost[0], base: T.bones.cost[0] });
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
  assert.equal(SIM.rangePx(S, S.towers[cell]), T.bones.range[0] * 48);
});

// ---- препятствия и особые клетки
const specialCell = (S, kind) => S.map.specials.find((s) => s.kind === kind).cell;
// башня type, построенная на клетке cell (а если задано moveTo — перенесённая туда командой move до волны), один раз бьёт
// неподвижного врага с HP hp; очередь волны держится непустой, чтобы волна не закончилась. Возвращает { tw, e, S }
const strike = (seed, cell, type, hp = 1e6, moveTo) => {
  const S = SIM.create(seed); S.souls = 1e4;
  SIM.step(S, { cmds: [{ k: 'build', cell, type }] });
  if (moveTo !== undefined) { SIM.step(S, { cmds: [{ k: 'move', cell, to: moveTo }] }); assert.ok(S.towers[moveTo], 'перенос не прошёл'); cell = moveTo; }
  SIM.step(S, { cmds: [{ k: 'call' }] }); SIM.step(S, null);
  S.queue = [{ at: 1e9, e: 'militia' }]; S.qi = 0;
  const tw = S.towers[cell], e = S.enemies[0], [x, y] = SIM.cellXY(S, cell);
  const far = (d) => Math.hypot(SIM.posAt(S, d).x - x, SIM.posAt(S, d).y - y);   // враг — в ближайшей к башне точке дороги
  let d = 0; for (let q = 0; q < SIM.pathLen(S); q += 4) if (far(q) < far(d)) d = q;
  assert.ok(far(d) < SIM.rangePx(S, tw) - 20, 'дорога вне радиуса башни');
  e.d = d; e.freezeT = 1e9; e.hp = e.max = hp; S.enemies = [e]; SIM.step(S, null);
  for (let i = 0; i < 120 * 10 && (e.hp === e.max && !e.dead); i++) SIM.step(S, null);
  return { tw, e, S };
};

test('постройка на препятствии отклоняется, препятствия не попадают в места под постройку', () => {
  const S = SIM.create(5); S.souls = 1e4;
  assert.ok(S.map.obstacles.length > 0);
  for (const { cell } of S.map.obstacles) assert.equal(SIM.canBuild(S, cell, 'bones').reason, 'obstacle', 'клетка ' + cell);
  SIM.step(S, { cmds: S.map.obstacles.map(({ cell }) => ({ k: 'build', cell, type: 'bones' })) });
  assert.ok(S.towers.every((t) => !t)); assert.equal(S.souls, 1e4);
  const ob = new Set(S.map.obstacles.map((o) => o.cell));
  assert.ok(SIM.rankCells(S, 3).every((c) => !ob.has(c)));
});

test('курган: +1 единица дальности (48 px) башне и кругу будущей башни', () => {
  const S = SIM.create(5), mound = specialCell(S, 'mound'), plain = freeCell(S); S.souls = 1e4;
  assert.equal(SIM.buildRangePx(S, mound, 'bones'), (3.6 + 1) * 48);
  assert.equal(SIM.buildRangePx(S, plain, 'bones'), 3.6 * 48);
  SIM.step(S, { cmds: [{ k: 'build', cell: mound, type: 'bones' }, { k: 'build', cell: plain, type: 'dark' }] });
  assert.equal(SIM.rangePx(S, S.towers[mound]), (3.6 + 1) * 48);
  assert.equal(SIM.rangePx(S, S.towers[plain]), 3.2 * 48);
  assert.equal(SIM.cellBonus(S, mound).kind, 'mound'); assert.equal(SIM.cellBonus(S, plain), null);
});

test('проклятая земля: постройка на 30% дороже и +25% урона', () => {
  const S = SIM.create(5), cursed = specialCell(S, 'cursed'), plain = freeCell(S); S.souls = 1000;
  assert.equal(SIM.canBuild(S, cursed, 'bones').cost, 130);
  assert.equal(SIM.canBuild(S, cursed, 'dark').cost, 195);
  assert.equal(SIM.canBuild(S, plain, 'dark').cost, 150);
  SIM.step(S, { cmds: [{ k: 'build', cell: cursed, type: 'dark' }] });
  assert.equal(S.souls, 1000 - 195); assert.equal(S.towers[cursed].invested, 195);
  const P = SIM.create(5); P.souls = 194;
  assert.equal(SIM.canBuild(P, cursed, 'dark').reason, 'souls'); assert.equal(SIM.canBuild(P, plain, 'dark').ok, true);
  // луч Тьмы уровня 1 — 20 урона, по ополченцу без защиты
  assert.equal(strike(5, cursed, 'dark').tw.dmg, 25);
  assert.equal(strike(5, plain, 'dark').tw.dmg, 20);
});

test('источник душ: +1 душа за каждое убийство башней на этой клетке', () => {
  const seed = 5, S0 = SIM.create(seed), well = specialCell(S0, 'well'), plain = freeCell(S0);
  const gain = (cell) => { const r = strike(seed, cell, 'bones', 1);
    assert.equal(r.e.dead, true, 'враг не убит'); assert.equal(r.tw.kills, 1); return r.S.stats.earned - r.e.bounty; };
  assert.equal(gain(well), 1);
  assert.equal(gain(plain), 0);
});

test('перенос и особые клетки: на препятствие нельзя, бонус берётся от новой клетки, наценка не взимается', () => {
  const S = SIM.create(5), mound = specialCell(S, 'mound'), cursed = specialCell(S, 'cursed'), well = specialCell(S, 'well'), plain = freeCell(S); S.souls = 1e4;
  SIM.step(S, { cmds: [{ k: 'build', cell: mound, type: 'bones' }] });
  const tw = S.towers[mound]; assert.equal(SIM.rangePx(S, tw), (3.6 + 1) * 48);
  // на препятствие перенос отклонён
  const ob = S.map.obstacles.find((o) => o.kind !== 'arch').cell;
  assert.equal(SIM.canMove(S, mound, ob).reason, 'obstacle');
  SIM.step(S, { cmds: [{ k: 'move', cell: mound, to: ob }] }); assert.equal(S.towers[ob], null); assert.equal(S.towers[mound], tw);
  // с кургана на обычную клетку: +1 к дальности снимается
  SIM.step(S, { cmds: [{ k: 'move', cell: mound, to: plain }] }); assert.equal(S.towers[plain], tw);
  assert.equal(SIM.rangePx(S, tw), 3.6 * 48);
  // на проклятую землю: бесплатно, вложения прежние
  const souls = S.souls, invested = tw.invested;
  SIM.step(S, { cmds: [{ k: 'move', cell: plain, to: cursed }] }); assert.equal(S.towers[cursed], tw);
  assert.equal(S.souls, souls); assert.equal(tw.invested, invested);
  // перенесённая на проклятую землю Тьма бьёт на 25% сильнее (20 → 25), на источнике душ башня начинает давать +1 душу
  assert.equal(strike(5, plain, 'dark', 1e6, cursed).tw.dmg, 25);
  const r = strike(5, plain, 'bones', 1, well); assert.equal(r.e.dead, true); assert.equal(r.S.stats.earned - r.e.bounty, 1);
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

test('башня, убранная из состояния между шагами (не командой), больше не числится за снарядами и облаками', () => {
  const S = SIM.create(4), cell = freeCell(S); S.souls = 1e5;
  SIM.step(S, { cmds: [{ k: 'build', cell, type: 'plague' }, { k: 'call' }] });
  for (let i = 0; i < 120 * 120 && !S.shots.some((s) => s.k === 'blob'); i++) SIM.step(S, null);
  SIM.step(S, null); S.towers[cell] = null;                       // так башню снимут перенос и слияние — мимо doCmd
  for (let i = 0; i < 120 && !S.clouds.length; i++) SIM.step(S, null);
  assert.ok(S.clouds.length, 'облако не появилось');
  SIM.step(S, null);
  for (const c of S.clouds) assert.ok(c.t <= 0.5, 'облако башни, которой нет, живёт ' + c.t.toFixed(2) + ' с');
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

// ---------------------------------------------------------------- перенос башни между волнами
// забег с башней type на лучшей клетке, прокачанной до 3-го уровня с перком, после первой волны (есть убийства и урон)
const veteran = (seed, type, perk) => {
  const S = SIM.create(seed); S.souls = 1e5; const cell = SIM.rankCells(S, 3.4)[0];
  SIM.step(S, { cmds: [{ k: 'build', cell, type }, { k: 'upgrade', cell }, { k: 'upgrade', cell }, { k: 'perk', cell, p: perk }, { k: 'call' }] });
  const tw = S.towers[cell];                                        // подготовка сработала: иначе тесты «сохраняет прокачку» проверят пустую башню
  assert.ok(tw && tw.perk === perk && tw.invested > T[type].cost[0], `прокачка не применилась: ${JSON.stringify(tw)}`);
  for (let i = 0; i < 120 * 300 && S.phase === 'wave'; i++) SIM.step(S, null);
  return { S, cell };
};
test('перенос в паузе между волнами: бесплатно, мгновенно, башня та же — уровень, перк, вложения и счётчики', () => {
  const { S, cell } = veteran(5, 'bones', 'volley');
  assert.equal(S.phase, 'prep'); assert.equal(S.wave, 1);
  const tw = S.towers[cell]; assert.ok(tw.kills > 0 && tw.dmg > 0, 'башня не воевала');
  const R = JSON.parse(JSON.stringify(S)), souls = S.souls, spent = S.stats.spent;   // контроль: тот же шаг без переноса
  const to = SIM.rankCells(S, 3.4).find((c) => c !== cell);
  assert.deepEqual(SIM.canMove(S, cell), { ok: true, reason: null });
  assert.deepEqual(SIM.canMove(S, cell, to), { ok: true, reason: null });
  SIM.step(S, { cmds: [{ k: 'move', cell, to }] }); SIM.step(R, null);
  assert.equal(S.towers[cell], null);
  assert.equal(S.towers[to], tw, 'перенесён тот же объект башни');
  assert.deepEqual(JSON.parse(JSON.stringify(tw)), Object.assign(R.towers[cell], { cell: to }), 'у башни поменялась только клетка');
  assert.equal(S.souls, souls); assert.equal(S.stats.spent, spent);
  assert.ok(S.ev.some((e) => e.k === 'move' && e.from === cell && e.cell === to), 'нет события move');
  assert.equal(SIM.canBuild(S, cell, 'bones').ok, true, 'старая клетка не освободилась');
});
test('перенос отклоняется: во время волны, на дорогу, на занятую клетку, под интерфейс, за поле, на ту же клетку, с пустой клетки, после конца', () => {
  const S = SIM.create(7); S.souls = 1e5; const [a, b, c] = SIM.rankCells(S, 3.4), road = S.map.road[12], hud = 0;
  SIM.step(S, { cmds: [{ k: 'build', cell: a, type: 'dark' }, { k: 'build', cell: b, type: 'bones' }] });
  const tried = (to, reason) => { assert.equal(SIM.canMove(S, a, to).reason, reason, `на ${to}`);
    const snap = JSON.stringify(S.towers); SIM.step(S, { cmds: [{ k: 'move', cell: a, to }] });
    assert.equal(JSON.stringify(S.towers.map((t) => t && t.cell)), JSON.stringify(JSON.parse(snap).map((t) => t && t.cell)), `перенос на ${to} прошёл`); };
  tried(road, 'road'); tried(b, 'occupied'); tried(hud, 'hud'); tried(-1, 'bounds'); tried(S.map.cols * S.map.rows, 'bounds'); tried(a, 'same');
  assert.equal(SIM.canMove(S, c).reason, 'none'); assert.deepEqual(SIM.moveCells(S, c), []);
  SIM.step(S, { cmds: [{ k: 'move', cell: c, to: SIM.rankCells(S, 3.4)[0] }] }); assert.equal(S.towers.filter(Boolean).length, 2);
  SIM.step(S, { cmds: [{ k: 'call' }] }); assert.equal(S.phase, 'wave');
  assert.equal(SIM.canMove(S, a).reason, 'phase'); assert.deepEqual(SIM.moveCells(S, a), []);
  tried(c, 'phase');
  S.phase = 'lost'; assert.equal(SIM.canMove(S, a).reason, 'ended');
});
test('перенос разрешён ровно там, где этот тип можно построить, — при любых душах (правила клетки общие с постройкой)', () => {
  for (const seed of [1, 2, 3]) {
    const S = SIM.create(seed); S.souls = 1e5; const [a, b] = SIM.rankCells(S, 3.4);
    SIM.step(S, { cmds: [{ k: 'build', cell: a, type: 'plague' }, { k: 'build', cell: b, type: 'spirits' }] });
    for (const souls of [1e9, 0]) {
      S.souls = souls; const want = [];
      for (let i = 0; i < S.map.cols * S.map.rows; i++) { S.souls = 1e9; const ok = i !== a && SIM.canBuild(S, i, 'plague').ok; S.souls = souls;
        assert.equal(SIM.canMove(S, a, i).ok, ok, `сид ${seed}, клетка ${i}, души ${souls}`); if (ok) want.push(i); }
      assert.deepEqual(SIM.moveCells(S, a), want);
    }
  }
});
test('перенос переживает облака, снаряды и яд: они числятся за башней по id, она стреляет уже с новой клетки', () => {
  const S = SIM.create(4); S.souls = 1e5; const [a, b] = SIM.rankCells(S, 3.4);
  SIM.step(S, { cmds: [{ k: 'build', cell: a, type: 'plague' }, { k: 'build', cell: b, type: 'bones' }, { k: 'call' }] });
  const tw = S.towers[a], id = tw.id;
  while (S.phase === 'wave') SIM.step(S, null);
  const cloud = S.clouds.find((c) => c.tw === id && c.t > 1); assert.ok(cloud, 'после волны не осталось облака котла (сид 4)');
  const to = SIM.moveCells(S, a).find((c) => SIM.coverage(S, c, 3) > 300 && Math.hypot(...SIM.cellXY(S, c).map((v, k) => v - SIM.cellXY(S, a)[k])) > 200);
  const t0 = cloud.t; SIM.step(S, { cmds: [{ k: 'move', cell: a, to }, { k: 'build', cell: a, type: 'dark' }] });
  assert.equal(S.towers[to], tw); assert.equal(S.towers[a].type, 'dark');
  assert.ok(S.clouds.includes(cloud) && Math.abs(cloud.t - (t0 - S.dt)) < 1e-9, `облако перенесённой башни погасло: ${cloud.t}`);
  const dmg0 = tw.dmg, [mx, my] = SIM.muzzle(S, tw); let fired = 0, poisoned = 0;
  SIM.step(S, { cmds: [{ k: 'call' }] });
  while (S.phase === 'wave') { SIM.step(S, null);
    for (const e of S.ev) if (e.k === 'fire' && e.type === 'plague' && e.t === S.t) { fired++; assert.deepEqual([e.x, e.y, e.cell], [mx, my, to]); }
    for (const s of S.shots) if (s.k === 'blob') assert.equal(s.tw, id);
    for (const e of S.enemies) for (const p of Object.values(e.poison)) { assert.equal(p.tw, id); poisoned++; } }
  assert.ok(fired > 0 && poisoned > 0, `котёл с новой клетки не воевал: выстрелов ${fired}, отравлений ${poisoned}`);
  assert.ok(tw.dmg > dmg0, 'урон после переноса не идёт в счёт башни');
});
test('перенесённая башня — как построенная на новой клетке, на любой допустимой клетке; перенос не стоит душ', () => {
  // особые клетки (курган, источник, проклятая земля) берутся от клетки башни: башня не хранит ничего клеточного, кроме самой клетки,
  // а перенос не списывает души — поэтому бонус новой клетки приходит сам, а наценка постройки не взимается.
  // Обход всех клеток moveCells: после появления особых клеток тест сам покрывает и их.
  // own — поля башни без тех, что у построенной и перенесённой законно разные (id, таймеры, вложено: наценка клетки)
  const own = (t) => { const o = Object.assign({}, t); for (const k of ['id', 'cd', 'fireT', 'built', 'invested']) delete o[k]; return o; };
  for (const type of C.TOWER_ORDER) {
    const A = SIM.create(6); A.souls = 1e5; const x = SIM.rankCells(A, 3.4)[0], B = JSON.parse(JSON.stringify(A));
    const perk = Object.keys(T[type].perks)[0], grow = (cell) => [{ k: 'build', cell, type }, { k: 'upgrade', cell }, { k: 'upgrade', cell }, { k: 'perk', cell, p: perk }];
    const grown = (t) => assert.ok(t && t.perk === perk && t.invested > T[type].cost[0], `прокачка не применилась: ${JSON.stringify(t)}`);
    SIM.step(A, { cmds: grow(x) }); const tw = A.towers[x]; grown(tw);
    const invested = tw.invested, cells = SIM.moveCells(A, x); let cur = x;
    assert.ok(cells.length > 100, 'мало клеток для переноса: ' + cells.length);
    for (const c of cells) {
      SIM.step(B, { cmds: grow(c) }); const tb = B.towers[c]; grown(tb);     // эталон: такая же башня, построенная прямо на c
      const souls = A.souls, preview = SIM.moveRangePx(A, cur, c);
      SIM.step(A, { cmds: [{ k: 'move', cell: cur, to: c }] }); cur = c;
      assert.equal(A.towers[c], tw, `${type}: перенос на ${c} не прошёл`);
      assert.equal(A.souls, souls, `${type}: перенос на ${c} стоил душ`); assert.equal(tw.invested, invested, `${type}: перенос на ${c} изменил вложенное`);
      assert.equal(preview, SIM.rangePx(B, tb), `${type}: превью радиуса на ${c} не равно радиусу построенной там башни`);
      assert.equal(SIM.rangePx(A, tw), SIM.rangePx(B, tb), `${type}: радиус на ${c}`); assert.deepEqual(SIM.muzzle(A, tw), SIM.muzzle(B, tb));
      assert.deepEqual(own(tw), own(tb), `${type}: на ${c} перенесённая башня отличается от построенной`);
      SIM.step(B, { cmds: [{ k: 'sell', cell: c }] });
    }
  }
});
test('состояние после переноса сериализуется без потерь', () => {
  const { S, cell } = veteran(3, 'plague', 'acid'), to = SIM.moveCells(S, cell)[5];
  SIM.step(S, { cmds: [{ k: 'move', cell, to }, { k: 'call' }] });
  const R = JSON.parse(JSON.stringify(S)); for (let i = 0; i < 120 * 20; i++) { SIM.step(S, null); SIM.step(R, null); }
  assert.deepEqual(R, S); assert.equal(R.towers[to].cell, to);
});
