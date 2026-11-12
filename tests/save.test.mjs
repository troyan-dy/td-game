// node --test tests/*.test.mjs — сид забега и сейв: разбор введённого сида, пригодность сохранённого состояния (SIM.loadable).
import test from 'node:test';
import assert from 'node:assert/strict';
import { SIM } from './bots.mjs';
const C = SIM.CONFIG;

const run = (S, sec) => { const n = Math.round(sec / S.dt); for (let i = 0; i < n; i++) SIM.step(S, null); };
const json = (S) => JSON.parse(JSON.stringify(S));
// забег посреди волны: башни всех типов (одна с перком), враги на дороге, снаряды и облака в полёте
const midWave = () => {
  const S = SIM.create(3), cells = SIM.rankCells(S, 3.4); S.souls = 5000;
  const cmds = C.TOWER_ORDER.map((type, i) => ({ k: 'build', cell: cells[i], type }));
  cmds.push({ k: 'upgrade', cell: cells[0] }, { k: 'upgrade', cell: cells[0] }, { k: 'perk', cell: cells[0], p: Object.keys(C.TOWERS[C.TOWER_ORDER[0]].perks)[0] });
  SIM.step(S, { cmds }); S.wave = 8; SIM.step(S, { cmds: [{ k: 'call' }] });
  const ready = () => S.enemies.length >= 3 && S.shots.some((s) => s.k === 'ghost') && S.clouds.length;
  for (let i = 0; i < 120 * 120 && !ready(); i++) SIM.step(S, null);
  assert.ok(S.phase === 'wave' && ready(), 'не собралось состояние посреди волны');
  return json(S);
};
const MID = midWave();
const fresh = () => json(MID);
const tower = (S) => S.towers.find(Boolean);

// ---------------------------------------------------------------- сид
test('сид: целое число из поля ввода, пробелы по краям и ведущие нули не мешают', () => {
  assert.deepEqual(SIM.parseSeed('42'), { ok: true, seed: 42, reason: null });
  assert.equal(SIM.parseSeed('  42 ').seed, 42);
  assert.equal(SIM.parseSeed('\t007\n').seed, 7);
  assert.equal(SIM.parseSeed('0').seed, 0);
  assert.equal(SIM.parseSeed('4294967295').seed, 4294967295);
  assert.equal(SIM.parseSeed(42).seed, 42);
  assert.equal(C.SEED.max, 4294967295);
});

test('сид: пустой, отрицательный, огромный и нечисловой ввод — понятный отказ, а не ошибка', () => {
  for (const s of ['', '   ', '\t', null, undefined]) assert.deepEqual(SIM.parseSeed(s), { ok: false, seed: null, reason: 'empty' }, JSON.stringify(s));
  for (const s of ['-5', ' -1 ', '-4294967296']) assert.equal(SIM.parseSeed(s).reason, 'negative', s);
  for (const s of ['4294967296', '99999999999999999999999999', '0000004294967296']) assert.equal(SIM.parseSeed(s).reason, 'big', s);
  for (const s of ['abc', 'сид', '4 2', '1.5', '1e3', '+5', '0x10', '--5', '5-', 'NaN', 'Infinity', '٤٢']) {
    const r = SIM.parseSeed(s); assert.equal(r.ok, false, s); assert.equal(r.reason, 'format', s); }
  assert.equal(SIM.parseSeed('0000004294967295').seed, 4294967295);
});

test('сид в HUD и на экране итогов вводится обратно и даёт ту же карту', () => {
  for (const seed of [0, 1, 42, 999999, C.SEED.random, C.SEED.max]) {
    const S = SIM.create(seed), back = SIM.parseSeed(String(S.seed));
    assert.equal(back.ok, true, String(seed)); assert.equal(back.seed, S.seed);
    assert.deepEqual(SIM.create(back.seed).map, S.map);
  }
  assert.ok(C.SEED.random >= 1 && C.SEED.random <= C.SEED.max);
  assert.notDeepEqual(SIM.create(C.SEED.max).map.road, SIM.create(0).map.road);
});

// ---------------------------------------------------------------- сейв
test('сейв: забег посреди волны после JSON годен и продолжается так же, как без сохранения', () => {
  const S = fresh();
  assert.equal(SIM.loadable(S), true);
  assert.equal(SIM.loadable(SIM.create(7)), true);
  const before = JSON.stringify(S); SIM.loadable(S); assert.equal(JSON.stringify(S), before, 'проверка изменила состояние');
  const A = fresh(), B = json(A); run(A, 20); run(B, 20); assert.deepEqual(A, B);
});

test('сейв: новые поля в состоянии проверку не ломают', () => {
  const S = fresh(); S.futureField = { a: 1 }; tower(S).branch = [1, 2, 3]; S.enemies[0].trait = 'x'; S.map.obstacles = [1, 2];
  assert.equal(SIM.loadable(S), true);
});

// порча: что сделать с годным состоянием → сейв должен быть отвергнут
const BAD = {
  'старая версия': (S) => { S.v = C.VERSION - 1; },
  'версия из будущего': (S) => { S.v = C.VERSION + 1; },
  'башня неизвестного типа': (S) => { const t = tower(S); S.towers[t.cell] = { type: 'nope' }; },
  'башня неизвестного типа с полными полями': (S) => { tower(S).type = 'nope'; },
  'башня без полей': (S) => { const t = tower(S); S.towers[t.cell] = { type: t.type }; },
  'уровень башни 0': (S) => { tower(S).lvl = 0; },
  'уровень башни выше последнего': (S) => { tower(S).lvl = C.TOWERS[tower(S).type].cost.length + 1; },
  'дробный уровень башни': (S) => { tower(S).lvl = 1.5; },
  'неизвестный перк': (S) => { tower(S).perk = 'nope'; },
  'башня не на своей клетке': (S) => { const t = tower(S); t.cell = t.cell + 1; },
  'башня на дороге': (S) => { const t = tower(S), r = S.map.road[5]; S.towers[t.cell] = null; t.cell = r; S.towers[r] = t; },
  'башня — не объект': (S) => { S.towers[tower(S).cell] = 5; },
  'урон башни строкой': (S) => { tower(S).dmg = '12'; },
  'враг неизвестного типа': (S) => { S.enemies[0].type = 'nope'; },
  'враг без полей': (S) => { S.enemies[0] = { type: 'militia' }; },
  'HP врага — не число': (S) => { S.enemies[0].hp = null; },
  'враг — не объект': (S) => { S.enemies[0] = 'x'; },
  'яд на враге испорчен': (S) => { S.enemies[0].poison = { p1: 'x' }; },
  'неизвестный враг в очереди волны': (S) => { S.queue[S.queue.length - 1].e = 'nope'; },
  'испорченная очередь волны': (S) => { S.queue[0] = null; },
  'курсор очереди за её концом': (S) => { S.qi = S.queue.length + 1; },
  'бесконечные души': (S) => { S.souls = Infinity; },
  'отрицательные души': (S) => { S.souls = -1; },
  'души строкой': (S) => { S.souls = '100'; },
  'отрицательная прочность': (S) => { S.hp = -3; },
  'волна дальше последней': (S) => { S.wave = SIM.waveCount() + 1; },
  'отрицательная волна': (S) => { S.wave = -1; },
  'дробная волна': (S) => { S.wave = 2.5; },
  'сид вне 32 бит': (S) => { S.seed = C.SEED.max + 1; },
  'отрицательный сид': (S) => { S.seed = -1; },
  'сид не совпадает с сидом карты': (S) => { S.seed = S.seed + 1; },
  'состояние случайности вне 32 бит': (S) => { S.rs = -1; },
  'шаг времени 0': (S) => { S.dt = 0; },
  'шаг времени крупнее предела': (S) => { S.dt = C.DT_MAX * 2; },
  'отрицательное время': (S) => { S.t = -1; },
  'неизвестная фаза': (S) => { S.phase = 'boss'; },
  'счётчик id не больше занятых': (S) => { S.nid = 1; },
  'повтор id': (S) => { S.enemies[1].id = S.enemies[0].id; },
  'нет статистики': (S) => { delete S.stats; },
  'статистика строкой': (S) => { S.stats.kills = '5'; },
  'нет списка врагов': (S) => { delete S.enemies; },
  'снаряд — не объект': (S) => { S.shots[0] = 7; },
  'снаряд без координат': (S) => { delete S.shots[0].x; },
  'список попаданий снаряда испорчен (ловит только проба)': (S) => { S.shots.find((s) => s.k === 'ghost').hit = 5; },
  'облако без времени': (S) => { delete S.clouds[0].t; },
  'событие без времени': (S) => { S.ev.push({ k: 'die' }); },
  'событие с координатой строкой': (S) => { S.ev.push({ k: 'die', t: S.t, x: 'a' }); },
  'открытое — не список': (S) => { S.unlocked = 'all'; },
  'карта короче нормы': (S) => { S.map.road = S.map.road.slice(0, 10); },
  'нет карты': (S) => { delete S.map; },
  'число вне JSON (1e999)': (S) => JSON.parse(JSON.stringify(S).replace(/"souls":\d+/, '"souls":1e999')),
};
for (const [name, spoil] of Object.entries(BAD)) test(`сейв отвергается: ${name}`, () => {
  let S = fresh(); S = spoil(S) || S;
  assert.equal(SIM.loadable(S), false);
});

test('сейв: не-объекты и обрывки отвергаются без исключений', () => {
  for (const x of [null, undefined, 0, 'мусор', [], {}, { v: C.VERSION }, { v: C.VERSION, wave: 3, phase: 'prep' }, Object.assign(fresh(), { towers: [] })])
    assert.equal(SIM.loadable(x), false, JSON.stringify(x));
});

// Свойство: что бы ни испортилось в сейве, если проверка его пропустила — логика по нему играет без исключений.
test('сейв: годный по проверке после случайной порчи не роняет шаг симуляции', () => {
  const R = (() => { let s = 12345; return () => (s = (s * 1103515245 + 12345) >>> 0) / 4294967296; })();
  const JUNK = [null, -1, 0, 1.5, 1e9, 'x', '', true, {}, [], [1], { type: 'nope' }];
  const leaves = (o, path, out) => { if (o && typeof o === 'object') for (const k of Object.keys(o)) { out.push([...path, k]); if (k !== 'map') leaves(o[k], [...path, k], out); } return out; };
  const paths = leaves(MID, [], []);
  let passed = 0;
  for (let n = 0; n < 1500; n++) {
    const S = fresh(), p = paths[Math.floor(R() * paths.length)], v = JUNK[Math.floor(R() * JUNK.length)];
    let o = S; for (const k of p.slice(0, -1)) o = o[k]; o[p[p.length - 1]] = JSON.parse(JSON.stringify(v));
    if (!SIM.loadable(S)) continue;
    passed++;
    assert.doesNotThrow(() => { for (let i = 0; i < 1200; i++) SIM.step(S, null); }, 'порча ' + p.join('.') + ' = ' + JSON.stringify(v));
  }
  assert.ok(passed > 50, 'проверка отвергла почти всё: ' + passed);
});
