// node --test tests/*.test.mjs — Алтарь крови: аура соседям, ветки и перки ауры, «не складываются», превью соседей, перенос и продажа.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SIM } from './bots.mjs';
const C = SIM.CONFIG, T = C.TOWERS, A = T.altar;

// клетка, у которой можно строить на ней и хотя бы на n соседних клетках (8 направлений); возвращает [клетка, соседи]
const NB = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];
const around = (S, c, r = 1) => { const n = S.map.cols, x = c % n, y = Math.floor(c / n), out = [];
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const X = x + dx, Y = y + dy;
    if ((dx || dy) && X >= 0 && Y >= 0 && X < n && Y < S.map.rows) out.push(Y * n + X); } return out; };
const spot = (S, n) => { S.souls = 1e6;
  for (const c of SIM.rankCells(S, C.TYPICAL_RANGE)) { const nb = around(S, c).filter((i) => SIM.canBuild(S, i, 'bones').ok); if (nb.length >= n) return [c, nb]; }
  throw new Error('нет клетки с ' + n + ' свободными соседями'); };
const build = (S, cell, type, ups = []) => { S.souls = 1e6; SIM.step(S, { cmds: [{ k: 'build', cell, type }, ...ups.map((track) => ({ k: 'upgrade', cell, track }))] }); return S.towers[cell]; };
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} против ${b}`);
// итоговые характеристики st — это свои o плюс аура (dmg, rate, range) алтаря с характеристиками a
const boosted = (st, o, a, msg) => { near(st.dmg, o.dmg * (1 + a.auraDmg), msg + ' урон'); near(st.rate, o.rate / (1 + a.auraRate), msg + ' скорость'); near(st.range, o.range + a.auraRange, msg + ' дальность'); };

test('Алтарь крови — тип из данных: в порядке карточек, не стреляет, три перка, ветки — прибавки ауры', () => {
  assert.ok(C.TOWER_ORDER.includes('altar')); assert.equal(A.title, 'Алтарь крови'); assert.equal(A.attack, undefined);
  assert.equal(Object.keys(A.perks).length, 3);
  assert.equal(A.art.sprite, 'altar'); assert.ok(!A.art.tint, 'алтарь — свой процедурный вид, не перекраска');
  const S = SIM.create(2), [c] = spot(S, 3), tw = build(S, c, 'altar'), o = SIM.towerStats(S, tw);
  assert.equal(o.auraR, 1); assert.ok(o.auraDmg > 0 && o.auraRate > 0);
  for (const [track, key] of [['dmg', 'auraDmg'], ['range', 'auraRange'], ['rate', 'auraRate']]) {
    const next = SIM.towerStats(S, tw, track); assert.ok(next[key] > o[key], `ветка ${track} не растит ${key}`);
    for (const other of ['auraDmg', 'auraRange', 'auraRate']) if (other !== key) assert.equal(next[other], o[other], `ветка ${track} меняет ${other}`); }
  SIM.step(S, { cmds: [{ k: 'call' }] }); for (let i = 0; i < 30 / S.dt; i++) SIM.step(S, null);
  assert.equal(tw.fireT, -9); assert.ok(!S.ev.some((e) => e.k === 'fire' && e.type === 'altar'));
});

test('башни на восьми соседних клетках получают бонус к урону, скорости и дальности, дальше — нет', () => {
  const S = SIM.create(2), [c, nb] = spot(S, 3), far = SIM.rankCells(S, C.TYPICAL_RANGE).find((i) => !around(S, c, 1).includes(i) && i !== c && around(S, c, 2).includes(i));
  const types = ['bones', 'spirits', 'plague', 'dark'], tws = nb.map((cell, i) => build(S, cell, types[i % types.length])), out = build(S, far, 'bones');
  const before = tws.map((t) => SIM.towerStats(S, t)), outBefore = SIM.towerStats(S, out);
  const alt = build(S, c, 'altar'), a = SIM.ownStats(S, alt);
  tws.forEach((t, i) => boosted(SIM.towerStats(S, t), before[i], a, `${t.type} на соседней клетке`));
  assert.deepEqual(SIM.towerStats(S, out), outBefore, 'башня через клетку усилилась');
  // бонус алтаря — внешний: свои характеристики соседа те же, а итоговые несут, от кого бонус
  assert.deepEqual(SIM.ownStats(S, tws[0]), SIM.ownStats(S, Object.assign({}, tws[0])));
  assert.deepEqual(SIM.towerStats(S, tws[0]).altar, { dmg: a.auraDmg, rate: a.auraRate, range: a.auraRange });
  assert.equal(SIM.towerStats(S, out).altar, undefined);
  // стреляет сосед ровно усиленными характеристиками
  const bones = tws[types.indexOf('bones')], st = SIM.towerStats(S, bones);
  SIM.step(S, { cmds: [{ k: 'call' }] });
  for (let i = 0; i < 60 / S.dt && !S.shots.some((s) => s.tw === bones.id && s.k === 'bolt'); i++) SIM.step(S, null);
  const shot = S.shots.find((s) => s.tw === bones.id && s.k === 'bolt'); assert.ok(shot, 'Кости рядом с алтарём не выстрелили');
  near(shot.dmg, st.dmg, 'урон болта');
});

test('ветки алтаря усиливают ауру: ветка урона — бонус урона, скорость — бонус скорости, дальность — бонус дальности', () => {
  const S = SIM.create(3), [c, [n]] = spot(S, 1), tw = build(S, n, 'dark'), o = SIM.towerStats(S, tw);
  const alt = build(S, c, 'altar'), a0 = SIM.ownStats(S, alt), s0 = SIM.towerStats(S, tw);
  for (const track of C.TRACKS) for (let i = 0; i < C.TRACK_MAX; i++) SIM.step(S, { cmds: [{ k: 'upgrade', cell: c, track }] });
  const a5 = SIM.ownStats(S, alt), s5 = SIM.towerStats(S, tw);
  assert.ok(a5.auraDmg > a0.auraDmg && a5.auraRate > a0.auraRate && a5.auraRange > a0.auraRange);
  assert.ok(s5.dmg > s0.dmg && s5.rate < s0.rate && s5.range > s0.range, 'прокачка алтаря не дошла до соседа');
  boosted(s5, o, a5, 'сосед прокачанного алтаря');
});

test('бонусы нескольких алтарей не складываются: по каждой прибавке берётся сильнейший; алтари рядом не зацикливаются', () => {
  const S = SIM.create(4), [c, nb] = spot(S, 3), tw = build(S, c, 'bones'), o = SIM.towerStats(S, tw);
  const p = nb[0], q = nb.find((i) => around(S, p, 1).includes(i)) || nb[1];   // по возможности алтари — соседи друг другу
  const a1 = build(S, p, 'altar'), one = SIM.towerStats(S, tw);
  const a2 = build(S, q, 'altar'); assert.deepEqual(SIM.towerStats(S, tw), one, 'два одинаковых алтаря дали больше одного');
  // второй алтарь сильнее по урону, первый — по скорости: каждая прибавка от сильнейшего
  for (let i = 0; i < 3; i++) SIM.step(S, { cmds: [{ k: 'upgrade', cell: q, track: 'dmg' }, { k: 'upgrade', cell: p, track: 'rate' }] });
  const s1 = SIM.ownStats(S, a1), s2 = SIM.ownStats(S, a2), st = SIM.towerStats(S, tw);
  assert.ok(s2.auraDmg > s1.auraDmg && s1.auraRate > s2.auraRate);
  boosted(st, o, { auraDmg: s2.auraDmg, auraRate: s1.auraRate, auraRange: Math.max(s1.auraRange, s2.auraRange) }, 'два алтаря');
  // алтарь рядом с алтарём: характеристики конечны, алтарь сам ауру не получает
  const st2 = SIM.towerStats(S, a2); assert.ok(Object.values(st2).every((v) => typeof v !== 'number' || Number.isFinite(v)));
  assert.equal(st2.altar, undefined, 'алтарь получил ауру соседнего алтаря');
});

test('три перка алтаря: сильнее урон соседям, сильнее скорость соседям, аура на две клетки вокруг', () => {
  const S0 = SIM.create(5), [c] = spot(S0, 1), ups = []; for (let i = 0; i < C.PERK_AT; i++) ups.push(C.TRACKS[i % C.TRACKS.length]);
  const res = {};
  for (const p of [null, ...Object.keys(A.perks)]) { const S = SIM.create(5), tw = build(S, c, 'altar', ups);
    if (p) { assert.equal(SIM.canPerk(S, c, p).ok, true, p); SIM.step(S, { cmds: [{ k: 'perk', cell: c, p }] }); assert.deepEqual(SIM.perksOf(tw), [p]); }
    res[p || 'none'] = { st: SIM.towerStats(S, tw), S }; }
  const none = res.none.st, ids = Object.keys(A.perks), [offering, frenzy, circle] = ids.map((id) => res[id].st);
  assert.ok(offering.auraDmg > none.auraDmg && offering.auraRate === none.auraRate, 'первый перк — урон соседям');
  assert.ok(frenzy.auraRate > none.auraRate && frenzy.auraDmg === none.auraDmg, 'второй перк — скорость соседям');
  assert.equal(circle.auraR, 2); assert.equal(none.auraR, 1);
  // «круг»: башня через клетку усилена, без перка — нет
  for (const [id, want] of [['none', false], [ids[2], true]]) { const S = res[id].S, far = SIM.rankCells(S, C.TYPICAL_RANGE).find((i) => around(S, c, 2).includes(i) && !around(S, c, 1).includes(i));
    const tw = build(S, far, 'bones'); assert.equal(!!SIM.towerStats(S, tw).altar, want, `${id}: башня через клетку`);
    assert.equal(SIM.auraTargets(S, c).includes(far), want); }
  for (const id of ids) { const txt = SIM.perkText(id); assert.ok(!/[{}]/.test(txt) && txt.length > 10, txt); }
});

test('превью: каких соседей усилит алтарь на клетке — до постройки и после; только башни с атакой', () => {
  const S = SIM.create(6), [c, nb] = spot(S, 3), [a, b, d] = nb;
  assert.deepEqual(SIM.auraTargets(S, c, 'altar'), []);
  build(S, a, 'bones'); build(S, b, 'plague'); build(S, d, 'altar');
  assert.deepEqual(SIM.auraTargets(S, c, 'altar').sort((x, y) => x - y), [a, b].sort((x, y) => x - y), 'алтарь в превью усиливает только стреляющих');
  assert.deepEqual(SIM.auraTargets(S, c, 'bones'), [], 'у Костей нет ауры');
  assert.ok(SIM.hasAura('altar') && !SIM.hasAura('bones') && !SIM.hasAura('nope'));
  build(S, c, 'altar'); assert.deepEqual(SIM.auraTargets(S, c).sort((x, y) => x - y), [a, b].sort((x, y) => x - y), 'стоящий алтарь');
  assert.deepEqual(SIM.auraTargets(S, a), [], 'у клетки с Костями ауры нет');
  // клетки, которые накрывает аура (рамка на карте): 3×3 в пределах поля
  const cells = SIM.auraCells(S, c); assert.equal(cells.length, 9); assert.ok(cells.includes(c) && nb.every((i) => cells.includes(i)));
  assert.equal(SIM.auraCells(S, 0, 'altar').length, 4, 'угол поля: аура обрезана краем');
});

test('продажа и перенос алтаря сразу снимают бонус; перенос к другой башне даёт бонус ей', () => {
  const S = SIM.create(7), [c, [n]] = spot(S, 1), tw = build(S, n, 'spirits'), o = SIM.towerStats(S, tw);
  build(S, c, 'altar'); assert.ok(SIM.towerStats(S, tw).altar);
  const to = SIM.moveCells(S, c).find((i) => !around(S, n, 1).includes(i));
  SIM.step(S, { cmds: [{ k: 'move', cell: c, to }] }); assert.equal(S.towers[to].type, 'altar');
  assert.deepEqual(SIM.towerStats(S, tw), o, 'после переноса алтаря бонус остался');
  SIM.step(S, { cmds: [{ k: 'move', cell: to, to: c }] }); assert.ok(SIM.towerStats(S, tw).altar, 'алтарь вернулся — бонус вернулся');
  SIM.step(S, { cmds: [{ k: 'sell', cell: c }] }); assert.deepEqual(SIM.towerStats(S, tw), o, 'после продажи алтаря бонус остался');
  // сейв с алтарём и усиленным соседом годен
  build(S, c, 'altar'); assert.ok(SIM.loadable(JSON.parse(JSON.stringify(S))));
});

test('превью переноса алтаря: кого он усилит на новой клетке — со своими перками, как после переноса', () => {
  const S = SIM.create(7), [c, [n]] = spot(S, 1), tw = build(S, n, 'spirits'), alt = build(S, c, 'altar');
  alt.perks.push('circle');                                            // «Кровавый круг»: охват 2 — превью обязано его учесть
  for (const to of SIM.moveCells(S, c)) {
    const pv = SIM.auraTargets(S, to, c).slice().sort();
    const T = JSON.parse(JSON.stringify(S)); SIM.step(T, { cmds: [{ k: 'move', cell: c, to }] });
    assert.deepEqual(pv, SIM.auraTargets(T, to).slice().sort(), `клетка ${to}`); }
  assert.deepEqual(SIM.auraTargets(S, c, n), [], 'с клетки не-алтаря превью пустое');
});

test('аура действует и на Колокол: его удар сильнее и чаще', () => {
  const S = SIM.create(8), [c, [n]] = spot(S, 1), bell = build(S, n, 'bell'), o = SIM.towerStats(S, bell);
  const alt = build(S, c, 'altar'); boosted(SIM.towerStats(S, bell), o, SIM.ownStats(S, alt), 'Колокол рядом с алтарём');
});

test('«Беспокойные мёртвые»: алтарь, перенесённый посреди волны, сразу уносит ауру', () => {
  const S = SIM.create(9), [c, [n]] = spot(S, 1), tw = build(S, n, 'bones'), o = SIM.towerStats(S, tw);
  build(S, c, 'altar'); S.relics.push('restless'); SIM.step(S, { cmds: [{ k: 'call' }] }); assert.equal(S.phase, 'wave');
  assert.ok(SIM.towerStats(S, tw).altar);
  const to = SIM.moveCells(S, c).find((i) => !around(S, n, 1).includes(i)); assert.ok(to !== undefined, 'перенос посреди волны недоступен');
  SIM.step(S, { cmds: [{ k: 'move', cell: c, to }] }); assert.equal(S.towers[to] && S.towers[to].type, 'altar');
  assert.deepEqual(SIM.towerStats(S, tw), o, 'бонус остался на старом месте');
});

test('Гримуар усиливает ауру алтаря: линия типа Алтаря — сила ауры (урон соседям), видно и в характеристиках алтаря', () => {
  const S = SIM.create(10), [c, [n]] = spot(S, 1), tw = build(S, n, 'dark'), alt = build(S, c, 'altar');
  const own0 = SIM.ownStats(S, alt), before = SIM.towerStats(S, tw).altar;
  S.souls = 1e6; SIM.step(S, { cmds: [{ k: 'grim', line: 'altar' }] }); assert.equal(S.grim.altar, 1);
  const g = SIM.grimBonus(S, 'altar'), after = SIM.towerStats(S, tw).altar;
  assert.ok(g.dmg > 0); near(after.dmg, before.dmg * (1 + g.dmg), 'урон соседям после линии Гримуара');
  near(SIM.towerStats(S, alt).auraDmg, own0.auraDmg * (1 + g.dmg), 'сила ауры в итоговых характеристиках алтаря');
  assert.deepEqual(SIM.ownStats(S, alt), own0, 'Гримуар — внешний бонус, свои характеристики алтаря те же');
});
