// node --test tests/*.test.mjs — забег на сгенерированной карте: команды, шаг времени, детерминизм, сейв, демо; боты — по tests/runs.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { SIM, play, smart, planned } from './bots.mjs';
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
  assert.equal(S.v, C.VERSION);
  assert.deepEqual(S.map, MAPGEN.generate(42));
  assert.notDeepEqual(SIM.create(43).map.road, S.map.road);
});

test('постройка на свободной клетке; отказ на дороге, на занятой клетке и без душ', () => {
  const S = SIM.create(5), road = S.map.road[10], free = freeCell(S);
  S.souls = 1000;
  assert.deepEqual(SIM.canBuild(S, road, 'bones'), { ok: false, reason: 'road', cost: T.bones.base.cost, base: T.bones.base.cost });
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

test('три ветки качаются каждая отдельно до своего потолка; цена ступени растёт (у гибрида — своим рядом) и берётся из конфига', () => {
  const S = SIM.create(5), cell = freeCell(S); S.souls = 1e6;
  SIM.step(S, { cmds: [{ k: 'build', cell, type: 'bones' }] });
  const tw = S.towers[cell];
  assert.deepEqual(C.TRACKS, ['dmg', 'range', 'rate']);
  for (const tr of C.TRACKS) assert.equal(tw.tracks[tr], 0);
  assert.equal(tw.cap, C.TRACK_MAX);
  const costs = T.bones.tracks.dmg.cost;
  assert.ok(costs.length >= C.TRACK_MAX, 'цен меньше, чем ступеней обычной башни');
  // цена растёт в ступенях обычной башни (1..TRACK_MAX) и отдельно в ступенях гибрида (дальше, до C.MERGE.cap)
  for (let i = 1; i < costs.length; i++) if (i !== C.TRACK_MAX) assert.ok(costs[i] > costs[i - 1], 'цена ступени не растёт: ' + costs);
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
  // потолок — свойство башни: поднятый потолок (гибрид) открывает следующие ступени по ценам из конфига
  tw.cap = C.TRACK_MAX + 1;
  assert.deepEqual(SIM.canUpgrade(S, cell, 'dmg'), { ok: true, reason: null, cost: costs[C.TRACK_MAX] });
  // потолок выше списка цен: ступень недоступна со своей причиной, а не «максимум» и не бесплатно
  tw.cap = costs.length + 1; tw.tracks.dmg = costs.length;
  assert.deepEqual(SIM.canUpgrade(S, cell, 'dmg'), { ok: false, reason: 'price', cost: null });
  const was = S.souls; SIM.step(S, { cmds: [{ k: 'upgrade', cell, track: 'dmg' }] }); assert.equal(S.souls, was); assert.equal(tw.tracks.dmg, costs.length);
  tw.cap = C.TRACK_MAX; tw.tracks.dmg = C.TRACK_MAX;
  // другая ветка — свои цены
  assert.equal(SIM.canUpgrade(S, cell, 'range').cost, T.bones.tracks.range.cost[0]);
  // отказы: нет ветки, нет башни, нет душ
  for (const junk of ['hp', 'constructor', '__proto__', 'toString', ['dmg'], null, 1]) assert.equal(SIM.canUpgrade(S, cell, junk).reason, 'track', String(junk));
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
    SIM.step(S, { cmds: [{ k: 'perk', cell, p: p1 }] }); assert.deepEqual(SIM.perksOf(tw), []);
    up(C.TRACKS[i % C.TRACKS.length]);
  }
  assert.equal(SIM.canPerk(S, cell, p1).need, 1);
  up('rate');
  assert.equal(SIM.steps(tw), C.PERK_AT);
  assert.deepEqual(SIM.canPerk(S, cell, p1), { ok: true, reason: null, cost: T.spirits.perks[p1].cost, need: 0 });
  assert.equal(SIM.canPerk(S, cell, 'nope').reason, 'perk');
  const before = S.souls, inv = tw.invested;
  SIM.step(S, { cmds: [{ k: 'perk', cell, p: p1 }] });
  assert.deepEqual(SIM.perksOf(tw), [p1]); assert.ok(SIM.hasPerk(tw, p1)); assert.equal(SIM.freeSlots(tw), 0);
  assert.equal(before - S.souls, T.spirits.perks[p1].cost); assert.equal(tw.invested, inv + T.spirits.perks[p1].cost);
  // второй перк не берётся ни тот же, ни другой
  assert.equal(SIM.canPerk(S, cell, p1).reason, 'chosen'); assert.equal(SIM.canPerk(S, cell, p2).reason, 'taken');
  SIM.step(S, { cmds: [{ k: 'perk', cell, p: p2 }, { k: 'perk', cell, p: p1 }] });
  assert.deepEqual(SIM.perksOf(tw), [p1]); assert.equal(before - S.souls, T.spirits.perks[p1].cost);
  // без душ — отказ с причиной
  const S2 = SIM.create(6); S2.souls = 1e6; SIM.step(S2, { cmds: [{ k: 'build', cell, type: 'dark' }] });
  for (let i = 0; i < C.PERK_AT; i++) SIM.step(S2, { cmds: [{ k: 'upgrade', cell, track: C.TRACKS[i % 2] }] });
  S2.souls = 0; assert.equal(SIM.canPerk(S2, cell, 'curse').reason, 'souls');
  // перк чужого типа не берётся
  S2.souls = 1e6; assert.equal(SIM.canPerk(S2, cell, p1).reason, 'perk');
});

test('имя перка или ветки из команды — только строка и собственный ключ данных: мусор не портит забег', () => {
  const S = SIM.create(6), cell = freeCell(S), tw = tower(S, cell, 'bones', C.TRACKS.concat(C.TRACKS)), souls = S.souls, inv = tw.invested;
  assert.equal(SIM.steps(tw), C.PERK_AT);
  const junk = ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf', ['pierce'], { p: 1 }, null, undefined, 3];
  for (const p of junk) assert.equal(SIM.canPerk(S, cell, p).reason, 'perk', String(p));
  for (const track of junk) assert.equal(SIM.canUpgrade(S, cell, track).reason, 'track', String(track));
  for (const type of junk) assert.equal(SIM.canBuild(S, SIM.rankCells(S, 3)[0], type).reason, 'type', String(type));
  SIM.step(S, { cmds: [...junk.map((p) => ({ k: 'perk', cell, p })), ...junk.map((track) => ({ k: 'upgrade', cell, track })),
    ...junk.map((type) => ({ k: 'build', cell: SIM.rankCells(S, 3)[0], type }))] });
  assert.equal(S.souls, souls); assert.equal(tw.invested, inv); assert.deepEqual(SIM.perksOf(tw), []);
  assert.equal(S.towers.filter(Boolean).length, 1);
  assert.ok(SIM.loadable(JSON.parse(JSON.stringify(S))), 'после мусорных команд сейв негоден');
});

test('перки — список со слотами: у обычной башни один слот, башня с двумя слотами держит два перка', () => {
  const S = SIM.create(6), cell = freeCell(S), ups = []; for (let i = 0; i < C.PERK_AT; i++) ups.push(C.TRACKS[i % C.TRACKS.length]);
  const tw = tower(S, cell, 'dark', ups), [a, b, c] = Object.keys(T.dark.perks);
  assert.equal(tw.slots, C.PERK_SLOTS); assert.equal(SIM.freeSlots(tw), 1);
  tw.slots = 2;                                                     // так гибрид получит второй слот
  SIM.step(S, { cmds: [{ k: 'perk', cell, p: a }, { k: 'perk', cell, p: b }, { k: 'perk', cell, p: c }] });
  assert.deepEqual(SIM.perksOf(tw), [a, b]); assert.equal(SIM.freeSlots(tw), 0);
  assert.equal(SIM.canPerk(S, cell, c).reason, 'taken'); assert.equal(SIM.canPerk(S, cell, a).reason, 'chosen');
  // оба перка работают: их параметры — в итоговых характеристиках
  const st = SIM.towerStats(S, tw); assert.equal(st.harvest, T.dark.perks.harvest.set.harvest); assert.equal(st.curse, T.dark.perks.curse.set.curse);
  assert.ok(SIM.loadable(JSON.parse(JSON.stringify(S))));
  // сейв с перком сверх слотов или неизвестным перком негоден
  const bad = JSON.parse(JSON.stringify(S)); bad.towers[cell].perks.push(c); assert.equal(SIM.loadable(bad), false);
  const bad2 = JSON.parse(JSON.stringify(S)); bad2.towers[cell].perks = ['constructor']; assert.equal(SIM.loadable(bad2), false);
  const bad3 = JSON.parse(JSON.stringify(S)); bad3.towers[cell].type = '__proto__'; assert.equal(SIM.loadable(bad3), false);
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
test('новые перки: Бронебой, Могильный холод, Миазмы, Двойной луч', () => {
  // Бронебой: болт по рыцарю теряет от брони вдвое меньше
  const plain = perkFight('bones', null, 'knight'), crush = perkFight('bones', 'crush', 'knight'), armor = C.ENEMIES.knight.armor;
  const ratio = hurt(crush.es[0]) / hurt(plain.es[0]);
  assert.ok(Math.abs(ratio - (1 - armor * (1 - T.bones.perks.crush.set.pen)) / (1 - armor)) < 0.02, 'бронебой: отношение урона ' + ratio.toFixed(3));
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
  // Двойной луч: второй по живучести враг получает половину урона первого
  const sl = perkFight('dark', 'split', 'militia', 2, 0.5), cu = perkFight('dark', 'curse', 'militia', 2, 0.5);   // один выстрел
  assert.ok(hurt(sl.es[0]) > 0 && hurt(sl.es[1]) > 0, 'луч не задел вторую цель');
  assert.equal(hurt(cu.es[1]), 0);
  const [a, b] = sl.es.map(hurt).sort((x, y) => y - x);
  assert.ok(Math.abs(b / a - T.dark.perks.split.set.split) < 0.01, 'вторая цель: ' + (b / a).toFixed(3));
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

test('замедление: более слабое не продлевает более сильное', () => {
  // Фонарь с «Могильным холодом» и обычный Фонарь бьют одного врага; сильный снимаем — его замедление кончается в свой срок,
  // хотя обычный продолжает попадать, и дальше на враге остаётся слабое
  const S = SIM.create(2), [a, b] = SIM.rankCells(S, C.TYPICAL_RANGE), ups = []; for (let i = 0; i < C.PERK_AT; i++) ups.push(C.TRACKS[i % C.TRACKS.length]);
  const cold = tower(S, a, 'spirits', ups); SIM.step(S, { cmds: [{ k: 'perk', cell: a, p: 'chill' }] });
  const plain = tower(S, b, 'spirits', ups); const strong = SIM.towerStats(S, cold), weak = SIM.towerStats(S, plain);
  assert.ok(strong.slow > weak.slow && strong.slowTime > weak.slowTime);
  const r = Math.min(strong.rangePx, weak.rangePx), [ax, ay] = SIM.cellXY(S, a), [bx, by] = SIM.cellXY(S, b);
  SIM.step(S, { cmds: [{ k: 'call' }] }); S.queue = []; S.qi = 0; S.enemies = []; S.shots = [];
  let best = -1; for (let d = 0; d < SIM.pathLen(S); d++) { const p = SIM.posAt(S, d); if (Math.hypot(p.x - ax, p.y - ay) < r * 0.8 && Math.hypot(p.x - bx, p.y - by) < r * 0.8) { best = d; break; } }
  assert.ok(best >= 0, 'нет точки дороги в радиусе обоих');
  S.queue.push({ at: 0, e: 'militia' }); SIM.step(S, null); const e = S.enemies[0]; e.d = best; e.lane = 0; e.freezeT = 1e9; e.hp = e.max = 1e9;
  for (let i = 0; i < 4 / S.dt && e.slowK < strong.slow - 1e-9; i++) SIM.step(S, null);
  assert.ok(Math.abs(e.slowK - strong.slow) < 1e-9, 'сильное замедление не легло');
  SIM.step(S, { cmds: [{ k: 'sell', cell: a }] }); S.shots = S.shots.filter((s) => s.tw !== cold.id);
  const t0 = S.t; let gone = -1;
  for (let i = 0; i < (strong.slowTime + 2) / S.dt; i++) { SIM.step(S, null); if (gone < 0 && Math.abs(e.slowK - strong.slow) > 1e-9) gone = S.t - t0; }
  assert.ok(gone > 0 && gone <= strong.slowTime + S.dt * 2, `сильное замедление продлилось слабыми попаданиями: ${gone.toFixed(2)} с при сроке ${strong.slowTime} с`);
  assert.ok(Math.abs(e.slowK - weak.slow) < 1e-9, 'после сильного осталось слабое замедление');
});

test('снаряд запоминает параметры перка в момент выстрела: проданная башня не отменяет отскоки Стаи', () => {
  const S = SIM.create(2), cell = freeCell(S), ups = []; for (let i = 0; i < C.PERK_AT; i++) ups.push(C.TRACKS[i % C.TRACKS.length]);
  const tw = tower(S, cell, 'spirits', ups); SIM.step(S, { cmds: [{ k: 'perk', cell, p: 'pack' }] });
  const st = SIM.towerStats(S, tw), r = st.rangePx * 0.9, es = dummies(S, cell, 'militia', [r, r + 8, r + 16]);
  for (let i = 0; i < 2 / S.dt && !S.shots.some((s) => s.k === 'ghost'); i++) SIM.step(S, null);
  const g = S.shots.find((s) => s.k === 'ghost'); assert.ok(g, 'Фонарь не выстрелил');
  assert.equal(g.bounces, st.bounces); assert.equal(g.bounceMult, st.bounceMult);
  SIM.step(S, { cmds: [{ k: 'sell', cell }] });
  for (let i = 0; i < 3 / S.dt && S.shots.length; i++) SIM.step(S, null);
  assert.ok(es.filter((e) => e.max - e.hp > 0).length >= 2, 'после продажи башни призрак не отскочил');
});

test('описания перков собираются из данных: чисел нет в тексте руками, правка конфига меняет описание', () => {
  for (const type of C.TOWER_ORDER) for (const id of Object.keys(T[type].perks)) {
    const txt = SIM.perkText(id); assert.ok(!/[{}]/.test(txt) && txt.length > 10, `${id}: ${txt}`);
    assert.ok(!/\d/.test(T[type].perks[id].desc.replace(/\{[^}]*\}/g, '')), `${id}: число вписано в описание руками`);
  }
  const ch = T.spirits.perks.chill, was = ch.set.slowTime; ch.set.slowTime = 4.5;
  try { assert.match(SIM.perkText('chill'), /4\.5 с вместо 1\.5 с/); } finally { ch.set.slowTime = was; }
  assert.match(SIM.perkText('chill'), new RegExp(`${was} с вместо`));
});

test('новый тип башни добавляется данными: с видом атаки стреляет, без вида атаки не стреляет', () => {
  const base = { cost: 50, dmg: 7, rate: 0.5, range: 3 }, tracks = T.bones.tracks;
  T.zz_beam = { name: 'ТЕСТ', short: 'ТЕСТ', title: 'Тест', dmgType: 'magic', attack: 'beam', muzzle: 40, base, tracks, extra: { heavy: 1 }, perks: {} };
  T.zz_none = { name: 'ТЕСТ', short: 'ТЕСТ', title: 'Тест', dmgType: 'magic', muzzle: 40, base, tracks, extra: { aura: 0.2 }, perks: {},
    fmt: { dmg: '+{aura%} урона соседям' }, art: { sprite: 'dark', tint: [1, 0.3, 0.3, 0.5] } };
  try {
    const S = SIM.create(2), [a, b] = SIM.rankCells(S, C.TYPICAL_RANGE); S.souls = 1e4;
    SIM.step(S, { cmds: [{ k: 'build', cell: a, type: 'zz_beam' }, { k: 'build', cell: b, type: 'zz_none' }, { k: 'upgrade', cell: b, track: 'dmg' }] });
    assert.ok(S.towers[a] && S.towers[b], 'тип из данных не построился');
    assert.equal(SIM.towerStats(S, S.towers[b]).aura, 0.2); assert.equal(S.towers[b].tracks.dmg, 1);
    // формат ветки и вид — из данных типа, недостающее — из общих значений
    assert.equal(SIM.trackText('zz_none', 'dmg', SIM.towerStats(S, S.towers[b])), '+20% урона соседям');
    assert.equal(SIM.trackText('zz_beam', 'range', SIM.towerStats(S, S.towers[a])), SIM.fill(C.TRACK_FMT.range, SIM.towerStats(S, S.towers[a]), {}));
    const art = SIM.art('zz_none'); assert.equal(art.sprite, 'dark'); assert.deepEqual(art.tint, [1, 0.3, 0.3, 0.5]); assert.deepEqual(art.color, C.ART.color);
    assert.deepEqual(SIM.art('zz_beam'), C.ART);
    assert.equal(SIM.muzzle(S, S.towers[a])[1], SIM.cellXY(S, a)[1] - 40);
    SIM.step(S, { cmds: [{ k: 'call' }] }); const fired = { zz_beam: 0, zz_none: 0 };
    for (let i = 0; i < 40 / S.dt; i++) { SIM.step(S, null); for (const e of S.ev) if (e.k === 'fire' && e.t === S.t) fired[e.type]++; }
    assert.ok(fired.zz_beam > 0 && S.towers[a].dmg > 0, 'тип с атакой не стрелял'); assert.equal(fired.zz_none, 0); assert.equal(S.towers[b].fireT, -9);
  } finally { delete T.zz_beam; delete T.zz_none; }
});

test('яд от облака «Мора» кончается в свой срок, а не держится до смерти врага', () => {
  // котёл с Мором травит хрупкого врага рядом с живучим; хрупкий умирает — его облако травит живучего; котёл продаём:
  // новых облаков нет, и яд на живучем кончается не позже, чем через срок яда после последнего облака
  const S = SIM.create(3), cell = freeCell(S), ups = []; for (let i = 0; i < C.PERK_AT; i++) ups.push(C.TRACKS[i % C.TRACKS.length]);
  const tw = tower(S, cell, 'plague', ups); SIM.step(S, { cmds: [{ k: 'perk', cell, p: 'pestilence' }] });
  const r = SIM.towerStats(S, tw).rangePx * 0.5, [weak, tough] = dummies(S, cell, 'militia', [r, r]);   // в одной точке дороги
  weak.hp = weak.max = 5;
  for (const e of [weak, tough]) { e.slowK = 1; e.slowT = 1e9; }   // упреждение котла по скорости — ноль: облако ложится прямо на манекенов
  let pest = false;
  for (let i = 0; i < 6 / S.dt && !pest; i++) { SIM.step(S, null); pest = S.ev.some((e) => e.k === 'cloud' && e.small); }
  assert.ok(pest, 'облако Мора не появилось');
  SIM.step(S, { cmds: [{ k: 'sell', cell }] });
  const linger = T.plague.extra.linger;
  let last = S.t; for (let i = 0; i < 12 / S.dt; i++) { SIM.step(S, null);
    for (const p of Object.values(tough.poison)) assert.ok(Number.isFinite(p.t) && Number.isFinite(p.dps), 'яд без числа: ' + JSON.stringify(p));
    if (S.clouds.length) last = S.t; }
  assert.deepEqual(tough.poison, {}, `яд держится ${(S.t - last).toFixed(1)} с после последнего облака при сроке ${linger} с`);
});

test('ни в одном снимке партий ботов, берущих все перки, нет нечисловых значений', () => {
  const sets = [{}, { bones: 'pierce', spirits: 'frost', plague: 'pestilence', dark: 'harvest', bell: 'toll', altar: 'frenzy', barracks: 'legion' }, { bones: 'crush', spirits: 'chill', plague: 'miasma', dark: 'split', bell: 'knell', altar: 'circle', barracks: 'burst' }];
  const all = new Set(); for (const p of sets) for (const v of Object.values(p)) all.add(v);
  for (const t of C.TOWER_ORDER) for (const p of Object.keys(T[t].perks)) if (!['volley', 'pack', 'acid', 'curse', 'drone', 'offering', 'grip'].includes(p)) assert.ok(all.has(p), 'перк не покрыт ботами: ' + p);
  const bad = (o, path) => { if (typeof o === 'number') return Number.isFinite(o) ? null : path;
    if (o && typeof o === 'object') for (const k of Object.keys(o)) { if (k === 'map') continue; const b = bad(o[k], path + '.' + k); if (b) return b; } return null; };
  for (const perks of sets) {
    const bot = planned(C.TOWER_ORDER, Object.keys(perks).length ? perks : undefined), S = SIM.create(3, { dt: 1 / 30 }), mem = {};
    SIM.step(S, { cmds: [{ k: 'call' }] }); let i = 0;
    while (S.phase !== 'won' && S.phase !== 'lost' && S.t < 5400) { const c = i++ % 3 === 0 ? bot(S, mem) : null; SIM.step(S, c ? { cmds: c } : null);
      if (i % 30 === 0) { const b = bad(S, 'S'); assert.equal(b, null, `нечисловое значение ${b} на ${S.t.toFixed(0)} с (перки ${JSON.stringify(perks)})`); } }
  }
});

test('вид атаки, действующий без целей: зовётся и без врагов, перезарядка — только когда сработал', () => {
  let calls = 0, acted = 0;
  SIM.ATTACKS.zz_idle = { idle: true, run: () => { calls++; if (calls % 3) return false; acted++; return true; } };
  T.zz_idle = { name: 'ТЕСТ', short: 'ТЕСТ', title: 'Тест', dmgType: 'phys', attack: 'zz_idle', muzzle: 40, base: { cost: 50, dmg: 1, rate: 2, range: 1 }, tracks: T.bones.tracks, perks: {} };
  try {
    const S = SIM.create(2), cell = freeCell(S); S.souls = 1e4; SIM.step(S, { cmds: [{ k: 'build', cell, type: 'zz_idle' }] });
    for (let i = 0; i < 10 / S.dt; i++) SIM.step(S, null);
    assert.equal(S.enemies.length, 0); assert.ok(calls > 0, 'действие без целей не позвано');
    // за 10 с: перезарядка 2 с после каждого срабатывания, повтор через 0.05 с после отказа
    assert.ok(acted >= 4 && acted <= 6, `сработало ${acted} раз из ${calls} вызовов`);
    assert.ok(S.ev.some((e) => e.k === 'fire' && e.type === 'zz_idle'));
  } finally { delete SIM.ATTACKS.zz_idle; delete T.zz_idle; }
});

test('характеристики в два этапа: свои (база, ветки, перки) и итоговые (свои плюс внешние бонусы)', () => {
  const S = SIM.create(2), cell = freeCell(S), ups = []; for (let i = 0; i < C.PERK_AT; i++) ups.push(C.TRACKS[i % C.TRACKS.length]);
  const tw = tower(S, cell, 'spirits', ups); SIM.step(S, { cmds: [{ k: 'perk', cell, p: 'chill' }] });
  const own = SIM.ownStats(S, tw), all = SIM.towerStats(S, tw);
  assert.equal(own.slow, T.spirits.extra.slow + T.spirits.tracks.dmg.also.slow * tw.tracks.dmg + T.spirits.perks.chill.add.slow);
  assert.deepEqual(all, own, 'внешних бонусов пока нет — итоговые равны своим');
  assert.deepEqual(SIM.ownStats(S, tw, 'dmg'), SIM.towerStats(S, tw, 'dmg'));
});

test('продажа возвращает 70% всего вложенного (постройка, ступени веток, перк) и освобождает клетку', () => {
  const S = SIM.create(3), cell = freeCell(S); S.souls = 1e5;
  const ups = []; for (let i = 0; i < C.PERK_AT; i++) ups.push(C.TRACKS[i % C.TRACKS.length]);
  const p = Object.keys(T.dark.perks)[0];
  SIM.step(S, { cmds: [{ k: 'build', cell, type: 'dark' }, ...ups.map((track) => ({ k: 'upgrade', cell, track })), { k: 'perk', cell, p }] });
  const tw = S.towers[cell], n = C.PERK_AT / C.TRACKS.length;
  let invested = T.dark.base.cost + T.dark.perks[p].cost;
  for (const tr of C.TRACKS) for (let i = 0; i < n; i++) invested += T.dark.tracks[tr].cost[i];
  assert.deepEqual(SIM.perksOf(tw), [p]); assert.equal(tw.invested, invested); assert.equal(1e5 - S.souls, invested);
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
  // бонус кургана — во внешнем этапе характеристик: итоговые = свои + 1 к дальности (после веток)
  const tm = S.towers[mound]; assert.equal(SIM.towerStats(S, tm).range, SIM.ownStats(S, tm).range + C.SPECIAL.mound.range);
  assert.equal(SIM.towerStats(S, tm).rangePx, SIM.towerStats(S, tm).range * 48);
  // покрытие дороги для меню постройки — типичным радиусом башни с бонусом клетки
  assert.equal(C.TYPICAL_RANGE, 3.4);
  assert.equal(SIM.spotCoverage(S, mound), SIM.coverage(S, mound, 3.4 + 1));
  assert.equal(SIM.spotCoverage(S, plain), SIM.coverage(S, plain, 3.4));
});

test('проклятая земля: постройка на 30% дороже и +25% урона', () => {
  const S = SIM.create(5), cursed = specialCell(S, 'cursed'), plain = freeCell(S); S.souls = 1000;
  // цены и урон — из конфига: наценка проклятой земли C.SPECIAL.cursed.cost, бонус к урону C.SPECIAL.cursed.dmg
  const up = (v) => Math.round(v * (1 + C.SPECIAL.cursed.cost)), DK = T.dark.base.cost;
  assert.equal(SIM.canBuild(S, cursed, 'bones').cost, up(T.bones.base.cost));
  assert.equal(SIM.canBuild(S, cursed, 'dark').cost, up(DK));
  assert.equal(SIM.canBuild(S, plain, 'dark').cost, DK);
  assert.equal(SIM.canBuild(S, cursed, 'dark').base, DK); assert.equal(SIM.canBuild(S, plain, 'dark').base, DK);
  SIM.step(S, { cmds: [{ k: 'build', cell: cursed, type: 'dark' }] });
  assert.equal(S.souls, 1000 - up(DK)); assert.equal(S.towers[cursed].invested, up(DK));
  const P = SIM.create(5); P.souls = up(DK) - 1;
  assert.equal(SIM.canBuild(P, cursed, 'dark').reason, 'souls'); assert.equal(SIM.canBuild(P, plain, 'dark').ok, true);
  // луч Тьмы уровня 1 — базовый урон, по ополченцу без защиты
  assert.equal(strike(5, cursed, 'dark').tw.dmg, T.dark.base.dmg * (1 + C.SPECIAL.cursed.dmg));
  assert.equal(strike(5, plain, 'dark').tw.dmg, T.dark.base.dmg);
  // бонус проклятой земли — во внешнем этапе: итоговый урон = свой × 1.25 (у Чумы — яд в секунду)
  const Q = SIM.create(5); Q.souls = 1e4; SIM.step(Q, { cmds: [{ k: 'build', cell: cursed, type: 'plague' }] });
  const tq = Q.towers[cursed]; assert.equal(SIM.towerStats(Q, tq).dmg, SIM.ownStats(Q, tq).dmg * (1 + C.SPECIAL.cursed.dmg));
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
  const R = T.bones.base.range, tw = S.towers[mound]; assert.equal(SIM.rangePx(S, tw), (R + C.SPECIAL.mound.range) * C.UNIT);
  // на препятствие перенос отклонён
  const ob = S.map.obstacles.find((o) => o.kind !== 'arch').cell;
  assert.equal(SIM.canMove(S, mound, ob).reason, 'obstacle');
  SIM.step(S, { cmds: [{ k: 'move', cell: mound, to: ob }] }); assert.equal(S.towers[ob], null); assert.equal(S.towers[mound], tw);
  // с кургана на обычную клетку: +1 к дальности снимается
  SIM.step(S, { cmds: [{ k: 'move', cell: mound, to: plain }] }); assert.equal(S.towers[plain], tw);
  assert.equal(SIM.rangePx(S, tw), R * C.UNIT);
  // на проклятую землю: бесплатно, вложения прежние
  const souls = S.souls, invested = tw.invested;
  SIM.step(S, { cmds: [{ k: 'move', cell: plain, to: cursed }] }); assert.equal(S.towers[cursed], tw);
  assert.equal(S.souls, souls); assert.equal(tw.invested, invested);
  // перенесённая на проклятую землю Тьма бьёт сильнее на бонус клетки, на источнике душ башня начинает давать +1 душу
  assert.equal(strike(5, plain, 'dark', 1e6, cursed).tw.dmg, T.dark.base.dmg * (1 + C.SPECIAL.cursed.dmg));
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
  S.shots.push({ k: 'bolt', x: e.x + startDx, y: e.y - 14 + off, dx: 1, dy: 0, left: 1000, dmg: 10, pen: 0, sp: T.bones.extra.speed, tw: -1, pierce: 4, falloff: T.bones.perks.pierce.set.pierceFalloff, hit: [] });
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

test('шаг времени: скорострельная башня наносит тот же урон при шаге 1/30, что при 1/120 (перезарядка переносит остаток шага)', () => {
  const dmgAt = (dt) => { const S = SIM.create(4, { dt }), cell = SIM.rankCells(S, 3)[0]; S.souls = 1e5; S.hp = 1e6;
    SIM.step(S, { cmds: [{ k: 'build', cell, type: 'spirits' }] });
    for (let i = 0; i < 5; i++) SIM.step(S, { cmds: C.TRACKS.map((track) => ({ k: 'upgrade', cell, track })) });
    S.wave = 14; SIM.step(S, { cmds: [{ k: 'call' }] });
    for (let i = 0; i < 40 / dt; i++) SIM.step(S, null);
    return S.towers[cell].dmg; };
  const fine = dmgAt(1 / 120), coarse = dmgAt(1 / 30);
  assert.ok(Math.abs(coarse / fine - 1) < 0.01, `урон за 40 с: ${coarse.toFixed(0)} при 1/30 против ${fine.toFixed(0)} при 1/120`);
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
// постройка и ступени по кругу веток до порога перка, затем перк: команды для клетки
const grownCmds = (cell, type, perk) => [{ k: 'build', cell, type }, ...Array.from({ length: C.PERK_AT }, (_, i) => ({ k: 'upgrade', cell, track: C.TRACKS[i % C.TRACKS.length] })), { k: 'perk', cell, p: perk }];
const isGrown = (t, type, perk) => assert.ok(t && SIM.hasPerk(t, perk) && SIM.steps(t) === C.PERK_AT && t.invested > T[type].base.cost, `прокачка не применилась: ${JSON.stringify(t)}`);
// забег с башней type на лучшей клетке, прокачанной до порога перка с перком, после первой волны (есть убийства и урон)
const veteran = (seed, type, perk) => {
  const S = SIM.create(seed); S.souls = 1e5; const cell = SIM.rankCells(S, C.TYPICAL_RANGE)[0];
  SIM.step(S, { cmds: [...grownCmds(cell, type, perk), { k: 'call' }] });
  const tw = S.towers[cell];                                        // подготовка сработала: иначе тесты «сохраняет прокачку» проверят пустую башню
  isGrown(tw, type, perk);
  for (let i = 0; i < 120 * 300 && S.phase === 'wave'; i++) SIM.step(S, null);
  return { S, cell };
};
test('перенос в паузе между волнами: бесплатно, мгновенно, башня та же — уровень, перк, вложения и счётчики', () => {
  const { S, cell } = veteran(5, 'bones', 'volley');
  assert.equal(S.phase, 'prep'); assert.equal(S.wave, 1);
  const tw = S.towers[cell]; assert.ok(tw.kills > 0 && tw.dmg > 0, 'башня не воевала');
  const R = JSON.parse(JSON.stringify(S)), souls = S.souls, spent = S.stats.spent;   // контроль: тот же шаг без переноса
  const to = SIM.rankCells(S, C.TYPICAL_RANGE).find((c) => c !== cell);
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
  const S = SIM.create(7); S.souls = 1e5; const [a, b, c] = SIM.rankCells(S, C.TYPICAL_RANGE), road = S.map.road[12], hud = 0;
  SIM.step(S, { cmds: [{ k: 'build', cell: a, type: 'dark' }, { k: 'build', cell: b, type: 'bones' }] });
  const tried = (to, reason) => { assert.equal(SIM.canMove(S, a, to).reason, reason, `на ${to}`);
    const snap = JSON.stringify(S.towers); SIM.step(S, { cmds: [{ k: 'move', cell: a, to }] });
    assert.equal(JSON.stringify(S.towers.map((t) => t && t.cell)), JSON.stringify(JSON.parse(snap).map((t) => t && t.cell)), `перенос на ${to} прошёл`); };
  tried(road, 'road'); tried(b, 'occupied'); tried(hud, 'hud'); tried(-1, 'bounds'); tried(S.map.cols * S.map.rows, 'bounds'); tried(a, 'same');
  assert.equal(SIM.canMove(S, c).reason, 'none'); assert.deepEqual(SIM.moveCells(S, c), []);
  SIM.step(S, { cmds: [{ k: 'move', cell: c, to: SIM.rankCells(S, C.TYPICAL_RANGE)[0] }] }); assert.equal(S.towers.filter(Boolean).length, 2);
  SIM.step(S, { cmds: [{ k: 'call' }] }); assert.equal(S.phase, 'wave');
  assert.equal(SIM.canMove(S, a).reason, 'phase'); assert.deepEqual(SIM.moveCells(S, a), []);
  tried(c, 'phase');
  S.phase = 'lost'; assert.equal(SIM.canMove(S, a).reason, 'ended');
});
test('перенос разрешён ровно там, где этот тип можно построить, — при любых душах (правила клетки общие с постройкой)', () => {
  for (const seed of [1, 2, 3]) {
    const S = SIM.create(seed); S.souls = 1e5; const [a, b] = SIM.rankCells(S, C.TYPICAL_RANGE);
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
  const S = SIM.create(4); S.souls = 1e5; const [a, b] = SIM.rankCells(S, C.TYPICAL_RANGE);
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
    const A = SIM.create(6); A.souls = 1e5; const x = SIM.rankCells(A, C.TYPICAL_RANGE)[0], B = JSON.parse(JSON.stringify(A));
    const perk = Object.keys(T[type].perks)[0], grow = (cell) => grownCmds(cell, type, perk), grown = (t) => isGrown(t, type, perk);
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
      assert.deepEqual(SIM.towerStats(A, tw), SIM.towerStats(B, tb), `${type}: характеристики на ${c}`); assert.deepEqual(SIM.muzzle(A, tw), SIM.muzzle(B, tb));
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

// ---- Колокол: удар по площади вокруг себя с оглушением
// Колокол на клетке с наибольшим покрытием дороги его малым радиусом (не особой); с перком p — после PERK_AT ступеней
// (p = null — те же ступени без перка, чтобы числа сравнивались). Волна идёт, очередь держится непустой, башня молчит до strikeNow.
const bellAt = (seed, p) => {
  const S = SIM.create(seed), cell = SIM.rankCells(S, T.bell.base.range).find((c) => !S.map.specials.some((s) => s.cell === c)), ups = [];
  if (p !== undefined) for (let i = 0; i < C.PERK_AT; i++) ups.push(C.TRACKS[i % C.TRACKS.length]);
  const tw = tower(S, cell, 'bell', ups); if (p) SIM.step(S, { cmds: [{ k: 'perk', cell, p }] });
  if (p) assert.ok(SIM.hasPerk(tw, p), 'перк не взялся: ' + p);
  SIM.step(S, { cmds: [{ k: 'call' }] }); S.queue = [{ at: 1e9, e: 'militia' }]; S.qi = 0; S.enemies = []; S.shots = []; tw.cd = 1e9;
  return { S, tw, cell, st: SIM.towerStats(S, tw) };
};
// враг type в точке дороги, ближайшей к расстоянию dist px от башни; живучий, идёт как обычно
const drop = (S, cell, type, dist) => { const [x, y] = SIM.cellXY(S, cell), L = SIM.pathLen(S); let best = 0, bd = Infinity;
  for (let d = 0; d < L; d++) { const p = SIM.posAt(S, d), q = Math.abs(Math.hypot(p.x - x, p.y - y) - dist); if (q < bd) { bd = q; best = d; } }
  S.queue.splice(S.qi, 0, { at: 0, e: type }); SIM.step(S, null);
  const e = S.enemies[S.enemies.length - 1]; e.d = best; e.lane = 0; e.hp = e.max = 1e6; return e; };
// враги по списку [тип, доля радиуса], один шаг на расстановку, затем ровно один удар
const strikeNow = (B, list) => { const es = list.map(([type, k]) => drop(B.S, B.cell, type, k * B.st.rangePx)); SIM.step(B.S, null);
  B.tw.cd = 0; SIM.step(B.S, null); return es; };
const near = (a, b, what) => assert.ok(Math.abs(a - b) < 1e-6, `${what}: ${a} против ${b}`);

test('Колокол бьёт разом всех врагов в радиусе и оглушает их; вне радиуса — никого; босс получает урон, но не оглушается', () => {
  const B = bellAt(4), { S, st } = B, [x, y] = SIM.cellXY(S, B.cell);
  near(st.stun, T.bell.extra.stun, 'длительность оглушения из конфига');
  const es = strikeNow(B, [['militia', 0], ['militia', 0.9], ['militia', 2.4], ['paladin', 0.3]]);
  const inside = (e) => Math.hypot(e.x - x, e.y - y) <= st.rangePx, [m0, m1, far, boss] = es;
  assert.ok(inside(m0) && inside(boss) && !inside(far), 'расстановка: ' + es.map((e) => Math.round(Math.hypot(e.x - x, e.y - y))).join(' '));
  assert.equal(S.ev.filter((v) => v.k === 'fire' && v.t === S.t).length, 1, 'один удар');
  const pulse = S.ev.find((v) => v.k === 'pulse' && v.t === S.t); assert.ok(pulse, 'нет события удара (волна в сцене)');
  near(pulse.r, st.rangePx, 'радиус волны удара'); near(pulse.x, x, 'волна от башни'); near(pulse.y, y, 'волна от башни');
  for (const e of es.filter(inside)) assert.ok(hurt(e) > 0, `враг ${e.type} в радиусе не получил урона`);
  for (const e of es.filter(inside).filter((e) => e !== boss)) near(e.stunT, st.stun, `оглушение ${e.type}`);
  assert.equal(hurt(far), 0); assert.equal(far.stunT, 0, 'враг вне радиуса оглушён');
  assert.equal(boss.stunT, 0, 'босс оглушён'); assert.ok(hurt(boss) > 0);
  if (inside(m1)) near(m1.stunT, st.stun, 'второй враг в радиусе');
  // урон — ровно итоговый урон башни (ополченец без брони; аура паладина броню прибавляет, поэтому без него)
  const B2 = bellAt(4), [lone] = strikeNow(B2, [['militia', 0]]); near(hurt(lone), B2.st.dmg, 'урон удара');
});

test('оглушённый враг стоит ровно срок оглушения, потом идёт; очнувшийся какое-то время к оглушению невосприимчив', () => {
  const B = bellAt(4), { S, st, tw } = B, [e] = strikeNow(B, [['militia', 0]]), d0 = e.d;
  assert.ok(e.stunT > 0);
  let stood = 0; while (e.d === d0 && stood < 10) { SIM.step(S, null); stood += S.dt; }
  assert.ok(Math.abs(stood - st.stun) <= S.dt * 2, `стоял ${stood.toFixed(3)} с при оглушении ${st.stun} с`);
  // сразу после оглушения новый удар ранит, но не оглушает; после невосприимчивости — снова оглушает
  e.freezeT = 1e9; const h = hurt(e); tw.cd = 0; SIM.step(S, null);
  assert.ok(hurt(e) > h, 'удар не ранил'); assert.ok(!(e.stunT > 0), 'оглушён снова без передышки');
  for (let i = 0; i < (st.guard + 0.1) / S.dt; i++) SIM.step(S, null);
  tw.cd = 0; SIM.step(S, null); near(e.stunT, st.stun, 'после невосприимчивости оглушается снова');
});

test('ветки Колокола: урон вместе с длительностью оглушения, дальность и частота удара — каждая от своей ветки', () => {
  const S = SIM.create(4), cell = freeCell(S), tw = tower(S, cell, 'bell'), s0 = SIM.towerStats(S, tw);
  const dmg = SIM.towerStats(S, tw, 'dmg'), range = SIM.towerStats(S, tw, 'range'), rate = SIM.towerStats(S, tw, 'rate');
  assert.ok(dmg.dmg > s0.dmg && dmg.stun > s0.stun && dmg.range === s0.range, 'ветка урона');
  assert.ok(range.range > s0.range && range.stun === s0.stun && range.dmg === s0.dmg, 'ветка дальности');
  assert.ok(rate.rate < s0.rate && rate.stun === s0.stun, 'ветка скорости');
  assert.ok(s0.range < T.plague.base.range, 'радиус Колокола малый — меньше самого короткого из старых');
  for (const k of C.TRACKS) assert.ok(SIM.trackText('bell', k, s0).length > 0);
  for (const [, tpl] of T.bell.show || []) assert.ok(!/[{}]/.test(SIM.fill(tpl, s0, T.bell.extra)));
  // прокачка до потолка: оглушение растёт, но остаётся кратким — короче паузы между ударами
  for (const k of C.TRACKS) for (let i = 0; i < C.TRACK_MAX; i++) SIM.step(S, { cmds: [{ k: 'upgrade', cell, track: k }] });
  const top = SIM.towerStats(S, tw); assert.ok(top.stun > s0.stun && top.stun < top.rate, `оглушение ${top.stun} с при ударе раз в ${top.rate} с`);
});

test('перки Колокола: Набат — оглушение дольше, Погребальный звон — проклятие всем задетым и боссу, Гул — замедление после оглушения', () => {
  assert.deepEqual(Object.keys(T.bell.perks).sort(), ['drone', 'knell', 'toll']);
  const plain = bellAt(4, null), toll = bellAt(4, 'toll'), knell = bellAt(4, 'knell'), drone = bellAt(4, 'drone');
  // Набат
  near(toll.st.stun, plain.st.stun + T.bell.perks.toll.add.stun, 'Набат в характеристиках');
  const [tm] = strikeNow(toll, [['militia', 0]]), [pm] = strikeNow(plain, [['militia', 0]]);
  near(tm.stunT, toll.st.stun, 'Набат на враге'); assert.ok(tm.stunT > pm.stunT);
  // Погребальный звон: проклятие на всех задетых, и на боссе
  const [km, kb] = strikeNow(knell, [['militia', 0], ['paladin', 0.3]]);
  for (const e of [km, kb]) { near(e.curse, knell.st.curse, 'проклятие ' + e.type); near(e.curseT, knell.st.curseTime, 'срок проклятия ' + e.type); }
  assert.equal(pm.curseT, 0);
  // Гул: после оглушения враг замедлен ещё dragTime; босс не оглушён, но замедлен
  const [dm, db] = strikeNow(drone, [['militia', 0], ['paladin', 0.3]]);
  near(dm.slowK, drone.st.drag, 'Гул на враге'); near(dm.slowT, drone.st.stun + drone.st.dragTime, 'срок Гула');
  near(db.slowK, drone.st.drag, 'Гул на боссе'); near(db.slowT, drone.st.dragTime, 'срок Гула на боссе'); assert.equal(db.stunT, 0);
  for (const id of ['toll', 'knell', 'drone']) assert.ok(!/[{}]/.test(SIM.perkText(id)));
});

test('оглушение — часть состояния: сейв посреди оглушения годен и продолжается без потерь', () => {
  const B = bellAt(4, 'drone'), [e] = strikeNow(B, [['militia', 0]]); assert.ok(e.stunT > 0);
  assert.ok(SIM.loadable(JSON.parse(JSON.stringify(B.S))), 'сейв с оглушённым врагом негоден');
  const R = JSON.parse(JSON.stringify(B.S)); for (let i = 0; i < 3 / B.S.dt; i++) { SIM.step(B.S, null); SIM.step(R, null); }
  assert.deepEqual(R, B.S);
  const bad = JSON.parse(JSON.stringify(B.S)); if (bad.enemies.length) { bad.enemies[0].stunT = 'x'; assert.equal(SIM.loadable(bad), false); }
});
