// node --test tests/*.test.mjs — Казарма: призыв скелетов на дорогу, удержание врага в ближнем бою, ветки, перки,
// судьба скелетов при продаже и переносе башни, скелеты в сейве.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SIM } from './bots.mjs';
const C = SIM.CONFIG, T = C.TOWERS, B = T.barracks, EN = C.ENEMIES;

const freeCell = (S) => SIM.rankCells(S, 3).find((c) => !S.map.specials.some((s) => s.cell === c));
const run = (S, sec) => { const n = Math.round(sec / S.dt); for (let i = 0; i < n; i++) SIM.step(S, null); };
const json = (S) => JSON.parse(JSON.stringify(S));
const build = (S, cell, ups = []) => { S.souls = 1e6;
  SIM.step(S, { cmds: [{ k: 'build', cell, type: 'barracks' }, ...ups.map((track) => ({ k: 'upgrade', cell, track }))] }); return S.towers[cell]; };
const mine = (S, tw) => S.skels.filter((s) => s.tw === tw.id);
const evs = (S, k) => S.ev.filter((e) => e.k === k && e.t === S.t);
// лимит скелетов на время теста (один скелет — проще следить за боем)
const withLimit = (n, fn) => { const was = B.extra.limit; B.extra.limit = n; try { return fn(); } finally { B.extra.limit = was; } };
// идёт волна без своих врагов (её очередь считается вышедшей): дальше враги выставляются руками
const quietWave = (S) => { SIM.step(S, { cmds: [{ k: 'call' }] }); S.qi = S.queue.length; S.enemies = []; S.shots = []; };
// расстояние по маршруту до точки, ближайшей к (x, y)
const routeD = (S, x, y) => { let best = 0, bd = Infinity;
  for (let d = 0; d < SIM.pathLen(S); d++) { const p = SIM.posAt(S, d), q = Math.hypot(p.x - x, p.y - y); if (q < bd) { bd = q; best = d; } } return best; };
// враг type на расстоянии d по маршруту (на оси дороги)
const enemyAt = (S, type, d, hp) => {
  const q = S.queue; S.queue = [{ at: 0, e: type }]; S.qi = 0; SIM.step(S, null); S.queue = q; S.qi = q.length;   // очередь волны — от генератора (её сверяет сейв)
  const e = S.enemies[S.enemies.length - 1], p = SIM.posAt(S, d); e.d = d; e.lane = 0; e.x = p.x; e.y = p.y;
  if (hp) e.hp = e.max = hp; return e; };
// Казарма с одним скелетом и враг, идущий к нему по дороге
const duel = (seed, type, hp, perk) => withLimit(1, () => {
  const S = SIM.create(seed), cell = freeCell(S), ups = perk ? Array.from({ length: C.PERK_AT }, (_, i) => C.TRACKS[i % C.TRACKS.length]) : [];
  const tw = build(S, cell, ups); if (perk) SIM.step(S, { cmds: [{ k: 'perk', cell, p: perk }] });
  for (let i = 0; i < 3 / S.dt && !mine(S, tw).length; i++) SIM.step(S, null);
  const sk = mine(S, tw)[0]; assert.ok(sk, 'скелет не появился');
  quietWave(S);
  const e = enemyAt(S, type, Math.max(0, routeD(S, sk.x, sk.y) - 60), hp);
  return { S, tw, sk, e, st: SIM.towerStats(S, tw) };
});

test('Казарма строится данными: тип в конфиге и в порядке карточек, вид — свой (частокол со знаменем)', () => {
  assert.ok(C.TOWER_ORDER.includes('barracks'));
  const A = SIM.art('barracks'); assert.equal(A.sprite, 'barracks'); assert.ok(!A.tint, 'Казарма — свой процедурный вид, не перекраска');
  assert.equal(Object.keys(B.perks).length, 3);
  const S = SIM.create(2), cell = freeCell(S); S.souls = B.base.cost;
  SIM.step(S, { cmds: [{ k: 'build', cell, type: 'barracks' }] });
  assert.equal(S.towers[cell].type, 'barracks'); assert.equal(S.souls, 0);
});

test('Казарма ставит скелетов и без врагов: на ближайшую клетку дороги в радиусе, с частотой призыва, не больше лимита', () => {
  const S = SIM.create(2), cell = freeCell(S), tw = build(S, cell), st = SIM.towerStats(S, tw), cells = SIM.skelCells(S, tw);
  assert.ok(st.limit >= 2 && cells.length >= st.limit, 'мало клеток дороги в радиусе');
  const [x, y] = SIM.cellXY(S, cell), dist = (c) => { const [cx, cy] = SIM.cellXY(S, c); return Math.hypot(cx - x, cy - y); };
  for (const c of cells) assert.ok(S.map.road.includes(c) && dist(c) <= st.rangePx);
  for (let i = 1; i < cells.length; i++) assert.ok(dist(cells[i]) >= dist(cells[i - 1]), 'клетки не по удалению');
  const times = [];
  for (let i = 0; i < st.rate * (st.limit + 2) / S.dt; i++) { SIM.step(S, null); if (evs(S, 'summon').length) times.push(S.t); }
  assert.equal(times.length, st.limit, 'скелетов сверх лимита или меньше');
  for (let i = 1; i < times.length; i++) assert.ok(Math.abs(times[i] - times[i - 1] - st.rate) <= S.dt * 1.01, `интервал ${times[i] - times[i - 1]} против ${st.rate}`);
  const sk = mine(S, tw); assert.equal(sk.length, st.limit);
  assert.equal(sk[0].cell, cells[0], 'первый скелет — на ближайшей клетке');
  for (const s of sk) { assert.ok(cells.includes(s.cell)); assert.equal(s.hp, st.hp); assert.equal(s.max, st.hp); assert.equal(s.dmg, st.dmg); assert.equal(s.foe, 0); }
});

test('скелет держит одного врага: тот стоит и бьёт скелета, пока не убьёт; погибший заменяется через интервал призыва', () => {
  const { S, tw, sk, e, st } = duel(2, 'militia', 1e6);
  for (let i = 0; i < 4 / S.dt && !sk.foe; i++) SIM.step(S, null);
  assert.equal(sk.foe, e.id, 'скелет не взял врага');
  const d0 = e.d, hp0 = sk.hp, eh0 = e.hp; run(S, 1.5);
  assert.equal(e.d, d0, 'удержанный враг идёт дальше');
  assert.ok(Math.abs(hp0 - sk.hp - 1.5 * EN.militia.melee) < EN.militia.melee * S.dt * 2, `скелет потерял ${hp0 - sk.hp} HP за 1.5 с при ударе врага ${EN.militia.melee}/с`);
  const lost = eh0 - e.hp; assert.ok(lost >= st.dmg && Math.abs(lost / st.dmg - Math.round(lost / st.dmg)) < 1e-6, `враг потерял ${lost}, не кратно удару ${st.dmg}`);
  // каждый удар скелета — событие попадания (вспышка и звук в сцене) у врага
  const hp1 = e.hp; let hits = 0; for (let i = 0; i < 2 * st.hit / S.dt; i++) { SIM.step(S, null); hits += evs(S, 'hit').filter((h) => h.kind === 'skel' && h.x === e.x).length; }
  assert.ok(e.hp < hp1 && hits === Math.round((hp1 - e.hp) / st.dmg), `ударов ${Math.round((hp1 - e.hp) / st.dmg)}, событий попадания ${hits}`);
  // второго врага этот скелет не держит
  const e2 = enemyAt(S, 'militia', Math.max(0, d0 - 30), 1e6), d2 = e2.d; run(S, 1.5);
  assert.ok(e2.d > d2 + 30, 'второй враг стоит');
  // скелет гибнет — враг идёт дальше, новый скелет — через интервал призыва после гибели
  let died = -1; for (let i = 0; i < 60 / S.dt && died < 0; i++) { SIM.step(S, null); if (evs(S, 'skelDie').length) died = S.t; }
  assert.ok(died > 0 && !S.skels.includes(sk), 'скелет не погиб');
  const dd = e.d; run(S, 0.5); assert.ok(e.d > dd, 'враг не пошёл после гибели скелета');
  let next = -1; for (let i = 0; i < (st.rate + 1) / S.dt && next < 0; i++) { SIM.step(S, null); if (evs(S, 'summon').length) next = S.t; }
  assert.ok(next > 0 && Math.abs(next - died - st.rate) <= S.dt * 2, `замена через ${(next - died).toFixed(2)} с при интервале ${st.rate}`);
});

test('убийство скелетом засчитывается Казарме: души и счётчик', () => {
  const { S, tw, e } = duel(3, 'militia', 20), souls = S.souls;
  for (let i = 0; i < 6 / S.dt && !e.dead; i++) SIM.step(S, null);
  assert.ok(e.dead && !e.leaked, 'скелет не убил врага'); assert.equal(tw.kills, 1); assert.ok(tw.dmg >= 20);
  assert.equal(S.souls, souls + e.bounty + (S.phase === 'prep' ? C.WAVE_BONUS(1) : 0));   // единственный враг — волна отбита
});

test('босс скелета не замечает: идёт мимо, скелет цел', () => {
  const { S, sk, e } = duel(2, 'paladin', 1e6); assert.ok(EN.paladin.unstoppable);
  const d0 = e.d, hp0 = sk.hp; run(S, 3);
  assert.ok(e.d > d0 + 60, 'босс остановился'); assert.equal(sk.foe, 0); assert.equal(sk.hp, hp0);
});

test('ветки Казармы: «урон» — HP и удар скелета, «скорость» — частота призыва, «дальность» — радиус выбора клетки дороги', () => {
  const S = SIM.create(2), cell = freeCell(S), tw = build(S, cell), st0 = SIM.towerStats(S, tw);
  const nd = SIM.towerStats(S, tw, 'dmg'), nr = SIM.towerStats(S, tw, 'rate'), ng = SIM.towerStats(S, tw, 'range');
  assert.ok(nd.hp > st0.hp && nd.dmg > st0.dmg && nd.rate === st0.rate, 'урон: HP и удар');
  assert.ok(nr.rate < st0.rate && nr.hp === st0.hp, 'скорость: интервал призыва');
  assert.ok(ng.range > st0.range && ng.hp === st0.hp && ng.rate === st0.rate, 'дальность');
  // прокачанный удар — у следующего скелета
  SIM.step(S, { cmds: [1, 2, 3].map(() => ({ k: 'upgrade', cell, track: 'dmg' })) });
  const st = SIM.towerStats(S, tw); for (let i = 0; i < 2 / S.dt && !mine(S, tw).length; i++) SIM.step(S, null);
  assert.equal(mine(S, tw)[0].max, st.hp); assert.equal(mine(S, tw)[0].dmg, st.dmg);
  // клетка, от которой дорога дальше базового радиуса, но ближе радиуса после веток дальности: призыв только после прокачки
  const far = SIM.create(4); far.souls = 1e6;
  const near = (c) => Math.min(...far.map.road.map((r) => Math.hypot(...SIM.cellXY(far, r).map((v, k) => v - SIM.cellXY(far, c)[k]))));
  const maxR = SIM.towerStats(far, Object.assign({}, far.towers[0] || {}, { type: 'barracks', cell: 0, tracks: { dmg: 0, range: C.TRACK_MAX, rate: 0 }, perks: [] })).rangePx;
  const c = SIM.rankCells(far, 6).find((i) => !far.map.specials.some((s) => s.cell === i) && near(i) > st0.rangePx && near(i) <= maxR);
  assert.ok(c >= 0, 'нет клетки для проверки дальности');
  const t2 = build(far, c); run(far, st0.rate + 1);
  assert.equal(SIM.skelCells(far, t2).length, 0); assert.equal(mine(far, t2).length, 0, 'скелет вне радиуса');
  SIM.step(far, { cmds: Array.from({ length: C.TRACK_MAX }, () => ({ k: 'upgrade', cell: c, track: 'range' })) });
  assert.ok(SIM.skelCells(far, t2).length > 0);
  run(far, 1); assert.equal(mine(far, t2).length, 1, 'после веток дальности скелет не появился');
});

test('перки Казармы: Костяной легион — лимит больше, Мёртвая хватка — враг получает больше урона, Костяной взрыв — урон при гибели', () => {
  // легион
  const S = SIM.create(2), cell = freeCell(S), ups = Array.from({ length: C.PERK_AT }, (_, i) => C.TRACKS[i % C.TRACKS.length]);
  const tw = build(S, cell, ups); const lim = SIM.towerStats(S, tw).limit;
  SIM.step(S, { cmds: [{ k: 'perk', cell, p: 'legion' }] }); const st = SIM.towerStats(S, tw);
  assert.equal(st.limit, lim + B.perks.legion.add.limit);
  run(S, st.rate * (st.limit + 1)); assert.equal(mine(S, tw).length, st.limit);
  // хватка: удержанный враг проклят на долю хватки
  const g = duel(2, 'militia', 1e6, 'grip');
  for (let i = 0; i < 4 / g.S.dt && !g.sk.foe; i++) SIM.step(g.S, null);
  run(g.S, 0.5); assert.equal(g.sk.foe, g.e.id);
  assert.ok(g.e.curseT > 0 && g.e.curse === B.perks.grip.set.grip, `проклятие ${g.e.curse} на ${g.e.curseT} с`);
  // взрыв: при гибели скелета удержанный враг получает burst × удар скелета
  const b = duel(2, 'knight', 1e6, 'burst'), boom = b.st.burst * b.st.dmg * (1 - EN.knight.armor);
  assert.ok(b.sk.burst > 0 && b.sk.burstR > 0);
  let jump = 0; for (let i = 0; i < 60 / b.S.dt && b.S.skels.includes(b.sk); i++) { const h = b.e.hp; SIM.step(b.S, null); if (evs(b.S, 'skelDie').length) jump = h - b.e.hp; }
  assert.ok(jump >= boom - 1e-6 && jump <= boom + b.st.dmg, `взрыв ${jump} при ожидаемых ${boom}`);
});

test('продажа и перенос Казармы: её скелеты рассыпаются, после переноса новые встают у новой клетки', () => {
  const S = SIM.create(2), [a, b] = SIM.rankCells(S, 3).filter((c) => !S.map.specials.some((s) => s.cell === c)), tw = build(S, a), st = SIM.towerStats(S, tw);
  run(S, st.rate + 1); assert.ok(mine(S, tw).length >= 2);
  SIM.step(S, { cmds: [{ k: 'move', cell: a, to: b }] });
  assert.equal(mine(S, tw).length, 0, 'скелеты остались после переноса'); assert.ok(S.ev.some((e) => e.k === 'skelDie'));
  run(S, st.rate + 0.5); const now = mine(S, tw); assert.equal(now.length, 1);
  assert.ok(SIM.skelCells(S, tw).includes(now[0].cell), 'скелет не у новой клетки');
  SIM.step(S, { cmds: [{ k: 'sell', cell: b }] }); SIM.step(S, null);
  assert.equal(S.skels.length, 0, 'скелеты проданной башни остались');
});

test('состояние со скелетами в бою сериализуется без потерь и годно для продолжения', () => {
  const { S, sk } = duel(2, 'knight', 1e6);
  for (let i = 0; i < 4 / S.dt && !sk.foe; i++) SIM.step(S, null);
  assert.ok(sk.foe > 0);
  assert.equal(SIM.loadable(json(S)), true);
  const R = json(S); run(S, 10); run(R, 10);
  assert.deepEqual(json(R), json(S));
});

test('перенос Казармы посреди боя (Беспокойные мёртвые): удержанный враг отпущен, бесхозных скелетов нет', () => {
  const { S, tw, sk, e } = duel(2, 'militia', 1e6);
  for (let i = 0; i < 4 / S.dt && !sk.foe; i++) SIM.step(S, null);
  assert.equal(sk.foe, e.id);
  S.relics.push('restless'); const to = SIM.moveCells(S, tw.cell).find((c) => SIM.skelCells(S, Object.assign({}, tw, { cell: c })).length);
  assert.ok(to >= 0, 'перенос посреди боя не разрешён');
  SIM.step(S, { cmds: [{ k: 'move', cell: tw.cell, to }] });
  assert.equal(S.towers[to], tw); assert.equal(mine(S, tw).length, 0, 'скелеты остались у старой клетки');
  const d = e.d; run(S, 0.5); assert.ok(e.d > d, 'враг остался стоять');
  assert.ok(S.skels.every((s) => SIM.skelCells(S, tw).includes(s.cell)), 'скелет не у новой клетки');
});
