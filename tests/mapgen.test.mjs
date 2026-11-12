// node --test tests/ — генератор карты: годность на 1000 сидах, детерминизм, проверка карты.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const MAPGEN = require('../live/mapgen.js');

const COLS = 25, ROWS = 14;
const xy = (i) => [i % COLS, Math.floor(i / COLS)];
const MAPS = new Map(), mapOf = (seed) => MAPS.get(seed) || MAPS.set(seed, MAPGEN.generate(seed)).get(seed);   // 1000 карт строятся один раз на все тесты
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
    const m = mapOf(seed), road = m.road;
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

test('генератор на 1000 сидах: вход не ближе 8 клеток к склепу, склеп не ближе 2 клеток к краю', () => {
  for (let seed = 1; seed <= 1000; seed++) {
    const road = mapOf(seed).road, [gx, gy] = xy(road[0]), [kx, ky] = xy(road[road.length - 1]);
    assert.ok(Math.hypot(gx - kx, gy - ky) >= 8, `сид ${seed}: вход ${gx},${gy} — склеп ${kx},${ky}`);
    assert.ok(Math.min(kx, COLS - 1 - kx, ky, ROWS - 1 - ky) >= 2, `сид ${seed}: склеп у края ${kx},${ky}`);
  }
});

// метрики качества по 1000 сидам (как у критика: пустая клетка — дальше 2 клеток от дороги по Чебышёву)
let memo = null;
const quality = () => memo || (memo = (() => {
  let sq6 = 0, edge4 = 0, row1 = 0, long8 = 0, seg2 = 0, segs = 0;
  for (let seed = 1; seed <= 1000; seed++) {
    const road = mapOf(seed).road, cells = road.map(xy);
    const sq = new Array(COLS * ROWS).fill(0); let big = 0;
    for (let i = 0; i < COLS * ROWS; i++) { const x = i % COLS, y = Math.floor(i / COLS);
      if (cells.some(([a, b]) => Math.max(Math.abs(a - x), Math.abs(b - y)) <= 2)) continue;
      sq[i] = x && y ? 1 + Math.min(sq[i - 1], sq[i - COLS], sq[i - COLS - 1]) : 1; big = Math.max(big, sq[i]); }
    if (big >= 6) sq6++;
    if (cells.filter(([x, y]) => x === 0 || y === 0 || x === COLS - 1 || y === ROWS - 1).length >= 4) edge4++;
    if (cells.filter(([, y]) => y === 1).length >= 3) row1++;
    let run = 1, mx = 0;
    for (let k = 2; k <= road.length; k++) {
      if (k === road.length || road[k - 1] - road[k - 2] !== road[k] - road[k - 1]) { segs++; if (run === 2) seg2++; mx = Math.max(mx, run); run = 1; } else run++; }
    if (mx >= 8) long8++;
  }
  return { sq6: sq6 / 1000, edge4: edge4 / 1000, row1: row1 / 1000, long8: long8 / 1000, seg2: seg2 / segs };
})());

test('качество карт: мало пустых углов и дороги у края экрана и вплотную под HUD', () => {
  const q = quality();
  assert.ok(q.sq6 <= 0.10, 'пустой квадрат 6×6+ на доле карт ' + q.sq6);
  assert.ok(q.edge4 <= 0.15, '4+ клеток дороги на краю на доле карт ' + q.edge4);
  assert.ok(q.row1 <= 0.20, '3+ клеток дороги вплотную под HUD на доле карт ' + q.row1);
});

test('качество карт: есть длинные прямые, коротких ступенек немного', () => {
  const q = quality();
  assert.ok(q.long8 >= 0.25, 'доля карт с прямой 8+ клеток ' + q.long8);
  assert.ok(q.seg2 <= 0.20, 'доля отрезков в 2 клетки ' + q.seg2);
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
  // склеп в двух клетках от входа и у края поля
  const nv = MAPGEN.validate({ cols: COLS, rows: ROWS, road: [13 * COLS + 5, 12 * COLS + 5, 11 * COLS + 5, 11 * COLS + 6, 11 * COLS + 7, 12 * COLS + 7] });
  assert.ok(nv.some((s) => /склеп/.test(s) && /вход/.test(s)), 'склеп у входа не замечен: ' + nv.join('; '));
  assert.ok(nv.some((s) => /склеп/.test(s) && /кра/.test(s)), 'склеп у края не замечен: ' + nv.join('; '));
  // дорога по верхней строке уходит под HUD
  const top = []; for (let x = 0; x < 20; x++) top.push(x);
  assert.ok(MAPGEN.validate({ cols: COLS, rows: ROWS, road: top }).some((s) => /HUD/.test(s)), 'дорога под HUD не замечена');
});
