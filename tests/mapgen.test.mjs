// node --test tests/ — генератор карты: годность на 1000 сидах, детерминизм, проверка карты.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const MAPGEN = require('../live/mapgen.js');

const COLS = 25, ROWS = 14;
const xy = (i) => [i % COLS, Math.floor(i / COLS)];
const turnsOf = (road) => { let n = 0;
  for (let k = 2; k < road.length; k++) { const [a, b, c] = [xy(road[k - 2]), xy(road[k - 1]), xy(road[k])];
    if (b[0] - a[0] !== c[0] - b[0] || b[1] - a[1] !== c[1] - b[1]) n++; }
  return n; };

test('карта: поле 25×14, вход на краю, дорога из соседних по стороне клеток', () => {
  const m = MAPGEN.generate(1);
  assert.equal(m.cols, COLS); assert.equal(m.rows, ROWS);
  const [x0, y0] = xy(m.road[0]);
  assert.ok(x0 === 0 || y0 === 0 || x0 === COLS - 1 || y0 === ROWS - 1, 'вход не на краю: ' + [x0, y0]);
  for (let k = 1; k < m.road.length; k++) { const [a, b] = [xy(m.road[k - 1]), xy(m.road[k])];
    assert.equal(Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]), 1, `разрыв дороги на ${k}`); }
});

test('генератор на 1000 сидах: длина 45–70, не меньше 8 поворотов, без самопересечений и касаний витков', () => {
  for (let seed = 1; seed <= 1000; seed++) {
    const m = MAPGEN.generate(seed), road = m.road;
    assert.deepEqual(MAPGEN.validate(m), [], 'сид ' + seed);
    assert.ok(road.length >= 45 && road.length <= 70, `сид ${seed}: длина ${road.length}`);
    assert.ok(turnsOf(road) >= 8, `сид ${seed}: поворотов ${turnsOf(road)}`);
    assert.equal(new Set(road).size, road.length, `сид ${seed}: самопересечение`);
    const at = new Map(road.map((c, k) => [c, k]));
    for (const [k, c] of road.entries()) { const [x, y] = xy(c);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue; const j = at.get(ny * COLS + nx);
        if (j !== undefined) assert.equal(Math.abs(j - k), 1, `сид ${seed}: витки ${k} и ${j} касаются боками`); } }
  }
});

test('один сид — одна и та же карта, разные сиды — разные карты', () => {
  assert.deepEqual(MAPGEN.generate(42), MAPGEN.generate(42));
  assert.deepEqual(JSON.parse(JSON.stringify(MAPGEN.generate(42))), MAPGEN.generate(42));
  const roads = new Set(); for (let s = 1; s <= 50; s++) roads.add(MAPGEN.generate(s).road.join(','));
  assert.ok(roads.size >= 48, 'мало разных карт: ' + roads.size);
});

test('проверка карты возвращает список нарушений', () => {
  const good = MAPGEN.generate(7);
  const short = Object.assign({}, good, { road: good.road.slice(0, 20) });
  assert.ok(MAPGEN.validate(short).some((s) => /длина/.test(s)), 'короткая дорога не замечена');
  // разрыв: выкидываем клетку из середины
  const gap = Object.assign({}, good, { road: good.road.filter((_, k) => k !== 25) });
  assert.ok(MAPGEN.validate(gap).some((s) => /разрыв/.test(s)), 'разрыв не замечен');
  // самопересечение: повтор клетки
  const loop = Object.assign({}, good, { road: [...good.road, good.road[good.road.length - 2]] });
  assert.ok(MAPGEN.validate(loop).some((s) => /самопересечение/.test(s)), 'самопересечение не замечено');
  // прямая змейка из узких U-поворотов: витки касаются боками, поворотов хватает
  const snake = []; for (let y = 0; y < 6; y++) for (let x = 0; x < 10; x++) snake.push(y * COLS + (y % 2 ? 9 - x : x));
  const v = MAPGEN.validate({ cols: COLS, rows: ROWS, road: snake });
  assert.ok(v.some((s) => /касаются/.test(s)), 'касание витков не замечено: ' + v.join('; '));
  // прямая дорога: мало поворотов, вход не на краю
  const straight = []; for (let x = 2; x < 24; x++) straight.push(5 * COLS + x);
  const w = MAPGEN.validate({ cols: COLS, rows: ROWS, road: straight });
  assert.ok(w.some((s) => /поворот/.test(s)), 'мало поворотов не замечено');
  assert.ok(w.some((s) => /вход/.test(s)), 'вход не на краю не замечен');
  // дорога по верхней строке уходит под HUD
  const top = []; for (let x = 0; x < 20; x++) top.push(x);
  assert.ok(MAPGEN.validate({ cols: COLS, rows: ROWS, road: top }).some((s) => /HUD/.test(s)), 'дорога под HUD не замечена');
});
