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
  assert.equal(S.v, C.VERSION);
  assert.deepEqual(S.map, MAPGEN.generate(42));
  assert.notDeepEqual(SIM.create(43).map.road, S.map.road);
});

test('постройка на свободной клетке; отказ на дороге, на занятой клетке и без душ', () => {
  const S = SIM.create(5), road = S.map.road[10], free = freeCell(S);
  S.souls = 1000;
  assert.deepEqual(SIM.canBuild(S, road, 'bones'), { ok: false, reason: 'road', cost: T.bones.base.cost });
  SIM.step(S, { cmds: [{ k: 'build', cell: road, type: 'bones' }] });
  assert.equal(S.towers[road], null);
  const cb = SIM.canBuild(S, free, 'bones');
  assert.equal(cb.ok, true);
  SIM.step(S, { cmds: [{ k: 'build', cell: free, type: 'bones' }] });
  assert.equal(S.towers[free].type, 'bones'); assert.equal(S.souls, 1000 - cb.cost); assert.equal(S.towers[free].invested, cb.cost);
  assert.equal(SIM.canBuild(S, free, 'dark').reason, 'occupied');
  SIM.step(S, { cmds: [{ k: 'build', cell: free, type: 'dark' }] });
  assert.equal(S.towers[free].type, 'bones'); assert.equal(S.souls, 1000 - cb.cost);
  const other = freeCell(S); S.souls = T.bones.base.cost - 1;
  assert.equal(SIM.canBuild(S, other, 'bones').reason, 'souls');
  SIM.step(S, { cmds: [{ k: 'build', cell: other, type: 'bones' }] }); assert.equal(S.towers[other], null);
  assert.equal(SIM.canBuild(S, -1, 'bones').reason, 'bounds');
  assert.equal(SIM.canBuild(S, S.map.cols * S.map.rows, 'bones').reason, 'bounds');
});

test('три ветки качаются каждая отдельно до своего потолка; цена ступени растёт и берётся из конфига', () => {
  const S = SIM.create(5), cell = freeCell(S); S.souls = 1e6;
  SIM.step(S, { cmds: [{ k: 'build', cell, type: 'bones' }] });
  const tw = S.towers[cell];
  assert.deepEqual(C.TRACKS, ['dmg', 'range', 'rate']);
  for (const tr of C.TRACKS) assert.equal(tw.tracks[tr], 0);
  assert.equal(tw.cap, C.TRACK_MAX);
  const costs = T.bones.tracks.dmg.cost;
  assert.equal(costs.length, C.TRACK_MAX);
  for (let i = 1; i < costs.length; i++) assert.ok(costs[i] > costs[i - 1], 'цена ступени не растёт: ' + costs);
  // ступени урона одна за другой: каждая списывает свою цену, другие ветки не трогаются
  for (let i = 0; i < C.TRACK_MAX; i++) {
    const cu = SIM.canUpgrade(S, cell, 'dmg');
    assert.deepEqual(cu, { ok: true, reason: null, cost: costs[i] });
    const before = S.souls; SIM.step(S, { cmds: [{ k: 'upgrade', cell, track: 'dmg' }] });
    assert.equal(before - S.souls, costs[i]); assert.equal(tw.tracks.dmg, i + 1);
  }
  assert.equal(tw.tracks.range, 0); assert.equal(tw.tracks.rate, 0);
  assert.deepEqual(SIM.canUpgrade(S, cell, 'dmg'), { ok: false, reason: 'max', cost: null });
  const before = S.souls; SIM.step(S, { cmds: [{ k: 'upgrade', cell, track: 'dmg' }] });
  assert.equal(S.souls, before); assert.equal(tw.tracks.dmg, C.TRACK_MAX);
  // потолок — свойство башни (гибрид качается дальше): цены дальше конфига нет — ступень недоступна, а не бесплатна
  tw.cap = C.TRACK_MAX + 1;
  assert.equal(SIM.canUpgrade(S, cell, 'dmg').ok, costs.length > C.TRACK_MAX);
  // другая ветка — свои цены
  assert.equal(SIM.canUpgrade(S, cell, 'range').cost, T.bones.tracks.range.cost[0]);
  // отказы: нет ветки, нет башни, нет душ
  assert.equal(SIM.canUpgrade(S, cell, 'hp').reason, 'track');
  assert.equal(SIM.canUpgrade(S, S.map.road[0], 'dmg').reason, 'none');
  S.souls = T.bones.tracks.rate.cost[0] - 1;
  assert.deepEqual(SIM.canUpgrade(S, cell, 'rate'), { ok: false, reason: 'souls', cost: T.bones.tracks.rate.cost[0] });
  SIM.step(S, { cmds: [{ k: 'upgrade', cell, track: 'rate' }] }); assert.equal(tw.tracks.rate, 0);
});

test('у каждого старого типа три перка: оба прежних и третий новый', () => {
  const OLD = { bones: ['pierce', 'volley'], spirits: ['frost', 'pack'], plague: ['pestilence', 'acid'], dark: ['harvest', 'curse'] };
  for (const [type, old] of Object.entries(OLD)) {
    const ids = Object.keys(T[type].perks);
    assert.equal(ids.length, 3, type); for (const p of old) assert.ok(ids.includes(p), `${type}: нет перка ${p}`);
  }
});

test('перк недоступен до шести суммарных ступеней, берётся один раз и один из трёх', () => {
  const S = SIM.create(6), cell = freeCell(S); S.souls = 1e6;
  SIM.step(S, { cmds: [{ k: 'build', cell, type: 'spirits' }] });
  const tw = S.towers[cell], [p1, p2] = Object.keys(T.spirits.perks), up = (track) => SIM.step(S, { cmds: [{ k: 'upgrade', cell, track }] });
  // ступени в разные ветки: считается сумма
  for (let i = 0; i < C.PERK_AT - 1; i++) {
    const cp = SIM.canPerk(S, cell, p1);
    assert.equal(cp.ok, false); assert.equal(cp.reason, 'steps'); assert.equal(cp.need, C.PERK_AT - i);
    SIM.step(S, { cmds: [{ k: 'perk', cell, p: p1 }] }); assert.equal(tw.perk, null);
    up(C.TRACKS[i % C.TRACKS.length]);
  }
  assert.equal(SIM.canPerk(S, cell, p1).need, 1);
  up('rate');
  assert.equal(SIM.steps(tw), C.PERK_AT);
  assert.deepEqual(SIM.canPerk(S, cell, p1), { ok: true, reason: null, cost: T.spirits.perks[p1].cost, need: 0 });
  assert.equal(SIM.canPerk(S, cell, 'nope').reason, 'perk');
  const before = S.souls, inv = tw.invested;
  SIM.step(S, { cmds: [{ k: 'perk', cell, p: p1 }] });
  assert.equal(tw.perk, p1); assert.equal(before - S.souls, T.spirits.perks[p1].cost); assert.equal(tw.invested, inv + T.spirits.perks[p1].cost);
  // второй перк не берётся ни тот же, ни другой
  assert.equal(SIM.canPerk(S, cell, p1).reason, 'chosen'); assert.equal(SIM.canPerk(S, cell, p2).reason, 'taken');
  SIM.step(S, { cmds: [{ k: 'perk', cell, p: p2 }, { k: 'perk', cell, p: p1 }] });
  assert.equal(tw.perk, p1); assert.equal(before - S.souls, T.spirits.perks[p1].cost);
  // без душ — отказ с причиной
  const S2 = SIM.create(6); S2.souls = 1e6; SIM.step(S2, { cmds: [{ k: 'build', cell, type: 'dark' }] });
  for (let i = 0; i < C.PERK_AT; i++) SIM.step(S2, { cmds: [{ k: 'upgrade', cell, track: C.TRACKS[i % 2] }] });
  S2.souls = 0; assert.equal(SIM.canPerk(S2, cell, 'curse').reason, 'souls');
});

// башня type на лучшей клетке и враги-манекены (заморожены, очень живучие) на дороге на расстоянии dist px от неё
const tower = (S, cell, type, ups = []) => { S.souls = 1e6;
  SIM.step(S, { cmds: [{ k: 'build', cell, type }, ...ups.map((track) => ({ k: 'upgrade', cell, track }))] }); return S.towers[cell]; };
const dummies = (S, cell, enemy, dists) => {
  SIM.step(S, { cmds: [{ k: 'call' }] }); S.queue = []; S.qi = 0; S.enemies = []; S.shots = [];
  const [x, y] = SIM.cellXY(S, cell), L = SIM.pathLen(S);
  return dists.map((dist) => { let best = 0, bd = Infinity;
    for (let d = 0; d < L; d += 1) { const p = SIM.posAt(S, d), q = Math.abs(Math.hypot(p.x - x, p.y - y) - dist); if (q < bd) { bd = q; best = d; } }
    S.queue.push({ at: 0, e: enemy }); S.qi = S.queue.length - 1; S.waveT = 0; SIM.step(S, null);
    const e = S.enemies[S.enemies.length - 1]; e.d = best; e.lane = 0; e.freezeT = 1e9; e.hp = e.max = 1e6; return e; });
};
const hurt = (e) => e.max - e.hp;

test('итоговые характеристики башни отдаёт логика, и стреляет башня ровно ими', () => {
  const S = SIM.create(2), cell = freeCell(S), future = SIM.buildStats(S, cell, 'bones'), tw = tower(S, cell, 'bones');
  const st0 = SIM.towerStats(S, tw), next = SIM.towerStats(S, tw, 'dmg');
  assert.deepEqual(future, st0, 'характеристики будущей башни совпадают с построенной');
  for (const tr of C.TRACKS) SIM.step(S, { cmds: [{ k: 'upgrade', cell, track: tr }, { k: 'upgrade', cell, track: tr }] });
  const st = SIM.towerStats(S, tw);
  assert.ok(st.dmg > st0.dmg && st.range > st0.range && st.rate < st0.rate, 'ветки не меняют характеристики');
  assert.ok(next.dmg > st0.dmg && next.range === st0.range, 'превью следующей ступени');
  assert.equal(st.rangePx, st.range * C.UNIT);
  // враг чуть дальше базового радиуса, но ближе нового: башня до него достаёт
  const [e] = dummies(S, cell, 'militia', [(st0.rangePx + st.rangePx) / 2]);
  const fires = []; for (let i = 0; i < 120 * 6; i++) { SIM.step(S, null); for (const v of S.ev) if (v.k === 'fire' && !fires.includes(v.t)) fires.push(v.t); }
  assert.ok(fires.length >= 3, 'башня не стреляет по врагу в новом радиусе');
  const k = hurt(e) / st.dmg; assert.ok(k >= 2 && Math.abs(k - Math.round(k)) < 1e-6, `урон ${hurt(e)} не кратен урону башни ${st.dmg}`);
  const gap = fires[2] - fires[1]; assert.ok(Math.abs(gap - st.rate) <= S.dt * 1.01, `интервал ${gap} против ${st.rate}`);
});

// башня с перком p (или без перка) против манекенов enemy на расстоянии в полрадиуса; sec секунд боя
const perkFight = (type, p, enemy, n = 1, sec = 3) => {
  const S = SIM.create(2), cell = freeCell(S), ups = []; for (let i = 0; i < C.PERK_AT; i++) ups.push(C.TRACKS[i % 2]);
  const tw = tower(S, cell, type, ups); if (p) SIM.step(S, { cmds: [{ k: 'perk', cell, p }] });
  const r = SIM.towerStats(S, tw).rangePx * 0.5, es = dummies(S, cell, enemy, Array.from({ length: n }, (_, i) => r + i * 6));
  const clouds = []; for (let i = 0; i < sec / S.dt; i++) { SIM.step(S, null); for (const c of S.clouds) if (!clouds.includes(c)) clouds.push(c); }
  return { S, tw, es, clouds, st: SIM.towerStats(S, tw) };
};
test('новые перки: Бронебой, Могильный холод, Миазмы, Расщеплённый луч', () => {
  // Бронебой: болт по рыцарю теряет от брони вдвое меньше
  const plain = perkFight('bones', null, 'knight'), crush = perkFight('bones', 'crush', 'knight'), armor = C.ENEMIES.knight.armor;
  const ratio = hurt(crush.es[0]) / hurt(plain.es[0]);
  assert.ok(Math.abs(ratio - (1 - armor * (1 - T.bones.perks.crush.pen)) / (1 - armor)) < 0.02, 'бронебой: отношение урона ' + ratio.toFixed(3));
  // Могильный холод: замедление сильнее и дольше, и это видно в итоговых характеристиках
  const sp = perkFight('spirits', 'pack', 'militia'), ch = perkFight('spirits', 'chill', 'militia');
  assert.ok(ch.st.slow > sp.st.slow && ch.st.slowTime > sp.st.slowTime);
  assert.ok(Math.abs(ch.es[0].slowK - ch.st.slow) < 1e-9, `замедление врага ${ch.es[0].slowK} против ${ch.st.slow}`);
  assert.ok(ch.es[0].slowT > sp.st.slowTime, 'замедление держится дольше');
  // Миазмы: облако шире и живёт дольше
  const ac = perkFight('plague', 'acid', 'militia'), mi = perkFight('plague', 'miasma', 'militia');
  assert.ok(mi.clouds.length && ac.clouds.length);
  assert.ok(mi.clouds[0].r > ac.clouds[0].r && mi.clouds[0].T > ac.clouds[0].T);
  assert.equal(mi.clouds[0].r, mi.st.cloudR * C.UNIT); assert.equal(mi.clouds[0].T, mi.st.cloudTime);
  // Расщеплённый луч: второй по живучести враг получает половину урона первого
  const sl = perkFight('dark', 'split', 'militia', 2, 0.5), cu = perkFight('dark', 'curse', 'militia', 2, 0.5);   // один выстрел
  assert.ok(hurt(sl.es[0]) > 0 && hurt(sl.es[1]) > 0, 'луч не задел вторую цель');
  assert.equal(hurt(cu.es[1]), 0);
  const [a, b] = sl.es.map(hurt).sort((x, y) => y - x);
  assert.ok(Math.abs(b / a - T.dark.perks.split.mult) < 0.01, 'вторая цель: ' + (b / a).toFixed(3));
});

test('вид башни растёт с суммой ступеней, точка выстрела поднимается вместе с ним и не уходит под HUD', () => {
  const S = SIM.create(8), cell = freeCell(S), tw = tower(S, cell, 'dark'), looks = [SIM.look(tw)], muz = [SIM.muzzle(S, tw)[1]];
  for (let i = 0; i < C.TRACK_MAX * C.TRACKS.length; i++) { SIM.step(S, { cmds: [{ k: 'upgrade', cell, track: C.TRACKS[i % C.TRACKS.length] }] });
    looks.push(SIM.look(tw)); muz.push(SIM.muzzle(S, tw)[1]); }
  assert.equal(looks[0], 1); assert.equal(looks[looks.length - 1], C.LOOK_AT.length + 1);
  for (let i = 1; i < looks.length; i++) { assert.ok(looks[i] >= looks[i - 1]); assert.ok(muz[i] <= muz[i - 1]); }
  for (const [n, lk] of C.LOOK_AT.map((n, i) => [n, i + 2])) assert.equal(looks[n], lk, `при ${n} ступенях вид ${lk}`);
  // башня в верхнем ряду: выстрел не из-под плашек HUD
  const top = SIM.create(8); top.souls = 1e6;
  const c1 = Array.from({ length: top.map.cols }, (_, x) => top.map.cols + x).find((c) => SIM.canBuild(top, c, 'dark').ok);
  SIM.step(top, { cmds: [{ k: 'build', cell: c1, type: 'dark' }] });
  for (const k of C.TRACKS) for (let i = 0; i < C.TRACK_MAX; i++) SIM.step(top, { cmds: [{ k: 'upgrade', cell: c1, track: k }] });
  assert.equal(SIM.look(top.towers[c1]), C.LOOK_AT.length + 1);
  assert.ok(SIM.muzzle(top, top.towers[c1])[1] >= C.VIEW_TOP);
});

test('продажа возвращает 70% всего вложенного (постройка, ступени веток, перк) и освобождает клетку', () => {
  const S = SIM.create(3), cell = freeCell(S); S.souls = 1e5;
  const ups = []; for (let i = 0; i < C.PERK_AT; i++) ups.push(C.TRACKS[i % C.TRACKS.length]);
  const p = Object.keys(T.dark.perks)[0];
  SIM.step(S, { cmds: [{ k: 'build', cell, type: 'dark' }, ...ups.map((track) => ({ k: 'upgrade', cell, track })), { k: 'perk', cell, p }] });
  const tw = S.towers[cell], n = C.PERK_AT / C.TRACKS.length;
  let invested = T.dark.base.cost + T.dark.perks[p].cost;
  for (const tr of C.TRACKS) for (let i = 0; i < n; i++) invested += T.dark.tracks[tr].cost[i];
  assert.equal(tw.perk, p); assert.equal(tw.invested, invested); assert.equal(1e5 - S.souls, invested);
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
  for (const type of C.TOWER_ORDER) assert.equal(SIM.buildRangePx(S, cell, type), T[type].base.range * 48);
  SIM.step(S, { cmds: [{ k: 'build', cell, type: 'bones' }] });
  assert.equal(SIM.towerStats(S, S.towers[cell]).rangePx, T.bones.base.range * 48);
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
  for (const c of S.clouds) assert.ok(Number.isFinite(c.dps) && c.dps === T.plague.base.dmg, 'dps облака ' + c.dps);
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
  assert.equal(SIM.loadable(Object.assign({}, S, { v: C.VERSION - 1 })), false);
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
