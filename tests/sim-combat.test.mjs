import test from 'node:test';
import assert from 'node:assert/strict';
import SIM from '../live/sim.js';

const C = SIM.CONFIG;

test('новая симуляция создаёт независимую партию с годной картой, самопроверка обнаруживает испорченную дорогу', () => {
  const game = SIM.spawn();
  assert.deepEqual(game, SIM.create());
  assert.deepEqual(SIM.selfCheck(), []);
  assert.equal(SIM.outOfPlay(game), false);
  const other = SIM.spawn();
  game.map.road = null;
  assert.ok(SIM.selfCheck(game).length);
  assert.deepEqual(SIM.selfCheck(other), []);
});

test('обратный отсчёт доступен между волнами только при включённом автоплее и наличии следующей волны', () => {
  const game = SIM.create(17, { dt: 1 / 30 });
  SIM.doCmd(game, { k: 'auto', on: true });
  assert.equal(SIM.autoIn(game), null);
  assert.equal(SIM.relicOffer(game), null);
  SIM.doCmd(game, { k: 'call' });
  assert.equal(SIM.autoIn(game), null);
  game.qi = game.queue.length;
  SIM.step(game);
  assert.equal(SIM.autoIn(game), C.RUN_CONTROL.autoDelay);
  SIM.step(game);
  assert.equal(SIM.autoIn(game), C.RUN_CONTROL.autoDelay - game.dt);
  SIM.doCmd(game, { k: 'auto', on: false });
  assert.equal(SIM.autoIn(game), null);
  SIM.doCmd(game, { k: 'auto', on: true });
  game.wave = SIM.waveCount();
  assert.equal(SIM.autoIn(game), null);
});

test('при равном уроне склепу выше стоит более многочисленная группа', () => {
  const game = SIM.create(17);
  game.leakBy = { cart: 2, paladin: 1, militia: 6, knight: 1 };
  game.waveLeakBy = { paladin: 1, cart: 2 };
  assert.deepEqual(SIM.leakReport(game).map(row => [row.type, row.hp]),
    [['militia', 6], ['cart', 6], ['paladin', 6], ['knight', 1]]);
  assert.deepEqual(SIM.waveLeakReport(game).map(row => row.type), ['cart', 'paladin']);
});

// Подготовить заданный отряд, сохранив штатное создание врагов и их боевые характеристики.
function deploy(game, types) {
  SIM.doCmd(game, { k: 'call' });
  game.queue = types.map(e => ({ at: 0, e }));
  SIM.step(game);
  return game.enemies;
}

test('пронзание двойного луча при равных расстояниях выбирает меньший id, за повторно поражённую цель платят один раз', () => {
  const game = SIM.create(17);
  game.souls = 1000;
  const cell = SIM.rankCells(game, 3)[0];
  SIM.doCmd(game, { k: 'build', cell, type: 'dark' });
  const tower = game.towers[cell];
  const [main, first, second, distant] = deploy(game, ['militia', 'militia', 'militia', 'militia']);
  for (const enemy of [first, second]) Object.assign(enemy, { x: main.x, y: main.y, hp: 7 });
  distant.x = main.x + 1;
  distant.hp = 6;
  const hp = main.hp, souls = game.souls;
  // Намеренно меняем порядок обхода: решение при равенстве зависит от id.
  game.enemies.reverse();
  const stats = { ...SIM.towerStats(game, tower), dmg: 10, split: 0.5 };
  SIM.ATTACKS.beam.run(game, tower, stats, game.enemies.slice(), ...SIM.muzzle(game, tower),
    { kind: 'magic', pierceN: 1, pierceK: 0.75 });
  assert.equal(main.hp, hp - 10);
  assert.equal(first.dead, true);
  assert.equal(second.hp, 7);
  assert.equal(distant.hp, 6);
  assert.equal(game.stats.kills, 1);
  assert.equal(game.souls, souls + first.bounty);
  assert.equal(tower.kills, 1);
});

test('легион на единственной доступной клетке дороги размещает трёх скелетов в центре и по сторонам', () => {
  const game = SIM.create(17, { dt: 1 / 30 });
  game.souls = 10000;
  const cell = game.towers.findIndex((_, cell) => SIM.canBuild(game, cell, 'barracks').ok &&
    SIM.skelCells(game, { cell }, SIM.buildStats(game, cell, 'barracks')).length === 1);
  assert.ok(cell >= 0);
  SIM.doCmd(game, { k: 'build', cell, type: 'barracks' });
  for (let i = 0; i < C.PERK_AT; i++) SIM.doCmd(game, { k: 'upgrade', cell, track: i % 2 ? 'dmg' : 'rate' });
  SIM.doCmd(game, { k: 'perk', cell, p: 'legion' });
  const tower = game.towers[cell], stats = SIM.towerStats(game, tower);
  assert.equal(stats.limit, 3);
  const steps = Math.ceil((1 + stats.limit * stats.rate) / game.dt);
  for (let i = 0; i < steps; i++) SIM.step(game);
  const [road] = SIM.skelCells(game, tower);
  const [x, y] = SIM.cellXY(game, road);
  assert.deepEqual(game.skels.map(s => s.cell), [road, road, road]);
  const [center, right, left] = game.skels;
  assert.deepEqual([center.x, center.y], [x, y]);
  assert.ok(right.x > x && left.x < x);
  assert.equal(right.x - x, x - left.x);
  assert.equal(right.y, left.y);
});

test('базовые правила дуэли: физический удар скелета учитывает броню, противник без своего melee наносит общий урон', t => {
  const game = SIM.create(17);
  const cell = SIM.rankCells(game, 3)[0];
  SIM.doCmd(game, { k: 'build', cell, type: 'barracks' });
  const tower = game.towers[cell], stats = SIM.towerStats(game, tower);
  SIM.ATTACKS.summon.run(game, tower, stats);
  const skel = game.skels[0];
  const [enemy] = deploy(game, ['knight']);
  const previous = C.ENEMIES.knight;
  C.ENEMIES.knight = { ...previous };
  delete C.ENEMIES.knight.melee;
  t.after(() => { C.ENEMIES.knight = previous; });
  delete skel.fx;
  Object.assign(enemy, { x: skel.x, y: skel.y, d: 0 });
  const hp = enemy.hp, skelHp = skel.hp;
  SIM.step(game);
  assert.equal(skel.foe, enemy.id);
  assert.equal(enemy.hp, hp - skel.dmg * (1 - enemy.armor));
  assert.equal(skel.hp, skelHp - C.MELEE * game.dt);
});

// Демо выбирает по описанию волны и запускает её тем же генератором. Подставляем
// маленькие детерминированные отряды, чтобы за один цикл увидеть несколько зачисток.
function demoWaves(t, describe) {
  const generate = SIM.WAVEGEN.wave;
  const waves = new Map();
  for (let n = 5; n <= 12; n++) {
    const original = generate(99, n), { count, duration, boss } = describe(n);
    waves.set(n, { ...original, boss, duration, total: { ...original.total, count },
      squads: [{ type: 'militia', count, at: count === 1 ? duration : 0, gap: count > 1 ? duration / (count - 1) : 0 }] });
  }
  return t.mock.method(SIM.WAVEGEN, 'wave', (seed, n) => waves.get(n) ?? generate(seed, n));
}

test('демо среди слишком длинных волн выбирает самую людную без босса, при равенстве берёт раннюю', t => {
  demoWaves(t, n => ({
    count: n === 5 ? 4 : n === 6 || n === 8 ? 2 : 1,
    duration: n + SIM.L,
    boss: n === 5,
  }));
  const state = SIM.at(0);
  assert.equal(state.demoWave, 6);
  assert.equal(state.hp, 16);
});

for (const selected of [5, 10]) {
  test(`демо повторяет волну ${selected} после зачистки без остановки на выборе реликвии`, t => {
    // На одних балансных данных все кандидаты — боссы (запасная волна 5),
    // на других десятая — единственный кандидат без босса.
    demoWaves(t, n => ({ count: 1, duration: 0, boss: selected === 5 || n !== selected }));
    const state = SIM.at(selected * SIM.L);
    assert.equal(state.demoWave, selected);
    assert.ok(state.stats.kills > 1, 'башни должны убивать и в повторных волнах');
    assert.ok(['prep', 'wave'].includes(state.phase));
    assert.equal(state.offer, null);
  });
}
