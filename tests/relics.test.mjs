// node --test tests/*.test.mjs — реликвии: когда предлагаются, что предлагается (без повторов, только открытые, по сиду),
// выбор останавливает забег, каждая реликвия берётся командой и работает, сейв на экране выбора.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SIM, smart } from './bots.mjs';
const C = SIM.CONFIG, RL = C.RELICS, IDS = Object.keys(RL), MAPGEN = SIM.MAPGEN;

const json = (S) => JSON.parse(JSON.stringify(S));
const run = (S, sec) => { const n = Math.round(sec / S.dt); for (let i = 0; i < n; i++) SIM.step(S, null); };
// волна отбита сразу: вызвать, убрать её врагов, шаг — зачистка (души за волну начисляются как обычно)
const clearWave = (S) => { SIM.step(S, { cmds: [{ k: 'call' }] }); S.queue = []; S.qi = 0; S.enemies = []; S.shots = []; SIM.step(S, null); };
const toWave = (S, n) => { while (S.wave < n) { assert.equal(S.phase, 'prep', `волна ${S.wave}: ждали паузу, а фаза ${S.phase}`); clearWave(S); } return S; };
// первый сид, на котором реликвия id предложена после 5-й волны
const seedFor = (id) => { for (let s = 1; s < 500; s++) if (SIM.drawRelics(s, 5, [], null).includes(id)) return s; throw new Error('не предложена ни на одном сиде: ' + id); };
// забег на экране выбора после 5-й волны, где предложена id; take — сразу взять её командой
const reach = (id, take = true, dt) => {
  const S = toWave(SIM.create(seedFor(id), { dt }), 5); assert.equal(S.phase, 'relic');
  const i = S.offer.indexOf(id); assert.ok(i >= 0, `${id} нет в предложении ${S.offer}`);
  if (take) { SIM.step(S, { cmds: [{ k: 'relic', i }] }); assert.ok(SIM.hasRelic(S, id)); assert.equal(S.phase, 'prep'); }
  return S;
};
const cellOf = (S, kind) => { for (let i = 0; i < S.map.cols * S.map.rows; i++) if (MAPGEN.special(S.map, i) === kind && !SIM.canBuild(S, i, 'bones').reason) return i; return -1; };
const plain = (S) => SIM.rankCells(S, C.TYPICAL_RANGE).find((i) => !MAPGEN.special(S.map, i));

// ---------------------------------------------------------------- данные
test('реликвии: в бесконечном режиме выбор после каждой положенной волны (SIM.relicDue)', () => {
  const S = SIM.create(6, { unlocked: C.TOWER_ORDER.concat(IDS.slice(0, 4)) }); S.phase = 'won'; S.wave = SIM.waveCount(); S.relics = IDS.slice(0, 2);
  SIM.step(S, { cmds: [{ k: 'endless' }] }); assert.equal(S.endless, true);
  const seen = [];
  while (S.wave < 40) { if (S.phase === 'relic') { seen.push(S.wave); assert.equal(SIM.loadable(json(S)), true, 'сейв выбора в бесконечном'); SIM.step(S, { cmds: [{ k: 'relic', i: 0 }] }); continue; } clearWave(S); }
  assert.deepEqual(seen, [25, 30], 'после двух открытых реликвий выбора больше нет');
  for (const n of seen) assert.ok(SIM.relicDue(n));
});

test('реликвии: пул около 20, примерно половина меняет правила; у каждой имя и описание с числами', () => {
  assert.ok(IDS.length >= 18 && IDS.length <= 24, 'реликвий ' + IDS.length);
  const rules = IDS.filter((id) => RL[id].kind === 'rule').length;
  assert.ok(rules >= IDS.length * 0.4 && rules <= IDS.length * 0.6, 'меняющих правила ' + rules);
  for (const id of IDS) {
    assert.ok(['num', 'rule'].includes(RL[id].kind), id);
    assert.ok(RL[id].name && RL[id].icon, id);
    const d = SIM.relicText(id); assert.ok(d.length > 10 && !/[{}]/.test(d), `${id}: «${d}»`);
    assert.ok(!Object.prototype.hasOwnProperty.call(C.TOWERS, id), 'id реликвии совпадает с башней: ' + id);
  }
});

// ---------------------------------------------------------------- выбор
test('реликвии: после 5-й волны забег стоит, пока не выбрана реликвия; выбор по номеру предложения', () => {
  const S = SIM.create(11);
  toWave(S, 4); clearWave(S);
  assert.equal(S.wave, 5); assert.equal(S.phase, 'relic');
  const offer = SIM.relicOffer(S); assert.equal(offer.length, C.RELIC_OFFER);
  for (const o of offer) assert.ok(o.name && o.desc && o.icon && ['num', 'rule'].includes(o.kind), JSON.stringify(o));
  const before = json(S), cell = SIM.rankCells(S, C.TYPICAL_RANGE)[0];
  SIM.step(S, { cmds: [{ k: 'call' }, { k: 'build', cell, type: 'bones' }, { k: 'relic', i: 7 }, { k: 'relic', i: -1 }, { k: 'relic', i: '1' }] });
  run(S, 60);
  assert.equal(S.phase, 'relic'); assert.equal(S.wave, 5); assert.equal(S.prepT, before.prepT); assert.equal(S.stats.time, before.stats.time);
  assert.equal(S.towers[cell], null, 'постройка во время выбора'); assert.equal(S.souls, before.souls); assert.deepEqual(S.relics, []);
  SIM.step(S, { cmds: [{ k: 'relic', i: 1 }] });
  assert.deepEqual(S.relics, [before.offer[1]]); assert.equal(S.offer, null); assert.equal(S.phase, 'prep');
  assert.deepEqual(SIM.relicsOf(S).map((r) => r.id), [before.offer[1]]);
  assert.ok(S.ev.some((e) => e.k === 'relic' && e.id === before.offer[1]));
  run(S, C.PREP_TIME + 1); assert.equal(S.wave, 6, 'после выбора пауза идёт и волна стартует сама');
});

test('реликвии: выбор после 5, 10 и 15; после последней волны — победа без выбора', () => {
  const S = SIM.create(4), seen = [];
  while (S.phase !== 'won') {
    if (S.phase === 'relic') { seen.push(S.wave); SIM.step(S, { cmds: [{ k: 'relic', i: 0 }] }); continue; }
    clearWave(S);
  }
  assert.deepEqual(seen, [5, 10, 15]); assert.equal(S.relics.length, 3); assert.equal(S.wave, SIM.waveCount());
});

test('реликвии: в забеге не повторяются, в предложении разные; набор от сида, не от хода боя', () => {
  for (let s = 1; s <= 60; s++) {
    const S = SIM.create(s), R = (k) => (s * 7 + k * 3) % C.RELIC_OFFER;
    while (S.phase !== 'won') {
      if (S.phase !== 'relic') { clearWave(S); continue; }
      const o = S.offer; assert.equal(new Set(o).size, o.length, `сид ${s}: повтор в предложении ${o}`);
      assert.equal(o.length, C.RELIC_OFFER);
      for (const id of o) assert.ok(!S.relics.includes(id), `сид ${s}: снова предложена взятая ${id}`);
      assert.deepEqual(o, SIM.drawRelics(s, S.wave, S.relics, null));
      SIM.step(S, { cmds: [{ k: 'relic', i: R(S.wave) }] });
    }
    assert.equal(new Set(S.relics).size, 3);
  }
  // ход боя не влияет: та же карта с обороной и без неё — то же предложение
  const A = SIM.create(5), B = SIM.create(5); B.souls = 5000;
  SIM.step(B, { cmds: SIM.rankCells(B, 3).slice(0, 6).map((cell, i) => ({ k: 'build', cell, type: C.TOWER_ORDER[i % 4] })) });
  for (let n = 0; n < 4; n++) { clearWave(A); SIM.step(B, { cmds: [{ k: 'call' }] }); B.hp = 1e6; for (let i = 0; i < 120 * 300 && B.phase === 'wave'; i++) SIM.step(B, null); }
  clearWave(A); SIM.step(B, { cmds: [{ k: 'call' }] }); B.hp = 1e6; for (let i = 0; i < 120 * 300 && B.phase === 'wave'; i++) SIM.step(B, null);
  assert.equal(A.phase, 'relic'); assert.equal(B.phase, 'relic'); assert.deepEqual(A.offer, B.offer);
  // разные сиды — разные наборы
  const firsts = new Set(); for (let s = 1; s <= 20; s++) firsts.add(SIM.drawRelics(s, 5, [], null).join());
  assert.ok(firsts.size >= 15, 'наборов на 20 сидах ' + firsts.size);
});

test('реликвии: предлагаются только открытые; когда открытых не осталось — выбора нет', () => {
  const open = ['marrow', 'deal', 'toll', 'coin'], S = SIM.create(8, { unlocked: C.TOWER_ORDER.concat(open) }), sizes = [];
  while (S.phase !== 'won') {
    if (S.phase !== 'relic') { clearWave(S); continue; }
    for (const id of S.offer) assert.ok(open.includes(id), 'закрытая ' + id);
    sizes.push(S.offer.length); SIM.step(S, { cmds: [{ k: 'relic', i: 0 }] });
  }
  assert.deepEqual(sizes, [3, 3, 2]);
  const N = SIM.create(8, { unlocked: C.TOWER_ORDER.slice() }); toWave(N, 6);
  assert.deepEqual(N.relics, []); assert.equal(N.wave, 6);
  // по умолчанию открыто всё
  const draws = new Set(); for (let s = 1; s <= 200; s++) for (const id of SIM.drawRelics(s, 5, [], null)) draws.add(id);
  assert.deepEqual([...draws].sort(), IDS.slice().sort());
});

// ---------------------------------------------------------------- сейв
test('реликвии: забег на экране выбора после JSON годен и продолжается с того же выбора', () => {
  const S = reach('deal', false), J = json(S);
  assert.equal(SIM.loadable(J), true);
  assert.deepEqual(SIM.relicOffer(J), SIM.relicOffer(S));
  SIM.step(S, { cmds: [{ k: 'relic', i: 2 }] }); SIM.step(J, { cmds: [{ k: 'relic', i: 2 }] });
  run(S, 20); run(J, 20); assert.deepEqual(json(J), json(S));
  assert.equal(SIM.loadable(json(S)), true, 'после выбора');
});

test('реликвии: партия бота проходит экраны выбора (берёт первую) и её снимки годны', () => {
  const S = SIM.create(2, { dt: 1 / 30 }), mem = {}; let i = 0, relicSnaps = 0;
  SIM.step(S, { cmds: [{ k: 'call' }] });
  while (S.phase !== 'won' && S.phase !== 'lost' && S.t < 5400) {
    if (S.phase === 'relic') { relicSnaps++; assert.equal(SIM.loadable(json(S)), true, 'снимок экрана выбора, волна ' + S.wave); }
    const cmds = i++ % 3 === 0 ? smart(S, mem) : null; SIM.step(S, cmds ? { cmds } : null);
  }
  assert.ok(S.relics.length >= 1 && relicSnaps >= 1, `реликвий ${S.relics.length}, волна ${S.wave}`);
});

// ---------------------------------------------------------------- каждая реликвия: берётся командой, забег идёт дальше, эффект
test('реликвии: каждая берётся и забег с башнями всех типов идёт дальше без ошибок', () => {
  for (const id of IDS) {
    const S = reach(id, true, 1 / 30); S.souls = 5000; S.hp = 1e6;
    const cells = SIM.rankCells(S, C.TYPICAL_RANGE), mound = cellOf(S, 'mound'), cursed = cellOf(S, 'cursed');
    const spots = [mound, cursed, ...cells].filter((c, k, a) => c >= 0 && a.indexOf(c) === k).slice(0, 8);
    SIM.step(S, { cmds: spots.map((cell, k) => ({ k: 'build', cell, type: C.TOWER_ORDER[k % 4] })) });
    assert.doesNotThrow(() => { SIM.step(S, { cmds: [{ k: 'call' }] }); run(S, 40); }, id);
    assert.ok(S.stats.kills > 0, id + ': башни не убивают');
    assert.equal(SIM.loadable(json(S)), true, id);
  }
});

const st = (S, cell) => SIM.towerStats(S, S.towers[cell]);
// пара забегов на одном сиде: с реликвией id и без (тот же сид, тот же путь к экрану выбора — во втором выбрана другая,
// и её действие снимается: сравнивается только id). Души и прочность — как до выбора (без «сразу при выборе» другой реликвии).
const pair = (id) => { const A = reach(id, true), B = reach(id, false), souls = B.souls, hp = B.hp;
  SIM.step(B, { cmds: [{ k: 'relic', i: (B.offer.indexOf(id) + 1) % B.offer.length }] });
  A.relics = [id]; B.relics = []; B.souls = souls; B.hp = hp; if (!(RL[id].take)) { A.souls = souls; A.hp = hp; }
  return [A, B]; };
// числа башни: тот же тип на той же клетке с реликвией и без
const towerPair = (id, type, cell) => { const [A, B] = pair(id); for (const S of [A, B]) S.souls = 5000;
  const c = cell ? cell(A) : plain(A); for (const S of [A, B]) SIM.step(S, { cmds: [{ k: 'build', cell: c, type }] }); return [st(A, c), st(B, c), A, B, c]; };
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} ≠ ${b}`);

const EFFECTS = {
  marrow: () => { const [a, b] = towerPair('marrow', 'bones'); near(a.rate, b.rate / 1.15, 'интервал Костей');
    const [x, y] = towerPair('marrow', 'spirits'); near(x.rate, y.rate, 'Духи не меняются'); },
  lampoil: () => { const [a, b] = towerPair('lampoil', 'spirits'); near(a.slow, b.slow + 0.08, 'замедление'); },
  bile: () => { const [a, b] = towerPair('bile', 'plague'); near(a.dmg, b.dmg * 1.25, 'яд'); const [x, y] = towerPair('bile', 'dark'); near(x.dmg, y.dmg, 'Тьма'); },
  lens: () => { const [a, b] = towerPair('lens', 'dark'); near(a.range, b.range + 0.8, 'дальность'); near(a.rangePx, a.range * C.UNIT, 'радиус в px'); },
  dust: () => { for (const t of C.TOWER_ORDER) { const [a, b] = towerPair('dust', t); near(a.dmg, b.dmg * 1.1, t); } },
  tithe: () => { const [A, B] = pair('tithe'); const a = A.souls, b = B.souls; clearWave(A); clearWave(B); assert.equal((A.souls - a) - (B.souls - b), 15); },
  coin: () => { const [A, B] = pair('coin'); for (const S of [A, B]) { S.relics = S.relics.filter((r) => r === 'coin'); S.souls = 5000; S.hp = 1e6;
      SIM.step(S, { cmds: SIM.rankCells(S, 3).slice(0, 4).map((cell) => ({ k: 'build', cell, type: 'dark' })).concat([{ k: 'call' }]) }); run(S, 90); }
    assert.ok(A.stats.kills > 0); assert.equal(A.stats.kills, B.stats.kills); assert.equal(A.stats.earned - B.stats.earned, A.stats.kills); },
  ossuary: () => { const S = reach('ossuary', false), hp = S.hp; SIM.step(S, { cmds: [{ k: 'relic', i: S.offer.indexOf('ossuary') }] }); assert.equal(S.hp, hp + 5); },
  hoard: () => { const S = reach('hoard', false), s = S.souls; SIM.step(S, { cmds: [{ k: 'relic', i: S.offer.indexOf('hoard') }] }); assert.equal(S.souls, s + 150); },
  chisel: () => { const [A, B] = pair('chisel'); const c = plain(A); for (const S of [A, B]) { S.souls = 5000; SIM.step(S, { cmds: [{ k: 'build', cell: c, type: 'bones' }] }); }
    for (const k of C.TRACKS) assert.equal(SIM.canUpgrade(A, c, k).cost, Math.round(SIM.canUpgrade(B, c, k).cost * 0.85), k);
    const s = A.souls, cost = SIM.canUpgrade(A, c, 'dmg').cost; SIM.step(A, { cmds: [{ k: 'upgrade', cell: c, track: 'dmg' }] }); assert.equal(A.souls, s - cost); },
  caustic: () => { const [A, B] = pair('caustic');
    for (const S of [A, B]) { S.relics = S.relics.filter((r) => r === 'caustic'); S.souls = 5000; S.hp = 1e6; SIM.step(S, { cmds: [{ k: 'build', cell: SIM.rankCells(S, 3)[0], type: 'plague' }, { k: 'call' }] }); }
    const poisoned = (S) => S.enemies.filter((e) => Object.keys(e.poison).length).length;
    for (let i = 0; i < 120 * 60 && !poisoned(A); i++) { SIM.step(A, null); SIM.step(B, null); }
    const n = poisoned(A), tw = (S) => S.towers.find(Boolean), dps = SIM.towerStats(A, tw(A)).dmg;
    assert.ok(n > 0, 'никто не отравлен'); assert.equal(poisoned(B), n);
    near(tw(A).dmg - tw(B).dmg, n * dps * 1, 'урон сразу при заражении'); },
  deal: () => { const [A, B] = pair('deal'); const c = plain(A);
    for (const S of [A, B]) { S.souls = 5000; SIM.step(S, { cmds: [{ k: 'build', cell: c, type: 'dark' }, { k: 'upgrade', cell: c, track: 'dmg' }] }); }
    const inv = A.towers[c].invested; assert.equal(SIM.sellValue(A.towers[c], A), inv); assert.equal(SIM.sellValue(B.towers[c], B), Math.floor(inv * C.SELL_REFUND));
    const s = A.souls; SIM.step(A, { cmds: [{ k: 'sell', cell: c }] }); assert.equal(A.souls, s + inv); },
  twin: () => { const [a, b, A, B, c] = towerPair('twin', 'bones', (S) => cellOf(S, 'mound')); assert.ok(c >= 0, 'нет кургана');
    near(a.dmg, b.dmg * 2, 'урон на кургане'); near(a.rate, b.rate * 1.7, 'перезарядка на кургане');
    const p = plain(A); for (const S of [A, B]) SIM.step(S, { cmds: [{ k: 'build', cell: p, type: 'bones' }] });
    near(st(A, p).dmg, st(B, p).dmg, 'вне кургана урон тот же'); near(st(A, p).rate, st(B, p).rate, 'вне кургана скорость та же'); },
  restless: () => { const [A, B] = pair('restless'); const c = plain(A), cells = SIM.rankCells(A, 3).filter((x) => x !== c);
    for (const S of [A, B]) { S.souls = 5000; SIM.step(S, { cmds: [{ k: 'build', cell: c, type: 'bones' }, { k: 'call' }] }); assert.equal(S.phase, 'wave'); }
    assert.equal(SIM.canMove(B, c).reason, 'phase');
    assert.ok(SIM.canMove(A, c).ok && SIM.canMove(A, c, cells[0]).ok, 'во время волны перенос разрешён');
    SIM.step(A, { cmds: [{ k: 'move', cell: c, to: cells[0] }] }); assert.ok(A.towers[cells[0]] && !A.towers[c], 'перенос во время волны');
    assert.equal(SIM.canMove(A, cells[0]).reason, 'phase', 'второй перенос за волну');
    SIM.step(A, { cmds: [{ k: 'move', cell: cells[0], to: cells[1] }] }); assert.ok(A.towers[cells[0]], 'второй перенос прошёл');
    A.queue = []; A.qi = 0; A.enemies = []; SIM.step(A, null); assert.equal(A.phase, 'prep'); assert.ok(SIM.canMove(A, cells[0], cells[1]).ok, 'в паузе как обычно');
    SIM.step(A, { cmds: [{ k: 'call' }] }); assert.ok(SIM.canMove(A, cells[0]).ok, 'в новой волне снова можно');
    assert.equal(SIM.loadable(json(A)), true); },
  cornerstone: () => { const [A, B] = pair('cornerstone'); const [c1, c2] = SIM.rankCells(A, 3).filter((i) => !MAPGEN.special(A.map, i));
    for (const S of [A, B]) S.souls = 5000;
    assert.equal(SIM.canBuild(A, c1, 'bones').cost, Math.round(C.TOWERS.bones.base.cost * 0.5)); assert.equal(SIM.canBuild(B, c1, 'bones').cost, C.TOWERS.bones.base.cost);
    const s = A.souls; SIM.step(A, { cmds: [{ k: 'build', cell: c1, type: 'bones' }] }); assert.equal(s - A.souls, 50);
    assert.equal(SIM.canBuild(A, c2, 'bones').cost, C.TOWERS.bones.base.cost, 'второй тип уже на поле'); assert.equal(SIM.canBuild(A, c2, 'spirits').cost, Math.round(C.TOWERS.spirits.base.cost * 0.5)); },
  hallowed: () => { const [A, B] = pair('hallowed'); const c = cellOf(A, 'cursed'); assert.ok(c >= 0, 'нет проклятой земли');
    assert.equal(SIM.canBuild(A, c, 'dark').cost, C.TOWERS.dark.base.cost); assert.ok(SIM.canBuild(B, c, 'dark').cost > C.TOWERS.dark.base.cost);
    for (const S of [A, B]) { S.souls = 5000; SIM.step(S, { cmds: [{ k: 'build', cell: c, type: 'dark' }] }); }
    near(st(A, c).dmg, st(B, c).dmg, 'бонус урона остаётся'); },
  toll: () => { const [A, B] = pair('toll'); for (const S of [A, B]) { S.relics = S.relics.filter((r) => r === 'toll'); S.hp = 1e6; SIM.step(S, { cmds: [{ k: 'call' }] }); }
    let bounty = 0; for (let i = 0; i < 120 * 200 && A.phase === 'wave'; i++) { SIM.step(A, null); SIM.step(B, null); }
    for (const e of A.ev) if (e.k === 'toll') bounty += e.souls;
    assert.equal(A.stats.kills, 0); assert.ok(A.stats.leaked > 0); assert.ok(A.stats.earned - B.stats.earned > 0, 'пропуски не принесли душ');
    assert.ok(bounty > 0); },
  haste: () => { const [A, B] = pair('haste'); run(A, 4.3); run(B, 4.3); const left = A.prepT, a = A.souls, b = B.souls;
    SIM.step(A, { cmds: [{ k: 'call' }] }); SIM.step(B, { cmds: [{ k: 'call' }] });
    assert.equal(A.souls - a, Math.floor(left * 2)); assert.equal(B.souls, b); },
  insight: () => { const [A, B] = pair('insight'); const c = plain(A);
    for (const S of [A, B]) { S.souls = 5000; SIM.step(S, { cmds: [{ k: 'build', cell: c, type: 'bones' }, ...[0, 1, 2, 3].map((i) => ({ k: 'upgrade', cell: c, track: C.TRACKS[i % 3] }))] }); }
    assert.equal(SIM.perkAt(A), 4); assert.equal(SIM.perkAt(B), C.PERK_AT);
    assert.ok(SIM.canPerk(A, c, 'volley').ok); assert.equal(SIM.canPerk(B, c, 'volley').reason, 'steps');
    SIM.step(A, { cmds: [{ k: 'perk', cell: c, p: 'volley' }] }); assert.ok(SIM.hasPerk(A.towers[c], 'volley')); assert.equal(SIM.loadable(json(A)), true); },
  usury: () => { const [A, B] = pair('usury'); for (const S of [A, B]) S.souls = 400; clearWave(A); clearWave(B);
    assert.equal(A.souls - B.souls, Math.floor(400 * 0.05));
    for (const S of [A, B]) S.souls = 5000; clearWave(A); clearWave(B); assert.equal(A.souls - B.souls, 50, 'не больше предела'); },
};
test('реликвии: у каждой есть тест эффекта', () => assert.deepEqual(Object.keys(EFFECTS).sort(), IDS.slice().sort()));
for (const [id, f] of Object.entries(EFFECTS)) test(`реликвия ${id} (${RL[id].name}): эффект`, f);
