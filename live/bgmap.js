// live/bgmap.js — процедурный фон карты «Некрополиса» (пиксель-арт, детерминированный).
// Рисуется один раз при загрузке в низком разрешении (1600/3 × 900/3) и растягивается ×3 без сглаживания:
// крупная пиксельная сетка как на референсе. Дорога идёт по тому же сплайну, что и враги (SIM.PTS).
// BGMAP.build() → { canvas (1600×900), lights: [[x, y, kind], …] } — огни свечей/окон для мерцания в сцене.
(function () {
  const K = 3, LW = Math.ceil(1600 / K), LH = Math.ceil(900 / K);
  const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const P = {
    g0: hex('#15132a'), g1: hex('#1c1934'), g2: hex('#24203f'), g3: hex('#2c2a4c'), gr1: hex('#22394a'), gr2: hex('#2f4b5c'), gr3: hex('#3b3a6a'),
    r0: hex('#cbb9e6'), r1: hex('#b6a3d6'), r2: hex('#a28fc4'), r3: hex('#8d7ab2'), mortar: hex('#7a6b9c'), curb: hex('#4f4370'), edge: hex('#231c3a'),
    st0: hex('#9a92bd'), st1: hex('#776f9a'), st2: hex('#544b75'), ol: hex('#120e22'), moss: hex('#3f6a5e'),
    tr0: hex('#2a1838'), tr1: hex('#3d2252'), c0: hex('#3b1d63'), c1: hex('#5a2d8f'), c2: hex('#7b42b8'), c3: hex('#a067dc'), c4: hex('#c79af0'),
    w0: hex('#0b2a35'), w1: hex('#114150'), w2: hex('#1f6e78'), w3: hex('#4fd6d0'), lily: hex('#2f5a3a'),
    fence: hex('#1b1628'), fenceHi: hex('#4a4266'), wall0: hex('#3a3456'), wall1: hex('#55507a'), wall2: hex('#6f6a96'),
    roof: hex('#4a2a3c'), roofHi: hex('#6a3a50'), win: hex('#ffb24a'), winHi: hex('#ffe09a'), red: hex('#a3243a'), soul: hex('#5ff2e0'), soulD: hex('#1e8e86'),
    wood: hex('#4a2f2a'), candle: hex('#efe2c8'), flame: hex('#ffb347'),
  };
  // ---------------------------------------------------------------- случайность и шум (детерминированно)
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const hash = (x, y) => { let h = (x * 374761393 + y * 668265263) ^ 0x5bd1e995; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  const vnoise = (x, y) => { const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, s = (t) => t * t * (3 - 2 * t);
    const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
    return a + (b - a) * s(xf) + (c - a) * s(yf) + (a - b - c + d) * s(xf) * s(yf); };
  const fbm = (x, y) => vnoise(x, y) * 0.55 + vnoise(x * 2.1, y * 2.1) * 0.3 + vnoise(x * 4.3, y * 4.3) * 0.15;

  BGMAP_build.lights = [];
  function BGMAP_build() {
    const C = SIM.CONFIG, lights = [];
    const cv = document.createElement('canvas'); cv.width = LW; cv.height = LH;
    const g = cv.getContext('2d'); const img = g.createImageData(LW, LH), D = img.data;
    const set = (x, y, c, a = 1) => { x |= 0; y |= 0; if (x < 0 || y < 0 || x >= LW || y >= LH) return; const i = (y * LW + x) * 4;
      if (a >= 1) { D[i] = c[0]; D[i + 1] = c[1]; D[i + 2] = c[2]; } else { D[i] += (c[0] - D[i]) * a; D[i + 1] += (c[1] - D[i + 1]) * a; D[i + 2] += (c[2] - D[i + 2]) * a; } D[i + 3] = 255; };
    const get = (x, y) => { const i = (y * LW + x) * 4; return [D[i], D[i + 1], D[i + 2]]; };
    // ---- поле расстояний до дороги (штампами вдоль пути)
    const dist = new Float32Array(LW * LH).fill(99);
    const PTS = SIM.PTS;
    for (let i = 1; i < PTS.length; i++) {
      const [ax, ay] = PTS[i - 1], [bx, by] = PTS[i], n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / K * 2));
      for (let j = 0; j <= n; j++) { const px = (ax + (bx - ax) * j / n) / K, py = (ay + (by - ay) * j / n) / K;
        for (let y = Math.floor(py - 14); y <= py + 14; y++) for (let x = Math.floor(px - 14); x <= px + 14; x++) {
          if (x < 0 || y < 0 || x >= LW || y >= LH) continue; const d = Math.hypot(x + 0.5 - px, (y + 0.5 - py) * 1.05), k = y * LW + x; if (d < dist[k]) dist[k] = d; } }
    }
    const RW = C.ROAD_HALF / K + 0.6;                                 // полуширина дороги в low-res
    const dAt = (x, y) => (x < 0 || y < 0 || x >= LW || y >= LH) ? 99 : dist[(y | 0) * LW + (x | 0)];
    // ---- земля
    for (let y = 0; y < LH; y++) for (let x = 0; x < LW; x++) {
      const n = fbm(x / 22, y / 22), m = fbm(x / 7 + 40, y / 7), e = Math.min(1, Math.min(x, LW - x, y * 1.4, (LH - y) * 1.3) / 40);
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
    // ---- запретные зоны для декора: дорога, площадки, ворота, склеп
    const blocked = (x, y, r) => { if (dAt(x, y) < RW + 2 + r) return true;
      for (const s of C.SLOTS) if (Math.hypot(x - s.x / K, (y - s.y / K) * 1.3) < 15 + r) return true;
      if (x < 70 && y < 46) return true; if (Math.hypot(x - C.CRYPT[0] / K, y - C.CRYPT[1] / K + 8) < 34 + r) return true;
      for (const [px, py, rx, ry] of PONDS) if (Math.hypot((x - px) / (rx + r + 2), (y - py) / (ry + r + 2)) < 1) return true; return false; };
    const PONDS = [[292, 170, 20, 6], [95, 252, 26, 6], [398, 150, 12, 5]];
    const treeOK = (x, y, r) => !blocked(x, y, 3) && !blocked(x, y - r * 1.25, r * 1.1);
    const items = [];                                                 // [y, draw] — рисуем по y (дальние раньше)
    // ---- спрайты декора
    const outlineRect = (x, y, w, h, c) => { for (let i = -1; i <= w; i++) { set(x + i, y - 1, P.ol); set(x + i, y + h, P.ol); } for (let j = 0; j < h; j++) { set(x - 1, y + j, P.ol); set(x + w, y + j, P.ol); }
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) set(x + i, y + j, c); };
    const grave = (x, y, kind) => items.push([y, () => {
      set(x - 1, y + 1, P.ol, 0.5); for (let i = -2; i <= 4; i++) set(x + i, y + 1, P.g0, 0.6);   // контактная тень
      if (kind === 0) { outlineRect(x - 2, y - 6, 5, 7, P.st1); for (let j = 0; j < 6; j++) set(x - 2, y - 6 + j, P.st0); set(x - 1, y - 7, P.ol); set(x, y - 7, P.ol); set(x + 1, y - 7, P.ol);
        set(x - 2, y - 6, P.ol); set(x + 2, y - 6, P.ol); set(x - 1, y - 6, P.st0); set(x, y - 6, P.st0); set(x + 2, y - 1, P.st2); set(x + 2, y - 2, P.st2); set(x, y - 4, P.st2); set(x - 1, y - 3, P.st2); set(x + 1, y - 3, P.st2);
        if (hash(x, y) > 0.6) { set(x - 2, y, P.moss); set(x - 1, y, P.moss); } }
      else if (kind === 1) { outlineRect(x, y - 8, 2, 9, P.st1); outlineRect(x - 2, y - 6, 6, 2, P.st0); set(x, y - 8, P.st0); }
      else { outlineRect(x - 3, y - 3, 7, 4, P.st1); for (let i = 0; i < 7; i++) set(x - 3 + i, y - 3, P.st0); set(x + 3, y, P.st2); }
    }]);
    const tree = (x, y, r) => items.push([y, () => {
      for (let j = 0; j < r * 0.9; j++) { set(x, y - j, P.tr0); set(x + 1, y - j, P.tr1); if (j > r * 0.4 && hash(x, j) > 0.7) { set(x - 1 - (j % 3), y - j, P.tr0); set(x + 2 + (j % 2), y - j - 1, P.tr0); } }
      for (let i = -3; i <= 4; i++) set(x + i, y + 1, P.g0, 0.7);
      const cy = y - r * 1.25, blobs = 5 + (r / 3 | 0);
      const bl = []; for (let b = 0; b < blobs; b++) { const a = b / blobs * 6.283 + hash(x, b) * 1.2, rr = r * (0.35 + 0.35 * hash(b, y)); bl.push([x + Math.cos(a) * rr * 1.2, cy + Math.sin(a) * rr * 0.7, r * (0.45 + 0.25 * hash(x + b, y))]); }
      bl.push([x, cy, r * 0.65]);
      for (const [bx, by, br] of bl) for (let yy = -br - 1; yy <= br + 1; yy++) for (let xx = -br - 1; xx <= br + 1; xx++) if (Math.hypot(xx, yy * 1.15) <= br + 1) set(bx + xx, by + yy, P.ol);
      for (const [bx, by, br] of bl) for (let yy = -br; yy <= br; yy++) for (let xx = -br; xx <= br; xx++) { const d = Math.hypot(xx, yy * 1.15); if (d > br) continue;
        const l = (-xx - yy) / br, n = hash(Math.floor(bx + xx), Math.floor(by + yy)); let c = l > 0.55 ? P.c3 : l > 0.05 ? P.c2 : l > -0.5 ? P.c1 : P.c0;
        if (n > 0.92) c = l > 0.3 ? P.c4 : P.c2; if (n < 0.06) c = P.c0; set(bx + xx, by + yy, c); }
    }]);
    const bush = (x, y, r) => items.push([y, () => {
      for (let yy = -r; yy <= 1; yy++) for (let xx = -r - 1; xx <= r + 1; xx++) { const d = Math.hypot(xx, (yy + r * 0.3) * 1.4); if (d > r + 1) continue;
        if (d > r) { set(x + xx, y + yy, P.ol); continue; } const l = (-xx * 0.6 - yy) / r, h2 = hash(x + xx, y + yy);
        set(x + xx, y + yy, hash(x, y) > 0.5 ? (l > 0.4 ? P.c2 : h2 > 0.5 ? P.c1 : P.c0) : (l > 0.4 ? P.gr2 : h2 > 0.5 ? P.gr1 : P.g2)); }
    }]);
    const fence = (x0, y0, len) => items.push([y0, () => {
      for (let i = 0; i < len; i++) { set(x0 + i, y0 - 4, P.fence); set(x0 + i, y0 - 1, P.fence); if (i % 3 === 0) { for (let j = 0; j < 7; j++) set(x0 + i, y0 - j, P.fence); set(x0 + i, y0 - 7, P.fenceHi); } }
    }]);
    const pond = (cx, cy, rx, ry) => items.push([cy - ry, () => {
      for (let y = -ry - 1; y <= ry + 1; y++) for (let x = -rx - 1; x <= rx + 1; x++) { const d = Math.hypot(x / rx, y / ry); if (d > 1.12) continue;
        if (d > 1) { set(cx + x, cy + y, P.st2); continue; } const n = fbm((cx + x) / 5, (cy + y) / 5);
        set(cx + x, cy + y, d > 0.85 ? P.w1 : n > 0.62 ? P.w2 : P.w0); if (hash(cx + x, cy + y) > 0.985) set(cx + x, cy + y, P.w3); }
      for (let i = 0; i < rx * ry / 18; i++) { const a = rnd() * 6.28, r = Math.sqrt(rnd()) * 0.8; const px = cx + Math.cos(a) * rx * r, py = cy + Math.sin(a) * ry * r; set(px, py, P.lily); set(px + 1, py, P.lily); }
      lights.push([cx * K, cy * K, 'water']);
    }]);
    const candle = (x, y) => items.push([y, () => { set(x, y, P.candle); set(x, y - 1, P.candle); set(x, y - 2, P.flame); lights.push([x * K + 1, (y - 2) * K, 'candle']); }]);
    const arch = (x, y) => items.push([y, () => {
      outlineRect(x - 8, y - 16, 3, 16, P.wall1); outlineRect(x + 5, y - 16, 3, 16, P.wall1);
      for (let i = -8; i <= 7; i++) { const yy = y - 16 - Math.round(Math.sqrt(Math.max(0, 64 - (i + 0.5) ** 2)) * 0.5); set(x + i, yy, P.wall2); set(x + i, yy + 1, P.wall1); set(x + i, yy - 1, P.ol); }
      for (let j = 0; j < 16; j++) { set(x - 8, y - j, P.wall2); set(x + 5, y - j, P.wall2); }
    }]);

    // ---- ворота с городом (слева вверху)
    items.push([40, () => {
      for (let i = 0; i < 6; i++) { const hx = 4 + i * 11, hy = 4 + (i % 2) * 3; outlineRect(hx, hy + 6, 9, 9, P.wall0);
        for (let r = 0; r < 6; r++) for (let q = r; q < 9 - r; q++) set(hx + q, hy + 6 - r, r === 0 ? P.ol : P.roof); set(hx + 4, hy + 1, P.roofHi);
        set(hx + 2, hy + 9, P.win); set(hx + 6, hy + 9, P.win); set(hx + 2, hy + 10, P.winHi); lights.push([(hx + 4) * K, (hy + 9) * K, 'window']); }
      outlineRect(0, 22, 62, 16, P.wall0);
      for (let x = 0; x < 62; x++) for (let y = 22; y < 38; y++) { if ((y - 22) % 4 === 3 || (x + Math.floor((y - 22) / 4) * 3) % 7 === 0) set(x, y, P.st2); else if (hash(x, y) > 0.8) set(x, y, P.wall1); }
      for (let x = 0; x < 62; x += 5) { outlineRect(x, 19, 3, 3, P.wall1); }
      // арка ворот над началом дороги
      const gx = Math.round(C.GATE[0] / K) - 1, gy = 37;
      for (let y = gy - 12; y <= gy; y++) for (let x = gx - 7; x <= gx + 7; x++) { const top = gy - 12 + Math.round(4 - Math.sqrt(Math.max(0, 49 - (x - gx) ** 2)) * 0.6); if (y < top) continue;
        set(x, y, (x + y) % 2 ? P.win : P.flame, 0.85); }
      for (let x = gx - 7; x <= gx + 7; x++) if ((x - gx) % 2 === 0) for (let y = gy - 10; y <= gy; y++) set(x, y, P.ol);
      outlineRect(gx - 11, gy - 18, 4, 18, P.wall1); outlineRect(gx + 8, gy - 18, 4, 18, P.wall1);
      for (const bx of [gx - 16, gx + 13]) { outlineRect(bx, gy - 15, 4, 9, P.red); set(bx + 1, gy - 12, P.r0); set(bx + 2, gy - 12, P.r0); set(bx + 1, gy - 11, P.r0); set(bx + 1, gy - 13, P.r0); }
      lights.push([(gx - 9) * K, (gy - 19) * K, 'torch'], [(gx + 10) * K, (gy - 19) * K, 'torch'], [gx * K, (gy - 5) * K, 'gate']);
    }]);
    // ---- склеп (справа внизу): ступени к двери, колонны, крыша, бирюзовый проём
    items.push([C.CRYPT[1] / K + 2, () => {
      const dx = Math.round(C.CRYPT[0] / K), dy = Math.round(C.CRYPT[1] / K) - 2, w = 46, h = 26, x0 = dx - w / 2, y0 = dy - h;
      outlineRect(x0, y0, w, h, P.wall0);
      for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) { if (y % 5 === 4 || (x + Math.floor(y / 5) * 4) % 9 === 0) set(x0 + x, y0 + y, P.st2); else if (hash(x0 + x, y0 + y) > 0.75) set(x0 + x, y0 + y, P.wall1); }
      for (let r = 0; r < 12; r++) for (let q = r * 2 - 4; q < w + 4 - r * 2; q++) set(x0 + q, y0 - r, r === 11 ? P.ol : r < 2 ? P.wall2 : P.wall1);
      for (let q = -5; q < w + 5; q++) { set(x0 + q, y0, P.wall2); set(x0 + q, y0 + 1, P.ol); }
      for (const cx of [x0 + 4, x0 + 12, x0 + w - 14, x0 + w - 6]) { outlineRect(cx, y0 + 2, 3, h - 2, P.wall1); for (let y = 2; y < h; y++) set(cx, y0 + y, P.wall2); }
      // череп над входом
      const sx = dx - 2, sy = y0 - 8; outlineRect(sx, sy, 5, 4, P.candle); set(sx + 1, sy + 1, P.ol); set(sx + 3, sy + 1, P.ol); outlineRect(sx + 1, sy + 4, 3, 1, P.candle);
      // проём
      for (let y = 0; y < 16; y++) for (let x = -5; x <= 5; x++) { const top = 16 - Math.round(Math.sqrt(Math.max(0, 25 - x * x)) * 0.8); if (16 - y > top + 3) continue;
        set(dx + x, dy - y, y > 12 ? P.soulD : (x + y) % 3 ? P.soul : P.soulD); }
      for (let x = -6; x <= 6; x++) set(dx + x, dy - 17, P.ol);
      lights.push([dx * K, (dy - 8) * K, 'crypt']);
      for (const cx of [x0 - 3, x0 + w + 2]) { outlineRect(cx, dy - 6, 3, 6, P.wall1); set(cx + 1, dy - 7, P.c3); set(cx + 1, dy - 8, P.c4); lights.push([(cx + 1) * K, (dy - 8) * K, 'brazier']); }
    }]);

    // ---- рамка из деревьев по краям и рассыпанный декор
    const tryPlace = (n, r, fn, zone, ok) => { let placed = 0;
      for (let i = 0; i < n * 30 && placed < n; i++) { const x = zone ? zone[0] + rnd() * zone[2] : rnd() * LW, y = zone ? zone[1] + rnd() * zone[3] : rnd() * LH;
        if (ok ? !ok(x, y) : blocked(x, y, r)) continue; fn(Math.round(x), Math.round(y)); placed++; } };
    const plantTree = (lo, span) => (x, y) => tree(x, y, lo + rnd() * span), tOK = (r) => (x, y) => treeOK(x, y, r);
    // края: плотные деревья
    tryPlace(18, 6, plantTree(9, 6), [0, 30, 26, LH - 30], tOK(13));
    tryPlace(18, 6, plantTree(9, 6), [LW - 28, 10, 28, LH - 10], tOK(13));
    tryPlace(16, 6, plantTree(9, 6), [70, LH - 22, LW - 100, 22], tOK(13));
    tryPlace(12, 6, plantTree(8, 5), [80, 0, LW - 120, 18], tOK(12));
    // внутренние деревья, пруды, руины
    tryPlace(10, 8, plantTree(7, 4), null, tOK(10));
    PONDS.forEach(([x, y, rx, ry]) => pond(x, y, rx, ry));
    tryPlace(3, 10, (x, y) => arch(x, y), [300, 20, 200, 100]);
    tryPlace(70, 3, (x, y) => grave(x, y, rnd() < 0.55 ? 0 : rnd() < 0.5 ? 1 : 2));
    tryPlace(40, 3, (x, y) => bush(x, y, 2 + (rnd() * 3 | 0)));
    tryPlace(9, 4, (x, y) => fence(x, y, 10 + (rnd() * 14 | 0)));
    tryPlace(14, 2, (x, y) => candle(x, y));
    items.sort((a, b) => a[0] - b[0]).forEach((it) => it[1]());
    g.putImageData(img, 0, 0);
    const big = document.createElement('canvas'); big.width = 1600; big.height = 900;
    const bg = big.getContext('2d'); bg.imageSmoothingEnabled = false; bg.drawImage(cv, 0, 0, LW * K, LH * K);
    return { canvas: big, lights };
  }
  window.BGMAP = { build: BGMAP_build };
})();
