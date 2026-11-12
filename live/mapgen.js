// live/mapgen.js — генератор карты забега: клетчатое поле и одна дорога под прямыми углами от входа на краю до склепа.
// Чистые функции от сида, без DOM. Карта — простой JSON: { v, seed, style, cols, rows, road: [индексы клеток от входа до склепа] }.
// Клетка адресуется индексом i = y * cols + x. Склеп — последняя клетка дороги.
// MAPGEN.generate(seed) → карта (всегда годная); MAPGEN.validate(map) → [нарушения]; MAPGEN.route(map) → маршрут врагов в px.
(function () {
  const C = (typeof window !== 'undefined' && window.CONFIG) || require('./config.js');
  const RNG = (typeof window !== 'undefined' && window.RNG) || require('./rng.js');
  const MP = C.MAP, G = C.GRID;
  const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];

  // порядок перебора по весам без повторов (ключ −ln(u)/w: чем больше вес, тем раньше)
  const weighted = (pairs, R) => pairs.map(([v, w]) => [v, -Math.log(1 - R()) / w]).sort((a, b) => a[1] - b[1]).map((p) => p[0]);
  const shuffle = (a, R) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

  const inKeepout = (x, y) => MP.keepout.some(([kx, ky, kw, kh]) => x >= kx && y >= ky && x < kx + kw && y < ky + kh);
  const onEdge = (x, y, cols, rows) => x === 0 || y === 0 || x === cols - 1 || y === rows - 1;
  const nearUi = (x, y) => { for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && inKeepout(x + dx, y + dy)) return true; return false; };
  const turnsOf = (road) => { let n = 0;
    for (let k = 2; k < road.length; k++) { const a = road[k - 2], b = road[k - 1], c = road[k]; if (b - a !== c - b) n++; }
    return n; };
  // склеп: не ближе cryptEdge к краю (здание шире клетки), далеко от входа, враги входят не сверху (иначе дорога ушла бы под крышу)
  const cryptProblems = (road, cols, rows) => { const f = [], e = road[road.length - 1], p = road[road.length - 2], x = e % cols, y = Math.floor(e / cols);
    const g = road[0], gx = g % cols, gy = Math.floor(g / cols);
    if (Math.min(x, cols - 1 - x, y, rows - 1 - y) < MP.cryptEdge) f.push(`склеп ближе ${MP.cryptEdge} клеток к краю поля: ${x},${y}`);
    if (Math.hypot(x - gx, y - gy) < MP.gateCryptMin) f.push(`склеп ближе ${MP.gateCryptMin} клеток ко входу: ${x},${y} и ${gx},${gy}`);
    if (p === e - cols) f.push('к склепу дорога подходит сверху');
    return f; };

  // ---------------------------------------------------------------- одна попытка: поиск в глубину по прямым отрезкам
  const attempt = (R, style) => {
    const cols = G.cols, rows = G.rows, target = MP.targetMin + Math.floor(R() * (MP.targetMax - MP.targetMin + 1));
    // вход: клетка на краю (не в углу, не под HUD и не вплотную к нему), первое направление — внутрь поля
    const starts = [];
    for (let x = 1; x < cols - 1; x++) { starts.push([x, 0, 0, 1], [x, rows - 1, 0, -1]); }
    for (let y = 1; y < rows - 1; y++) { starts.push([0, y, 1, 0], [cols - 1, y, -1, 0]); }
    const ok = starts.filter(([x, y, dx, dy]) => !inKeepout(x, y) && !nearUi(x, y) && !inKeepout(x + dx, y + dy));
    const [sx, sy, sdx, sdy] = ok[Math.floor(R() * ok.length)];
    const road = [sy * cols + sx], used = new Set(road);
    let budget = 3000;
    // можно ли положить клетку (x, y) следующей: внутри поля и не на его краю, свободна, не касается чужих витков ни боком, ни углом
    const free = (x, y) => {
      if (x < 0 || y < 0 || x >= cols || y >= rows || inKeepout(x, y) || onEdge(x, y, cols, rows)) return false;
      const i = y * cols + x; if (used.has(i)) return false;
      const prev = road[road.length - 1], prev2 = road.length > 1 ? road[road.length - 2] : -1;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const j = ny * cols + nx; if (!used.has(j) || j === prev) continue;
        if (j === prev2 && dx && dy) continue;                       // угол поворота: соседство по диагонали со своей же клеткой
        return false; }
      return true; };
    const done = () => road.length >= target && turnsOf(road) >= MP.minTurns && !cryptProblems(road, cols, rows).length;
    const grow = (dx, dy, first) => {
      if (--budget < 0) return false;
      const lens = first ? shuffle([1, 2, 3, 4], R) : weighted(style.segs, R);
      for (const L of lens) {
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
    if (road.length) { const [x, y] = xy(road[0]); if (!onEdge(x, y, cols, rows)) f.push(`вход не на краю карты: ${x},${y}`); }
    const hidden = road.filter((i) => inKeepout(...xy(i)));
    if (hidden.length) f.push(`дорога под HUD: ${hidden.length} клеток`);
    const edge = road.slice(1).filter((i) => onEdge(...xy(i), cols, rows));
    if (edge.length) f.push(`дорога по краю поля: ${edge.length} клеток`);
    if (road.length >= 2) f.push(...cryptProblems(road, cols, rows));
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

  // ---------------------------------------------------------------- генерация: характер от сида, попытки с производными потоками, лучший кандидат
  const generate = (seed) => {
    seed = seed >>> 0;
    const style = MP.styles[Math.floor(RNG.stream(seed, 'map-style')() * MP.styles.length)];
    let best = null, bestScore = -Infinity, found = 0;
    for (let a = 0; a < MP.attempts && found < MP.candidates; a++) {
      const road = attempt(RNG.stream(seed, 'map', a), style);   // у каждой попытки свой поток от сида забега
      if (!road) continue;
      const m = { v: 1, seed, style: style.name, cols: G.cols, rows: G.rows, road };
      if (validate(m).length) continue;
      found++; const sc = score(m);
      if (sc > bestScore) { best = m; bestScore = sc; }
    }
    if (!best) throw new Error('mapgen: нет годной карты для сида ' + seed);
    return best;
  };
  // оценка кандидата: охват поля (клетки в пределах двух от дороги) минус штрафы за дорогу вплотную к интерфейсу и за большой пустой квадрат
  const score = (m) => {
    const cols = m.cols, rows = m.rows, near = new Uint8Array(cols * rows); let cover = 0, ui = 0;
    for (const c of m.road) { const x = c % cols, y = Math.floor(c / cols); if (nearUi(x, y)) ui++;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const nx = x + dx, ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < cols && ny < rows && !near[ny * cols + nx]) { near[ny * cols + nx] = 1; cover++; } } }
    const sq = new Uint8Array(cols * rows); let big = 0;                 // самый большой квадрат клеток дальше двух от дороги
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) { const i = y * cols + x; if (near[i]) continue;
      sq[i] = x && y ? 1 + Math.min(sq[i - 1], sq[i - cols], sq[i - cols - 1]) : 1; if (sq[i] > big) big = sq[i]; }
    return cover - MP.score.nearUi * ui - MP.score.empty * Math.max(0, big - MP.score.emptyFrom);
  };

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
      for (let s = 0; s <= 16; s++) { const an = a0 + da * s / 16; pts.push([ox + Math.cos(an) * r, oy + Math.sin(an) * r]); }
    }
    pts.push(P[P.length - 1]);
    return pts;
  };

  // клетка под интерфейсом (HUD, кнопка волны, карточки башен): не игровая — ни дороги, ни построек
  const hud = (m, i) => inKeepout(i % m.cols, Math.floor(i / m.cols));

  const MAPGEN = { generate, validate, route, cellXY, cellAt, hud };
  if (typeof module !== 'undefined') module.exports = MAPGEN;
  if (typeof window !== 'undefined') window.MAPGEN = MAPGEN;
})();
