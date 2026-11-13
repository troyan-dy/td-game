// node --test tests/*.test.mjs — управление забегом: волна сама не начинается, автоплей (команда, задержка, первая волна,
// выбор реликвии, победа и бесконечный режим), окно «Нетерпения», время забега только в волнах, детерминизм и сейв.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SIM } from './bots.mjs';
const C = SIM.CONFIG, RC = C.RUN_CONTROL, RUN = SIM.waveCount();

const json = (S) => JSON.parse(JSON.stringify(S));
const run = (S, sec) => { const n = Math.round(sec / S.dt); for (let i = 0; i < n; i++) SIM.step(S, null); };
const cmd = (S, ...cmds) => SIM.step(S, { cmds });
// волна отбита сразу: вызвать, убрать её врагов, шаг — зачистка
const clearWave = (S) => { cmd(S, { k: 'call' }); S.qi = S.queue.length; S.enemies = []; S.shots = []; SIM.step(S, null); };
// идущая волна зачищена на следующем шаге (без вызова)
const finish = (S) => { S.qi = S.queue.length; S.enemies = []; S.shots = []; SIM.step(S, null); };

test('числа управления забегом — в конфиге', () => {
  assert.ok(RC.autoDelay > 0 && RC.autoDelay <= 10, 'задержка автоплея ' + RC.autoDelay);
  assert.ok(RC.hasteWindow > RC.autoDelay, 'окно Нетерпения ' + RC.hasteWindow);
  assert.equal(C.RELICS.haste.window, RC.hasteWindow, 'окно в описании реликвии — из того же блока');
  assert.equal(C.PREP_TIME, undefined, 'таймера паузы между волнами больше нет');
});

test('без автоплея волна сама не начинается, сколько бы ни прошло времени', () => {
  const S = SIM.create(3, { dt: 1 / 30 });
  assert.equal(S.auto, false, 'автоплей по умолчанию выключен');
  run(S, 120); assert.equal(S.phase, 'prep'); assert.equal(S.wave, 0);
  clearWave(S); assert.equal(S.phase, 'prep'); assert.equal(S.wave, 1);
  run(S, 600); assert.equal(S.phase, 'prep', 'волна началась сама'); assert.equal(S.wave, 1);
  cmd(S, { k: 'call' }); assert.equal(S.phase, 'wave'); assert.equal(S.wave, 2);
});

test('автоплей: следующая волна через задержку из конфига после зачистки; первая — только по кнопке', () => {
  const S = SIM.create(3, { dt: 1 / 30 });
  cmd(S, { k: 'auto', on: true }); assert.equal(S.auto, true);
  run(S, 60); assert.equal(S.wave, 0, 'первая волна забега началась без кнопки');
  clearWave(S); assert.equal(S.phase, 'prep');
  run(S, RC.autoDelay - 0.2); assert.equal(S.phase, 'prep', 'раньше задержки');
  run(S, 0.4); assert.equal(S.phase, 'wave', 'после задержки волна не началась'); assert.equal(S.wave, 2);
  // команда без on — переключение; выключенный автоплей не стартует волну, повторное включение — отсчёт заново
  finish(S); run(S, RC.autoDelay / 2); cmd(S, { k: 'auto' }); assert.equal(S.auto, false);
  run(S, RC.autoDelay * 4); assert.equal(S.phase, 'prep', 'выключенный автоплей начал волну');
  cmd(S, { k: 'auto', on: true }); run(S, RC.autoDelay - 0.2); assert.equal(S.phase, 'prep', 'отсчёт после включения не с начала');
  run(S, 0.4); assert.equal(S.phase, 'wave'); assert.equal(S.wave, 3);
  // повторное «включить» не сбивает идущий отсчёт
  finish(S); run(S, RC.autoDelay - 0.5); cmd(S, { k: 'auto', on: true }); run(S, 0.6); assert.equal(S.phase, 'wave', 'повторное включение сбросило отсчёт');
});

test('автоплей ждёт игрока на выборе реликвии и на экране победы; первая волна бесконечного режима — по кнопке', () => {
  const S = SIM.create(11, { dt: 1 / 30 }); cmd(S, { k: 'auto', on: true });
  while (S.wave < 5) clearWave(S);
  assert.equal(S.phase, 'relic'); run(S, 60); assert.equal(S.phase, 'relic', 'автоплей пропустил выбор реликвии'); assert.equal(S.wave, 5);
  cmd(S, { k: 'relic', i: 0 }); assert.equal(S.phase, 'prep');
  run(S, RC.autoDelay + 0.1); assert.equal(S.phase, 'wave', 'после выбора автоплей не продолжил'); assert.equal(S.wave, 6);
  const W = SIM.create(5, { dt: 1 / 30 }); W.wave = RUN - 1; cmd(W, { k: 'auto', on: true }, { k: 'call' }); finish(W);
  assert.equal(W.phase, 'won'); run(W, 60); assert.equal(W.phase, 'won', 'автоплей ушёл с экрана победы');
  cmd(W, { k: 'endless' }); assert.equal(W.phase, 'prep'); assert.equal(W.auto, true);
  run(W, 60); assert.equal(W.wave, RUN, 'первая волна бесконечного режима началась сама');
  cmd(W, { k: 'call' }); finish(W); assert.equal(W.phase, 'prep');
  run(W, RC.autoDelay + 0.1); assert.equal(W.wave, RUN + 2, 'в бесконечном режиме автоплей не идёт');
});

test('автоплей переключается в любой фазе и не мешает командам; забег детерминирован', () => {
  const play = () => { const S = SIM.create(8, { dt: 1 / 30 }); const cells = SIM.rankCells(S, C.TYPICAL_RANGE); S.souls = 3000;
    cmd(S, ...cells.slice(0, 6).map((cell, i) => ({ k: 'build', cell, type: C.TOWER_ORDER[i % 4] })), { k: 'call' }, { k: 'auto', on: true });
    run(S, 120); cmd(S, { k: 'auto', on: false }); run(S, 20); cmd(S, { k: 'auto', on: true }); run(S, 60); return S; };
  const A = play(), B = play();
  assert.ok(A.wave >= 3, 'волна ' + A.wave); assert.deepEqual(json(A), json(B));
  const L = SIM.create(2); L.phase = 'lost'; cmd(L, { k: 'auto', on: true }); assert.equal(L.auto, true);
});

test('время забега считает только идущие волны, без ожидания между ними', () => {
  const S = SIM.create(3, { dt: 1 / 30 });
  run(S, 50); assert.equal(S.stats.time, 0, 'ожидание до первой волны вошло во время');
  cmd(S, { k: 'call' }); run(S, 2);
  const t = S.stats.time; assert.ok(Math.abs(t - 2) < 0.1, 'время волны ' + t);
  finish(S); const t2 = S.stats.time; run(S, 100); assert.equal(S.stats.time, t2, 'ожидание между волнами вошло во время');
});

test('Нетерпение: призыв волны в окне после зачистки — души за оставшиеся секунды; автоплей и конец окна — без душ', () => {
  const RL = C.RELICS.haste;
  const at = (sec, auto) => { const S = SIM.create(4, { dt: 1 / 30 }); S.relics = ['haste']; clearWave(S);
    if (auto) cmd(S, { k: 'auto', on: true }); run(S, sec); return S; };
  const A = at(4.3), left = A.hasteT, a = A.souls;
  assert.ok(Math.abs(left - (RL.window - 4.3)) < 0.05, 'окно ' + left);
  cmd(A, { k: 'call' }); assert.equal(A.souls - a, Math.floor(left * RL.perSec));
  assert.ok(A.ev.some((e) => e.k === 'haste'));
  const late = at(RL.window + 1), b = late.souls; assert.equal(late.hasteT, 0); cmd(late, { k: 'call' }); assert.equal(late.souls, b, 'души после конца окна');
  const auto = at(0, true), c = auto.souls; run(auto, RC.autoDelay + 0.1); assert.equal(auto.phase, 'wave'); assert.ok(!auto.ev.some((e) => e.k === 'haste'), 'автоплей получил души Нетерпения');
  assert.ok(auto.souls - c < Math.floor((RL.window - RC.autoDelay) * RL.perSec));
  const none = SIM.create(4, { dt: 1 / 30 }); clearWave(none); run(none, 2); const d = none.souls; cmd(none, { k: 'call' }); assert.equal(none.souls, d, 'без реликвии души за ранний призыв');
});

test('сейв: автоплей, его отсчёт и окно Нетерпения переживают JSON; забег продолжается так же', () => {
  const S = SIM.create(6, { dt: 1 / 30 }); cmd(S, { k: 'auto', on: true }); clearWave(S); run(S, 1);
  const base = json(S), J = json(S); assert.equal(SIM.loadable(J), true); assert.equal(J.auto, true);
  run(S, 30); run(J, 30); assert.deepEqual(json(J), json(S));
  assert.equal(S.wave, 2, 'автоплей после сейва не начал волну');
  for (const [name, spoil] of Object.entries({
    'отсчёт автоплея длиннее задержки': (X) => { X.autoT = RC.autoDelay * 3; },
    'отрицательный отсчёт автоплея (не −1)': (X) => { X.autoT = -0.5; },
    'окно Нетерпения длиннее окна': (X) => { X.hasteT = RC.hasteWindow * 2; },
    'автоплей — не булево': (X) => { X.auto = 1; },
    'отсчёт автоплея у первой волны': (X) => { X.wave = 0; X.autoT = 1; },
  })) { const X = json(base); spoil(X); assert.equal(SIM.loadable(X), false, name); }
});
