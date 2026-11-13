// node --test tests/*.test.mjs — сид забега и сейв: разбор введённого сида, пригодность сохранённого состояния (SIM.loadable).
import test from 'node:test';
import assert from 'node:assert/strict';
import { SIM, smart, idle } from './bots.mjs';
const C = SIM.CONFIG;

const run = (S, sec) => { const n = Math.round(sec / S.dt); for (let i = 0; i < n; i++) SIM.step(S, null); };
const json = (S) => JSON.parse(JSON.stringify(S));
// забег посреди волны: башни всех типов (одна с перком), враги на дороге, снаряды и облака в полёте
const midWave = () => {
  const S = SIM.create(3), cells = SIM.rankCells(S, C.TYPICAL_RANGE); S.souls = 5000;
  const cmds = C.TOWER_ORDER.map((type, i) => ({ k: 'build', cell: cells[i], type }));
  const perk = Object.keys(C.TOWERS[C.TOWER_ORDER[0]].perks)[0];
  for (let i = 0; i < C.PERK_AT; i++) cmds.push({ k: 'upgrade', cell: cells[0], track: C.TRACKS[i % C.TRACKS.length] });
  cmds.push({ k: 'perk', cell: cells[0], p: perk }, { k: 'grim', line: 'dmg' }, { k: 'grim', line: C.TOWER_ORDER[0] });
  SIM.step(S, { cmds });
  assert.ok(S.grim.dmg === 1 && S.grim[C.TOWER_ORDER[0]] === 1, 'покупки Гримуара не применились');
  assert.ok(SIM.hasPerk(S.towers[cells[0]], perk) && SIM.steps(S.towers[cells[0]]) === C.PERK_AT, 'прокачка башни не применилась');
  S.wave = 8; SIM.step(S, { cmds: [{ k: 'call' }] });
  const ready = () => S.enemies.length >= 3 && S.shots.some((s) => s.k === 'ghost') && S.clouds.length;
  for (let i = 0; i < 120 * 120 && !ready(); i++) SIM.step(S, null);
  assert.ok(S.phase === 'wave' && ready(), 'не собралось состояние посреди волны');
  return S;
};
const MID = json(midWave());
const fresh = () => json(MID);
const tower = (S) => S.towers.find((t) => t && t.perks.length) || S.towers.find(Boolean);   // первая — прокачанная, с перком

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
});

test('сейв: живой забег и его JSON-копия дальше идут одинаково', () => {
  const L = midWave(), J = json(L);
  run(L, 20); run(J, 20);
  assert.deepEqual(json(J), json(L));
});

// Защита от расширений состояния: всё, что реально бывает в партии, проверка принимает.
// Тикет, добавивший в состояние поле, которое проверка не понимает, увидит это здесь.
for (const [name, bot, seed] of [['smart', smart, 1], ['idle', idle, 2]]) test(`сейв: снимки партии бота ${name} годны на всём её ходу и в конце`, () => {
  const S = SIM.create(seed, { dt: 1 / 30 }), mem = {}, every = Math.round(20 / S.dt); let i = 0, n = 0;
  SIM.step(S, { cmds: [{ k: 'call' }] });
  while (S.phase !== 'won' && S.phase !== 'lost' && S.t < 5400) {
    const cmds = i % 3 === 0 ? bot(S, mem) : null;
    SIM.step(S, cmds ? { cmds } : null);
    if (++i % every === 0) { n++; assert.equal(SIM.loadable(json(S)), true, `снимок на ${S.t.toFixed(0)} с, волна ${S.wave}, ${S.phase}`); }
  }
  assert.ok(n >= 5, 'снимков ' + n);
  assert.ok(S.phase === 'won' || S.phase === 'lost', 'партия не закончилась');
  assert.equal(SIM.loadable(json(S)), true, 'законченный забег (' + S.phase + ')');
});

test('сейв: старт волны за пределами забега не бросает исключение', () => {
  const S = fresh(); S.phase = 'prep'; S.wave = SIM.waveCount(); S.prepT = 1; S.enemies = []; S.queue = []; S.qi = 0;
  assert.doesNotThrow(() => run(S, 3));
});

test('сейв: крошечный шаг времени отвергается сразу, без долгой пробы', () => {
  for (const dt of [1e-9, Number.MIN_VALUE, C.DT_MIN / 2]) {
    const S = fresh(); S.dt = dt; const t0 = Date.now();
    assert.equal(SIM.loadable(S), false, String(dt)); assert.ok(Date.now() - t0 < 500, 'проверка шла ' + (Date.now() - t0) + ' мс');
  }
  const S = fresh(); S.dt = C.DT_MIN; assert.equal(SIM.loadable(S), true, 'самый мелкий допустимый шаг');
});

test('сейв: новые поля в состоянии проверку не ломают', () => {
  const S = fresh(); S.futureField = { a: 1 }; tower(S).branch = [1, 2, 3]; S.enemies[0].trait = 'x'; S.stats.relics = 0;
  assert.equal(SIM.loadable(S), true);
});

// порча: что сделать с годным состоянием → сейв должен быть отвергнут
const BAD = {
  'старая версия': (S) => { S.v = C.VERSION - 1; },
  'версия из будущего': (S) => { S.v = C.VERSION + 1; },
  'башня неизвестного типа': (S) => { const t = tower(S); S.towers[t.cell] = { type: 'nope' }; },
  'башня неизвестного типа с полными полями': (S) => { tower(S).type = 'nope'; },
  'башня без полей': (S) => { const t = tower(S); S.towers[t.cell] = { type: t.type }; },
  'отрицательная ступень ветки': (S) => { tower(S).tracks.dmg = -1; },
  'дробная ступень ветки': (S) => { tower(S).tracks.range = 1.5; },
  'ступень ветки выше потолка башни': (S) => { const t = tower(S); t.tracks.rate = t.cap + 1; },
  'нет ветки': (S) => { delete tower(S).tracks.dmg; },
  'потолок ниже обычного': (S) => { const t = tower(S); t.cap = C.TRACK_MAX - 1; for (const k of C.TRACKS) t.tracks[k] = Math.min(t.tracks[k], t.cap); },
  'потолок выше числа цен': (S) => { tower(S).cap = 99; },
  'дробный потолок': (S) => { tower(S).cap = C.TRACK_MAX + 0.5; },
  'слотов перков меньше обычного': (S) => { tower(S).slots = C.PERK_SLOTS - 1; },
  'перк сверх слотов': (S) => { const t = tower(S), other = Object.keys(C.TOWERS[t.type].perks).find((p) => !t.perks.includes(p)); t.perks.push(other); },
  'повтор перка': (S) => { const t = tower(S); t.slots = 2; t.perks.push(t.perks[0]); },
  'неизвестный перк': (S) => { tower(S).perks = ['nope']; },
  'перк-свойство объекта': (S) => { tower(S).perks = ['constructor']; },
  'чужой перк': (S) => { const t = tower(S), alien = C.TOWER_ORDER.find((k) => k !== t.type); t.perks = [Object.keys(C.TOWERS[alien].perks)[0]]; },
  'перки — не список': (S) => { tower(S).perks = 'pierce'; },
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
  'шаг времени 1e-9': (S) => { S.dt = 1e-9; },
  'шаг времени Number.MIN_VALUE': (S) => { S.dt = Number.MIN_VALUE; },
  'пауза после последней волны (таймер старта волны 10 с)': (S) => { S.phase = 'prep'; S.wave = SIM.waveCount(); S.prepT = 10; S.enemies = []; S.queue = []; S.qi = 0; },
  'таймер паузы длиннее паузы между волнами': (S) => { S.phase = 'prep'; S.prepT = C.PREP_TIME * 10; S.enemies = []; S.queue = []; S.qi = 0; },
  'гигантский таймер паузы': (S) => { S.phase = 'prep'; S.prepT = 1e300; S.enemies = []; S.queue = []; S.qi = 0; },
  'идёт волна 0': (S) => { S.wave = 0; },
  'гигантское время': (S) => { S.t = 1e300; },
  'отрицательное HP врага': (S) => { S.enemies[0].hp = -50; },
  'отрицательный запас HP врага': (S) => { S.enemies[0].max = -50; },
  'отрицательное вложенное в башню': (S) => { tower(S).invested = -1000; },
  'отрицательные убийства башни': (S) => { tower(S).kills = -1; },
  'отрицательная перезарядка башни': (S) => { tower(S).cd = -5; },
  'отрицательное время в статистике': (S) => { S.stats.time = -10; },
  'гигантская награда врага': (S) => { S.enemies[0].bounty = 1e300; },
  'карта от другого сида при подменённом сиде': (S) => { S.seed = S.seed + 1; S.map.seed = S.seed; },
  'дорога карты подменена': (S) => { const r = SIM.create(S.seed + 1).map.road; S.map.road = r; },
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
  'нет Гримуара': (S) => { delete S.grim; },
  'Гримуар — не объект': (S) => { S.grim = 3; },
  'нет линии типа в Гримуаре': (S) => { delete S.grim[C.TOWER_ORDER[0]]; },
  'ступень общей линии Гримуара выше пяти': (S) => { S.grim.dmg = C.GRIMOIRE.all.dmg.cost.length + 1; },
  'ступень линии типа Гримуара выше предела': (S) => { S.grim[C.TOWER_ORDER[0]] = 99; },
  'дробная ступень Гримуара': (S) => { S.grim.range = 1.5; },
  'отрицательная ступень Гримуара': (S) => { S.grim.rate = -1; },
  'ступень Гримуара строкой': (S) => { S.grim.dmg = '1'; },
  'неизвестная реликвия': (S) => { S.relics = ['nope']; },
  'реликвия-свойство объекта': (S) => { S.relics = ['constructor']; },
  'реликвии — не список': (S) => { S.relics = 'deal'; },
  'реликвий больше, чем было выборов': (S) => { S.relics = ['deal', 'toll']; },
  'предложение реликвий вне фазы выбора': (S) => { S.offer = SIM.drawRelics(S.seed, 5, [], null); },
  'перенос посреди боя в будущей волне': (S) => { S.waveMoved = S.wave + 1; },
  'дробная волна переноса посреди боя': (S) => { S.waveMoved = 1.5; },
  'число вне JSON (1e999)': (S) => JSON.parse(JSON.stringify(S).replace(/"souls":\d+/, '"souls":1e999')),
};
// забег на выборе реликвии после 5-й волны (волны отбиты сразу: враги убраны)
const relicPick = () => { const S = SIM.create(3);
  while (S.phase !== 'relic') { SIM.step(S, { cmds: [{ k: 'call' }] }); S.queue = []; S.qi = 0; S.enemies = []; S.shots = []; SIM.step(S, null); }
  return json(S); };
const PICK = relicPick();
test('сейв: забег на выборе реликвии годен', () => { assert.equal(SIM.loadable(json(PICK)), true); assert.equal(PICK.phase, 'relic'); });
const BAD_PICK = {
  'выбор без предложения': (S) => { S.offer = null; },
  'пустое предложение': (S) => { S.offer = []; },
  'предложение не то, что даёт сид': (S) => { S.offer = Object.keys(C.RELICS).filter((id) => !S.offer.includes(id)).slice(0, C.RELIC_OFFER); },
  'предложение в другом порядке': (S) => { S.offer.reverse(); },
  'в предложении закрытая реликвия': (S) => { S.unlocked = C.TOWER_ORDER.concat(S.offer.slice(1)); },
  'в предложении уже взятая реликвия': (S) => { S.relics = [S.offer[0]]; },
  'выбор после волны без реликвии': (S) => { S.wave = 6; S.offer = SIM.drawRelics(S.seed, 6, [], null); },
  'выбор после последней волны': (S) => { S.wave = SIM.waveCount(); S.offer = SIM.drawRelics(S.seed, S.wave, [], null); },
  'выбор с таймером паузы длиннее паузы': (S) => { S.prepT = C.PREP_TIME * 3; },
};
for (const [name, spoil] of Object.entries(BAD_PICK)) test(`сейв выбора реликвии отвергается: ${name}`, () => {
  const S = json(PICK); spoil(S); assert.equal(SIM.loadable(S), false);
});

for (const [name, spoil] of Object.entries(BAD)) test(`сейв отвергается: ${name}`, () => {
  let S = fresh(); S = spoil(S) || S;
  assert.equal(SIM.loadable(S), false);
});

// забег с гибридом (Кости с примесью Духов, перки обеих) в паузе между волнами
const hybridRun = () => {
  const S = SIM.create(5), n = S.map.cols; S.souls = 1e6;
  const near = (c) => [-n - 1, -n, -n + 1, -1, 1, n - 1, n, n + 1].map((d) => c + d).filter((i) => Math.abs((i % n) - (c % n)) <= 1 && SIM.canBuild(S, i, 'bones').ok);
  const a = SIM.rankCells(S, C.TYPICAL_RANGE).find((c) => near(c).length), b = near(a)[0], cmds = [];
  for (const [cell, type, p] of [[a, 'bones', 'crush'], [b, 'spirits', 'frost']]) { cmds.push({ k: 'build', cell, type });
    for (const k of C.TRACKS) for (let i = 0; i < C.TRACK_MAX; i++) cmds.push({ k: 'upgrade', cell, track: k }); cmds.push({ k: 'perk', cell, p }); }
  cmds.push({ k: 'merge', cell: a, other: b }); SIM.step(S, { cmds });
  assert.ok(S.towers[a] && S.towers[a].mix === 'spirits' && S.towers[a].perks.length === 2, 'гибрид не собрался');
  return json(S); };
const HYB = hybridRun();
const hyb = (S) => S.towers.find((t) => t && t.mix);
test('сейв: забег с гибридом годен', () => { assert.equal(SIM.loadable(json(HYB)), true); assert.equal(HYB.stats.merges, 1); });
const BAD_HYB = {
  'примесь неизвестного типа': (S) => { hyb(S).mix = 'nope'; },
  'примесь-свойство объекта': (S) => { hyb(S).mix = 'constructor'; },
  'примесь — число': (S) => { hyb(S).mix = 5; },
  'нет поля примеси': (S) => { delete hyb(S).mix; },
  'Алтарь крови первой башней гибрида': (S) => { const t = hyb(S); t.type = 'altar'; t.perks = []; },
  'гибрид с потолком обычной башни': (S) => { const t = hyb(S); t.cap = C.TRACK_MAX; },
  'гибрид с одним слотом перков': (S) => { const t = hyb(S); t.slots = C.PERK_SLOTS; t.perks = t.perks.slice(0, 1); },
  'гибрид из непрокачанной башни': (S) => { hyb(S).tracks.dmg = C.TRACK_MAX - 1; },
  'перк не своего типа и не примеси': (S) => { hyb(S).perks[1] = 'curse'; },
  'два перка одного типа у гибрида разных типов': (S) => { hyb(S).perks = ['crush', 'volley']; },
  'обычная башня с потолком и слотами гибрида, но без примеси — перк чужого типа': (S) => { const t = hyb(S); t.mix = null; },
  'счётчик слияний строкой': (S) => { S.stats.merges = '1'; },
};
for (const [name, spoil] of Object.entries(BAD_HYB)) test(`сейв с гибридом отвергается: ${name}`, () => {
  const S = json(HYB); spoil(S); assert.equal(SIM.loadable(S), false);
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
