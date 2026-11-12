// live/mapgen.js — генератор карты забега: клетчатое поле и одна дорога под прямыми углами от входа на краю до склепа.
// Чистые функции от сида, без DOM. Карта — простой JSON: { v, seed, cols, rows, road: [индексы клеток от входа до склепа] }.
// Клетка адресуется индексом i = y * cols + x. Склеп — последняя клетка дороги.
// MAPGEN.generate(seed) → карта (всегда годная); MAPGEN.validate(map) → [нарушения]; MAPGEN.route(map) → маршрут врагов в px.
(function () {
  const C = (typeof window !== 'undefined' && window.CONFIG) || require('./config.js');
  const MP = C.MAP, G = C.GRID;
  const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];

  // mulberry32: своя последовательность для каждой попытки
  const rng = (seed) => { let s = seed >>> 0; return () => { let t = (s = (s + 0x6D2B79F5) >>> 0); t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
  const derive = (seed, k) => { let h = (seed >>> 0) ^ Math.imul(k + 1, 0x9E3779B1); h = Math.imul(h ^ (h >>> 16), 0x85EBCA6B); h = Math.imul(h ^ (h >>> 13), 0xC2B2AE35); return (h ^ (h >>> 16)) >>> 0; };
  const shuffle = (a, R) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

  const inKeepout = (x, y) => MP.keepout.some(([kx, ky, kw, kh]) => x >= kx && y >= ky && x < kx + kw && y < ky + kh);
  const turnsOf = (road) => { let n = 0;
    for (let k = 2; k < road.length; k++) { const a = road[k - 2], b = road[k - 1], c = road[k]; if (b - a !== c - b) n++; }
    return n; };
  // склеп: не у края (здание шире клетки) и враги входят не сверху (иначе дорога ушла бы под крышу)
  const cryptOK = (road, cols, rows) => { const e = road[road.length - 1], p = road[road.length - 2], x = e % cols, y = Math.floor(e / cols);
    return x >= 1 && x <= cols - 2 && y >= 2 && p !== e - cols; };

  // ---------------------------------------------------------------- одна попытка: поиск в глубину по прямым отрезкам
  const attempt = (R) => {
    const cols = G.cols, rows = G.rows, target = MP.targetMin + Math.floor(R() * (MP.targetMax - MP.targetMin + 1));
    // вход: клетка на краю (не в углу и не под HUD), первое направление — внутрь поля
    const starts = [];
    for (let x = 1; x < cols - 1; x++) { starts.push([x, 0, 0, 1], [x, rows - 1, 0, -1]); }
    for (let y = 1; y < rows - 1; y++) { starts.push([0, y, 1, 0], [cols - 1, y, -1, 0]); }
    const ok = starts.filter(([x, y]) => !inKeepout(x, y));
    const [sx, sy, sdx, sdy] = ok[Math.floor(R() * ok.length)];
    const road = [sy * cols + sx], used = new Set(road);
    let budget = 3000;
    // можно ли положить клетку (x, y) следующей: внутри поля, свободна, не касается чужих витков ни боком, ни углом
    const free = (x, y) => {
      if (x < 0 || y < 0 || x >= cols || y >= rows || inKeepout(x, y)) return false;
      const i = y * cols + x; if (used.has(i)) return false;
      const prev = road[road.length - 1], prev2 = road.length > 1 ? road[road.length - 2] : -1;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const j = ny * cols + nx; if (!used.has(j) || j === prev) continue;
        if (j === prev2 && dx && dy) continue;                       // угол поворота: соседство по диагонали со своей же клеткой
        return false; }
      return true; };
    const done = () => road.length >= target && turnsOf(road) >= MP.minTurns && cryptOK(road, cols, rows);
    const grow = (dx, dy, first) => {
      if (--budget < 0) return false;
      const opts = [];
      for (let L = first ? 1 : MP.segMin; L <= MP.segMax; L++) opts.push(L);
      for (const L of shuffle(opts, R)) {
        const added = []; let x = road[road.length - 1] % cols, y = Math.floor(road[road.length - 1] / cols), fail = false;
        for (let s = 0; s < L; s++) { x += dx; y += dy; if (!free(x, y)) { fail = true; break; }
          const i = y * cols + x; road.push(i); used.add(i); added.push(i);
          if (road.length > MP.roadMax) { fail = true; break; }
          if (s === L - 1 && done()) return true; }
        if (!fail) for (const [ndx, ndy] of shuffle(DIRS.filter(([a, b]) => a * dx + b * dy === 0), R)) if (grow(ndx, ndy, false)) return true;
        for (const i of added) { road.pop(); used.delete(i); }
        if (budget < 0) return false;
      }
      return false; };
    return grow(sdx, sdy, true) ? road : null;
  };

  // ---------------------------------------------------------------- проверка карты: список нарушений (пустой — карта годна)
  const validate = (m) => {
    const f = [], cols = m.cols, rows = m.rows, road = m.road || [];
    if (cols !== G.cols || rows !== G.rows) f.push(`поле ${cols}×${rows}, ожидалось ${G.cols}×${G.rows}`);
    if (road.length < MP.roadMin || road.length > MP.roadMax) f.push(`длина дороги ${road.length}, нужно ${MP.roadMin}–${MP.roadMax}`);
    for (const i of road) if (!(i >= 0 && i < cols * rows) || i !== Math.floor(i)) { f.push('клетка дороги вне поля: ' + i); return f; }
    const xy = (i) => [i % cols, Math.floor(i / cols)];
    if (road.length) { const [x, y] = xy(road[0]); if (!(x === 0 || y === 0 || x === cols - 1 || y === rows - 1)) f.push(`вход не на краю карты: ${x},${y}`); }
    for (let k = 1; k < road.length; k++) { const [a, b] = [xy(road[k - 1]), xy(road[k])];
      if (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) !== 1) f.push(`разрыв дороги между ${k - 1} и ${k}`); }
    const at = new Map();
    road.forEach((c, k) => { if (at.has(c)) f.push(`самопересечение: клетка ${c} (шаги ${at.get(c)} и ${k})`); else at.set(c, k); });
    const turns = turnsOf(road); if (turns < MP.minTurns) f.push(`поворотов ${turns}, нужно не меньше ${MP.minTurns}`);
    const touch = new Set();
    road.forEach((c, k) => { const [x, y] = xy(c);
      for (const [dx, dy] of DIRS) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const j = at.get(ny * cols + nx); if (j !== undefined && Math.abs(j - k) > 1) { const key = Math.min(j, k) + ':' + Math.max(j, k);
          if (!touch.has(key)) { touch.add(key); f.push(`витки касаются боками: шаги ${Math.min(j, k)} и ${Math.max(j, k)}`); } } } });
    return f;
  };

  // ---------------------------------------------------------------- генерация: попытки с производным сидом
  const generate = (seed) => {
    seed = seed >>> 0;
    let best = null, bestScore = -1, found = 0;
    for (let a = 0; a < MP.attempts && found < MP.candidates; a++) {
      const road = attempt(rng(derive(seed, a)));
      if (!road) continue;
      const m = { v: 1, seed, cols: G.cols, rows: G.rows, road };
      if (validate(m).length) continue;
      found++; const sc = spread(m);
      if (sc > bestScore) { best = m; bestScore = sc; }
    }
    if (!best) throw new Error('mapgen: нет годной карты для сида ' + seed);
    return best;
  };
  // насколько дорога раскинута по полю: число клеток в пределах двух клеток от дороги
  const spread = (m) => { const near = new Set();
    for (const c of m.road) { const x = c % m.cols, y = Math.floor(c / m.cols);
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const nx = x + dx, ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < m.cols && ny < m.rows) near.add(ny * m.cols + nx); } }
    return near.size; };

  // ---------------------------------------------------------------- геометрия
  const cellXY = (m, i) => [(i % m.cols + 0.5) * G.tile, (Math.floor(i / m.cols) + 0.5) * G.tile];
  const cellAt = (m, x, y) => { const cx = Math.floor(x / G.tile), cy = Math.floor(y / G.tile);
    return cx >= 0 && cy >= 0 && cx < m.cols && cy < m.rows ? cy * m.cols + cx : -1; };
  // маршрут врагов: из-за края поля по центрам клеток дороги до склепа, углы скруглены дугой радиуса cornerR
  const route = (m) => {
    const c = m.road.map((i) => cellXY(m, i)), [x0, y0] = c[0];
    const ex = (m.road[0] % m.cols === 0 ? -1 : m.road[0] % m.cols === m.cols - 1 ? 1 : 0), ey = ex ? 0 : (Math.floor(m.road[0] / m.cols) === 0 ? -1 : 1);
    const pts = [[x0 + ex * G.tile, y0 + ey * G.tile]];
    const P = [pts[0], ...c], r = MP.cornerR;
    for (let k = 1; k < P.length - 1; k++) {
      const [a, b, d] = [P[k - 1], P[k], P[k + 1]], ux = Math.sign(b[0] - a[0]), uy = Math.sign(b[1] - a[1]), vx = Math.sign(d[0] - b[0]), vy = Math.sign(d[1] - b[1]);
      if (ux === vx && uy === vy) { pts.push(b); continue; }
      // дуга от (b − u·r) к (b + v·r) с центром в (b − u·r + v·r)
      const ox = b[0] - ux * r + vx * r, oy = b[1] - uy * r + vy * r, a0 = Math.atan2(-vy, -vx), a1 = Math.atan2(uy, ux);
      let da = a1 - a0; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
      for (let s = 0; s <= 6; s++) { const an = a0 + da * s / 6; pts.push([ox + Math.cos(an) * r, oy + Math.sin(an) * r]); }
    }
    pts.push(P[P.length - 1]);
    return pts;
  };

  const MAPGEN = { generate, validate, route, cellXY, cellAt };
  if (typeof module !== 'undefined') module.exports = MAPGEN;
  if (typeof window !== 'undefined') window.MAPGEN = MAPGEN;
})();
