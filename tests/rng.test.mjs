// node --test tests/*.test.mjs — случайность от сида забега: независимые именованные потоки, детерминизм, состояние в JSON.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const RNG = require('../live/rng.js');

const take = (f, n) => Array.from({ length: n }, f);

test('неназванный поток имеет номер 0 и сохраняет последовательность для старых сидов', () => {
  assert.equal(RNG.seed(0), 2388540327);
  assert.equal(RNG.seed(0, '', 0), RNG.seed(0));
  const next = RNG.stream(0);
  assert.deepEqual(take(() => next() * 2 ** 32, 3), [336309845, 3768188672, 864577953]);
});

test('поток от сида и имени детерминирован, значения в [0, 1)', () => {
  const a = take(RNG.stream(42, 'waves'), 50), b = take(RNG.stream(42, 'waves'), 50);
  assert.deepEqual(a, b);
  assert.ok(a.every((v) => v >= 0 && v < 1));
  assert.ok(new Set(a).size === 50);
});

test('потоки разных имён, сидов и номеров независимы', () => {
  const seq = (...k) => take(RNG.stream(...k), 8).join(',');
  const all = [seq(42, 'map'), seq(42, 'waves'), seq(42, 'relics'), seq(43, 'waves'), seq(42, 'map', 1), seq(42, 'map', 2)];
  assert.equal(new Set(all).size, all.length);
});

test('поток с состоянием в объекте: JSON-копия продолжает ту же последовательность', () => {
  const S = { rs: RNG.seed(7, 'battle') }, first = take(() => RNG.next(S, 'rs'), 5);
  const R = JSON.parse(JSON.stringify(S));
  assert.deepEqual(take(() => RNG.next(S, 'rs'), 5), take(() => RNG.next(R, 'rs'), 5));
  assert.deepEqual(first, take(RNG.stream(7, 'battle'), 5));
});
