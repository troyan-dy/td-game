// live/towerart.js — процедурный пиксельный вид башен без своего арта (Колокол, Казарма, Алтарь крови): по типу и виду 1..3
// рисуется маленький холст «пикселями арта» с тёмной обводкой и увеличивается без сглаживания. Одна картинка — для сцены
// (текстура tw_<sprite>_<вид>, её размеры попадают в ASSETS и SIZES как у обычного арта) и для DOM (data URL): башня на поле,
// на карточке и в панели выглядит одинаково. Подставка каждой башни — своего цвета. Колокол рисуется отдельной частью
// (сцена качает его при ударе), на общей картинке — на своём месте. lights — точки огня (свечи) для свечения в сцене.
(function () {
  const P = 4;                                                   // пикселей холста на пиксель арта
  const SHOW = 1.75;                                             // экранных px на пиксель арта (размер в SIZES)
  const INK = '#120d22';
  const STONE = { hi: '#7a6aa0', mid: '#54487a', lo: '#3a3058', dk: '#271f3e' };
  // painter: прямоугольники в координатах арта; outline — тёмный контур вокруг непрозрачного
  const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const painter = (W, H) => { const c = canvas(W, H), g = c.getContext('2d');
    const r = (x, y, w, h, col) => { if (w <= 0 || h <= 0) return; g.fillStyle = col; g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); };
    return { c, g, r, W, H }; };
  const outline = (p, col = INK) => { const { c, g, W, H } = p, d = g.getImageData(0, 0, W, H).data, o = g.createImageData(W, H), od = o.data;
    const on = (x, y) => x >= 0 && y >= 0 && x < W && y < H && d[(y * W + x) * 4 + 3] > 40;
    const [R, G, B] = [1, 3, 5].map((i) => parseInt(col.slice(i, i + 2), 16));
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { if (on(x, y)) continue;
      if (on(x - 1, y) || on(x + 1, y) || on(x, y - 1) || on(x, y + 1)) { const i = (y * W + x) * 4; od[i] = R; od[i + 1] = G; od[i + 2] = B; od[i + 3] = 255; } }
    const t = canvas(W, H); t.getContext('2d').putImageData(o, 0, 0); g.drawImage(t, 0, 0); return p; };
  const up = (p) => { const c = canvas(p.W * P, p.H * P), g = c.getContext('2d'); g.imageSmoothingEnabled = false; g.drawImage(p.c, 0, 0, c.width, c.height); return c; };

  // подставка: каменная плита с полосой цвета башни (trim — [светлый, тёмный]) — по ней тип узнаётся и на мелком экране
  const plinth = (p, x, y, w, h, trim) => { const { r } = p;
    r(x, y, w, h, STONE.mid); r(x, y, w, 1, STONE.hi); r(x, y + h - 1, w, 1, STONE.dk);
    for (let i = x + 3; i < x + w - 1; i += 6) r(i, y + 3, 1, h - 4, STONE.lo);
    r(x - 1, y + 1, w + 2, 2, trim[0]); r(x - 1, y + 2, w + 2, 1, trim[1]); };
  const pillar = (p, x, y, w, h) => { const { r } = p; r(x, y, w, h, STONE.mid); r(x, y, 1, h, STONE.hi); r(x + w - 1, y, 1, h, STONE.lo);
    for (let j = y + 4; j < y + h; j += 5) r(x, j, w, 1, STONE.lo); };
  const candle = (p, x, y, h, lights, ox = 0.5) => { const { r } = p;
    r(x, y, 2, h, '#e8dcc8'); r(x + 1, y, 1, h, '#b8a890'); r(x, y + 1, 1, 2, '#c41e3a');
    r(x, y - 2, 2, 2, '#ffb347'); r(x, y - 3, 1, 1, '#ffe7a0'); lights.push([x + ox + 0.5, y - 2]); };

  // ---------------------------------------------------------------- Колокол: звонница — две колонны, балка, крыша, колокол в проёме
  const bellArt = (lk) => {
    const W = [30, 32, 36][lk - 1], H = [42, 50, 58][lk - 1], cx = W / 2, p = painter(W, H), { r } = p, lights = [];
    const ph = H - 7, bw = W - 6;
    plinth(p, 3, ph, bw, 6, ['#e8a948', '#9a5f1e']);
    const top = [12, 13, 13][lk - 1], pw = lk === 3 ? 5 : 4;
    pillar(p, 5, top, pw, ph - top); pillar(p, W - 5 - pw, top, pw, ph - top);
    r(3, top - 3, W - 6, 3, '#5a3a26'); r(3, top - 3, W - 6, 1, '#8a5d3a'); r(3, top - 1, W - 6, 1, '#3a2418');   // балка
    for (let i = 0; i < 7; i++) { const w = 2 + i * ((W - 4) / 7); r(cx - w / 2, top - 10 + i, w, 1, i < 2 ? STONE.hi : STONE.lo); r(cx - w / 2, top - 10 + i, 1, 1, STONE.hi); }
    r(cx - 1, top - 13, 2, 3, '#e8a948'); r(cx - 2, top - 12, 4, 1, '#e8a948');                                  // шпиль-крест
    if (lk >= 2) { r(cx - 2, top - 6, 4, 3, '#e6dcc0'); r(cx - 1, top - 5, 1, 1, INK); r(cx + 1, top - 5, 1, 1, INK); }   // череп на фронтоне
    if (lk === 3) { candle(p, 1, ph - 4, 4, lights); candle(p, W - 3, ph - 4, 4, lights); }
    outline(p);
    // колокол — отдельная часть: вешается на балку (pivot), качается в сцене
    const bh = [13, 16, 19][lk - 1], bwid = [12, 14, 16][lk - 1], b = painter(bwid + 2, bh + 4);
    { const R = b.r, c = (bwid + 2) / 2;
      R(c - 1, 0, 2, 2, '#3a2418');                                                                              // петля
      for (let j = 0; j < bh; j++) { const k = j / (bh - 1), w = Math.round(4 + (bwid - 4) * Math.pow(k, 1.6)); const x0 = c - w / 2;
        R(x0, j + 2, w, 1, '#c0812f'); R(x0, j + 2, Math.max(1, Math.round(w * 0.3)), 1, '#f2c86a'); R(x0 + w - Math.max(1, Math.round(w * 0.25)), j + 2, Math.max(1, Math.round(w * 0.25)), 1, '#7a4a1e'); }
      R(c - bwid / 2, bh, bwid, 2, '#8a5522'); R(c - bwid / 2, bh, bwid, 1, '#d9a441');                              // губа
      R(c - 1, bh + 2, 2, 2, '#3a2418'); }                                                                        // язык
    outline(b);
    const part = { cv: up(b), pivot: [(bwid + 2) / 2, 0], at: [cx, top] };
    return { frame: up(p), W, H, parts: [part], lights };
  };

  // ---------------------------------------------------------------- Казарма: частокол, знамя на древке, щит с черепом
  const barracksArt = (lk) => {
    const W = [30, 32, 36][lk - 1], H = [42, 50, 58][lk - 1], p = painter(W, H), { r } = p, lights = [];
    const ph = H - 7, BLUE = ['#8cb8ff', '#3c64b4'];
    plinth(p, 2, ph, W - 4, 6, BLUE);
    if (lk === 3) { r(7, ph - 30, W - 14, 30, STONE.mid); r(7, ph - 30, W - 14, 1, STONE.hi);                   // сторожевая башня за частоколом
      for (let x = 7; x < W - 7; x += 4) r(x, ph - 33, 2, 3, STONE.mid); r(W / 2 - 1, ph - 24, 2, 4, '#1a1430'); }
    // частокол: заострённые колья разной высоты
    for (let x = 3, i = 0; x < W - 4; x += 3, i++) { const hgt = 13 + ((i * 7) % 5) + 2 * (lk - 1);
      r(x, ph - hgt, 2, hgt, '#7a5434'); r(x, ph - hgt, 1, hgt, '#9e744a'); r(x + 0.5, ph - hgt - 1, 1, 1, '#9e744a'); }
    r(3, ph - 8, W - 7, 1, '#c8aa76'); r(3, ph - 12 - lk, W - 7, 1, '#c8aa76');                                  // перевязь
    // знамя: древко справа, полотнище с ласточкиным хвостом влево
    const pole = W - 7, ptop = 1, fw = [13, 14, 16][lk - 1], fh = [11, 13, 15][lk - 1];
    r(pole, ptop, 2, ph - ptop, '#5a3a26'); r(pole, ptop, 1, ph - ptop, '#8a5d3a'); r(pole - 1, ptop - 1, 4, 2, '#e8dcc0');
    r(pole - fw, ptop + 2, fw, fh, '#3c64b4'); r(pole - fw, ptop + 2, fw, 1, '#8cb8ff'); r(pole - fw, ptop + 2, 1, fh, '#5c84d4');
    r(pole - fw, ptop + 2 + fh - 3, 3, 3, 'rgba(0,0,0,0)'); p.g.clearRect(pole - fw, ptop + 2 + fh - 3, 3, 3); p.g.clearRect(pole - fw, ptop + 2 + fh - 2, 4, 2);
    const sx = pole - fw / 2 - 2, sy = ptop + 4;                                                               // череп на полотнище
    r(sx, sy, 5, 4, '#e6dcc0'); r(sx + 1, sy + 4, 3, 1, '#e6dcc0'); r(sx + 1, sy + 1, 1, 1, '#1a1430'); r(sx + 3, sy + 1, 1, 1, '#1a1430');
    if (lk >= 2) { const q = 3; r(q, ptop + 6, 2, ph - ptop - 6, '#5a3a26'); r(q, ptop + 6, 1, ph - ptop - 6, '#8a5d3a');   // второе древко с вымпелом
      r(q + 2, ptop + 7, 7, 5, '#3c64b4'); r(q + 2, ptop + 7, 7, 1, '#8cb8ff'); p.g.clearRect(q + 7, ptop + 10, 2, 2); }
    // щит спереди: синее поле, костяной обод, скрещённые кости
    const shw = [10, 11, 12][lk - 1], shh = [12, 13, 14][lk - 1], shx = Math.round(W / 2 - shw / 2) - 1, shy = ph - shh + 2;
    for (let j = 0; j < shh; j++) { const k = j < shh * 0.55 ? 0 : Math.round((j - shh * 0.55) * shw / (shh * 0.95)); r(shx + k, shy + j, shw - 2 * k, 1, '#d8ccac'); if (shw - 2 * k - 2 > 0) r(shx + k + 1, shy + j, shw - 2 * k - 2, 1, j ? '#2f5196' : '#d8ccac'); }
    for (let i = 0; i < shw - 4; i++) { r(shx + 2 + i, shy + 2 + i * 0.9, 1, 1, '#e6dcc0'); r(shx + shw - 3 - i, shy + 2 + i * 0.9, 1, 1, '#e6dcc0'); }
    outline(p);
    return { frame: up(p), W, H, parts: [], lights };
  };

  // ---------------------------------------------------------------- Алтарь крови: надгробная плита с руной, стол, чаша с кровью, свечи
  const altarArt = (lk) => {
    const W = [32, 34, 36][lk - 1], H = [40, 48, 56][lk - 1], cx = W / 2, p = painter(W, H), { r } = p, lights = [];
    const RED = ['#ff4d5e', '#9a1a2c'], ph = H - 6;
    plinth(p, 1, ph, W - 2, 5, RED); plinth(p, 4, ph - 3, W - 8, 3, RED);
    // плита позади: скруглённый верх, руна-капля
    const sw = 14 + 2 * (lk - 1), sh = [24, 30, 36][lk - 1], sx = cx - sw / 2, sy = ph - 3 - sh;
    r(sx, sy + 3, sw, sh - 3, STONE.lo); r(sx + 2, sy + 1, sw - 4, 2, STONE.lo); r(sx + 4, sy, sw - 8, 1, STONE.lo); r(sx, sy + 3, 1, sh - 3, STONE.mid); r(sx + 2, sy + 1, sw - 4, 1, STONE.mid);
    if (lk === 3) { r(sx - 2, sy + 2, 3, 3, '#e6dcc0'); r(sx + sw - 1, sy + 2, 3, 3, '#e6dcc0'); r(sx - 3, sy, 2, 2, '#e6dcc0'); r(sx + sw + 1, sy, 2, 2, '#e6dcc0'); }   // рога
    const ry = sy + 4; r(cx - 1, ry, 2, 1, '#ff4d5e'); r(cx - 2, ry + 1, 4, 2, '#ff4d5e'); r(cx - 3, ry + 3, 6, 3, '#ff4d5e'); r(cx - 2, ry + 6, 4, 1, '#ff4d5e'); r(cx - 1, ry + 3, 1, 2, '#ffd0d6');
    // стол
    const ty = ph - 3 - 9, tw = W - 10; r(5, ty, tw, 9, STONE.mid); r(5, ty, tw, 2, STONE.hi); r(5, ty + 8, tw, 1, STONE.dk); r(7, ty + 3, tw - 4, 5, STONE.lo);
    r(cx - 2, ty + 2, 1, 6, '#c41e3a'); r(cx + 3, ty + 2, 1, 4, '#c41e3a');                                       // потёки крови
    // чаша
    const cw = [10, 11, 12][lk - 1], cy = ty - 6;
    r(cx - cw / 2, cy, cw, 1, '#d9a441'); r(cx - cw / 2 + 1, cy + 1, cw - 2, 1, '#e8293f'); r(cx - cw / 2 + 2, cy + 1, 2, 1, '#ff9aa6');
    r(cx - cw / 2 + 1, cy + 2, cw - 2, 2, '#7a5a2a'); r(cx - cw / 2 + 2, cy + 4, cw - 4, 1, '#7a5a2a'); r(cx - 1, cy + 5, 2, 1, '#d9a441'); r(cx - 3, ty - 1, 6, 1, '#d9a441');
    r(cx - cw / 2 + 1, cy + 2, 1, 2, '#d9a441');
    // свечи: на столе, с вида 2 — высокие подсвечники на плите
    candle(p, 6, ty - 4, 4, lights); candle(p, W - 8, ty - 4, 4, lights);
    if (lk >= 2) { const hh = [0, 10, 14][lk - 1]; for (const x of [1, W - 3]) { r(x, ph - hh, 2, hh, '#5a4a3a'); r(x - 1, ph - hh, 4, 1, '#d9a441'); candle(p, x, ph - hh - 4, 4, lights); } }
    outline(p);
    return { frame: up(p), W, H, parts: [], lights };
  };

  const MAKERS = { bell: bellArt, barracks: barracksArt, altar: altarArt };
  const ART = {};                                                // имя текстуры → { frame, full, W, H, parts, lights, url }
  const full = (a) => { if (!a.parts.length) return a.frame; const c = canvas(a.frame.width, a.frame.height), g = c.getContext('2d'); g.imageSmoothingEnabled = false;
    g.drawImage(a.frame, 0, 0); for (const q of a.parts) g.drawImage(q.cv, (q.at[0] - q.pivot[0]) * P, (q.at[1] - q.pivot[1]) * P); return c; };
  const TOWERART = (window.TOWERART = {
    P, SHOW,
    sprites: () => Object.keys(MAKERS),
    // создать холсты (раз) и зарегистрировать как обычный арт: ASSETS/SIZES — размеры, G — текстуры (кадр и части)
    install: () => {
      for (const sp of Object.keys(MAKERS)) for (let lk = 1; lk <= 3; lk++) { const n = `tw_${sp}_${lk}`; if (ART[n]) continue;
        const a = MAKERS[sp](lk); a.full = full(a); a.url = a.full.toDataURL(); ART[n] = a;
        if (window.ASSETS) window.ASSETS[n] = { w: a.full.width, h: a.full.height, code: true };
        if (window.SIZES) window.SIZES[n] = [a.W * SHOW, a.H * SHOW];
        if (window.G && G.gl) { G.canvasTex(n, a.frame); a.parts.forEach((q, i) => { q.tex = `${n}_p${i}`; G.canvasTex(q.tex, q.cv); }); } }
    },
    get: (n) => ART[n] || null,
    url: (n) => (ART[n] ? ART[n].url : null),
  });
})();
