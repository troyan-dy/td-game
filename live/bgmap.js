// live/bgmap.js — процедурный фон карты «Некрополиса» по сгенерированной карте (пиксель-арт, детерминированный).
// Рисуется в низком разрешении (1600/3 × 900/3) и растягивается ×3 без сглаживания: крупная пиксельная сетка как на референсе.
// Дорога идёт по тому же маршруту, что и враги (SIM.routeOf(map)), поверх — еле заметная сетка клеток.
// BGMAP.build(map) → { canvas (1600×900), over (1600×900, прозрачный слой поверх врагов: перемычки арок), lights: [[x, y, kind], …] }.
(function () {
  const K = 3, LW = Math.ceil(1600 / K), LH = Math.ceil(900 / K);
  const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const P = {
    g0: hex('#15132a'), g1: hex('#1c1934'), g2: hex('#24203f'), g3: hex('#2c2a4c'), gr1: hex('#22394a'), gr2: hex('#2f4b5c'), gr3: hex('#3b3a6a'),
    r0: hex('#cbb9e6'), r1: hex('#b6a3d6'), r2: hex('#a28fc4'), r3: hex('#8d7ab2'), mortar: hex('#7a6b9c'), curb: hex('#4f4370'), edge: hex('#231c3a'),
    st0: hex('#9a92bd'), st1: hex('#776f9a'), st2: hex('#544b75'), ol: hex('#120e22'), moss: hex('#3f6a5e'),
    c0: hex('#3b1d63'), c1: hex('#5a2d8f'), c2: hex('#7b42b8'),
    wall0: hex('#3a3456'), wall1: hex('#55507a'), wall2: hex('#6f6a96'),
    win: hex('#ffb24a'), red: hex('#a3243a'), soul: hex('#5ff2e0'), soulD: hex('#1e8e86'),
    candle: hex('#efe2c8'), flame: hex('#ffb347'),
    tr0: hex('#0d1a1e'), tr1: hex('#14302b'), tr2: hex('#1e4639'), tr3: hex('#2e5e49'), tr4: hex('#4a7a55'), bark: hex('#2b2033'), bark2: hex('#3d2f45'),
    w0: hex('#0b1d30'), w1: hex('#12344a'), w2: hex('#1b5163'), w3: hex('#2f7f86'), wHi: hex('#8fe9e4'), mud: hex('#1a1626'),
  };
  // ---------------------------------------------------------------- случайность и шум (детерминированно от сида карты)
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const hash = (x, y) => { let h = (x * 374761393 + y * 668265263) ^ 0x5bd1e995; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  const vnoise = (x, y) => { const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, s = (t) => t * t * (3 - 2 * t);
    const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
    return a + (b - a) * s(xf) + (c - a) * s(yf) + (a - b - c + d) * s(xf) * s(yf); };
  const fbm = (x, y) => vnoise(x, y) * 0.55 + vnoise(x * 2.1, y * 2.1) * 0.3 + vnoise(x * 4.3, y * 4.3) * 0.15;

  function BGMAP_build(map) {
    const C = SIM.CONFIG, TILE = C.GRID.tile, lights = [], R = SIM.routeOf(map), road = new Set(map.road);
    seed = (map.seed % 0x7ffffff) + 7;
    const ox = (map.seed % 997) * 13.7, oy = (map.seed % 991) * 7.3;          // сдвиг шума: у каждой карты своя земля
    const cv = document.createElement('canvas'); cv.width = LW; cv.height = LH;
    const g = cv.getContext('2d'); const img = g.createImageData(LW, LH), top = g.createImageData(LW, LH);
    let D = img.data;
    // слой поверх врагов (перемычки арок): враги проходят под ним. Рисуется только непрозрачным
    const onTop = (fn) => { const keep = D; D = top.data; fn(); D = keep; };
    const set = (x, y, c, a = 1) => { x |= 0; y |= 0; if (x < 0 || y < 0 || x >= LW || y >= LH) return; const i = (y * LW + x) * 4;
      if (a >= 1) { D[i] = c[0]; D[i + 1] = c[1]; D[i + 2] = c[2]; } else { D[i] += (c[0] - D[i]) * a; D[i + 1] += (c[1] - D[i + 1]) * a; D[i + 2] += (c[2] - D[i + 2]) * a; } D[i + 3] = 255; };
    // ---- поле расстояний до оси дороги (штампами вдоль маршрута)
    const dist = new Float32Array(LW * LH).fill(99), PTS = R.pts;
    for (let i = 1; i < PTS.length; i++) {
      const [ax, ay] = PTS[i - 1], [bx, by] = PTS[i], n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / K * 2));
      for (let j = 0; j <= n; j++) { const px = (ax + (bx - ax) * j / n) / K, py = (ay + (by - ay) * j / n) / K;
        for (let y = Math.floor(py - 14); y <= py + 14; y++) for (let x = Math.floor(px - 14); x <= px + 14; x++) {
          if (x < 0 || y < 0 || x >= LW || y >= LH) continue; const d = Math.hypot(x + 0.5 - px, y + 0.5 - py), k = y * LW + x; if (d < dist[k]) dist[k] = d; } }
    }
    const RW = C.ROAD_HALF / K;                                       // полуширина дороги в low-res
    const dAt = (x, y) => (x < 0 || y < 0 || x >= LW || y >= LH) ? 99 : dist[(y | 0) * LW + (x | 0)];
    // ---- земля
    for (let y = 0; y < LH; y++) for (let x = 0; x < LW; x++) {
      const n = fbm((x + ox) / 22, (y + oy) / 22), m = fbm((x + ox) / 7 + 40, (y + oy) / 7), e = Math.min(1, Math.min(x, LW - x, y * 1.4, (LH - y) * 1.3) / 40);
      let c = n < 0.38 ? P.g0 : n < 0.5 ? P.g1 : n < 0.62 ? P.g2 : P.g3;
      if (m > 0.62 && hash(x, y) > 0.55) c = hash(x + 3, y) > 0.5 ? P.gr1 : P.gr2;            // пятна сине-зелёной травы
      if (hash(x * 7, y * 3) > 0.985) c = P.gr3;
      set(x, y, c);
      if (e < 1) set(x, y, P.g0, (1 - e) * 0.6);                        // края темнее
    }
    // травинки
    for (let i = 0; i < 2600; i++) { const x = rnd() * LW | 0, y = rnd() * LH | 0; if (dAt(x, y) < RW + 2) continue; const c = rnd() < 0.5 ? P.gr2 : P.gr1; set(x, y, c); set(x, y - 1, c); if (rnd() < 0.4) set(x + 1, y, c); }
    // ---- дорога: обвод, бордюр, брусчатка
    for (let y = 0; y < LH; y++) for (let x = 0; x < LW; x++) {
      const d = dist[y * LW + x]; if (d > RW + 2) continue;
      if (d > RW + 1) { set(x, y, P.edge, 0.85); continue; }
      if (d > RW) { set(x, y, P.curb); continue; }
      const row = Math.floor(y / 3), off = Math.floor(hash(row, 77) * 4), sw = 3 + (hash(row, 9) > 0.5 ? 1 : 0), cx = Math.floor((x + off) / sw), lx = (x + off) % sw, ly = y % 3;
      let c = [P.r0, P.r1, P.r1, P.r2, P.r2, P.r3][Math.floor(hash(cx, row) * 6)];
      const corner = (lx === sw - 1 && ly === 2) || (lx === sw - 1 && ly === 0 && hash(cx, row + 5) > 0.5);
      if (corner || (ly === 2 && hash(cx * 3, row) > 0.35) || (lx === sw - 1 && hash(cx, row * 3) > 0.3)) c = P.mortar;
      else if (lx === 0 && ly === 0) c = c.map((v) => Math.min(255, v + 16));
      else if (ly === 1 && lx === sw - 2) c = c.map((v) => v - 10);
      set(x, y, c);
      if (d > RW - 1.2) set(x, y, P.curb, 0.45);                       // мягкий бордюр внутри
    }
    // ---- плоский декор только на свободной земле (опавшие листья): ничего объёмного, что можно спутать с препятствием;
    // дорога, вход, склеп и клетки препятствий свободны. Свечи горят только у надгробий
    const [gx, gy] = R.gate, [kx, ky] = R.crypt;
    const blocked = (x, y, r) => dAt(x, y) < RW + 3 + r || obst.has(SIM.MAPGEN.cellAt(map, x * K, y * K)) || Math.hypot(x - gx / K, y - gy / K) < 26 + r || Math.hypot(x - kx / K, y - ky / K + 6) < 24 + r;
    const items = [];                                                 // [y, draw] — рисуем по y (дальние раньше)
    const leaves = (x, y) => items.push([y, () => {                  // опавшие листья: россыпь пикселей без контура и тени
      for (let k = 0; k < 6; k++) { const px = x + Math.round((hash(x + k, y) - 0.5) * 8), py = y + Math.round((hash(x, y + k) - 0.5) * 4);
        set(px, py, [P.c0, P.c1, P.moss][k % 3], 0.8); }
    }]);
    // вросшая в землю плита: плоская, без контура и тени, чуть светлее земли
    const slab = (x, y) => items.push([-0.8, () => { const w = 3 + Math.floor(hash(x, y) * 3);
      for (let j = 0; j < 2; j++) for (let i = 0; i < w; i++) if (hash(x + i, y + j) > 0.15) set(x + i, y + j, P.st2, 0.45); }]);
    const candle = (x, y) => items.push([y, () => { set(x, y, P.candle); set(x, y - 1, P.candle); set(x, y - 2, P.flame); lights.push([x * K + 1, (y - 2) * K, 'candle']); }]);

    // ---- препятствия: объёмные, с чёрным контуром и тенью на земле — с одного взгляда отличаются от плоского декора
    const CS = TILE / K, cols = map.cols, cellX = (i) => (i % cols) * CS, cellY = (i) => Math.floor(i / cols) * CS;
    const obst = new Map((map.obstacles || []).map((o) => [o.cell, o.kind]));
    const key = (x, y) => x + ',' + y;
    // фигура: mask — Map 'x,y' → цвет; сначала контур вокруг, потом заливка
    const shape = (mask) => {
      for (const k of mask.keys()) { const [x, y] = k.split(',').map(Number);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (!mask.has(key(x + dx, y + dy))) set(x + dx, y + dy, P.ol); }
      for (const [k, c] of mask) { const [x, y] = k.split(',').map(Number); set(x, y, c); } };
    const footprint = (x, y, rx, ry, a) => { for (let j = -ry; j <= ry; j++) for (let i = -rx; i <= rx; i++) if ((i * i) / (rx * rx) + (j * j) / (ry * ry) <= 1) set(x + i, y + j, P.ol, a); };
    // ель-призрак: ствол и ярусы кроны, свет слева
    const tree = (bx, by, h, w, s) => { bx = Math.round(bx); by = Math.round(by);
      const m = new Map(), ch = h - 3;
      for (let j = 0; j < 3; j++) { m.set(key(bx, by - j), P.bark2); m.set(key(bx + 1, by - j), P.bark); }
      for (let r = 0; r < ch; r++) { const y = by - 3 - r, k = 1 - r / ch, tier = (r + Math.floor(s * 3)) % 5, hw = Math.max(0.5, w / 2 * k * (0.7 + 0.09 * tier));
        for (let x = Math.round(bx + 0.5 - hw); x <= Math.round(bx + 0.5 + hw); x++) { const u = (x - bx - 0.5) / Math.max(1, hw);
          if (Math.abs(u) > 0.8 && hash(x * 7 + s * 99, y) > 0.6) continue;               // рваный край кроны
          let c = u < -0.3 ? P.tr3 : u < 0.35 ? P.tr2 : P.tr1;
          if (tier === 4) c = u < 0 ? P.tr2 : P.tr1;                                       // тень под ярусом
          if (u < -0.2 && hash(x * 5 + s * 31, y * 3) > 0.86) c = P.tr4;
          m.set(key(x, y), c); } }
      footprint(bx + 1, by + 1, w / 2 + 1, 2, 0.55); shape(m); };
    // надгробие: плита со скруглённым верхом или крест
    const tomb = (x, y, s) => { x = Math.round(x); y = Math.round(y);
      const m = new Map(), cross = s < 0.3, w = cross ? 8 : 7 + (s > 0.65 ? 1 : 0), h = cross ? 14 : 10 + Math.floor(s * 4), x0 = x - Math.floor(w / 2);
      if (cross) { for (let j = 0; j < h; j++) { m.set(key(x - 1, y - j), P.st0); m.set(key(x, y - j), P.st1); m.set(key(x + 1, y - j), P.st2); }
        for (let i = 0; i < w; i++) { m.set(key(x0 + i, y - h + 4), i < 3 ? P.st0 : P.st1); m.set(key(x0 + i, y - h + 5), i < 3 ? P.st1 : P.st2); } }
      else for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { if (j >= h - 2 && (i === 0 || i === w - 1) || j === h - 1 && (i === 1 || i === w - 2)) continue;
        m.set(key(x0 + i, y - j), i === 0 ? P.st0 : i === w - 1 ? P.st2 : (j === h - 3 && i > 0 && i < w - 1) ? P.st2 : P.st1); }
      footprint(x, y + 1, w / 2 + 1, 1.5, 0.5); shape(m);
      if (!cross && hash(x, y) > 0.5) set(x0 + 1, y - 1, P.moss); };
    // руина: обломок стены из кирпичей с рваным верхом, мох и щебень
    const ruin = (cx, by, s, hmax) => { cx = Math.round(cx); by = Math.round(by);
      const m = new Map(), w = 16 + Math.floor(s * 3), x0 = cx - Math.floor(w / 2);
      for (let i = 0; i < w; i++) { const top = Math.min(hmax, 7 + Math.floor((Math.sin(i * 0.7 + s * 20) * 0.5 + 0.5) * 9 + hash(i, s * 50) * 4)) - (i === 0 || i === w - 1 ? 4 : 0);
        for (let j = 0; j < top; j++) { const row = Math.floor(j / 3), mortar = j % 3 === 2 || (i + row * 2) % 5 === 0;
          m.set(key(x0 + i, by - j), j === top - 1 ? (hash(i, j + s) > 0.5 ? P.moss : P.wall2) : mortar ? P.st2 : i < 2 ? P.wall2 : P.wall1); } }
      footprint(cx, by + 1, w / 2 + 2, 2, 0.5); shape(m);
      for (let k = 0; k < 4; k++) { const rx = x0 - 2 + Math.floor(hash(k, s * 70) * (w + 4)), ry = by + 1 + Math.floor(hash(k + 9, s) * 3);
        set(rx, ry, P.ol); set(rx + 1, ry, P.st1); set(rx + 1, ry - 1, P.st0); } };
    // колонна: основание, ствол, капитель и чаша с огнём; 'gate' — тёплый огонь и красное знамя, 'crypt' — бирюзовое пламя душ и череп.
    // by — основание, h — высота ствола (без огня), low-res пиксели
    const column = (cx, by, h, style) => { cx = Math.round(cx); by = Math.round(by);
      const m = new Map(), w = 6, x0 = cx - 3, hot = style === 'gate' ? [P.flame, P.win] : [P.soulD, P.soul];
      for (let j = 0; j < h; j++) for (let i = -1; i <= w; i++) { const base = j < 2, cap = j >= h - 2;
        if (!base && !cap && (i < 0 || i >= w)) continue;
        m.set(key(x0 + i, by - j), cap || base ? (i < 2 ? P.wall2 : P.wall1) : i < 2 ? P.wall2 : i >= w - 1 ? P.wall0 : (j % 5 === 4 ? P.st2 : P.wall1)); }
      for (let i = 0; i < w; i++) m.set(key(x0 + i, by - h), P.st2);                             // чаша
      footprint(cx, by + 1, 5, 1.5, 0.6); shape(m);
      for (let i = 1; i < w - 1; i++) set(x0 + i, by - h - 1, hot[0]); set(x0 + 2, by - h - 2, hot[1]); set(x0 + 3, by - h - 2, hot[0]); set(x0 + 3, by - h - 3, hot[1]);
      lights.push([(x0 + 3) * K, (by - h - 2) * K, style === 'gate' ? 'torch' : 'brazier']);
      if (style === 'gate') { for (let j = 0; j < 6; j++) for (let i = 1; i < w - 1; i++) if (!(j === 5 && (i === 1 || i === w - 2))) set(x0 + i, by - h + 3 + j, j < 1 ? P.ol : P.red); }
      else { const sy = by - h + 4; for (let i = 1; i < 5; i++) { set(x0 + i, sy, P.candle); set(x0 + i, sy + 1, P.candle); } set(x0 + 2, sy + 1, P.ol); set(x0 + 3, sy + 1, P.ol); } };
    // перемычка между верхами колонн a и b ([x, y]) — в слое поверх врагов; у бокового входа она идёт поперёк дороги вертикально
    const lintel = (a, b, style) => onTop(() => {
      const m = new Map(), horiz = Math.abs(b[0] - a[0]) > Math.abs(b[1] - a[1]), x0 = Math.round(Math.min(a[0], b[0])), x1 = Math.round(Math.max(a[0], b[0]));
      const y0 = Math.round(Math.min(a[1], b[1])), y1 = Math.round(Math.max(a[1], b[1]));
      if (horiz) { for (let x = x0 - 4; x <= x1 + 4; x++) for (let j = 0; j < 3; j++) m.set(key(x, y0 - 3 + j), j === 0 ? P.wall2 : j === 2 ? P.wall0 : P.wall1); }
      // у бокового входа перемычка видна сверху: каменная кровля прохода от верха северной колонны до верха южной, черепица и конёк
      else for (let y = y0 - 5; y <= y1 + 1; y++) for (let i = -6; i <= 5; i++) { const end = y < y0 - 2 || y > y1 - 2;
        if (Math.abs(i + 0.5) > 4.5 && !end) continue;
        m.set(key(x0 + i, y), end ? (i < -2 ? P.wall2 : P.wall1) : i === -1 || i === 0 ? P.wall2 : (y + (i < 0 ? 0 : 1)) % 3 === 0 ? P.st2 : i < 0 ? P.wall1 : P.wall0); }
      shape(m);
      const mx = horiz ? Math.round((x0 + x1) / 2) : x0, my = horiz ? y0 - 6 : Math.round((y0 + y1) / 2) - 1;   // череп над серединой
      const sk = style === 'gate' ? P.candle : P.soul;
      for (let i = -2; i <= 1; i++) { set(mx + i, my, sk); set(mx + i, my + 1, sk); } set(mx - 1, my + 1, P.ol); set(mx, my + 1, P.ol);
      for (let i = -3; i <= 2; i++) set(mx + i, my - 1, P.ol); set(mx - 3, my, P.ol); set(mx + 2, my, P.ol); set(mx - 3, my + 1, P.ol); set(mx + 2, my + 1, P.ol);
    });
    // здание склепа: стена в кирпичах, пилястры, фронтон с черепом, бирюзовая арка входа внизу посередине. cx, by — середина основания
    const crypt = (cx, by, w, h, roof) => { cx = Math.round(cx); by = Math.round(by);
      const m = new Map(), x0 = cx - Math.floor(w / 2);
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
        const pil = i % 8 < 2, c = pil ? (i % 8 === 0 ? P.wall2 : P.wall1) : (j % 4 === 3 || (i + Math.floor(j / 4) * 3) % 7 === 0) ? P.st2 : hash(x0 + i, by - j) > 0.8 ? P.wall1 : P.wall0;
        m.set(key(x0 + i, by - j), j === h - 1 ? P.wall2 : c); }
      for (let r = 0; r < roof; r++) for (let i = Math.round(r * w / 2 / roof) - 1; i <= w - Math.round(r * w / 2 / roof); i++) m.set(key(x0 + i, by - h - r), r === 0 ? P.wall2 : r % 3 === 2 ? P.st2 : P.wall1);
      footprint(cx, by + 1, w / 2 + 2, 2, 0.6); shape(m);
      const sx = cx - 2, sy = by - h - Math.round(roof * 0.55); for (let i = 0; i < 4; i++) { set(sx + i, sy, P.candle); set(sx + i, sy + 1, P.candle); } set(sx + 1, sy + 1, P.ol); set(sx + 2, sy + 1, P.ol);
      const dh = Math.min(h - 3, 14), dw = 5;                                                      // проём: светящаяся арка душ
      for (let j = 0; j < dh; j++) for (let i = -dw; i <= dw; i++) { if (j > dh - 3 && Math.abs(i) > dw - (j - dh + 4)) continue;
        set(cx + i, by - j, Math.abs(i) === dw || j === dh - 1 ? P.ol : (i + j) % 3 ? P.soul : P.soulD); }
      lights.push([cx * K, (by - dh / 2) * K, 'crypt']); };
    // вода: пруды из соседних клеток сливаются в один, края скруглены; темнее к середине, блики, каменный берег
    const water = new Set([...obst].filter(([, k]) => k === 'water').map(([c]) => c));
    // форма пруда: круг вокруг центра каждой клетки и перемычка-капсула к соседней клетке пруда, край чуть волнистый
    const wmask = new Set(), wc = (i) => [cellX(i) + CS / 2, cellY(i) + CS / 2];
    const segD = (x, y, [ax, ay], [bx, by]) => { const dx = bx - ax, dy = by - ay, u = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
      return Math.hypot(x - ax - dx * u, y - ay - dy * u); };
    for (const i of water) { const c = wc(i), nb = [1, cols].map((d) => i + d).filter((j) => water.has(j) && (j - i === cols || j % cols));
      for (let y = Math.floor(cellY(i)) - 3; y < cellY(i) + CS + 3; y++) for (let x = Math.floor(cellX(i)) - 3; x < cellX(i) + CS + 3; x++) {
        const r = CS * 0.47 + 1.2 * Math.sin(Math.atan2(y - c[1], x - c[0]) * 2 + i) + (vnoise(x / 3 + i, y / 3) - 0.5) * 2.5;
        if (Math.min(segD(x + 0.5, y + 0.5, c, c), ...nb.map((j) => segD(x + 0.5, y + 0.5, c, wc(j)) + 1.5)) <= r) wmask.add(key(x, y)); } }
    const drawWater = () => {
      for (const k of wmask) { const [x, y] = k.split(',').map(Number);
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (!wmask.has(key(x + dx, y + dy)) && Math.abs(dx) + Math.abs(dy) <= 2) set(x + dx, y + dy, Math.abs(dx) + Math.abs(dy) === 1 ? P.mud : P.st2); }
      for (const k of wmask) { const [x, y] = k.split(',').map(Number); let e = 9;
        for (let r = 1; r <= 4 && e === 9; r++) for (const [dx, dy] of [[r, 0], [-r, 0], [0, r], [0, -r]]) if (!wmask.has(key(x + dx, y + dy))) { e = r; break; }
        let c = e <= 1 ? P.w3 : e <= 2 ? P.w2 : e <= 3 ? P.w1 : P.w0;
        if (e > 2 && hash(Math.floor(x / 4), y) > 0.95 && y % 3 === 0) c = P.w3;                           // рябь
        if (e > 2 && hash(x, y * 7) > 0.995) c = P.wHi;
        set(x, y, c); }
      for (const i of water) lights.push([cellX(i) * K + TILE / 2, cellY(i) * K + TILE / 2, 'water']);
      for (const i of water) for (let k = 0; k < 5; k++) { const x = Math.round(cellX(i) + hash(i, k) * CS), y = Math.round(cellY(i) + hash(k, i) * CS);    // камни берега
        if (!wmask.has(key(x, y)) && [[1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [-2, 0], [0, 2], [0, -2]].some(([dx, dy]) => wmask.has(key(x + dx, y + dy)))) { set(x, y, P.st1); set(x + 1, y, P.st2); set(x, y - 1, P.st0); } } };
    items.push([-1, drawWater]);                                      // вода плоская: под всем остальным
    for (const [i, kind] of obst) {
      const x0 = cellX(i), y0 = cellY(i), cx = x0 + CS / 2, s = hash(i, 17);
      if (kind !== 'water' && kind !== 'arch' && kind !== 'crypt') items.push([-0.5, () => {                    // тёмная земля под препятствием: клетка читается занятой
        for (let y = Math.ceil(y0 + 1); y < y0 + CS - 1; y++) for (let x = Math.ceil(x0 + 1); x < x0 + CS - 1; x++) {
          const e = Math.min(x - x0, x0 + CS - x, y - y0, y0 + CS - y); if (e < 3 && hash(x, y * 5) > e / 3) continue; set(x, y, P.ol, 0.32); } }]);
      // верх фигуры: в игровую клетку сверху заходит не больше чем на 4 пикселя (она не должна выглядеть занятой);
      // над препятствием, интерфейсом и краем поля — без ограничения (там густой лес смыкается кронами)
      const up = i - cols, topY = up < 0 || obst.has(up) || SIM.MAPGEN.hud(map, up) ? -Infinity : y0 - 4, fit = (by, h) => Math.max(6, Math.min(h, by - topY));
      if (kind === 'tree') {
        // лес вдали от дороги — густой: четыре дерева на клетку; у дороги — одно большое
        const far = map.road.length && Math.min(...map.road.map((c) => Math.max(Math.abs(c % cols - i % cols), Math.abs(Math.floor(c / cols) - Math.floor(i / cols))))) >= 3;
        if (!far) { const by = y0 + CS * 0.9; items.push([by, () => tree(cx - 0.5, by, fit(by, 30), 18, s)]); }
        else for (let k = 0; k < 4; k++) { const tx = x0 + CS * (0.28 + 0.44 * (k % 2)) + (hash(i, k) - 0.5) * 4, ty = y0 + CS * (0.45 + 0.42 * (k >> 1)) + (hash(k, i) - 0.5) * 3;
          const h = fit(ty, 19 + hash(i, k + 5) * 9); items.push([ty, () => tree(tx, ty, h, Math.min(13 + hash(i, k + 7) * 4, h * 0.75), hash(i, k + 9))]); }
      } else if (kind === 'grave') {
        const n = 2 + Math.floor(s * 1.9);
        for (let k = 0; k < n; k++) { const tx = x0 + 5 + k * (CS - 10) / (n - 1), ty = y0 + CS * (0.62 + 0.26 * (k % 2));
          items.push([ty, () => tomb(tx, ty, hash(i, k + 3))]); }
        if (s > 0.45) candle(Math.round(x0 + CS * 0.2), Math.round(y0 + CS * 0.9));
      } else if (kind === 'ruin') { const by = y0 + CS * 0.8; items.push([by, () => ruin(cx, by, s, fit(by, 99))]); }
    }

    // ---- вход и склеп: колонны портика по бокам дороги (не заходят на неё), перемычка над дорогой — в слое поверх врагов.
    // Подход сбоку: колонны выше и ниже дороги, нижняя целиком ниже края дороги. Подход снизу: колонны слева и справа.
    // dir — направление хода врагов в клетке [dx, dy]; style — 'gate' или 'crypt'
    const portico = (cx, cy, dir, style) => {
      if (dir[0]) { const nb = cy - RW - 2, sb = cy + RW + 2 + 18;
        items.push([nb, () => column(cx, nb, 18, style)]); items.push([sb, () => column(cx, sb, 18, style)]);
        lintel([cx, nb - 18], [cx, sb - 18], style); }
      else { const by = cy + CS / 2 - 1.5, h = Math.round(by - (cy - CS / 2) - 1), off = RW + 5;
        items.push([by, () => column(cx - off, by, h, style)]); items.push([by, () => column(cx + off, by, h, style)]);
        lintel([cx - off, by - h], [cx + off, by - h], style); } };
    const dirAt = (a, b) => [Math.sign(b % cols - a % cols), Math.sign(Math.floor(b / cols) - Math.floor(a / cols))];
    const g0 = map.road[0], gdir = map.road.length > 1 ? dirAt(g0, map.road[1]) : [1, 0];
    portico(gx / K, gy / K, gdir, 'gate');
    lights.push([gx, gy, 'gate']);
    if (map.road.length > 1) {
      const e = map.road[map.road.length - 1], kdir = dirAt(map.road[map.road.length - 2], e), kcx = kx / K, kcy = ky / K;
      portico(kcx, kcy, kdir, 'crypt');
      if (kdir[0]) {                                                    // подход сбоку: здание за склепом по ходу, к нему мощёный порог
        const bcx = kcx + kdir[0] * CS, by = kcy + CS / 2 - 1.5;
        items.push([kcy, () => { for (let y = Math.round(kcy - RW + 2); y <= kcy + RW - 2; y++) for (let x = Math.round(Math.min(kcx, bcx)); x <= Math.max(kcx, bcx); x++) set(x, y, (x + y) % 4 ? P.r2 : P.mortar); }]);
        items.push([by, () => crypt(bcx, by, 24, 30, 10)]);
      } else items.push([kcy - RW, () => crypt(kcx, kcy - RW + 1, 56, 14, 8)]);   // подход снизу: широкое здание над склепом, вход — на дорогу
    }

    const tryPlace = (n, r, fn) => { let placed = 0;
      for (let i = 0; i < n * 30 && placed < n; i++) { const x = rnd() * LW, y = rnd() * LH; if (blocked(x, y, r)) continue; fn(Math.round(x), Math.round(y)); placed++; } };
    tryPlace(140, 3, (x, y) => leaves(x, y));
    tryPlace(40, 3, (x, y) => slab(x, y));
    items.sort((a, b) => a[0] - b[0]).forEach((it) => it[1]());
    g.putImageData(img, 0, 0);
    const tc = document.createElement('canvas'); tc.width = LW; tc.height = LH; tc.getContext('2d').putImageData(top, 0, 0);
    const over = document.createElement('canvas'); over.width = 1600; over.height = 900;
    const og = over.getContext('2d'); og.imageSmoothingEnabled = false; og.drawImage(tc, 0, 0, LW * K, LH * K);
    const big = document.createElement('canvas'); big.width = 1600; big.height = 900;
    const bg = big.getContext('2d'); bg.imageSmoothingEnabled = false; bg.drawImage(cv, 0, 0, LW * K, LH * K);
    // ---- сетка клеток: тонкие тёмные линии по краям игровых клеток (поле читается по клеткам);
    // клетки под интерфейсом (HUD, кнопка волны, карточки) затемнены и без сетки — на них не строят
    for (let i = 0; i < map.cols * map.rows; i++) { if (road.has(i) || SIM.MAPGEN.obstacle(map, i)) continue;
      const x = (i % map.cols) * TILE, y = Math.floor(i / map.cols) * TILE;
      if (SIM.MAPGEN.hud(map, i)) { bg.fillStyle = 'rgba(5, 4, 12, 0.55)'; bg.fillRect(x, y, TILE, TILE); continue; }
      bg.fillStyle = 'rgba(8, 6, 20, 0.22)'; bg.fillRect(x, y, TILE, 1); bg.fillRect(x, y, 1, TILE); }
    return { canvas: big, over, lights };
  }
  window.BGMAP = { build: BGMAP_build };
})();
