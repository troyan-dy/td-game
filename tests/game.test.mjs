// node --test tests/*.test.mjs — уровень, детерминизм, баланс (ожидания ботов — tests/runs.mjs), команды, сейв.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SIM, play, smart } from './bots.mjs';
import { RUNS, playRun, describe } from './runs.mjs';
const C = SIM.CONFIG;

test('уровень: путь до склепа, 18 площадок вне дороги, 25 волн', () => {
  assert.deepEqual(SIM.selfCheck(), []);
});
test('каждая площадка покрывает дорогу (нет пустышек)', () => {
  for (const s of C.SLOTS) assert.ok(SIM.coverage(s.id, 3.2) >= 150, `площадка ${s.id}: ${SIM.coverage(s.id, 3.2)}`);
});
test('есть сильные узловые площадки, бьющие по двум отрезкам', () => {
  const best = C.SLOTS.map((s) => SIM.coverage(s.id, 3.5)).sort((a, b) => b - a);
  assert.ok(best[0] > 2 * best[best.length - 1], 'разброс покрытия слишком мал: ' + best.join(','));
});
test('детерминизм: тот же seed — тот же итог', () => {
  const a = play(smart, 7, 900), b = play(smart, 7, 900);
  assert.deepEqual([a.wave, a.hp, a.kills, a.souls], [b.wave, b.hp, b.kills, b.souls]);
});
for (const R of RUNS) test(`бот ${R.name}: ${R.want}`, () => {        // партии и ожидания — tests/runs.mjs
  const r = playRun(R); assert.ok(R.ok(r), `${R.name}: ${describe(r)}`);
});
test('команды: нельзя строить без душ, продажа возвращает 70%', () => {
  const S = SIM.create(); S.souls = 50; SIM.step(S, { cmds: [{ k: 'build', slot: 0, type: 'bones' }] }); assert.equal(S.towers[0], null);
  S.souls = 1000; SIM.step(S, { cmds: [{ k: 'build', slot: 0, type: 'dark' }, { k: 'upgrade', slot: 0 }] });
  assert.equal(S.towers[0].lvl, 2); const inv = S.towers[0].invested, before = S.souls;
  SIM.step(S, { cmds: [{ k: 'sell', slot: 0 }] }); assert.equal(S.souls - before, Math.floor(inv * 0.7)); assert.equal(S.towers[0], null);
});
test('состояние сериализуется в JSON без потерь (сейв)', () => {
  const S = SIM.create(3); SIM.step(S, { cmds: [{ k: 'build', slot: 11, type: 'plague' }, { k: 'call' }] });
  for (let i = 0; i < 120 * 20; i++) SIM.step(S, null);
  const R = JSON.parse(JSON.stringify(S)); for (let i = 0; i < 120 * 30; i++) { SIM.step(S, null); SIM.step(R, null); }
  assert.deepEqual(R, S);
});
