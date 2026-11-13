// node --test tests/*.test.mjs — слияние башен в гибриды: условия и запреты, команда merge, гибрид (потолок 8, два перка,
// вложенное), цели и превью, дымовой прогон всех пар типов, эффект каждой примеси, перки второй башни на чужой атаке,
// внешние бонусы, перенос и продажа, сейв.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SIM } from './bots.mjs';
const C = SIM.CONFIG, T = C.TOWERS, M = C.MERGE;

const around = (S, c, r = 1) => { const n = S.map.cols, x = c % n, y = Math.floor(c / n), out = [];
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const X = x + dx, Y = y + dy;
    if ((dx || dy) && X >= 0 && Y >= 0 && X < n && Y < S.map.rows) out.push(Y * n + X); } return out; };
const diag = (S, a, b) => a % S.map.cols !== b % S.map.cols && Math.floor(a / S.map.cols) !== Math.floor(b / S.map.cols);
// две соседние свободные клетки у дороги (dg: true — по диагонали, false — по стороне, undefined — любые); rest — сколько ещё
// свободных соседей нужно у первой
const pairSpot = (S, dg, rest = 0) => {
  for (const c of SIM.rankCells(S, C.TYPICAL_RANGE)) { const nb = around(S, c).filter((i) => SIM.canBuild(Object.assign({}, S, { souls: 1e9 }), i, 'bones').ok);
    const b = nb.find((i) => dg === undefined || diag(S, c, i) === dg); if (b !== undefined && nb.length > rest) return [c, b, nb.filter((i) => i !== b)]; }
  throw new Error('нет пары соседних клеток'); };
// башня типа type со всеми ветками на потолке обычной башни и перком p (если задан)
const maxed = (S, cell, type, p) => { S.souls = 1e7; const cmds = [{ k: 'build', cell, type }];
  for (const k of C.TRACKS) for (let i = 0; i < C.TRACK_MAX; i++) cmds.push({ k: 'upgrade', cell, track: k });
  if (p) cmds.push({ k: 'perk', cell, p });
  SIM.step(S, { cmds }); const tw = S.towers[cell]; assert.ok(tw && tw.type === type, 'не построилась ' + type); if (p) assert.ok(SIM.hasPerk(tw, p), 'не взялся перк ' + p);
  return tw; };
// гибрид first + second на сиде seed; p1, p2 — перки башен до слияния
const hybrid = (seed, first, second, p1, p2, dg) => {
  const S = SIM.create(seed), [a, b, rest] = pairSpot(S, dg, 1), A = maxed(S, a, first, p1), B = maxed(S, b, second, p2);
  const before = { A: JSON.parse(JSON.stringify(A)), B: JSON.parse(JSON.stringify(B)), souls: S.souls };
  SIM.step(S, { cmds: [{ k: 'merge', cell: a, other: b }] });
  return { S, a, b, rest, tw: S.towers[a], before }; };
const near = (x, y, msg) => assert.ok(Math.abs(x - y) < 1e-6, `${msg}: ${x} против ${y}`);
const hurt = (e) => e.max - e.hp;
// враги-манекены (живучие, на месте) на дороге в точке на расстоянии dist px от клетки cell; волна идёт, очередь пуста
const dummies = (S, cell, enemy, dists) => {
  SIM.step(S, { cmds: [{ k: 'call' }] }); S.queue = []; S.qi = 0; S.enemies = []; S.shots = [];
  const [x, y] = SIM.cellXY(S, cell), L = SIM.pathLen(S);
  return dists.map((dist) => { let best = 0, bd = Infinity;
    for (let d = 0; d < L; d += 1) { const p = SIM.posAt(S, d), q = Math.abs(Math.hypot(p.x - x, p.y - y) - dist); if (q < bd) { bd = q; best = d; } }
    S.queue.push({ at: 0, e: enemy }); S.qi = S.queue.length - 1; S.waveT = 0; SIM.step(S, null);
    const e = S.enemies[S.enemies.length - 1]; e.d = best; e.lane = 0; e.speed = 0; e.hp = e.max = 1e6; e.heal = 0; return e; });
};
// шагать, пока башня tw не выстрелит n раз (по событиям fire), и ещё after секунд — долететь снаряду
const fires = (S, tw, n = 1, after = 1.2) => { let k = 0;
  for (let i = 0; i < 20 / S.dt && k < n; i++) { SIM.step(S, null); if (S.ev.some((e) => e.k === 'fire' && e.cell === tw.cell && e.t === S.t)) k++; }
  assert.equal(k, n, 'башня не выстрелила');
  for (let i = 0; i < after / S.dt; i++) { const was = tw.cd; SIM.step(S, null); if (tw.cd > was + 1e-9) break; } };
const firsts = C.TOWER_ORDER.filter((t) => T[t].attack), all = C.TOWER_ORDER;
const json = (S) => JSON.parse(JSON.stringify(S));

test('у каждого типа в конфиге есть примесь: имя, значок, числа и описание из данных; цена слияния — не дороже перка', () => {
  for (const type of all) { const m = T[type].mix;
    assert.ok(m && m.name && m.icon && m.add && Object.keys(m.add).length, 'нет примеси у ' + type);
    const txt = SIM.mixText(type); assert.ok(!/[{}]/.test(txt) && txt.length > 15, `${type}: ${txt}`);
    assert.ok(!/\d/.test(m.desc.replace(/\{[^}]*\}/g, '')), `${type}: число вписано в описание примеси руками`); }
  for (const type of all) for (const p of Object.values(T[type].perks)) assert.ok(M.cost > 0 && M.cost <= p.cost, 'слияние дороже перка');
  assert.ok(M.cap === 8 && M.slots === 2);
  assert.deepEqual(firsts, all.filter((t) => t !== 'altar'), 'первой может быть любая башня с атакой, кроме Алтаря');
});

test('слияние: гибрид на клетке первой, клетка второй свободна; вложенное — сумма плюс цена; оба перка; потолок 8; счётчик слияний', () => {
  const { S, a, b, tw, before } = hybrid(2, 'bones', 'spirits', 'crush', 'frost');
  assert.equal(S.towers[b], null, 'клетка второй башни не освободилась');
  assert.equal(tw.id, before.A.id, 'гибрид — первая башня'); assert.equal(tw.type, 'bones'); assert.equal(tw.mix, 'spirits');
  assert.equal(tw.cap, M.cap); assert.equal(tw.slots, M.slots);
  assert.deepEqual(SIM.perksOf(tw), ['crush', 'frost']);
  assert.equal(tw.invested, before.A.invested + before.B.invested + M.cost);
  assert.equal(before.souls - S.souls, M.cost, 'списана цена слияния');
  assert.deepEqual(tw.tracks, before.A.tracks, 'ступени первой башни остались');
  assert.equal(S.stats.merges, 1);
  assert.equal(SIM.create(1).stats.merges, 0);
  assert.ok(S.ev.some((e) => e.k === 'merge' && e.cell === a && e.other === b && e.type === 'bones' && e.mix === 'spirits'), 'нет события слияния');
  assert.equal(SIM.canBuild(S, b, 'dark').ok, true, 'на освободившейся клетке нельзя строить');
  assert.equal(SIM.sellValue(tw, S), Math.floor(tw.invested * C.SELL_REFUND));
});

test('гибрид качается до 8-й ступени по ценам из конфига и повторно не сливается — ни первым, ни вторым', () => {
  const { S, a, rest } = hybrid(3, 'dark', 'bones');
  for (const k of C.TRACKS) for (let n = C.TRACK_MAX; n < M.cap; n++) {
    const cu = SIM.canUpgrade(S, a, k); assert.ok(cu.ok, `ступень ${n + 1} ветки ${k}: ${cu.reason}`); assert.equal(cu.cost, T.dark.tracks[k].cost[n]);
    SIM.step(S, { cmds: [{ k: 'upgrade', cell: a, track: k }] }); }
  for (const k of C.TRACKS) { assert.equal(S.towers[a].tracks[k], M.cap); assert.equal(SIM.canUpgrade(S, a, k).reason, 'max'); }
  const c = rest[0]; maxed(S, c, 'bones');
  assert.equal(SIM.canMerge(S, a, c).reason, 'hybrid', 'гибрид первым'); assert.equal(SIM.canMerge(S, c, a).reason, 'mixed', 'гибрид вторым');
  assert.deepEqual(SIM.mergeTargets(S, c), []);
  const was = JSON.stringify(S.towers); SIM.step(S, { cmds: [{ k: 'merge', cell: c, other: a }, { k: 'merge', cell: a, other: c }] });
  assert.equal(JSON.stringify(S.towers.map((t) => t && [t.type, t.mix])), JSON.stringify(JSON.parse(was).map((t) => t && [t.type, t.mix])));
});

test('запреты слияния: причина словами из логики, и команда при отказе ничего не меняет', () => {
  const S = SIM.create(4), [a, b, rest] = pairSpot(S, undefined, 1), far = SIM.rankCells(S, C.TYPICAL_RANGE).find((i) => !around(S, a, 1).includes(i) && i !== a && SIM.canBuild(S, i, 'bones').ok);
  assert.equal(SIM.canMerge(S, a, b).reason, 'none');
  maxed(S, a, 'bones');
  assert.equal(SIM.canMerge(S, a, b).reason, 'empty');
  assert.equal(SIM.canMerge(S, a, a).reason, 'same');
  S.souls = 1e6; SIM.step(S, { cmds: [{ k: 'build', cell: b, type: 'spirits' }] });
  assert.equal(SIM.canMerge(S, a, b).reason, 'unready', 'вторая не прокачана');
  assert.equal(SIM.canMerge(S, b, a).reason, 'tracks', 'первая не прокачана');
  for (const k of C.TRACKS) for (let i = 0; i < C.TRACK_MAX; i++) SIM.step(S, { cmds: [{ k: 'upgrade', cell: b, track: k }] });
  maxed(S, far, 'dark'); assert.equal(SIM.canMerge(S, a, far).reason, 'far', 'не соседи');
  assert.equal(SIM.canMerge(S, a, b).ok, true); assert.equal(SIM.canMerge(S, a).ok, true, 'без второй — можно ли слить эту башню вообще');
  S.souls = M.cost - 1; assert.deepEqual(SIM.canMerge(S, a, b), { ok: false, reason: 'souls', cost: M.cost });
  SIM.step(S, { cmds: [{ k: 'merge', cell: a, other: b }] }); assert.equal(S.towers[b].type, 'spirits', 'слилось без душ');
  S.souls = 1e6;
  // во время волны — нельзя (и с реликвией переноса посреди боя тоже)
  S.relics.push('restless'); SIM.step(S, { cmds: [{ k: 'call' }] }); assert.equal(S.phase, 'wave');
  assert.equal(SIM.canMerge(S, a, b).reason, 'phase'); assert.equal(SIM.canMerge(S, a).reason, 'phase'); assert.deepEqual(SIM.mergeTargets(S, a), []);
  SIM.step(S, { cmds: [{ k: 'merge', cell: a, other: b }] }); assert.ok(S.towers[b] && !S.towers[a].mix, 'слилось во время волны');
  // Алтарь крови первым — нельзя, вторым — можно
  const S2 = SIM.create(4); maxed(S2, a, 'altar'); maxed(S2, b, 'bones');
  assert.equal(SIM.canMerge(S2, a, b).reason, 'first'); assert.equal(SIM.canMerge(S2, a).reason, 'first'); assert.equal(SIM.canMerge(S2, b, a).ok, true);
  // мусор в команде
  for (const other of [undefined, null, -1, 1e9, 1.5, 'x', [b]]) assert.equal(SIM.canMerge(S2, b, other === undefined ? -5 : other).ok, false, String(other));
  SIM.step(S2, { cmds: [{ k: 'merge', cell: b, other: 'x' }, { k: 'merge', cell: 'x', other: b }, { k: 'merge' }] }); assert.ok(!S2.towers[b].mix);
  // конец забега
  S2.phase = 'lost'; assert.equal(SIM.canMerge(S2, b, a).reason, 'ended');
});

test('цели слияния: соседи по восьми направлениям (и по диагонали), только готовые; при нехватке душ цель остаётся', () => {
  for (const dg of [true, false]) { const S = SIM.create(5), [a, b] = pairSpot(S, dg); maxed(S, a, 'plague'); maxed(S, b, 'bell');
    assert.deepEqual(SIM.mergeTargets(S, a), [b], dg ? 'по диагонали' : 'по стороне'); assert.deepEqual(SIM.mergeTargets(S, b), [a]);
    S.souls = 0; assert.deepEqual(SIM.mergeTargets(S, a), [b], 'без душ сосед всё равно подходит (кнопка покажет нехватку)'); }
  const S = SIM.create(5), [a, b, [c]] = pairSpot(S, undefined, 1); maxed(S, a, 'dark'); S.souls = 1e6; SIM.step(S, { cmds: [{ k: 'build', cell: b, type: 'bones' }] }); maxed(S, c, 'altar');
  assert.deepEqual(SIM.mergeTargets(S, a), [c], 'непрокачанный сосед — не цель'); assert.deepEqual(SIM.mergeTargets(S, c), [], 'Алтарь первым не сливается');
});

test('превью гибрида: что получится — до слияния, ровно то, что выходит после', () => {
  const S = SIM.create(6), [a, b] = pairSpot(S); maxed(S, a, 'spirits', 'pack'); maxed(S, b, 'dark', 'curse');
  const info = SIM.mergeInfo(S, a, b), towersBefore = JSON.stringify(S.towers);
  assert.equal(info.ok, true); assert.equal(info.cost, M.cost); assert.equal(info.type, 'spirits'); assert.equal(info.mix, 'dark');
  assert.match(info.name, /ДУХИ/); assert.match(info.name, /ТЬМА/); assert.equal(info.icon, T.dark.mix.icon); assert.equal(info.mixText, SIM.mixText('dark'));
  assert.equal(info.cap, M.cap); assert.equal(info.frees, b);
  assert.deepEqual(info.perks.map((p) => [p.id, p.on]), [['pack', true], ['curse', true]]);
  assert.equal(JSON.stringify(S.towers), towersBefore, 'превью изменило башни');
  SIM.step(S, { cmds: [{ k: 'merge', cell: a, other: b }] });
  const tw = S.towers[a], st = SIM.towerStats(S, tw);
  assert.deepEqual(info.stats, st, 'характеристики превью — как у вышедшего гибрида');
  assert.equal(info.invested, tw.invested);
  const hi = SIM.hybridInfo(S, tw); assert.equal(hi.name, info.name); assert.deepEqual(hi.stats, st);
  assert.equal(SIM.hybridInfo(S, S.towers.find((t) => t && !t.mix) || Object.assign({}, tw, { mix: null })), null, 'у обычной башни нет описания гибрида');
  // перки гибрида — двух типов, группами по типу
  assert.deepEqual(SIM.perkGroups(tw).map((g) => [g.type, g.ids.length]), [['spirits', 3], ['dark', 3]]);
  assert.equal(SIM.mergeInfo(S, a, a), null);
});

test('одинаковые типы сливаются: атака плюс собственная примесь, оба слота — перки своего типа', () => {
  const { S, a, tw } = hybrid(7, 'bones', 'bones', 'crush');
  assert.equal(tw.type, 'bones'); assert.equal(tw.mix, 'bones');
  const st = SIM.towerStats(S, tw); assert.equal(st.pierceN, T.bones.mix.add.pierceN);
  assert.deepEqual(SIM.perkGroups(tw).map((g) => g.type), ['bones']);
  assert.equal(SIM.freeSlots(tw), 1);
  S.souls = 1e6; SIM.step(S, { cmds: [{ k: 'perk', cell: a, p: 'volley' }] }); assert.deepEqual(SIM.perksOf(tw), ['crush', 'volley']);
  // у разных типов — по перку на тип
  const H = hybrid(7, 'bones', 'spirits', 'crush'); H.S.souls = 1e6;
  assert.equal(SIM.canPerk(H.S, H.a, 'volley').reason, 'taken', 'второй перк Костей у гибрида Костей и Духов');
  assert.equal(SIM.canPerk(H.S, H.a, 'frost').ok, true);
  assert.equal(SIM.canPerk(H.S, H.a, 'curse').reason, 'perk', 'перк чужого типа');
});

test('Кости + Кости с Залпом и Пронзающим болтом: каждый болт залпа летит к своей цели и пробивает врагов по линии', () => {
  const { S, a, tw } = hybrid(7, 'bones', 'bones', 'pierce', 'volley'), st = SIM.towerStats(S, tw), r = st.rangePx;
  assert.deepEqual(SIM.perksOf(tw), ['pierce', 'volley']); assert.ok(SIM.perkOn(tw, 'pierce') && SIM.perkOn(tw, 'volley'));
  assert.ok(st.bolts > 1 && st.pierce > 1);
  const es = dummies(S, a, 'militia', [r * 0.3, r * 0.5, r * 0.7, r * 0.9]);
  fires(S, tw, 1, 0);
  const shots = S.shots.filter((s) => s.k === 'bolt' && s.tw === tw.id);
  assert.equal(shots.length, st.bolts, 'болтов залпа');
  for (const s of shots) { assert.equal(s.pierce, st.pierce, 'болт залпа не пронзающий'); near(s.dmg, st.dmg * st.boltMult, 'урон болта залпа'); }
  for (let i = 0; i < 2 / S.dt && S.shots.some((s) => s.tw === tw.id); i++) SIM.step(S, null);
  assert.ok(es.filter((e) => hurt(e) > 0).length >= st.bolts, 'болты залпа не долетели до своих целей');
});

// ---------------------------------------------------------------- дымовой прогон всех пар
test('каждая допустимая упорядоченная пара типов сливается и отыгрывает волну без ошибок и нечисловых значений', () => {
  const bad = (o, path) => { if (typeof o === 'number') return Number.isFinite(o) ? null : path;
    if (o && typeof o === 'object') for (const k of Object.keys(o)) { if (k === 'map') continue; const b = bad(o[k], path + '.' + k); if (b) return b; } return null; };
  let pairs = 0;
  for (const first of firsts) for (const second of all) {
    const S = SIM.create(11, { dt: 1 / 30 }), [a, b] = pairSpot(S);
    maxed(S, a, first, Object.keys(T[first].perks)[0]); maxed(S, b, second, Object.keys(T[second].perks)[2]);
    assert.equal(SIM.canMerge(S, a, b).ok, true, `${first}+${second}: ${SIM.canMerge(S, a, b).reason}`);
    SIM.step(S, { cmds: [{ k: 'merge', cell: a, other: b }] }); const tw = S.towers[a];
    assert.ok(tw.mix === second && tw.type === first, `${first}+${second} не слились`);
    S.wave = 5; SIM.step(S, { cmds: [{ k: 'call' }] });
    for (let i = 0; i < 90 / S.dt && S.phase === 'wave'; i++) { SIM.step(S, null);
      if (i % 60 === 0) { const p = bad(S, 'S'); assert.equal(p, null, `${first}+${second}: нечисловое ${p}`); } }
    assert.ok(tw.fireT > 0 && tw.dmg > 0, `${first}+${second}: гибрид не стрелял`);
    assert.equal(bad(S, 'S'), null); assert.equal(SIM.loadable(json(S)), true, `${first}+${second}: сейв негоден`);
    const st = SIM.towerStats(S, tw); assert.equal(bad(st, 'st'), null);
    pairs++; }
  assert.equal(pairs, firsts.length * all.length);
});

// ---------------------------------------------------------------- примеси
test('примесь Костей — пронзание: удар чужой атаки задевает ещё врага рядом с целью', () => {
  const { S, a, tw } = hybrid(8, 'dark', 'bones'), st = SIM.towerStats(S, tw), r = st.rangePx * 0.5, [e1, e2] = dummies(S, a, 'militia', [r, r]);
  fires(S, tw, 1, 0);
  const [big, small] = [e1, e2].map(hurt).sort((x, y) => y - x);
  assert.ok(big > 0 && small > 0, `второй враг не задет: ${big} / ${small}`);
  near(small / big, T.bones.mix.add.pierceK, 'доля урона пронзания');
  assert.ok(S.ev.some((e) => e.k === 'pierce'), 'нет события пронзания для сцены');
});

test('примесь Духов — замедление: болт гибрида замедляет; у Духов с примесью Духов — сильнее, но не выше предела', () => {
  const { S, a, tw } = hybrid(8, 'bones', 'spirits'), st = SIM.towerStats(S, tw), [e] = dummies(S, a, 'militia', [st.rangePx * 0.5]);
  near(st.slow, T.spirits.mix.add.slow, 'замедление в характеристиках'); fires(S, tw);
  near(e.slowK, T.spirits.mix.add.slow, 'замедление на враге'); assert.ok(e.slowT > 0);
  const H = hybrid(8, 'spirits', 'spirits', 'chill'), hs = SIM.towerStats(H.S, H.tw);
  for (const k of C.TRACKS) for (let i = 0; i < 3; i++) SIM.step(H.S, { cmds: [{ k: 'upgrade', cell: H.a, track: k }] });
  const top = SIM.towerStats(H.S, H.tw), [g] = dummies(H.S, H.a, 'militia', [top.rangePx * 0.5]);
  assert.ok(top.slow > T.spirits.extra.slow + T.spirits.mix.add.slow && hs.slow > 0);
  fires(H.S, H.tw); near(g.slowK, Math.min(C.SLOW_MAX, top.slow), 'замедление не выше предела');
});

test('примесь Чумы — яд при попадании: после удара враг отравлен на долю урона попадания', () => {
  const { S, a, tw } = hybrid(9, 'bones', 'plague'), st = SIM.towerStats(S, tw), [e] = dummies(S, a, 'militia', [st.rangePx * 0.5]);
  fires(S, tw, 1, 0.6); const p = e.poison['v' + tw.id];
  assert.ok(p, 'яд не лёг: ' + JSON.stringify(e.poison)); near(p.dps, st.dmg * T.plague.mix.add.venom, 'яд в секунду');
  const h = hurt(e); tw.cd = 1e9; S.shots = []; for (let i = 0; i < Math.round(1 / S.dt); i++) SIM.step(S, null);
  near(hurt(e) - h, p.dps * 1, 'яд за секунду'); assert.equal(e.poison['v' + tw.id].tw, tw.id);
});

test('примесь Тьмы — пробой: броня и магическая защита гасят меньше урона', () => {
  const P = T.dark.mix.add;
  const { S, a, tw } = hybrid(10, 'bones', 'dark'), st = SIM.towerStats(S, tw), [k] = dummies(S, a, 'knight', [st.rangePx * 0.5]);
  fires(S, tw); near(hurt(k), st.dmg * (1 - k.armor * (1 - P.pen)), 'урон по рыцарю');
  const H = hybrid(10, 'spirits', 'dark'), hs = SIM.towerStats(H.S, H.tw), [pr] = dummies(H.S, H.a, 'priest', [hs.rangePx * 0.5]);
  fires(H.S, H.tw); near(hurt(pr), hs.dmg * (1 - pr.mres * (1 - P.mpen)), 'урон по священнику');
  // на яде пробою нечего делать — это честно помечено
  const Q = hybrid(10, 'plague', 'dark'); assert.equal(SIM.hybridInfo(Q.S, Q.tw).mixOn, false); assert.equal(SIM.hybridInfo(H.S, H.tw).mixOn, true);
});

test('примесь Колокола — шанс мини-оглушения при попадании; боссы не оглушаются', () => {
  const add = T.bell.mix.add, was = add.stunChance; add.stunChance = 1;
  try {
    const { S, a, tw } = hybrid(12, 'spirits', 'bell'), st = SIM.towerStats(S, tw), [e] = dummies(S, a, 'militia', [st.rangePx * 0.5]);
    fires(S, tw, 1, 0); for (let i = 0; i < 2 / S.dt && !(e.stunT > 0); i++) SIM.step(S, null);
    assert.ok(e.stunT > 0 && e.stunT <= add.stunMini, 'мини-оглушение не легло: ' + e.stunT);
    const H = hybrid(12, 'spirits', 'bell'), hs = SIM.towerStats(H.S, H.tw), [b] = dummies(H.S, H.a, 'paladin', [hs.rangePx * 0.5]);
    fires(H.S, H.tw, 2); assert.equal(b.stunT, 0, 'босс оглушён'); assert.ok(hurt(b) > 0);
  } finally { add.stunChance = was; }
  // с настоящим шансом: оглушает часть попаданий
  const { S, a, tw } = hybrid(12, 'bones', 'bell'), st = SIM.towerStats(S, tw), es = dummies(S, a, 'militia', [st.rangePx * 0.5]);
  let stuns = 0, shots = 0; for (let i = 0; i < 40 / S.dt; i++) { SIM.step(S, null); for (const v of S.ev) if (v.t === S.t) { if (v.k === 'stun') stuns++; if (v.k === 'fire' && v.cell === a) shots++; } }
  assert.ok(stuns > 0 && stuns < shots, `оглушений ${stuns} из ${shots} выстрелов`);
  assert.ok(es[0].hp < es[0].max);
});

test('примесь Алтаря крови — ослабленная аура: соседи гибрида бьют сильнее и чаще, слабее, чем от Алтаря; себя гибрид не усиливает', () => {
  const { S, a, rest, tw } = hybrid(13, 'bones', 'altar'), n = rest[0], add = T.altar.mix.add;
  S.souls = 1e6; SIM.step(S, { cmds: [{ k: 'build', cell: n, type: 'spirits' }] }); const sp = S.towers[n];
  assert.ok(SIM.auraOf(tw), 'у гибрида нет ауры');
  assert.deepEqual(SIM.towerStats(S, sp).altar, { dmg: add.auraDmg, rate: add.auraRate, range: add.auraRange });
  assert.equal(SIM.towerStats(S, tw).altar, undefined, 'гибрид усилил сам себя');
  assert.ok(SIM.auraTargets(S, a).includes(n)); assert.ok(SIM.auraCells(S, a).includes(n));
  const real = SIM.ownStats(S, Object.assign(JSON.parse(JSON.stringify(tw)), { type: 'altar', mix: null, tracks: { dmg: 0, range: 0, rate: 0 }, perks: [] }));
  assert.ok(add.auraDmg < real.auraDmg && add.auraRate < real.auraRate, 'аура примеси не слабее Алтаря');
  // перк Алтаря на гибриде усиливает его ауру
  const H = hybrid(13, 'bones', 'altar', null, 'offering'); assert.ok(SIM.towerStats(H.S, H.tw).auraDmg > add.auraDmg);
  assert.equal(SIM.hybridInfo(H.S, H.tw).perks[0].on, true);
});

// ---------------------------------------------------------------- перки на гибриде
test('перки второй башни на чужой атаке: общие действуют, перки своей атаки помечены недействующими и не покупаются', () => {
  // Проклятие Тьмы на болте: попадание проклинает
  const { S, a, tw } = hybrid(14, 'bones', 'dark', null, 'curse'), st = SIM.towerStats(S, tw), [e] = dummies(S, a, 'militia', [st.rangePx * 0.5]);
  assert.equal(SIM.perkOn(tw, 'curse'), true); fires(S, tw);
  near(e.curse, T.dark.perks.curse.set.curse, 'проклятие с болта'); assert.ok(e.curseT > 0);
  // Стая Духов на болте не действует: нет её чисел в характеристиках, помечена в описании
  const H = hybrid(14, 'bones', 'spirits', null, 'pack'), hs = SIM.towerStats(H.S, H.tw);
  assert.equal(SIM.perkOn(H.tw, 'pack'), false); assert.equal(hs.bounces, undefined);
  assert.deepEqual(SIM.hybridInfo(H.S, H.tw).perks.map((p) => [p.id, p.on]), [['pack', false]]);
  // недействующий перк не продаётся; свои перки первой — продаются
  H.S.souls = 1e6; assert.equal(SIM.canPerk(H.S, H.a, 'volley').ok, true);
  const Q = hybrid(14, 'bones', 'spirits'); Q.S.souls = 1e6; assert.equal(SIM.canPerk(Q.S, Q.a, 'pack').reason, 'dead'); assert.equal(SIM.canPerk(Q.S, Q.a, 'frost').ok, true);
  // каждый перк с needs действует только на своей атаке
  for (const type of all) for (const [id, pd] of Object.entries(T[type].perks)) if (pd.needs) {
    assert.ok(SIM.ATTACKS[pd.needs], `${id}: нет вида атаки ${pd.needs}`); assert.equal(T[type].attack, pd.needs, `${id}: перк не своей атаки`); }
  // Ледяной ужас на луче: шанс сковать работает
  const F = hybrid(14, 'dark', 'spirits', null, 'frost'), fs = SIM.towerStats(F.S, F.tw); assert.equal(fs.freezeChance, T.spirits.perks.frost.set.freezeChance);
  // два перка ставят одну характеристику — побеждает большее: Проклятие (Тьма) и Погребальный звон (Колокол)
  const K = hybrid(14, 'dark', 'bell', 'curse', 'knell'), ks = SIM.towerStats(K.S, K.tw), c1 = T.dark.perks.curse.set, c2 = T.bell.perks.knell.set;
  assert.equal(ks.curseTime, Math.max(c1.curseTime, c2.curseTime)); assert.equal(ks.curse, Math.max(c1.curse, c2.curse));
});

test('внешние бонусы действуют на гибрид: Гримуар, особая клетка, реликвия, аура Алтаря рядом', () => {
  const { S, a, rest, tw } = hybrid(15, 'bones', 'spirits'), o = SIM.towerStats(S, tw);
  S.souls = 1e6; SIM.step(S, { cmds: [{ k: 'grim', line: 'dmg' }, { k: 'grim', line: 'bones' }] });
  const g = SIM.grimBonus(S, 'bones'), cell = 1 + (((SIM.cellBonus(S, a) || {}).dmg) || 0);
  near(SIM.towerStats(S, tw).dmg, SIM.ownStats(S, tw).dmg * cell * (1 + g.dmg), 'Гримуар');
  S.relics.push('dust'); near(SIM.towerStats(S, tw).dmg, SIM.ownStats(S, tw).dmg * cell * C.RELICS.dust.tower.mul.dmg * (1 + g.dmg), 'реликвия');
  S.relics = []; S.grim = Object.fromEntries(Object.keys(S.grim).map((k) => [k, 0]));
  SIM.step(S, { cmds: [{ k: 'build', cell: rest[0], type: 'altar' }] }); const st = SIM.towerStats(S, tw);
  assert.ok(st.altar && st.dmg > o.dmg, 'аура Алтаря не дошла до гибрида');
  // особая клетка: курган прибавляет дальность после переноса гибрида на него
  const mound = S.map.specials.find((s) => s.kind === 'mound'), to = mound && SIM.canMove(S, a, mound.cell).ok ? mound.cell : -1;
  if (to >= 0) { SIM.step(S, { cmds: [{ k: 'move', cell: a, to }] }); near(SIM.towerStats(S, S.towers[to]).range, SIM.ownStats(S, S.towers[to]).range + C.SPECIAL.mound.range, 'курган'); }
});

test('гибрид переносится со всей прокачкой и продаётся с возвратом доли от суммы вложенного', () => {
  const { S, a, b, tw } = hybrid(16, 'plague', 'bones', 'acid', 'crush'), inv = tw.invested;
  SIM.step(S, { cmds: [{ k: 'move', cell: a, to: b }] }); assert.equal(S.towers[b], tw); assert.equal(tw.mix, 'bones'); assert.equal(tw.cap, M.cap);
  const souls = S.souls; SIM.step(S, { cmds: [{ k: 'sell', cell: b }] });
  assert.equal(S.souls - souls, Math.floor(inv * C.SELL_REFUND)); assert.equal(S.towers[b], null);
});

test('сейв с гибридом годен и продолжается так же, как без сохранения', () => {
  const { S, a, tw } = hybrid(17, 'spirits', 'plague', 'frost', 'pestilence'); const st = SIM.towerStats(S, tw); dummies(S, a, 'militia', [st.rangePx * 0.5, st.rangePx * 0.6]);
  for (let i = 0; i < 3 / S.dt; i++) SIM.step(S, null);
  assert.ok(S.shots.length || Object.keys(S.enemies[0].poison).length, 'гибрид не успел выстрелить');
  const J = json(S); assert.equal(SIM.loadable(J), true);
  for (let i = 0; i < 5 / S.dt; i++) { SIM.step(S, null); SIM.step(J, null); }
  assert.deepEqual(json(J), json(S));
});

test('примесь Казармы — скелет на месте убитого врага, с кулдауном и пределом поднятых', () => {
  const { S, a, tw } = hybrid(18, 'dark', 'barracks'), st = SIM.towerStats(S, tw), add = T.barracks.mix.add;
  near(st.raiseCd, add.raiseCd, 'кулдаун в характеристиках');
  const es = dummies(S, a, 'militia', [st.rangePx * 0.5, st.rangePx * 0.5, st.rangePx * 0.5]); for (const e of es) e.hp = 1;
  fires(S, tw, 1, 0);
  const raised = () => S.skels.filter((s) => s.tw === tw.id && s.raised);
  assert.equal(raised().length, 1, 'убитый враг не встал скелетом');
  const s = raised()[0], dead = es.find((e) => e.dead); assert.ok(dead, 'враг не убит');
  near(s.x, dead.x, 'скелет на месте врага'); near(s.max, add.raiseHp, 'HP скелета'); near(s.dmg, st.dmg * add.raiseDmg, 'удар скелета');
  assert.ok(S.map.road.includes(s.cell));
  fires(S, tw, 1, 0); assert.equal(raised().length, 1, 'второй скелет раньше кулдауна');
  assert.equal(SIM.loadable(json(S)), true, 'сейв с поднятым скелетом');
  // смерть поднятого скелета не трогает перезарядку гибрида (её сдвигают только скелеты Казармы-первой)
  tw.cd = 0.25; s.hp = 0; SIM.step(S, null);
  assert.ok(!S.skels.includes(s), 'скелет не погиб'); assert.ok(st.rate > 0.3, 'интервал гибрида короче проверки');
  near(tw.cd, 0.25 - S.dt, 'перезарядка гибрида после смерти поднятого скелета');
});

test('Казарма первой: скелеты гибрида бьют с примесью второй и остаются при слиянии; Казарма второй — её скелеты рассыпаются', () => {
  const S = SIM.create(19), [a, b] = pairSpot(S); maxed(S, a, 'barracks'); maxed(S, b, 'barracks');
  SIM.step(S, { cmds: [{ k: 'call' }] }); for (let i = 0; i < 20 / S.dt && !(S.skels.some((s) => s.tw === S.towers[a].id) && S.skels.some((s) => s.tw === S.towers[b].id)); i++) SIM.step(S, null);
  const A = S.towers[a], B = S.towers[b]; assert.ok(S.skels.some((s) => s.tw === A.id) && S.skels.some((s) => s.tw === B.id), 'Казармы не призвали скелетов');
  S.phase = 'prep'; S.enemies = []; S.queue = []; S.qi = 0; S.prepT = 10;
  SIM.step(S, { cmds: [{ k: 'merge', cell: a, other: b }] }); assert.equal(S.towers[a].mix, 'barracks');
  assert.ok(S.skels.some((s) => s.tw === A.id), 'скелеты первой рассыпались'); assert.ok(!S.skels.some((s) => s.tw === B.id), 'скелеты второй остались');
  // Казарма с примесью Духов: удар скелета замедляет
  const H = hybrid(19, 'barracks', 'spirits'), sc = SIM.skelCells(H.S, H.tw)[0], [hx, hy] = SIM.cellXY(H.S, H.a), [sx, sy] = SIM.cellXY(H.S, sc);
  const [e] = dummies(H.S, H.a, 'militia', [Math.hypot(sx - hx, sy - hy)]);
  for (let i = 0; i < 20 / H.S.dt && !(e.slowT > 0); i++) SIM.step(H.S, null);
  assert.ok(e.slowT > 0 && hurt(e) > 0, 'скелет гибрида не замедлил врага'); near(e.slowK, T.spirits.mix.add.slow, 'замедление от скелета');
  assert.equal(SIM.perkOn(H.tw, 'legion'), true); const Q = hybrid(19, 'bones', 'barracks', null, 'legion'); assert.equal(SIM.perkOn(Q.tw, 'legion'), false);
});
