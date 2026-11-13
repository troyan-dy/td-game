// node --test tests/*.test.mjs — конец забега и бесконечный режим: победа с выбором, волны после последней, рост угрозы
// и босса, поражение с достигнутой волной, сейв далёкой волны, волны с реликвией.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const SIM = require('../live/sim.js');
const WAVEGEN = require('../live/wavegen.js');
const C = SIM.CONFIG, WG = C.WAVEGEN;
const RUN = SIM.waveCount();

const json = (S) => JSON.parse(JSON.stringify(S));
const run = (S, sec) => { const n = Math.round(sec / S.dt); for (let i = 0; i < n; i++) SIM.step(S, null); };
// волна n идёт: забег поставлен на паузу перед ней и вызвал её
const startAt = (S, n) => { S.phase = 'prep'; S.wave = n - 1; S.autoT = -1; SIM.step(S, { cmds: [{ k: 'call' }] }); assert.equal(S.wave, n); return S; };
// волна зачищена: все вышли и умерли — на следующем шаге её конец
const clear = (S) => { S.qi = S.queue.length; S.enemies = []; SIM.step(S, null); };
// забег, победивший на последней волне
const won = (seed = 5) => { const S = startAt(SIM.create(seed, { dt: 1 / 30 }), RUN); clear(S); return S; };
const endless = (seed = 5) => { const S = won(seed); SIM.step(S, { cmds: [{ k: 'endless' }] }); return S; };

test('победа на последней волне: забег ждёт выбора, продолжить можно только один раз и только после победы', () => {
  const S = won();
  assert.equal(S.phase, 'won'); assert.equal(S.wave, RUN); assert.equal(S.endless, false);
  assert.ok(S.ev.some((e) => e.k === 'win'));
  assert.equal(SIM.canEndless(S), true);
  assert.equal(SIM.loadable(json(S)), true, 'победа годна для сейва');
  // без команды забег стоит: время и волна не идут, «призвать» не работает
  const t = S.stats.time; run(S, 30); SIM.step(S, { cmds: [{ k: 'call' }] });
  assert.equal(S.phase, 'won'); assert.equal(S.wave, RUN); assert.equal(S.stats.time, t);
  SIM.step(S, { cmds: [{ k: 'endless' }] });
  assert.equal(S.phase, 'prep'); assert.equal(S.wave, RUN); assert.equal(S.endless, true); assert.equal(S.autoT, -1, 'первая волна бесконечного режима — по кнопке');
  assert.ok(S.ev.some((e) => e.k === 'endless'));
  assert.equal(SIM.canEndless(S), false);
  assert.equal(SIM.loadable(json(S)), true);
  // до победы, после поражения и повторно команда ничего не делает
  const A = SIM.create(5); SIM.step(A, { cmds: [{ k: 'endless' }] }); assert.equal(A.endless, false); assert.equal(SIM.canEndless(A), false);
  const L = SIM.create(5); L.phase = 'lost'; SIM.step(L, { cmds: [{ k: 'endless' }] }); assert.equal(L.endless, false); assert.equal(L.phase, 'lost');
  const B = endless(); SIM.step(B, { cmds: [{ k: 'endless' }] }); assert.equal(B.phase, 'prep'); assert.equal(B.wave, RUN);
});

test('обычный забег за последнюю волну не выходит, бесконечный — идёт дальше по кнопке', () => {
  const N = SIM.create(5); N.wave = RUN; N.phase = 'prep'; N.auto = true; N.autoT = 1;
  SIM.step(N, { cmds: [{ k: 'call' }] }); run(N, 3);
  assert.equal(N.wave, RUN, 'обычный забег вызвал волну после последней');
  assert.equal(SIM.lastWave(N), RUN);
  const S = endless(); assert.equal(SIM.lastWave(S), Infinity);
  SIM.step(S, { cmds: [{ k: 'call' }] });
  assert.equal(S.wave, RUN + 1); assert.equal(S.phase, 'wave');
  assert.deepEqual(S.queue, WAVEGEN.queue(WAVEGEN.wave(S.seed, RUN + 1)), 'волна не от того же генератора');
  clear(S);
  assert.equal(S.phase, 'prep', 'после волны бесконечного режима снова пауза'); assert.equal(S.autoT, C.RUN_CONTROL.autoDelay);
  run(S, 60); assert.equal(S.wave, RUN + 1, 'без автоплея волна началась сама');
  SIM.step(S, { cmds: [{ k: 'call' }] }); assert.equal(S.wave, RUN + 2);
  // разведка видит волны за последней только в бесконечном режиме
  assert.deepEqual(SIM.scoutRange(S), { from: RUN + 3, to: RUN + 2 + C.SCOUT_AHEAD });
  assert.ok(SIM.preview(S, RUN + 3)); assert.equal(SIM.preview(won(), RUN + 1), null);
});

test('бесконечный режим: угроза растёт, босс каждые 10 волн и растёт вместе с волной', () => {
  for (let n = RUN + 1; n <= 200; n++) assert.ok(WG.budget(n) > WG.budget(n - 1), 'бюджет ' + n);
  const hpOf = (n) => { let a = 0; for (let s = 1; s <= 20; s++) a += WAVEGEN.wave(s, n).total.hp; return a; };
  for (let n = RUN + 1; n < 100; n += 5) assert.ok(hpOf(n + 5) > hpOf(n), `HP волн ${n + 5} не больше ${n}`);   // волны без босса
  const share = (n) => { let a = 0; for (let s = 1; s <= 20; s++) { const w = WAVEGEN.wave(s, n); a += w.squads.find((q) => q.boss).hp / w.total.hp; } return a / 20; };
  const s20 = share(RUN);
  for (let n = RUN + 1; n <= 120; n++) {
    const w = WAVEGEN.wave(3, n);
    assert.equal(w.boss, n % 10 === 0, 'босс на волне ' + n);
    if (!w.boss) continue;
    const b = w.squads.find((q) => q.boss), prev = WAVEGEN.wave(3, n - 10).squads.find((q) => q.boss);
    assert.ok(b.hp > prev.hp && b.bounty > prev.bounty, `босс ${n} не сильнее босса ${n - 10}`);
    assert.ok(share(n) > s20 / 2, `доля босса в HP волны ${n}: ${share(n).toFixed(3)} против ${s20.toFixed(3)} на ${RUN}-й`);
  }
  // до конца обычного забега босс прежний
  for (const n of [10, 20]) assert.equal(WAVEGEN.wave(1, n).squads.find((q) => q.boss).hp, WAVEGEN.wave(2, n).squads.find((q) => q.boss).hp, `босс ${n}-й волны не зависит от сида`);
  assert.ok(WAVEGEN.wave(1, 20).squads.find((q) => q.boss).hp > WAVEGEN.wave(1, 10).squads.find((q) => q.boss).hp);
  const S = endless(); startAt(S, 30);
  assert.ok(S.ev.some((e) => e.k === 'wave' && e.wave === 30 && e.boss));
});

test('бесконечный забег заканчивается поражением на достигнутой волне, без победы', () => {
  const S = endless(); S.hp = 1; startAt(S, RUN + 3);
  for (let i = 0; i < 120 * 30 && S.phase !== 'lost'; i++) SIM.step(S, null);
  assert.equal(S.phase, 'lost'); assert.equal(S.wave, RUN + 3); assert.equal(S.endless, true);
  assert.ok(!S.ev.some((e) => e.k === 'win'));
  assert.equal(SIM.loadable(json(S)), true, 'законченный бесконечный забег');
  SIM.step(S, { cmds: [{ k: 'call' }, { k: 'endless' }] }); assert.equal(S.phase, 'lost'); assert.equal(S.wave, RUN + 3);
});

test('поражение объясняет себя: кто прорвался к склепу и сколько прочности отнял, по типам врагов', () => {
  const S = SIM.create(5); S.hp = 1e3; startAt(S, 3);                 // без башен: прорываются все
  for (let i = 0; i < 120 * 200 && S.phase === 'wave'; i++) SIM.step(S, null);
  const rep = SIM.leakReport(S), w = WAVEGEN.wave(S.seed, 3);
  assert.ok(rep.length >= 1, 'пустой отчёт');
  assert.equal(rep.reduce((a, r) => a + r.hp, 0), S.stats.leaked, 'сумма прочности по типам — все прорывы');
  for (const q of w.squads) { const r = rep.find((x) => x.type === q.type); assert.ok(r && r.n >= q.count, `${q.type}: ${JSON.stringify(rep)}`); assert.equal(r.name, C.ENEMIES[q.type].name); }
  for (let i = 1; i < rep.length; i++) assert.ok(rep[i - 1].hp >= rep[i].hp, 'больше урона — выше');
  assert.equal(SIM.loadable(json(S)), true);
  const old = json(S); delete old.leakBy; assert.equal(SIM.loadable(old), true, 'сейв прежней сборки без счётчика прорывов годен');
  assert.deepEqual(SIM.leakReport(old), []);
});

// счётчики забега, доигранного до волны n: души и награды всех волн, убийства, урон башни
const farRun = (n) => {
  const S = endless(9); S.souls = 5000; const cells = SIM.rankCells(S, 3.4);
  SIM.step(S, { cmds: C.TOWER_ORDER.map((type, i) => ({ k: 'build', cell: cells[i], type })) });
  let bounty = 0, kills = 0, hp = 0;
  for (let k = 1; k <= n; k++) { const w = WAVEGEN.wave(S.seed, k); bounty += w.total.bounty + w.bonus; kills += w.total.count + w.total.extra; hp += w.total.hp; }
  startAt(S, n); S.hp = 1e6; run(S, 12);
  Object.assign(S.stats, { kills, earned: bounty, spent: bounty, time: n * 120 }); S.souls = bounty; S.towers.find(Boolean).dmg = hp; S.towers.find(Boolean).kills = kills;
  return S;
};
for (const n of [60, 200]) test(`сейв бесконечного забега на ${n}-й волне годен и после JSON идёт так же`, () => {
  const S = farRun(n);
  assert.equal(S.phase, 'wave'); assert.ok(S.enemies.length > 0, 'нет врагов на дороге');
  assert.equal(SIM.loadable(json(S)), true);
  const J = json(S); run(S, 5); run(J, 5); assert.deepEqual(json(J), json(S));
});

test('сейв бесконечного режима: волна согласована с режимом', () => {
  const ok = endless(); assert.equal(SIM.loadable(json(ok)), true);
  const bad = {
    'режим не логический': (S) => { S.endless = 1; },
    'бесконечный режим до победы': (S) => { S.wave = 5; },
    'идёт последняя волна в бесконечном режиме': (S) => { S.phase = 'wave'; },
    'победа в бесконечном режиме': (S) => { S.phase = 'won'; },
    'поражение до волн бесконечного режима': (S) => { S.phase = 'lost'; },
  };
  for (const [name, spoil] of Object.entries(bad)) { const S = json(ok); spoil(S); assert.equal(SIM.loadable(S), false, name); }
  const N = won(); N.wave = RUN + 1; assert.equal(SIM.loadable(json(N)), false, 'волна за последней без бесконечного режима');
});

test('реликвия положена после волн 5, 10, 15 и каждой пятой в бесконечном режиме', () => {
  const due = []; for (let n = 1; n <= 60; n++) if (SIM.relicDue(n)) due.push(n);
  assert.deepEqual(due, [5, 10, 15, 25, 30, 35, 40, 45, 50, 55, 60]);
});
