import test from 'node:test';
import assert from 'node:assert/strict';
import { SIM, play, smart, planned, idle, grim } from './bots.mjs';
import { RUNS, resultOf, results, describe } from './runs.mjs';

const C = SIM.CONFIG, T = C.TOWERS;
const json = (state) => JSON.parse(JSON.stringify(state));

test('ни в одном снимке партий ботов, берущих все перки, нет нечисловых значений', () => {
  const sets = [{}, { bones: 'pierce', spirits: 'frost', plague: 'pestilence', dark: 'harvest', bell: 'toll', altar: 'frenzy', barracks: 'legion' }, { bones: 'crush', spirits: 'chill', plague: 'miasma', dark: 'split', bell: 'knell', altar: 'circle', barracks: 'burst' }];
  const all = new Set(); for (const p of sets) for (const v of Object.values(p)) all.add(v);
  for (const t of C.TOWER_ORDER) for (const p of Object.keys(T[t].perks)) if (!['volley', 'pack', 'acid', 'curse', 'drone', 'offering', 'grip'].includes(p)) assert.ok(all.has(p), 'перк не покрыт ботами: ' + p);
  const bad = (o, path) => { if (typeof o === 'number') return Number.isFinite(o) ? null : path;
    if (o && typeof o === 'object') for (const k of Object.keys(o)) { if (k === 'map') continue; const b = bad(o[k], path + '.' + k); if (b) return b; } return null; };
  for (const perks of sets) {
    const bot = planned(C.TOWER_ORDER, Object.keys(perks).length ? perks : undefined), S = SIM.create(3, { dt: 1 / 30 }), mem = {};
    SIM.step(S, { cmds: [{ k: 'call' }, { k: 'auto', on: true }] }); let i = 0;
    while (S.phase !== 'won' && S.phase !== 'lost' && S.t < 5400) { const c = i++ % 3 === 0 ? bot(S, mem) : null; SIM.step(S, c ? { cmds: c } : null);
      if (i % 30 === 0) { const b = bad(S, 'S'); assert.equal(b, null, `нечисловое значение ${b} на ${S.t.toFixed(0)} с (перки ${JSON.stringify(perks)})`); } }
  }
});

test('детерминизм: тот же сид и те же команды — тот же итог', () => {
  const a = play(smart, 7, 900), b = play(smart, 7, 900);
  assert.deepEqual(a, b);
  const c = play(smart, 8, 900); assert.notDeepEqual(a.towers, c.towers);
});
for (const R of RUNS) test(`бот ${R.name}: ${R.want}`, () => {        // партии и ожидания — tests/runs.mjs
  const r = resultOf(R.name); assert.ok(R.ok(r, results), `${R.name}: ${describe(r)}`);
});

test('реликвии: партия бота проходит экраны выбора (берёт первую) и её снимки годны', () => {
  const S = SIM.create(2, { dt: 1 / 30 }), mem = {}; let i = 0, relicSnaps = 0;
  SIM.step(S, { cmds: [{ k: 'call' }, { k: 'auto', on: true }] });
  while (S.phase !== 'won' && S.phase !== 'lost' && S.t < 5400) {
    if (S.phase === 'relic') { relicSnaps++; assert.equal(SIM.loadable(json(S)), true, 'снимок экрана выбора, волна ' + S.wave); }
    const cmds = i++ % 3 === 0 ? smart(S, mem) : null; SIM.step(S, cmds ? { cmds } : null);
  }
  assert.ok(S.relics.length >= 1 && relicSnaps >= 1, `реликвий ${S.relics.length}, волна ${S.wave}`);
});

// Защита от расширений состояния: всё, что реально бывает в партии, проверка принимает.
// Тикет, добавивший в состояние поле, которое проверка не понимает, увидит это здесь.
for (const [name, bot, seed] of [['smart', smart, 1], ['idle', idle, 2], ['grim', grim, 3]]) test(`сейв: снимки партии бота ${name} годны на всём её ходу и в конце`, () => {
  const S = SIM.create(seed, { dt: 1 / 30 }), mem = {}, every = Math.round(20 / S.dt); let i = 0, n = 0;
  SIM.step(S, { cmds: [{ k: 'call' }, { k: 'auto', on: true }] });
  while (S.phase !== 'won' && S.phase !== 'lost' && S.t < 5400) {
    const cmds = i % 3 === 0 ? bot(S, mem) : null;
    SIM.step(S, cmds ? { cmds } : null);
    if (++i % every === 0) { n++; assert.equal(SIM.loadable(json(S)), true, `снимок на ${S.t.toFixed(0)} с, волна ${S.wave}, ${S.phase}`); }
  }
  assert.ok(n >= 5, 'снимков ' + n);
  assert.ok(S.phase === 'won' || S.phase === 'lost', 'партия не закончилась');
  assert.equal(SIM.loadable(json(S)), true, 'законченный забег (' + S.phase + ')');
});
