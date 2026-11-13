// node --test tests/*.test.mjs — Гримуар: общая прокачка за души внутри забега (линии, цены, отказы, бонусы в итоговых
// характеристиках башни, закрытые типы, сейв).
import test from 'node:test';
import assert from 'node:assert/strict';
import { SIM } from './bots.mjs';
const C = SIM.CONFIG, G = C.GRIMOIRE;

const freeCell = (S) => SIM.rankCells(S, 3).find((c) => !S.map.specials.some((s) => s.cell === c) && !S.towers[c]);
const build = (S, type) => { const cell = freeCell(S); SIM.step(S, { cmds: [{ k: 'build', cell, type }] }); assert.ok(S.towers[cell], 'не построилась ' + type); return S.towers[cell]; };
const buy = (S, line) => SIM.step(S, { cmds: [{ k: 'grim', line }] });
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} ≠ ${b}`);
const json = (S) => JSON.parse(JSON.stringify(S));
const typeLine = (type) => SIM.grimLines(SIM.create(1)).find((l) => l.id === type);

test('Гримуар: три общие линии по пять ступеней и по линии на каждый тип по три; цены растут и берутся из конфига', () => {
  const S = SIM.create(1), lines = SIM.grimLines(S);
  assert.deepEqual(lines.filter((l) => l.group === 'all').map((l) => l.id), C.TRACKS);
  assert.deepEqual(lines.filter((l) => l.group === 'type').map((l) => l.id), C.TOWER_ORDER);
  const cheapestTower = Math.min(...C.TOWER_ORDER.map((t) => C.TOWERS[t].base.cost));
  for (const l of lines) {
    const cost = l.group === 'all' ? G.all[l.id].cost : (C.TOWERS[l.id].grim || {}).cost || G.type.cost;
    assert.equal(l.max, l.group === 'all' ? 5 : 3, l.id);
    assert.equal(cost.length, l.max, l.id);
    assert.equal(l.step, 0); assert.equal(l.cost, cost[0]);
    for (let i = 1; i < cost.length; i++) assert.ok(cost[i] > cost[i - 1], `цена линии ${l.id} не растёт: ${cost}`);
    // покупка конкурирует с ещё одной башней: первая ступень не дешевле самой дешёвой башни
    assert.ok(cost[0] >= cheapestTower, `первая ступень ${l.id} (${cost[0]}) дешевле башни (${cheapestTower})`);
    assert.ok(C.TRACKS.includes(l.track), l.id);
  }
});

test('Гримуар: покупка списывает цену ступени и сразу действует на построенные башни и на построенные позже', () => {
  const S = SIM.create(5); S.souls = 1e6;
  const a = build(S, 'bones'), b = build(S, 'plague');
  const own = (tw) => SIM.ownStats(S, tw), before = [a, b].map((t) => SIM.towerStats(S, t));
  for (let i = 0; i < 5; i++) {
    const cg = SIM.canGrim(S, 'dmg'), souls = S.souls, spent = S.stats.spent;
    assert.equal(cg.ok, true); assert.equal(cg.cost, G.all.dmg.cost[i]);
    buy(S, 'dmg');
    assert.equal(S.souls, souls - cg.cost); assert.equal(S.stats.spent, spent + cg.cost);
    assert.equal(SIM.grimLines(S).find((l) => l.id === 'dmg').step, i + 1);
  }
  [a, b].forEach((t, i) => near(SIM.towerStats(S, t).dmg, before[i].dmg * (1 + G.all.dmg.k * 5), 'урон после 5 ступеней ' + t.type));
  // свои характеристики не меняются: Гримуар — внешний бонус
  near(own(a).dmg, C.TOWERS.bones.base.dmg, 'свои характеристики');
  const c = build(S, 'dark');
  near(SIM.towerStats(S, c).dmg, SIM.ownStats(S, c).dmg * (1 + G.all.dmg.k * 5), 'урон башни, построенной позже');
  assert.equal(SIM.buildStats(S, -1, 'spirits').dmg, SIM.ownStats(S, { type: 'spirits', cell: -1, tracks: { dmg: 0, range: 0, rate: 0 }, perks: [] }).dmg * (1 + G.all.dmg.k * 5), 'подсказка карточки');
});

test('Гримуар: дальность и скорость входят в итоговые характеристики, интервал выстрела делится', () => {
  const S = SIM.create(5); S.souls = 1e6;
  const t = build(S, 'spirits'), st0 = SIM.towerStats(S, t);
  buy(S, 'range'); buy(S, 'range'); buy(S, 'rate');
  const st = SIM.towerStats(S, t);
  near(st.range, st0.range * (1 + 2 * G.all.range.k), 'дальность');
  near(st.rangePx, st.range * C.UNIT, 'радиус в px');
  near(st.rate, st0.rate / (1 + G.all.rate.k), 'интервал');
  near(st.dmg, st0.dmg, 'урон без покупки урона');
  // следующая ступень ветки в панели тоже с бонусом Гримуара
  near(SIM.towerStats(S, t, 'range').range, SIM.ownStats(S, t, 'range').range * (1 + 2 * G.all.range.k), 'превью ступени');
});

test('Гримуар: линия типа усиливает только башни этого типа, свою ветку', () => {
  const S = SIM.create(5); S.souls = 1e6;
  const bones = build(S, 'bones'), dark = build(S, 'dark'), b0 = SIM.towerStats(S, bones), d0 = SIM.towerStats(S, dark);
  const L = typeLine('bones');
  for (let i = 0; i < 3; i++) { assert.equal(SIM.canGrim(S, 'bones').cost, L.costs[i]); buy(S, 'bones'); }
  assert.equal(SIM.canGrim(S, 'bones').reason, 'max');
  const b = SIM.towerStats(S, bones), d = SIM.towerStats(S, dark);
  const k = (C.TOWERS.bones.grim || {}).k || G.type.k;
  near(b[L.track], b0[L.track] * (1 + 3 * k), 'ветка типа');
  assert.deepEqual(d, d0, 'другой тип не тронут');
  // общая и типовая линии одной ветки складываются
  buy(S, L.track);
  near(SIM.towerStats(S, bones)[L.track], b0[L.track] * (1 + 3 * k + G.all[L.track].k), 'сумма общей и типовой');
  const want = { dmg: 0, range: 0, rate: 0 }; want[L.track] = G.all[L.track].k + 3 * k;
  assert.deepEqual(SIM.grimBonus(S, 'bones'), want);
});

test('Гримуар: отказы с причиной — нет душ, предел, неизвестная линия, закрытый тип, конец забега; доступен во время волны', () => {
  const S = SIM.create(5);
  S.souls = G.all.rate.cost[0] - 1;
  assert.deepEqual(SIM.canGrim(S, 'rate'), { ok: false, reason: 'souls', cost: G.all.rate.cost[0], step: 0, max: 5 });
  buy(S, 'rate'); assert.equal(S.grim.rate, 0); assert.equal(S.souls, G.all.rate.cost[0] - 1);
  S.souls = 1e6;
  for (let i = 0; i < 5; i++) buy(S, 'rate');
  assert.deepEqual(SIM.canGrim(S, 'rate'), { ok: false, reason: 'max', cost: null, step: 5, max: 5 });
  const souls = S.souls; buy(S, 'rate'); assert.equal(S.souls, souls); assert.equal(S.grim.rate, 5);
  for (const bad of ['nope', 'constructor', '__proto__', 'toString', 5, null, undefined, ['dmg']]) {
    assert.equal(SIM.canGrim(S, bad).reason, 'line', String(bad)); assert.doesNotThrow(() => buy(S, bad)); }
  assert.equal(S.souls, souls);
  // во время волны
  SIM.step(S, { cmds: [{ k: 'call' }] }); assert.equal(S.phase, 'wave');
  assert.equal(SIM.canGrim(S, 'dmg').ok, true); buy(S, 'dmg'); assert.equal(S.grim.dmg, 1);
  // закрытый тип: линии нет в списке, купить нельзя
  const L = SIM.create(5, { unlocked: ['bones', 'spirits'] }); L.souls = 1e6;
  assert.deepEqual(SIM.grimLines(L).filter((l) => l.group === 'type').map((l) => l.id), ['bones', 'spirits']);
  assert.equal(SIM.canGrim(L, 'dark').reason, 'locked'); buy(L, 'dark'); assert.equal(L.grim.dark, 0);
  assert.equal(SIM.canGrim(L, 'dmg').ok, true);
  // конец забега
  S.phase = 'lost'; assert.equal(SIM.canGrim(S, 'range').reason, 'ended');
});

test('Гримуар: состояние — чистый JSON, сохраняется с забегом и после загрузки действует так же', () => {
  const S = SIM.create(5); S.souls = 1e6;
  const t = build(S, 'bones'); buy(S, 'dmg'); buy(S, 'dmg'); buy(S, 'bones'); buy(S, 'range');
  const J = json(S);
  assert.equal(SIM.loadable(J), true);
  assert.deepEqual(J.grim, S.grim);
  assert.deepEqual(SIM.towerStats(J, J.towers[t.cell]), SIM.towerStats(S, t));
  assert.deepEqual(SIM.grimLines(J), SIM.grimLines(S));
  assert.ok(S.ev.some((e) => e.k === 'grim' && e.line === 'range' && e.step === 1), 'нет события покупки');
});
