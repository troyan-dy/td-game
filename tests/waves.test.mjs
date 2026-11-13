// node --test tests/*.test.mjs — генератор волн: детерминизм по сиду, бюджет угрозы, свойства, боссы, превью против того, что выходит на дорогу.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const SIM = require('../live/sim.js');
const WAVEGEN = require('../live/wavegen.js');
const C = SIM.CONFIG, WG = C.WAVEGEN, EN = C.ENEMIES;

const RUN = SIM.waveCount();
const seeds = (n) => Array.from({ length: n }, (_, i) => i + 1);
const sig = (w) => w.squads.map((q) => q.type + '×' + q.count).join(' ') + (w.trait ? ' ' + w.trait.id : '');
// сколько врагов даёт один враг типа t вместе с теми, кто выйдет из него (у ополченцев, выходящих из повозки, своих нет)
const heads = (t) => 1 + (EN[t].spawnOnDeath ? EN[t].spawnOnDeath.n : 0);
const run = (S, sec) => { const n = Math.round(sec / S.dt); for (let i = 0; i < n; i++) SIM.step(S, null); };

test('забег — RUN_WAVES волн из генератора, ручного списка волн нет', () => {
  assert.equal(C.WAVES, undefined, 'в конфиге остался ручной список волн');
  assert.equal(RUN, C.RUN_WAVES);
  assert.equal(RUN, 20);
});

test('волна детерминирована по сиду и номеру: та же при повторе и после JSON, разные сиды — разные составы', () => {
  for (const n of [1, 5, 10, 13, 20]) {
    assert.deepEqual(WAVEGEN.wave(77, n), WAVEGEN.wave(77, n));
    assert.deepEqual(JSON.parse(JSON.stringify(WAVEGEN.wave(77, n))), WAVEGEN.wave(77, n));
  }
  const runs = new Set(seeds(30).map((s) => Array.from({ length: RUN }, (_, i) => sig(WAVEGEN.wave(s, i + 1))).join('|')));
  assert.ok(runs.size >= 29, 'мало разных наборов волн: ' + runs.size);
  const w7 = new Set(seeds(30).map((s) => sig(WAVEGEN.wave(s, 7))));
  assert.ok(w7.size >= 10, 'у 7-й волны мало разных составов: ' + w7.size);
});

test('волна не зависит от того, что было в бою: тот же сид с обороной и без — те же превью', () => {
  const a = SIM.create(31), b = SIM.create(31);
  a.souls = 1e5; a.hp = b.hp = 1e9;
  const cells = SIM.rankCells(a, 3.4).slice(0, 6);
  SIM.step(a, { cmds: [...cells.map((cell, i) => ({ k: 'build', cell, type: C.TOWER_ORDER[i % 4] })), { k: 'call' }] });
  SIM.step(b, { cmds: [{ k: 'call' }] });
  for (const S of [a, b]) while (S.wave < 3 || S.phase !== 'prep') SIM.step(S, null);
  assert.notEqual(a.rs, b.rs, 'бой должен был пойти по-разному');
  for (let n = 4; n <= 6; n++) assert.deepEqual(SIM.preview(a, n), SIM.preview(b, n));
});

test('бюджет угрозы строго растёт от волны к волне, в том числе за пределами забега', () => {
  for (let n = 2; n <= 200; n++) assert.ok(WG.budget(n) > WG.budget(n - 1), `бюджет ${n} не больше ${n - 1}`);
  for (const s of seeds(50)) for (let n = 1; n <= RUN; n++) {
    const w = WAVEGEN.wave(s, n);
    assert.equal(w.budget, WG.budget(n));
    // угроза в составе × power (бюджет, ушедший в силу врагов сверх предела числа) не больше бюджета волны
    assert.ok(w.threat * w.power <= w.budget * (w.trait && w.trait.mods.budget || 1) * (w.boss ? WG.bossEscort : 1) + 1e-6, `сид ${s} волна ${n}: потрачено ${w.threat}×${w.power} из ${w.budget}`);
  }
});

test('у каждого типа врага цена угрозы и минимальная волна; раньше своей волны тип не появляется', () => {
  for (const [k, d] of Object.entries(EN)) {
    assert.ok(d.threat > 0, k + ': нет цены угрозы'); assert.ok(Number.isInteger(d.minWave) && d.minWave >= 1, k + ': нет минимальной волны');
  }
  const first = {};
  for (const s of seeds(200)) for (let n = 1; n <= RUN; n++) for (const q of WAVEGEN.wave(s, n).squads) {
    assert.ok(n >= EN[q.type].minWave, `сид ${s}: ${q.type} на волне ${n}, минимальная ${EN[q.type].minWave}`);
    assert.ok(q.count >= 1 && Number.isInteger(q.count));
    first[q.type] = Math.min(first[q.type] || 99, n);
  }
  for (const [k, d] of Object.entries(EN)) if (d.minWave <= RUN) assert.equal(first[k], d.minWave, `${k} ни разу не вышел на своей минимальной волне`);
});

test('боссы на каждой bossEvery-й волне (10-я и 20-я в забеге), только там', () => {
  for (const s of seeds(20)) for (let n = 1; n <= 60; n++) {
    const w = WAVEGEN.wave(s, n), bosses = w.squads.filter((q) => q.boss);
    assert.equal(w.boss, n % WG.bossEvery === 0, `сид ${s} волна ${n}`);
    assert.equal(bosses.length, w.boss ? 1 : 0, `сид ${s} волна ${n}: боссов ${bosses.length}`);
    if (w.boss) { assert.equal(bosses[0].count, 1); assert.ok(w.squads.length >= 2, 'у босса нет свиты'); assert.equal(w.bossName, bosses[0].name); }
  }
  assert.ok(WAVEGEN.wave(1, 20).squads.find((q) => q.boss).hp > WAVEGEN.wave(1, 10).squads.find((q) => q.boss).hp, 'босс 20-й не сильнее босса 10-й');
  assert.ok([10, 20].every((n) => SIM.isBoss(n)) && !SIM.isBoss(11));
});

test('свойство примерно у трети волн, кроме волн 1–2 и боссов; встречается каждое свойство', () => {
  let with_ = 0, all = 0; const seen = {};
  for (const s of seeds(500)) for (let n = 1; n <= RUN; n++) {
    const w = WAVEGEN.wave(s, n);
    if (n < WG.traitFrom || w.boss) { assert.equal(w.trait, null, `сид ${s} волна ${n}: свойство ${w.trait && w.trait.id}`); continue; }
    all++; if (w.trait) { with_++; seen[w.trait.id] = (seen[w.trait.id] || 0) + 1; }
  }
  assert.equal(WG.traitFrom, 3);
  const share = with_ / all;
  assert.ok(Math.abs(share - WG.traitChance) < 0.03, 'доля волн со свойством ' + share.toFixed(3));
  assert.ok(Math.abs(WG.traitChance - 0.35) < 0.05);
  for (const id of Object.keys(C.TRAITS)) assert.ok(seen[id] > 50, 'свойство ' + id + ' почти не встречается: ' + (seen[id] || 0));
});

// средние характеристики типа на волне n: по волнам со свойством id и по волнам без свойства
const statsBy = (n, pick) => { const acc = { yes: [], no: [] };
  for (const s of seeds(600)) { const w = WAVEGEN.wave(s, n); acc[pick(w) ? 'yes' : w.trait ? 'skip' : 'no']?.push(w); } return acc; };
const avg = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
test('свойство реально меняет врагов: броня, скорость, HP, награда, число и лечение против волн того же номера без свойства', () => {
  const n = 9, sq = (ws, type, key) => ws.flatMap((w) => w.squads.filter((q) => q.type === type).map((q) => q[key]));
  const by = (id) => statsBy(n, (w) => w.trait && w.trait.id === id);
  const armored = by('armored'), fast = by('fast'), horde = by('horde'), rich = by('rich'), healers = by('healers');
  assert.ok(avg(sq(armored.yes, 'knight', 'armor')) > avg(sq(armored.no, 'knight', 'armor')), 'бронированная: броня рыцарей не выросла');
  assert.ok(avg(sq(armored.yes, 'militia', 'mres')) > avg(sq(armored.no, 'militia', 'mres')), 'бронированная: защита от магии не выросла');
  assert.ok(avg(sq(fast.yes, 'militia', 'speed')) > avg(sq(fast.no, 'militia', 'speed')), 'быстрая: скорость не выросла');
  const cnt = (ws) => avg(ws.map((w) => w.total.count));
  assert.ok(cnt(horde.yes) > 1.3 * cnt(horde.no), `толпа: врагов ${cnt(horde.yes)} против ${cnt(horde.no)}`);
  assert.ok(avg(sq(horde.yes, 'militia', 'hp')) < avg(sq(horde.no, 'militia', 'hp')), 'толпа: враги не слабее');
  assert.ok(avg(sq(rich.yes, 'knight', 'bounty')) > avg(sq(rich.no, 'knight', 'bounty')), 'богатая: награда не выросла');
  const priests = (ws) => avg(ws.map((w) => w.squads.filter((q) => q.type === 'priest').reduce((a, q) => a + q.count * EN.priest.threat, 0) / w.threat));
  assert.ok(priests(healers.yes) > priests(healers.no) + 0.1, `с лекарями: доля священников ${priests(healers.yes)} против ${priests(healers.no)}`);
  assert.ok(avg(sq(healers.yes, 'priest', 'heal')) > avg(sq(healers.no, 'priest', 'heal')), 'с лекарями: лечение не сильнее');
  for (const t of [armored, fast, horde, rich, healers]) assert.ok(t.yes.length > 20 && t.no.length > 100);
});

test('генератор отдаёт волну по любому номеру: дальше 20-й угроза продолжает расти', () => {
  for (let n = 1; n <= 150; n++) {
    const w = WAVEGEN.wave(9, n);
    assert.equal(w.n, n); assert.ok(w.squads.length >= 1 && Number.isFinite(w.total.hp) && w.total.hp > 0, 'волна ' + n);
  }
  // составы случайны, поэтому сравниваем средние суммарные HP по сидам
  let prev = 0;
  for (const n of [5, 15, 25, 35, 55, 85, 125]) { const hp = avg(seeds(40).map((s) => WAVEGEN.wave(s, n).total.hp));
    assert.ok(hp > prev, `волна ${n}: средние суммарные HP ${hp} не больше ${prev}`); prev = hp; }
});

test('превью: свойство с цифрами, отряды, суммарные HP и награда, босс и награда за зачистку', () => {
  let traitW = null, bossW = WAVEGEN.wave(3, 10);
  for (let s = 1; !traitW; s++) for (let n = 3; n <= 9 && !traitW; n++) { const w = WAVEGEN.wave(s, n); if (w.trait) traitW = w; }
  assert.ok(traitW.trait.name && traitW.trait.desc && Object.keys(traitW.trait.mods).length);
  for (const w of [traitW, bossW]) {
    for (const q of w.squads) for (const k of ['name', 'count', 'hp', 'armor', 'mres', 'speed', 'bounty', 'leak']) assert.ok(q[k] !== undefined, `нет ${k} у ${q.type}`);
    assert.equal(w.total.count, w.squads.reduce((a, q) => a + q.count, 0));
    assert.equal(w.total.hp, w.squads.reduce((a, q) => a + q.count * q.hp, 0) + w.extra.reduce((a, q) => a + q.count * q.hp, 0));
    assert.equal(w.bonus, C.WAVE_BONUS(w.n));
  }
  assert.ok(bossW.boss && bossW.bossName);
  const pr = bossW.squads.find((q) => q.type === 'priest') || WAVEGEN.wave(5, 19).squads.find((q) => q.type === 'priest');
  if (pr) assert.match(pr.ability, /\d/, 'способность священника без цифр: ' + pr.ability);
});

test('SIM.preview: следующая волна и не дальше SCOUT_AHEAD вперёд, не дальше конца забега', () => {
  const S = SIM.create(12);
  assert.equal(C.SCOUT_AHEAD, 3);
  assert.equal(SIM.preview(S, 0), null);
  for (let n = 1; n <= C.SCOUT_AHEAD; n++) assert.deepEqual(SIM.preview(S, n), WAVEGEN.wave(12, n));
  assert.equal(SIM.preview(S, C.SCOUT_AHEAD + 1), null);
  assert.deepEqual(SIM.scoutRange(S), { from: 1, to: C.SCOUT_AHEAD });
  S.wave = RUN - 1; assert.deepEqual(SIM.scoutRange(S), { from: RUN, to: RUN }); assert.equal(SIM.preview(S, RUN + 1), null);
});

// «Ворота»: без башен и с бездонным склепом каждая волна проходит целиком; записываем каждого врага при выходе на дорогу
const gauntlet = (seed, waves) => {
  const S = SIM.create(seed, { dt: 1 / 30 }), out = []; S.hp = 1e9;
  for (let n = 1; n <= waves; n++) {
    const pv = SIM.preview(S, n), seen = new Map();
    SIM.step(S, { cmds: [{ k: 'call' }] });
    let guard = 0; const remain = [];
    while (S.phase === 'wave' && guard++ < 1e6) {
      for (const e of S.enemies) { const r = seen.get(e.id);
        if (!r) seen.set(e.id, { type: e.type, child: !!e.child, hp: e.max, armor: e.armor, mres: e.mres, speed: e.speed, bounty: e.bounty, name: e.name, d0: e.d });
        else if (r.v === undefined && e.d > r.d0 && e.slowT <= 0 && e.freezeT <= 0) r.v = (e.d - r.d0) / S.dt; }
      remain.push(SIM.remaining(S) === S.queue.slice(S.qi).reduce((a, q) => a + heads(q.e), 0) + S.enemies.reduce((a, e) => a + heads(e.type), 0));
      SIM.step(S, null);
    }
    assert.ok(remain.every(Boolean), 'SIM.remaining не равно невышедшим плюс живым (вместе с теми, кто выйдет из них)');
    out.push({ pv, got: [...seen.values()] });                       // следующая волна — сразу командой call
  }
  return out;
};
test('превью совпадает с тем, что выходит на дорогу: типы, число, HP, броня, защита, скорость, награда', () => {
  for (const seed of [2, 5]) for (const { pv, got } of gauntlet(seed, RUN)) {
    const byType = {};
    for (const g of got) { assert.equal(g.child, false); (byType[g.type] = byType[g.type] || []).push(g); }
    assert.deepEqual(Object.keys(byType).sort(), pv.squads.map((q) => q.type).sort(), `сид ${seed} волна ${pv.n}: типы`);
    for (const q of pv.squads) {
      const list = byType[q.type];
      assert.equal(list.length, q.count, `сид ${seed} волна ${pv.n}: ${q.type} число`);
      for (const g of list) {
        for (const k of ['hp', 'armor', 'mres', 'speed', 'bounty', 'name']) assert.equal(g[k === 'hp' ? 'hp' : k], q[k], `сид ${seed} волна ${pv.n}: ${q.type}.${k}`);
        if (g.v !== undefined) assert.ok(Math.abs(g.v - q.speed) < 1e-6, `сид ${seed} волна ${pv.n}: ${q.type} идёт со скоростью ${g.v}, в превью ${q.speed}`);
      }
    }
  }
});

test('броня свойства работает в бою: физический удар по бронированному врагу слабее ровно на его броню', () => {
  let seed = 1, n = 0;
  for (; seed < 500 && !n; seed++) for (let k = 3; k <= 9; k++) if (WAVEGEN.wave(seed, k).trait?.id === 'armored') { n = k; break; }
  seed--;
  const S = SIM.create(seed); S.hp = 1e9; S.wave = n - 1;
  SIM.step(S, { cmds: [{ k: 'call' }] });
  while (!S.enemies.length) SIM.step(S, null);
  const e = S.enemies[0], q = WAVEGEN.wave(seed, n).squads.find((x) => x.type === e.type);
  assert.ok(e.armor > EN[e.type].armor, 'броня не выросла');
  assert.equal(e.armor, q.armor);
  e.freezeT = 1e9; e.hp = e.max = 1e6; SIM.step(S, null);
  S.shots.push({ k: 'bolt', x: e.x - 20, y: e.y - 14, tid: e.id, dmg: 100, sp: 900, tw: -1, lx: e.x, ly: e.y });
  run(S, 0.2);
  assert.ok(Math.abs((1e6 - e.hp) - 100 * (1 - e.armor)) < 1e-6, `урон ${1e6 - e.hp}, броня ${e.armor}`);
});

test('из повозки выходят ополченцы с характеристиками этой волны из превью', () => {
  let seed = 1, n = 0;
  for (; seed < 500 && !n; seed++) for (let k = 7; k <= RUN; k++) { const w = WAVEGEN.wave(seed, k); if (w.squads.some((q) => q.type === 'cart') && w.trait) { n = k; break; } }
  seed--;
  const S = SIM.create(seed); S.hp = 1e9; S.wave = n - 1;
  const pv = SIM.preview(S, n), ex = pv.extra.find((x) => x.type === 'militia');
  assert.ok(ex && ex.count === pv.squads.find((q) => q.type === 'cart').count * EN.cart.spawnOnDeath.n);
  SIM.step(S, { cmds: [{ k: 'call' }] });
  let cart = null; for (let i = 0; i < 120 * 200 && !cart; i++) { SIM.step(S, null); cart = S.enemies.find((e) => e.type === 'cart'); }
  cart.d = 400; cart.hp = 1; cart.freezeT = 1e9; SIM.step(S, null);
  S.shots.push({ k: 'bolt', x: cart.x - 20, y: cart.y - 14, tid: cart.id, dmg: 100, sp: 900, tw: -1, lx: cart.x, ly: cart.y });
  run(S, 0.2);
  const kids = S.enemies.filter((e) => e.child);
  assert.equal(kids.length, EN.cart.spawnOnDeath.n);
  for (const k of kids) for (const key of ['hp', 'armor', 'mres', 'speed', 'bounty']) assert.equal(k[key === 'hp' ? 'max' : key], ex[key], key);
});

// ---------------------------------------------------------------- предел волны и негодные номера
test('предел волны: до 500-й врагов и длительность не выше предела, очередь не длиннее, суммарные HP растут', () => {
  for (const s of seeds(3)) for (let n = 1; n <= 500; n++) {
    const w = WAVEGEN.wave(s, n), q = WAVEGEN.queue(w);
    assert.ok(w.total.count + w.total.extra <= WG.maxEnemies, `сид ${s} волна ${n}: врагов ${w.total.count}+${w.total.extra}`);
    assert.ok(w.duration <= WG.maxDuration, `сид ${s} волна ${n}: длительность ${w.duration}`);
    assert.equal(q.length, w.total.count); assert.ok(q.every((x) => x.at <= WG.maxDuration));
    assert.ok(w.power >= 1);
  }
  let prev = 0;
  for (const n of [10, 20, 30, 50, 100, 200, 300, 500]) {
    const hp = avg(seeds(20).map((s) => WAVEGEN.wave(s, n).total.hp));
    assert.ok(hp > prev, `волна ${n}: средние суммарные HP ${hp} не больше ${prev}`); prev = hp;
  }
  assert.ok(WAVEGEN.wave(1, 100).power > 1, 'на 100-й волне бюджет сверх предела не ушёл в силу врагов');
});

test('генерация и очередь волны занимают доли миллисекунды на любом номере', () => {
  const t0 = performance.now(); let k = 0;
  for (let n = 1; n <= 500; n++, k++) WAVEGEN.queue(WAVEGEN.wave(3, n));
  for (const n of [1e4, 1e6, Number.MAX_SAFE_INTEGER]) { WAVEGEN.queue(WAVEGEN.wave(3, n)); k++; }
  const per = (performance.now() - t0) / k;
  assert.ok(per < 2, `в среднем ${per.toFixed(2)} мс на волну`);
});

test('негодный номер волны — RangeError; огромный — конечная волна в пределах', () => {
  for (const bad of [0, -1, -5, 1.5, NaN, undefined, null, '3', Infinity, -Infinity, 2 ** 53, {}, []])
    assert.throws(() => WAVEGEN.wave(1, bad), RangeError, 'номер ' + String(bad));
  for (const n of [1e6, Number.MAX_SAFE_INTEGER]) {
    const w = WAVEGEN.wave(1, n);
    assert.ok(w.total.count + w.total.extra <= WG.maxEnemies && w.duration <= WG.maxDuration);
    for (const q of [...w.squads, ...w.extra]) for (const k of ['hp', 'armor', 'mres', 'speed', 'bounty']) assert.ok(Number.isFinite(q[k]), `${n}: ${q.type}.${k} = ${q[k]}`);
    assert.ok(Number.isFinite(w.total.hp) && Number.isFinite(w.total.bounty));
  }
  const S = SIM.create(1);
  for (const bad of [NaN, 1.5, '1', undefined, Infinity, 0]) assert.equal(SIM.preview(S, bad), null);
});

test('характеристики превью — по формуле: база × множитель волны × свойство (× сила сверх предела)', () => {
  const near = (a, b) => Math.abs(a - b) < 0.006;
  let checked = 0, plain = 0;
  for (const s of seeds(40)) for (let n = 1; n <= 40; n++) {
    const w = WAVEGEN.wave(s, n), T = w.trait ? C.TRAITS[w.trait.id] : {}, k = (key) => (T[key] === undefined ? 1 : T[key]);
    // волна заметно меньше предела числа врагов — значит, в него не упиралась, и добавочной силы нет
    // (урезанная до предела волна теряет на округлении не больше нескольких врагов на отряд)
    if (w.total.count + w.total.extra < WG.maxEnemies - 20) { assert.equal(w.power, 1, `сид ${s} волна ${n}`); plain++; }
    for (const q of [...w.squads, ...w.extra]) { if (q.boss) continue; const d = EN[q.type];
      assert.equal(q.hp, Math.round(d.hp * C.HP_MULT(n) * k('hp') * w.power), `сид ${s} волна ${n}: ${q.type}.hp`);
      assert.equal(q.bounty, Math.round(d.bounty * C.BOUNTY_MULT(n) * k('bounty') * w.power ** WG.powerBounty), `сид ${s} волна ${n}: ${q.type}.bounty`);
      assert.ok(near(q.armor, Math.min(0.9, d.armor + (T.armor || 0))), `сид ${s} волна ${n}: ${q.type}.armor ${q.armor}`);
      assert.ok(near(q.mres, Math.min(0.9, d.mres + (T.mres || 0))), `сид ${s} волна ${n}: ${q.type}.mres ${q.mres}`);
      assert.ok(near(q.speed, d.speed * k('speed')), `сид ${s} волна ${n}: ${q.type}.speed ${q.speed}`);
      assert.equal(q.heal, d.heal ? Math.round(d.heal * C.HP_MULT(n) * k('heal')) : 0, `сид ${s} волна ${n}: ${q.type}.heal`);
      checked++; }
  }
  assert.ok(checked > 1000 && plain > 300);
});

// ---------------------------------------------------------------- свойства в бою: цифры превью — это то, что происходит
const findWave = (pred, from = 3, to = RUN) => { for (let s = 1; s < 2000; s++) for (let n = from; n <= to; n++) { const w = WAVEGEN.wave(s, n); if (pred(w)) return { seed: s, n, w }; } throw new Error('нет такой волны'); };
const ALL_SEEN = Object.fromEntries(Object.keys(EN).map((k) => [k, 1]));
const startAt = (seed, n) => { const S = SIM.create(seed); S.hp = 1e9; S.wave = n - 1; S.seen = Object.assign({}, ALL_SEEN); SIM.step(S, { cmds: [{ k: 'call' }] }); return S; };
const enemyOf = (S, f = () => true) => { for (let i = 0; i < 120 * 300; i++) { const e = S.enemies.find((x) => !x.dead && f(x)); if (e) return e; SIM.step(S, null); } throw new Error('враг не вышел'); };
const shoot = (S, e, k, dmg) => { e.freezeT = 1e9; SIM.step(S, null);
  S.shots.push({ k, x: e.x - 20, y: e.y - 14, tid: e.id, dmg, sp: 900, tw: -1, lx: e.x, ly: e.y, bounces: 0, hit: [], born: S.t, seed: 0 }); run(S, 0.3); };

test('награда за убийство в бою равна награде из превью («Богатая», «Толпа»)', () => {
  for (const id of ['rich', 'horde']) {
    const { seed, n, w } = findWave((x) => x.trait && x.trait.id === id && x.squads.some((q) => !EN[q.type].spawnOnDeath && q.count > 2));
    const S = startAt(seed, n), e = enemyOf(S, (x) => !EN[x.type].spawnOnDeath), q = w.squads.find((x) => x.type === e.type);
    assert.notEqual(q.bounty, Math.round(EN[e.type].bounty * C.BOUNTY_MULT(n)), `${id}: награда не отличается от волны без свойства`);
    e.hp = 1; const before = S.souls; shoot(S, e, 'bolt', 100);
    assert.ok(e.dead, `${id}: враг не убит`);
    assert.equal(S.souls - before, q.bounty, `${id}: за убийство ${S.souls - before} душ, в превью ${q.bounty}`);
  }
});

test('магический удар по врагу «Бронированной» волны слабее ровно на защиту из превью', () => {
  const { seed, n, w } = findWave((x) => x.trait && x.trait.id === 'armored');
  const S = startAt(seed, n), e = enemyOf(S), q = w.squads.find((x) => x.type === e.type);
  assert.ok(q.mres > EN[e.type].mres, 'защита не выросла');
  e.hp = e.max = 1e6; shoot(S, e, 'ghost', 100);
  assert.ok(Math.abs((1e6 - e.hp) - 100 * (1 - q.mres)) < 1e-6, `урон ${1e6 - e.hp}, защита в превью ${q.mres}`);
});

test('лечение священника «С лекарями» равно лечению из превью', () => {
  const { seed, n, w } = findWave((x) => x.trait && x.trait.id === 'healers');
  const q = w.squads.find((x) => x.type === 'priest');
  assert.ok(q.heal > Math.round(EN.priest.heal * C.HP_MULT(n)), 'лечение не сильнее, чем без свойства');
  const S = startAt(seed, n), p = enemyOf(S, (x) => x.type === 'priest'), t = enemyOf(S, (x) => x !== p && !EN[x.type].boss);
  for (const e of S.enemies) { e.freezeT = 1e9; if (e.type === 'priest') e.healCD = 1e9; }
  t.d = p.d; SIM.step(S, null);
  t.hp = t.max * 0.1; assert.ok(t.max - t.hp > q.heal);
  p.healCD = S.dt / 2; const before = t.hp; SIM.step(S, null);
  assert.ok(Math.abs((t.hp - before) - q.heal) < 1e-9, `вылечено ${t.hp - before}, в превью ${q.heal}`);
});

// ---------------------------------------------------------------- состав волны
test('бюджет меньше цены самого дешёвого врага — волна из одного самого дешёвого доступного (тип не зашит в код)', () => {
  const oldB = WG.budget, oldT = EN.knight.threat;
  try {
    WG.budget = () => 0.2;
    for (const n of [1, 2, 5, 9, 13]) { const w = WAVEGEN.wave(4, n), nb = w.squads.filter((q) => !q.boss);
      assert.deepEqual(nb.map((q) => [q.type, q.count]), [['militia', 1]], 'волна ' + n); }
    EN.knight.threat = 0.25;                                          // рыцарь стал самым дешёвым — он и выходит
    for (const n of [5, 9]) assert.deepEqual(WAVEGEN.wave(4, n).squads.filter((q) => !q.boss).map((q) => [q.type, q.count]), [['knight', 1]], 'волна ' + n);
    assert.deepEqual(WAVEGEN.wave(4, 2).squads.map((q) => q.type), ['militia'], 'рыцарь вышел раньше своей волны');
  } finally { WG.budget = oldB; EN.knight.threat = oldT; }
});

test('кто не ходит один (alone: false), тот не составляет волну сам; волн из одного отряда немного', () => {
  assert.equal(EN.priest.alone, false);
  let single = 0, multi = 0;
  for (const s of seeds(300)) for (let n = 1; n <= RUN; n++) {
    const w = WAVEGEN.wave(s, n), nb = w.squads.filter((q) => !q.boss);
    assert.ok(nb.some((q) => EN[q.type].alone !== false), `сид ${s} волна ${n}: одни ${nb.map((q) => q.type).join(', ')}`);
    if (Object.keys(EN).filter((k) => !EN[k].boss && EN[k].minWave <= n).length >= 2) { multi++; if (nb.length === 1) single++; }
  }
  assert.ok(single / multi <= 0.2, `волн из одного отряда ${(100 * single / multi).toFixed(1)}%`);
});

test('правка превью не меняет конфиг и следующие волны', () => {
  const { seed, n } = findWave((x) => x.trait && x.trait.id === 'healers');
  const fresh = WAVEGEN.wave(seed, n), share = C.TRAITS.healers.share.priest;
  const w = WAVEGEN.wave(seed, n); w.trait.mods.share.priest = 0.99; w.trait.mods.heal = 9; w.squads[0].hp = 1; w.stats[w.squads[0].type].hp = 1;
  assert.equal(C.TRAITS.healers.share.priest, share);
  assert.deepEqual(WAVEGEN.wave(seed, n), fresh);
});

test('характеристики врагов — по текущему конфигу, а не из кэша прошлой партии того же сида', () => {
  const hpOf = () => { const S = SIM.create(8); S.hp = 1e9; SIM.step(S, { cmds: [{ k: 'call' }] }); return enemyOf(S).max; };
  assert.equal(hpOf(), EN.militia.hp);
  const old = C.HP_MULT;
  try { C.HP_MULT = (n) => 2 * old(n); assert.equal(hpOf(), 2 * EN.militia.hp); } finally { C.HP_MULT = old; }
});

test('«осталось» сразу учитывает тех, кто выйдет из повозок, и не растёт, когда повозка ломается', () => {
  const { seed, n, w } = findWave((x) => x.squads.some((q) => q.type === 'cart'), 7);
  const S = SIM.create(seed, { dt: 1 / 30 }); S.hp = 1e9; S.wave = n - 1; S.seen = Object.assign({}, ALL_SEEN);
  SIM.step(S, { cmds: [{ k: 'call' }] });
  assert.equal(SIM.remaining(S), w.total.count + w.total.extra);
  let last = SIM.remaining(S), kids = 0; const shot = new Set();
  for (let i = 0; S.phase === 'wave' && i < 30 * 600; i++) {
    for (const e of S.enemies) if (e.type === 'cart' && !shot.has(e.id) && e.d > 150) { shot.add(e.id);
      S.shots.push({ k: 'bolt', x: e.x - 10, y: e.y - 14, tid: e.id, dmg: 1e9, sp: 900, tw: -1, lx: e.x, ly: e.y }); }
    SIM.step(S, null);
    kids += S.enemies.filter((e) => e.child && !shot.has('k' + e.id) && shot.add('k' + e.id)).length;
    const r = SIM.remaining(S); assert.ok(r <= last, `«осталось» выросло: ${last} → ${r}`); last = r;
  }
  assert.ok(kids > 0, 'ни одна повозка не сломалась');
  assert.equal(last, 0);
});

test('титульное демо не падает, если ни одна волна не укладывается в половину петли', () => {
  const old = WG.pace;
  try { WG.pace = () => 40; const S = SIM.at(7 * SIM.L + 0.5); assert.ok(S.demo && S.wave >= 1); } finally { WG.pace = old; }
});
