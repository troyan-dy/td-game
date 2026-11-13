// node --test tests/*.test.mjs — генератор карты: годность на N = 200 сидах, детерминизм, проверка карты.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const MAPGEN = require('../live/mapgen.js');
const C = require('../live/config.js');

const COLS = 25, ROWS = 14;
const xy = (i) => [i % COLS, Math.floor(i / COLS)];
const N = 200;                                                                  // сидов в тестах на множестве карт
const MAPS = new Map(), mapOf = (seed) => MAPS.get(seed) || MAPS.set(seed, MAPGEN.generate(seed)).get(seed);   // карты строятся один раз на все тесты
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

test('генератор на N сидах: длина 45–70, не меньше 8 поворотов, без самопересечений и касаний витков', () => {
  for (let seed = 1; seed <= N; seed++) {
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

test('генератор на N сидах: вход не ближе 8 клеток к склепу, склеп не ближе 2 клеток к краю', () => {
  for (let seed = 1; seed <= N; seed++) {
    const road = mapOf(seed).road, [gx, gy] = xy(road[0]), [kx, ky] = xy(road[road.length - 1]);
    assert.ok(Math.hypot(gx - kx, gy - ky) >= 8, `сид ${seed}: вход ${gx},${gy} — склеп ${kx},${ky}`);
    assert.ok(Math.min(kx, COLS - 1 - kx, ky, ROWS - 1 - ky) >= 2, `сид ${seed}: склеп у края ${kx},${ky}`);
  }
});

// метрики качества по N сидам (как у критика: пустая клетка — дальше 2 клеток от дороги по Чебышёву)
let memo = null;
const quality = () => memo || (memo = (() => {
  let sq6 = 0, edge4 = 0, row1 = 0, long8 = 0, seg2 = 0, segs = 0;
  for (let seed = 1; seed <= N; seed++) {
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
  return { sq6: sq6 / N, edge4: edge4 / N, row1: row1 / N, long8: long8 / N, seg2: seg2 / segs };
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

// клетки под интерфейсом (HUD, кнопка волны, карточки) — не игровые, в «свободные» не входят
const HUD = [[0, 0, 25, 1], [0, 2, 4, 2], [0, 12, 8, 2]];
const isHud = (i) => { const [x, y] = xy(i); return HUD.some(([kx, ky, kw, kh]) => x >= kx && y >= ky && x < kx + kw && y < ky + kh); };
const nearRoad = (road, i, r = 2) => { const [x, y] = xy(i); return road.some((c) => { const [a, b] = xy(c); return Math.max(Math.abs(a - x), Math.abs(b - y)) <= r; }); };

test('препятствия на N сидах: 8–15% свободных клеток, у дороги остаётся не меньше 40 свободных', () => {
  let minShare = 1, maxShare = 0, minNear = Infinity;
  for (let seed = 1; seed <= N; seed++) {
    const m = mapOf(seed), road = new Set(m.road), obst = m.obstacles.map((o) => o.cell);
    const free = []; for (let i = 0; i < COLS * ROWS; i++) if (!road.has(i) && !isHud(i)) free.push(i);
    assert.equal(new Set(obst).size, obst.length, `сид ${seed}: препятствия повторяются`);
    for (const c of obst) assert.ok(free.includes(c), `сид ${seed}: препятствие ${c} на дороге или под интерфейсом`);
    const share = obst.length / free.length; minShare = Math.min(minShare, share); maxShare = Math.max(maxShare, share);
    assert.ok(share >= 0.08 && share <= 0.15, `сид ${seed}: препятствий ${(share * 100).toFixed(1)}%`);
    const near = free.filter((i) => !obst.includes(i) && nearRoad(m.road, i)).length; minNear = Math.min(minNear, near);
    assert.ok(near >= 40, `сид ${seed}: у дороги свободно ${near}`);
  }
  assert.ok(maxShare - minShare > 0.03, `доля препятствий не меняется от сида: ${minShare}–${maxShare}`);
});

test('особые клетки на N сидах: 4–6 штук, все в пределах двух клеток от дороги, на свободных клетках, все три вида', () => {
  const counts = new Set();
  for (let seed = 1; seed <= N; seed++) {
    const m = mapOf(seed), road = new Set(m.road), obst = new Set(m.obstacles.map((o) => o.cell)), sp = m.specials;
    counts.add(sp.length);
    assert.ok(sp.length >= 4 && sp.length <= 6, `сид ${seed}: особых клеток ${sp.length}`);
    assert.equal(new Set(sp.map((s) => s.cell)).size, sp.length, `сид ${seed}: особые клетки повторяются`);
    for (const s of sp) {
      assert.ok(['mound', 'well', 'cursed'].includes(s.kind), `сид ${seed}: вид ${s.kind}`);
      assert.ok(!road.has(s.cell) && !obst.has(s.cell) && !isHud(s.cell), `сид ${seed}: особая клетка ${s.cell} не свободна`);
      assert.ok(nearRoad(m.road, s.cell), `сид ${seed}: особая клетка ${s.cell} дальше двух клеток от дороги`);
    }
    assert.deepEqual(new Set(sp.map((s) => s.kind)), new Set(['mound', 'well', 'cursed']), `сид ${seed}: не все виды`);
  }
  assert.ok(counts.size >= 2, 'число особых клеток не меняется от сида');
});

// ---- арка, склеп, досягаемость особых клеток, узловые клетки
const cheb = (a, b) => { const [x, y] = xy(a), [u, v] = xy(b); return Math.max(Math.abs(x - u), Math.abs(y - v)); };
const kindCells = (m, kind) => m.obstacles.filter((o) => o.kind === kind).map((o) => o.cell).sort((a, b) => a - b);
// путь врагов (полилиния в px) и расстояние от центра клетки до него
const distToRoute = (m, i) => { const P = MAPGEN.route(m), [x, y] = MAPGEN.cellXY(m, i); let d = Infinity;
  for (let k = 1; k < P.length; k++) { const [a, b] = [P[k - 1], P[k]], dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy || 1;
    const u = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / L)); d = Math.min(d, Math.hypot(x - a[0] - dx * u, y - a[1] - dy * u)); }
  return d; };
// направление последнего шага дороги (куда идут враги в склепе)
const lastDir = (m) => { const [e, p] = [m.road[m.road.length - 1], m.road[m.road.length - 2]], [x, y] = xy(e), [u, v] = xy(p); return [x - u, y - v]; };

test('арка входа на N сидах: два столба по бокам от входа поперёк дороги', () => {
  for (let seed = 1; seed <= N; seed++) {
    const m = mapOf(seed), g = m.road[0], [x, y] = xy(g), side = x === 0 || x === COLS - 1;
    const want = (side ? [[x, y - 1], [x, y + 1]] : [[x - 1, y], [x + 1, y]]).map(([a, b]) => b * COLS + a).sort((a, b) => a - b);
    assert.deepEqual(kindCells(m, 'arch'), want, `сид ${seed}: столбы арки`);
  }
});

test('склеп на N сидах: занимает клетки вокруг себя, входом к дороге — клетки за склепом по ходу врагов и с боков от проёма', () => {
  const sizes = new Set();
  for (let seed = 1; seed <= N; seed++) {
    const m = mapOf(seed), e = m.road[m.road.length - 1], p = m.road[m.road.length - 2], [dx, dy] = lastDir(m), [x, y] = xy(e), cells = kindCells(m, 'crypt');
    sizes.add(cells.length);
    // клетки под интерфейсом не в счёт: склеп у кнопки волны (около 1% карт) теряет часть здания
    const byHud = [...Array(COLS * ROWS).keys()].some((i) => isHud(i) && cheb(i, e) === 1);
    assert.ok(cells.length >= (byHud ? 2 : 4), `сид ${seed}: склеп занимает ${cells.length} клеток`);
    for (const c of cells) assert.ok(cheb(c, e) === 1 && c !== p, `сид ${seed}: клетка склепа ${c} не вокруг склепа или на дороге`);
    // за склепом по ходу врагов — здание; проём смотрит на подходящий участок дороги (на клетку p)
    if (!isHud((y + dy) * COLS + x + dx)) assert.ok(cells.includes((y + dy) * COLS + x + dx), `сид ${seed}: за склепом (${x + dx},${y + dy}) нет здания`);
    // боковые клетки проёма (поперёк хода) — колонны портика
    for (const [a, b] of [[x + dy, y + dx], [x - dy, y - dx]]) if (!isHud(b * COLS + a)) assert.ok(cells.includes(b * COLS + a), `сид ${seed}: нет колонны (${a},${b})`);
  }
  assert.ok(sizes.size >= 2, 'склеп одинаковой формы при любом подходе дороги');
});

test('вплотную ко входу и склепу ничего, кроме арки и склепа, нет — ни препятствий, ни особых клеток', () => {
  for (let seed = 1; seed <= N; seed++) {
    const m = mapOf(seed), ends = [m.road[0], m.road[m.road.length - 1]];
    for (const o of m.obstacles) if (o.kind !== 'arch' && o.kind !== 'crypt') assert.ok(ends.every((e) => cheb(o.cell, e) > 1), `сид ${seed}: ${o.kind} у входа или склепа`);
    for (const s of m.specials) assert.ok(ends.every((e) => cheb(s.cell, e) > 1), `сид ${seed}: особая клетка у входа или склепа`);
  }
});

test('с каждой особой клетки до пути врагов достаёт башня с самым коротким базовым радиусом; особые не ближе 3 клеток друг к другу', () => {
  const minR = Math.min(...Object.values(C.TOWERS).filter((t) => t.attack).map((t) => t.base.range)) * C.UNIT;   // у башни без атаки (Алтарь) радиуса нет
  for (let seed = 1; seed <= N; seed++) {
    const m = mapOf(seed);
    for (const s of m.specials) assert.ok(distToRoute(m, s.cell) <= minR, `сид ${seed}: с особой клетки ${xy(s.cell)} до дороги ${distToRoute(m, s.cell).toFixed(0)} px > ${minR}`);
    for (const a of m.specials) for (const b of m.specials) if (a !== b) assert.ok(cheb(a.cell, b.cell) >= 3, `сид ${seed}: особые клетки ${xy(a.cell)} и ${xy(b.cell)} рядом`);
  }
});

test('цена решения: препятствия закрывают 20–30% узловых клеток (путь врагов в радиусе башни распадается на 2+ участка)', () => {
  const R = C.TYPICAL_RANGE * C.UNIT; let nodes = 0, shut = 0, low = 0;
  for (let seed = 1; seed <= N; seed++) {
    const m = mapOf(seed), P = MAPGEN.route(m), road = new Set(m.road), ob = new Set(m.obstacles.map((o) => o.cell)), pts = [];
    for (let k = 1; k < P.length; k++) { const [a, b] = [P[k - 1], P[k]], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 4));
      for (let j = 0; j < n; j++) pts.push([a[0] + (b[0] - a[0]) * j / n, a[1] + (b[1] - a[1]) * j / n]); }
    let mn = 0, ms = 0;
    for (let i = 0; i < COLS * ROWS; i++) { if (road.has(i) || isHud(i)) continue;
      const [x, y] = MAPGEN.cellXY(m, i); let runs = 0, inr = false;
      for (const [px, py] of pts) { const v = Math.hypot(px - x, py - y) <= R; if (v && !inr) runs++; inr = v; }
      if (runs >= 2) { mn++; if (ob.has(i)) ms++; } }
    nodes += mn; shut += ms; if (mn >= 34 && ms / mn < 0.12) low++;
  }
  const share = shut / nodes;
  assert.ok(share >= 0.20 && share <= 0.30, `закрыто ${(share * 100).toFixed(1)}% узловых клеток`);
  // бедные узловыми клетками карты генератор бережёт (C.MAP.obstacles.nodeKeep), на богатых закрыта заметная доля всегда
  assert.equal(low, 0, `карт с 34+ узловыми, где закрыто меньше 12%: ${low} из ${N}`);
});

test('проверка карты ловит неверные препятствия и особые клетки', () => {
  const good = MAPGEN.generate(7), with_ = (o) => Object.assign({}, good, o);
  const roadCell = good.road[5], hudCell = 0;
  const has = (m, re) => MAPGEN.validate(m).some((s) => re.test(s));
  assert.ok(has(with_({ obstacles: [...good.obstacles, { cell: roadCell, kind: 'tree' }] }), /препятствие/), 'препятствие на дороге');
  assert.ok(has(with_({ obstacles: [...good.obstacles, { cell: hudCell, kind: 'tree' }] }), /препятствие/), 'препятствие под HUD');
  assert.ok(has(with_({ obstacles: good.obstacles.slice(0, 3) }), /препятствий/), 'мало препятствий');
  assert.ok(has(with_({ obstacles: [...good.obstacles, { cell: good.obstacles[0].cell, kind: 'tree' }] }), /препятствие/), 'повтор препятствия');
  assert.ok(has(with_({ specials: good.specials.slice(0, 3) }), /особых/), 'мало особых клеток');
  const far = []; for (let i = 0; i < COLS * ROWS; i++) if (!isHud(i) && !nearRoad(good.road, i)) far.push(i);
  assert.ok(has(with_({ specials: [...good.specials.slice(1), { cell: far[0], kind: 'mound' }] }), /особая/), 'особая клетка вдали от дороги');
  assert.ok(has(with_({ specials: [...good.specials.slice(1), { cell: good.obstacles[0].cell, kind: 'mound' }] }), /особая/), 'особая клетка на препятствии');
  assert.ok(has(with_({ specials: [...good.specials.slice(1), { cell: good.specials[1].cell, kind: 'gold' }] }), /особая/), 'неизвестный вид');
  // каждого вида хотя бы одна
  assert.ok(has(with_({ specials: good.specials.map((s) => Object.assign({}, s, { kind: 'mound' })) }), /вид/), 'не все виды особых клеток');
  // особые клетки рядом друг с другом
  const sp0 = good.specials[0].cell, [sx, sy] = xy(sp0);
  const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => (sy + dy) * COLS + sx + dx)
    .find((c) => !good.road.includes(c) && !isHud(c) && !good.obstacles.some((o) => o.cell === c) && nearRoad(good.road, c));
  assert.ok(nb !== undefined);
  assert.ok(has(with_({ specials: [...good.specials, { cell: nb, kind: 'well' }].slice(-6) }), /рядом|ближе/), 'особые клетки рядом');
  // особая клетка через одну по диагонали от дороги: в пределах двух клеток, но башня до пути врагов не достаёт
  const unreach = []; for (let i = 0; i < COLS * ROWS; i++) if (!isHud(i) && !good.road.includes(i) && !good.obstacles.some((o) => o.cell === i)
    && nearRoad(good.road, i) && distToRoute(good, i) > 3.0 * 48 && good.specials.every((s) => cheb(s.cell, i) >= 3)) unreach.push(i);
  assert.ok(unreach.length, 'на карте нет клетки через одну по диагонали');
  assert.ok(has(with_({ specials: [...good.specials.slice(1), { cell: unreach[0], kind: good.specials[0].kind }] }), /достаёт/), 'особая клетка вне досягаемости');
  // столбы арки и склеп: на месте и без лишнего рядом
  const noArch = good.obstacles.filter((o) => o.kind !== 'arch'), noCrypt = good.obstacles.filter((o) => o.kind !== 'crypt');
  assert.ok(has(with_({ obstacles: [...noArch, ...kindCells(good, 'arch').map((c) => ({ cell: c, kind: 'tree' }))] }), /арк/), 'вместо арки деревья');
  assert.ok(has(with_({ obstacles: [...noCrypt, ...kindCells(good, 'crypt').slice(1).map((c) => ({ cell: c, kind: 'crypt' }))] }), /склеп/), 'склеп неполный');
  const gate = good.road[0], [gx, gy] = xy(gate), ring = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const c = (gy + dy) * COLS + gx + dx;
    if (gx + dx >= 0 && gx + dx < COLS && gy + dy >= 0 && gy + dy < ROWS && !good.road.includes(c) && !isHud(c) && !good.obstacles.some((o) => o.cell === c)) ring.push(c); }
  assert.ok(ring.length, 'у входа нет свободной клетки');
  assert.ok(has(with_({ obstacles: [...good.obstacles, { cell: ring[0], kind: 'grave' }] }), /вплотную/), 'надгробие вплотную ко входу');
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
