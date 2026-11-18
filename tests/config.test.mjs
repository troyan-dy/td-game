import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import SIM from '../live/sim.js';

// Игра загружает модули как обычные скрипты. У каждого теста свой конфиг и кэши.
const scripts = ['config', 'rng', 'mapgen', 'wavegen', 'sim', 'meta'].map((name) => {
  const url = new URL(`../live/${name}.js`, import.meta.url);
  return { name, url, source: readFileSync(url, 'utf8') };
});

function loadRules(configure) {
  const world = createContext({ window: {} });
  for (const { name, url, source } of scripts) {
    runInContext(source, world, { filename: url.href });
    if (name === 'config' && configure) configure(world.window.CONFIG);
  }
  return world.window;
}

test('игровые модули без CommonJS создают тот же забег и проверяют его сохранение', () => {
  const { SIM: game, META: meta, CONFIG: config } = loadRules();
  const seed = 7;
  const state = game.create(seed);
  assert.equal(game.CONFIG, config);
  assert.deepEqual(JSON.parse(JSON.stringify(state)), JSON.parse(JSON.stringify(SIM.create(seed))));
  assert.equal(game.loadable(state), true);
  assert.equal(meta.fresh().runs, 0);
});

test('неоднозначные идентификаторы в конфиге отвергаются до начала забега', () => {
  const perk = Object.keys(SIM.CONFIG.TOWERS.bones.perks)[0];
  assert.throws(() => loadRules((c) => { c.TOWERS.dark.perks[perk] = c.TOWERS.bones.perks[perk]; }),
    new RegExp(`перк ${perk} есть у bones и у dark`));
  assert.throws(() => loadRules((c) => { c.RELICS.bones = {}; }), /реликвия bones совпадает по id с башней/);
  assert.throws(() => loadRules((c) => { c.TRACKS.push('bones'); }), /линия Гримуара bones повторяется/);
});

for (const type of ['bones', 'dark']) {
  test(`ошибка подготовки образца башни для сейва называет проблемный тип ${type}`, () => {
    const { SIM: game } = loadRules((c) => { c.TOWERS[type].base.cost = 2e9; });
    assert.throws(() => game.loadable(game.create(7)), new RegExp(`не создался образец башни ${type}`));
  });
}
