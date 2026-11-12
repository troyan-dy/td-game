// live/bgmap.js — процедурный фон карты «Некрополиса» по сгенерированной карте (пиксель-арт, детерминированный).
// Рисуется в низком разрешении (1600/3 × 900/3) и растягивается ×3 без сглаживания: крупная пиксельная сетка как на референсе.
// Дорога идёт по тому же маршруту, что и враги (SIM.routeOf(map)), поверх — еле заметная сетка клеток.
// BGMAP.build(map) → { canvas (1600×900), lights: [[x, y, kind], …] } — огни свечей и факелов для мерцания в сцене.
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
    const g = cv.getContext('2d'); const img = g.createImageData(LW, LH), D = img.data;
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
    // ---- мелкий декор только на земле: дорога, вход и склеп свободны
    const [gx, gy] = R.gate, [kx, ky] = R.crypt;
    const blocked = (x, y, r) => dAt(x, y) < RW + 3 + r || Math.hypot(x - gx / K, y - gy / K) < 26 + r || Math.hypot(x - kx / K, y - ky / K + 6) < 24 + r;
    const items = [];                                                 // [y, draw] — рисуем по y (дальние раньше)
    const outlineRect = (x, y, w, h, c) => { for (let i = -1; i <= w; i++) { set(x + i, y - 1, P.ol); set(x + i, y + h, P.ol); } for (let j = 0; j < h; j++) { set(x - 1, y + j, P.ol); set(x + w, y + j, P.ol); }
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) set(x + i, y + j, c); };
    const grave = (x, y, kind) => items.push([y, () => {
      for (let i = -2; i <= 3; i++) set(x + i, y + 1, P.g0, 0.6);                                       // контактная тень
      if (kind === 0) { outlineRect(x - 1, y - 4, 3, 5, P.st1); set(x - 1, y - 4, P.st0); set(x, y - 4, P.st0); set(x - 1, y - 3, P.st0); set(x + 1, y - 1, P.st2);
        if (hash(x, y) > 0.6) set(x - 1, y, P.moss); }
      else if (kind === 1) { outlineRect(x, y - 6, 1, 7, P.st1); outlineRect(x - 1, y - 4, 3, 1, P.st0); }
      else { outlineRect(x - 2, y - 2, 5, 3, P.st1); for (let i = 0; i < 5; i++) set(x - 2 + i, y - 2, P.st0); }
    }]);
    const bush = (x, y, r) => items.push([y, () => {
      for (let yy = -r; yy <= 1; yy++) for (let xx = -r - 1; xx <= r + 1; xx++) { const d = Math.hypot(xx, (yy + r * 0.3) * 1.4); if (d > r + 1) continue;
        if (d > r) { set(x + xx, y + yy, P.ol); continue; } const l = (-xx * 0.6 - yy) / r, h2 = hash(x + xx, y + yy);
        set(x + xx, y + yy, hash(x, y) > 0.5 ? (l > 0.4 ? P.c2 : h2 > 0.5 ? P.c1 : P.c0) : (l > 0.4 ? P.gr2 : h2 > 0.5 ? P.gr1 : P.g2)); }
    }]);
    const candle = (x, y) => items.push([y, () => { set(x, y, P.candle); set(x, y - 1, P.candle); set(x, y - 2, P.flame); lights.push([x * K + 1, (y - 2) * K, 'candle']); }]);

    // ---- вход: две колонны с факелами по бокам дороги у края карты и тёплое свечение проёма
    items.push([gy / K + 8, () => {
      const cx = Math.round(gx / K), cy = Math.round(gy / K), horiz = map.road[0] % map.cols === 0 || map.road[0] % map.cols === map.cols - 1;
      const posts = horiz ? [[cx - 2, cy - 14], [cx - 2, cy + 12]] : [[cx - 15, cy + 2], [cx + 12, cy + 2]];
      for (const [px, py] of posts) { outlineRect(px, py - 14, 4, 14, P.wall1); for (let j = 0; j < 14; j++) set(px, py - 14 + j, P.wall2);
        outlineRect(px - 1, py - 16, 6, 2, P.wall2); set(px + 1, py - 17, P.flame); set(px + 2, py - 17, P.win); set(px + 1, py - 18, P.flame);
        outlineRect(px + 1, py - 10, 2, 5, P.red); lights.push([(px + 1.5) * K, (py - 17) * K, 'torch']); }
      lights.push([gx, gy, 'gate']);
    }]);
    // ---- склеп на последней клетке: стены, колонны, крыша, бирюзовый проём (в клетку шириной, крыша заходит на клетку выше)
    items.push([ky / K + 10, () => {
      const dx = Math.round(kx / K), dy = Math.round(ky / K) + 9, w = 20, h = 14, x0 = dx - w / 2, y0 = dy - h;
      outlineRect(x0, y0, w, h, P.wall0);
      for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) { if (y % 5 === 4 || (x + Math.floor(y / 5) * 4) % 9 === 0) set(x0 + x, y0 + y, P.st2); else if (hash(x0 + x, y0 + y) > 0.75) set(x0 + x, y0 + y, P.wall1); }
      for (let r = 0; r < 7; r++) for (let q = r * 2 - 2; q < w + 2 - r * 2; q++) set(x0 + q, y0 - r, r === 6 ? P.ol : r < 2 ? P.wall2 : P.wall1);
      for (let q = -3; q < w + 3; q++) { set(x0 + q, y0, P.wall2); set(x0 + q, y0 + 1, P.ol); }
      for (const cx of [x0 + 1, x0 + w - 3]) { outlineRect(cx, y0 + 2, 2, h - 2, P.wall1); for (let y = 2; y < h; y++) set(cx, y0 + y, P.wall2); }
      const sx = dx - 2, sy = y0 - 6; outlineRect(sx, sy, 4, 3, P.candle); set(sx + 1, sy + 1, P.ol); set(sx + 2, sy + 1, P.ol);   // череп над входом
      for (let y = 0; y < 10; y++) for (let x = -3; x <= 3; x++) { if (y > 7 - Math.abs(x) * 0.6 + 2) continue; set(dx + x, dy - y, y > 7 ? P.soulD : (x + y) % 3 ? P.soul : P.soulD); }
      lights.push([dx * K, (dy - 5) * K, 'crypt']);
      for (const cx of [x0 - 3, x0 + w + 1]) { outlineRect(cx, dy - 4, 2, 4, P.wall1); set(cx, dy - 5, P.c2); set(cx + 1, dy - 6, P.soul); lights.push([(cx + 1) * K, (dy - 6) * K, 'brazier']); }
    }]);

    const tryPlace = (n, r, fn) => { let placed = 0;
      for (let i = 0; i < n * 30 && placed < n; i++) { const x = rnd() * LW, y = rnd() * LH; if (blocked(x, y, r)) continue; fn(Math.round(x), Math.round(y)); placed++; } };
    tryPlace(40, 3, (x, y) => grave(x, y, rnd() < 0.55 ? 0 : rnd() < 0.5 ? 1 : 2));
    tryPlace(26, 3, (x, y) => bush(x, y, 1 + (rnd() * 2 | 0)));
    tryPlace(10, 2, (x, y) => candle(x, y));
    items.sort((a, b) => a[0] - b[0]).forEach((it) => it[1]());
    g.putImageData(img, 0, 0);
    const big = document.createElement('canvas'); big.width = 1600; big.height = 900;
    const bg = big.getContext('2d'); bg.imageSmoothingEnabled = false; bg.drawImage(cv, 0, 0, LW * K, LH * K);
    // ---- сетка клеток: тонкие тёмные линии по краям клеток вне дороги (поле читается по клеткам)
    bg.fillStyle = 'rgba(8, 6, 20, 0.22)';
    for (let i = 0; i < map.cols * map.rows; i++) { if (road.has(i)) continue;
      const x = (i % map.cols) * TILE, y = Math.floor(i / map.cols) * TILE;
      bg.fillRect(x, y, TILE, 1); bg.fillRect(x, y, 1, TILE); }
    return { canvas: big, lights };
  }
  window.BGMAP = { build: BGMAP_build };
})();
