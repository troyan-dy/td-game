// live/mapgen.js — генератор карты забега: клетчатое поле и одна дорога под прямыми углами от входа на краю до склепа.
// Чистые функции от сида, без DOM. Карта — простой JSON: { v, seed, style, cols, rows, road: [индексы клеток от входа до склепа],
//   obstacles: [{ cell, kind: 'arch'|'tree'|'water'|'grave'|'ruin' }], specials: [{ cell, kind: 'mound'|'well'|'cursed' }] }.
// Клетка адресуется индексом i = y * cols + x. Склеп — последняя клетка дороги. Препятствия и особые клетки ставятся после
// выбора дороги из своих потоков ('map-obstacles', 'map-special'), поэтому дорога по сиду от них не зависит.
// MAPGEN.generate(seed) → карта (всегда годная); MAPGEN.validate(map) → [нарушения]; MAPGEN.route(map) → маршрут врагов в px;
// MAPGEN.obstacle(map, i), MAPGEN.special(map, i) → вид или null.
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
  const validate = (m) => { const road = m.road || [], f = roadProblems(m);
    return road.every((i) => i >= 0 && i < m.cols * m.rows && i === Math.floor(i)) ? f.concat(cellProblems(m)) : f; };
  const roadProblems = (m) => {
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

  // ---------------------------------------------------------------- препятствия и особые клетки
  const OB = MP.obstacles, SP = MP.specials, OB_KINDS = ['arch', 'tree', 'water', 'grave', 'ruin'], SP_KINDS = Object.keys(C.SPECIAL);
  const cheb = (m, a, b) => Math.max(Math.abs(a % m.cols - b % m.cols), Math.abs(Math.floor(a / m.cols) - Math.floor(b / m.cols)));
  // расстояние каждой клетки до дороги по Чебышёву (в клетках)
  const roadDist = (m) => { const d = new Array(m.cols * m.rows).fill(99);
    for (const c of m.road) for (let i = 0; i < d.length; i++) { const v = cheb(m, i, c); if (v < d[i]) d[i] = v; }
    return d; };
  // свободные клетки: не дорога и не под интерфейсом (от них считается доля препятствий)
  const freeCells = (m) => { const road = new Set(m.road), out = [];
    for (let i = 0; i < m.cols * m.rows; i++) if (!road.has(i) && !inKeepout(i % m.cols, Math.floor(i / m.cols))) out.push(i);
    return out; };
  // столбы арки входа: две клетки по бокам от входа, поперёк направления дороги
  const archCells = (m) => { const g = m.road[0], x = g % m.cols, y = Math.floor(g / m.cols), side = x === 0 || x === m.cols - 1;
    return (side ? [[x, y - 1], [x, y + 1]] : [[x - 1, y], [x + 1, y]])
      .filter(([a, b]) => a >= 0 && b >= 0 && a < m.cols && b < m.rows && !inKeepout(a, b)).map(([a, b]) => b * m.cols + a); };
  const pickWeighted = (pairs, R) => { let s = 0; for (const p of pairs) s += p[1]; let u = R() * s;
    for (const [v, w] of pairs) { u -= w; if (u < 0) return v; } return pairs[pairs.length - 1][0]; };

  // расстановка после выбора дороги (дорога по сиду от неё не зависит): k — номер попытки, у каждой свои потоки
  const decorate = (m, k) => {
    const R = RNG.stream(m.seed, 'map-obstacles', k), dist = roadDist(m), free = freeCells(m), F = free.length, cols = m.cols;
    const n = Math.max(Math.ceil(OB.min * F), Math.min(Math.floor(OB.max * F), Math.round(F * (OB.share[0] + R() * (OB.share[1] - OB.share[0])))));
    const taken = new Map(), gate = m.road[0], crypt = m.road[m.road.length - 1];
    for (const c of archCells(m)) taken.set(c, 'arch');
    // у входа и склепа ничего не ставим: там арка и здание склепа
    const ok = (i) => !taken.has(i) && cheb(m, i, gate) > 1 && cheb(m, i, crypt) > 1;
    // лес: клетки дальше от дороги — раньше, у края поля — ещё раньше (густой край леса), с шумом от сида
    const nf = Math.round((n - taken.size) * (OB.forest[0] + R() * (OB.forest[1] - OB.forest[0])));
    const edge = (i) => { const x = i % cols, y = Math.floor(i / cols); return Math.min(x, cols - 1 - x, y, m.rows - 1 - y) === 0 ? 1.5 : 0; };
    free.filter((i) => dist[i] >= OB.forestFrom && ok(i)).map((i) => [i, dist[i] + edge(i) + R() * 2.5])
      .sort((a, b) => b[1] - a[1]).slice(0, nf).forEach(([i]) => taken.set(i, 'tree'));
    // у дороги: надгробия, руины, отдельные деревья и пруды; выгодные клетки (много дороги в радиусе башни) выбираются чаще
    const value = (i) => { const x = i % cols, y = Math.floor(i / cols); let v = 0;
      for (const c of m.road) if (Math.hypot(c % cols - x, Math.floor(c / cols) - y) <= OB.valueR) v++; return v; };
    const near = free.filter((i) => ok(i) && !taken.has(i));
    for (const i of weighted(near.map((i) => [i, 1 + OB.valueW * value(i)]), R)) {
      if (taken.size >= n) break; if (taken.has(i)) continue;
      const kind = pickWeighted(OB.mix, R);
      if (kind !== 'water') { taken.set(i, kind); continue; }
      const size = OB.pond[0] + Math.floor(R() * (OB.pond[1] - OB.pond[0] + 1)), pond = [i]; taken.set(i, 'water');
      for (let p = 0; p < pond.length && pond.length < size && taken.size < n; p++) {
        const x = pond[p] % cols, y = Math.floor(pond[p] / cols);
        for (const [dx, dy] of shuffle(DIRS.slice(), R)) { const nx = x + dx, ny = y + dy, j = ny * cols + nx;
          if (pond.length >= size || taken.size >= n || nx < 0 || ny < 0 || nx >= cols || ny >= m.rows) continue;
          if (free.includes(j) && ok(j)) { pond.push(j); taken.set(j, 'water'); } } }
    }
    m.obstacles = [...taken].map(([cell, kind]) => ({ cell, kind })).sort((a, b) => a.cell - b.cell);
    // особые клетки: случайно среди свободных у дороги (не только на лучших местах), каждого вида хотя бы одна, не кучей
    const Q = RNG.stream(m.seed, 'map-special', k), cnt = SP.min + Math.floor(Q() * (SP.max - SP.min + 1));
    const kinds = shuffle(SP_KINDS.slice(), Q); while (kinds.length < cnt) kinds.push(SP_KINDS[Math.floor(Q() * SP_KINDS.length)]);
    const out = [];
    for (const i of shuffle(free.filter((i) => dist[i] <= SP.near && !taken.has(i)), Q)) {
      if (out.length >= cnt) break;
      if (!out.some((s) => cheb(m, s.cell, i) < SP.apart)) out.push({ cell: i, kind: kinds[out.length] }); }
    m.specials = out.sort((a, b) => a.cell - b.cell);
    return m;
  };
  // нарушения правил препятствий и особых клеток
  const cellProblems = (m) => {
    const f = [], n = m.cols * m.rows, road = new Set(m.road), obst = m.obstacles || [], sp = m.specials || [], dist = roadDist(m);
    const bad = (c) => !(c >= 0 && c < n) || c !== Math.floor(c), hud = (c) => inKeepout(c % m.cols, Math.floor(c / m.cols));
    const free = freeCells(m), seen = new Set();
    for (const o of obst) { const c = o && o.cell;
      if (bad(c)) { f.push('препятствие вне поля: ' + c); continue; }
      if (road.has(c)) f.push('препятствие на дороге: ' + c);
      if (hud(c)) f.push('препятствие под интерфейсом: ' + c);
      if (seen.has(c)) f.push('препятствие повторяется: ' + c);
      if (!OB_KINDS.includes(o.kind)) f.push(`препятствие неизвестного вида «${o.kind}»: ${c}`);
      seen.add(c); }
    const share = free.length ? obst.length / free.length : 0;
    if (share < OB.min || share > OB.max) f.push(`препятствий ${(share * 100).toFixed(1)}% свободных клеток, нужно ${OB.min * 100}–${OB.max * 100}%`);
    const nearFree = free.filter((i) => !seen.has(i) && dist[i] <= 2).length;
    if (nearFree < OB.nearMin) f.push(`в пределах двух клеток от дороги свободно ${nearFree}, нужно не меньше ${OB.nearMin}`);
    if (sp.length < SP.min || sp.length > SP.max) f.push(`особых клеток ${sp.length}, нужно ${SP.min}–${SP.max}`);
    const ss = new Set();
    for (const s of sp) { const c = s && s.cell;
      if (bad(c)) { f.push('особая клетка вне поля: ' + c); continue; }
      if (road.has(c) || hud(c) || seen.has(c)) f.push('особая клетка не на свободной клетке: ' + c);
      if (dist[c] > SP.near) f.push(`особая клетка дальше ${SP.near} клеток от дороги: ${c}`);
      if (ss.has(c)) f.push('особая клетка повторяется: ' + c);
      if (!SP_KINDS.includes(s.kind)) f.push(`особая клетка неизвестного вида «${s.kind}»: ${c}`);
      ss.add(c); }
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
      const m = { v: 2, seed, style: style.name, cols: G.cols, rows: G.rows, road };
      if (roadProblems(m).length) continue;
      found++; const sc = score(m);
      if (sc > bestScore) { best = m; bestScore = sc; }
    }
    if (!best) throw new Error('mapgen: нет годной карты для сида ' + seed);
    for (let k = 0; k < OB.attempts; k++) if (!validate(decorate(best, k)).length) return best;
    throw new Error('mapgen: нет расстановки препятствий для сида ' + seed);
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

  // вид препятствия и особой клетки по индексу (null — нет). Таблица строится раз на объект карты: карту после генерации не правят
  const LOOK = new WeakMap();
  const lookOf = (m) => { let l = LOOK.get(m);
    if (!l) { l = { ob: new Map((m.obstacles || []).map((o) => [o.cell, o.kind])), sp: new Map((m.specials || []).map((s) => [s.cell, s.kind])) }; LOOK.set(m, l); }
    return l; };
  const obstacle = (m, i) => lookOf(m).ob.get(i) || null;
  const special = (m, i) => lookOf(m).sp.get(i) || null;

  const MAPGEN = { generate, validate, route, cellXY, cellAt, hud, obstacle, special };
  if (typeof module !== 'undefined') module.exports = MAPGEN;
  if (typeof window !== 'undefined') window.MAPGEN = MAPGEN;
})();
