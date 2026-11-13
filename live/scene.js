// live/scene.js — «Некрополис»: всё, что РИСУЕТСЯ. Чистая функция от t и состояния сима.
// Слои: фон-карта (по сгенерированной карте забега) → подсветка клетки → круг радиуса → облака яда → y-сортировка башен и врагов → снаряды и лучи → FX событий →
// атмосфера → finish → полоски здоровья и всплывающие числа (чёткие, после грейда).
// Если арта ещё нет (ASSETS[name] отсутствует), объект рисуется кодовым плейсхолдером.
(function () {
  const S = (window.SCENE = {}), L = LIB, M = L.M, W = SIM.VIEW.W, H = SIM.VIEW.H, C = SIM.CONFIG, TILE = C.GRID.tile;
  const has = (n) => !!(window.ASSETS && window.ASSETS[n]);
  const SZ = (n, def) => (window.SIZES && window.SIZES[n]) || def;
  S.REPEAT = [];
  S.ui = { sel: -1, hover: -1, armed: null, preview: null, last: 'bones', move: -1 };   // выбор игрока (пишет ui.js); sel/hover — индексы клеток; move — клетка переносимой башни (-1 — не переносим)
  S.programs = () => { L.init(W, H); L.glyphs(); L.SUN = [W * 0.15, -300]; };
  S.LIGHTS = [];
  // фон перестраивается, когда в кадре другая карта (новый забег, титульное демо)
  let bgKey = '';
  const ensureBG = (map) => { const key = map.seed + ':' + map.road.join(','); if (key === bgKey || !window.BGMAP) return;
    const b = BGMAP.build(map); G.canvasTex('bg_code', b.canvas); G.canvasTex('bg_over', b.over); S.LIGHTS = b.lights; S.bgCode = true; bgKey = key; };
  const LIGHT = { candle: [[1, 0.7, 0.3], 12, 0.55], window: [[1, 0.65, 0.25], 16, 0.5], torch: [[1, 0.6, 0.2], 26, 0.7], gate: [[1, 0.55, 0.2], 46, 0.55],
    crypt: [[0.3, 0.95, 0.88], 60, 0.5], brazier: [[0.8, 0.4, 1], 20, 0.65], water: [[0.3, 0.9, 0.85], 40, 0.12] };

  // палитра (линейные 0..1)
  const COL = {
    soul: [0.30, 0.95, 0.88], dark: [0.80, 0.38, 1.0], poison: [0.45, 0.90, 0.25], torch: [1.0, 0.62, 0.25],
    bone: [0.90, 0.85, 0.72], ink: [0.07, 0.05, 0.14], road: [0.66, 0.57, 0.78], ground: [0.12, 0.11, 0.20],
    hpOk: [0.40, 0.85, 0.35], hpLow: [0.95, 0.30, 0.25], frost: [0.70, 0.95, 1.0], heal: [1.0, 0.85, 0.45],
    ward: [0.65, 1.0, 0.55], haste: [1.0, 0.42, 0.25],
  };
  const TCOL = { bones: COL.bone, spirits: COL.soul, plague: COL.poison, dark: COL.dark };
  const TOWER_H = [86, 94, 104];                               // высота башни по уровням, view px
  const EH = { militia: 34, knight: 36, priest: 38, cart: 58, paladin: 72, scout: 31, banner: 38 };
  const HUD_SOULS = [1392, 27];                                // куда летят души (центр счётчика душ в ui.js)

  // ---------------------------------------------------------------- плейсхолдер-фон (если bgmap.js не загрузился)
  const drawPlaceholderMap = (ST) => {
    L.solid(0, 0, W, H, COL.ground);
    const R = SIM.routeOf(ST.map), P = R.pts;
    for (let i = 1; i < P.length; i++) { const a = P[i - 1], b = P[i], len = Math.hypot(b[0] - a[0], b[1] - a[1]), ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
      L.solid(a[0], a[1] - C.ROAD_HALF - 4, len + 2, 2 * C.ROAD_HALF + 8, [0.25, 0.21, 0.33], ang, 0, C.ROAD_HALF + 4); }
    for (let i = 1; i < P.length; i++) { const a = P[i - 1], b = P[i], len = Math.hypot(b[0] - a[0], b[1] - a[1]), ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
      L.solid(a[0], a[1] - C.ROAD_HALF, len + 2, 2 * C.ROAD_HALF, COL.road, ang, 0, C.ROAD_HALF); }
    const [gx, gy] = R.gate; L.glow(gx, gy, 60, COL.torch, 0.5);
    const [cx, cy] = R.crypt; L.solid(cx - 30, cy - 50, 60, 80, [0.33, 0.30, 0.42]); L.solid(cx - 10, cy - 10, 20, 40, COL.soul, 0, 0, 0, 0.8);
  };

  // ---------------------------------------------------------------- башни
  const towerName = (tw) => { for (let l = tw.lvl; l >= 1; l--) if (has(`tw_${tw.type}_${l}`)) return `tw_${tw.type}_${l}`; return `tw_${tw.type}_${tw.lvl}`; };
  const drawTower = (ST, tw, GT, t, sel) => {
    const [x, y] = SIM.cellXY(ST, tw.cell), h = TOWER_H[tw.lvl - 1];
    const age = GT - tw.built, pop = age < 0.45 ? 1 + 0.18 * Math.sin(age / 0.45 * Math.PI) * (1 - age / 0.45) : 1;   // squash при постройке
    const kick = Math.max(0, 1 - (GT - tw.fireT) / 0.18);                                                          // отдача
    L.shadow(x, y + 4, 40, 13, 0.55);
    if (sel) L.glow(x, y - h * 0.45, h * 0.7, TCOL[tw.type], 0.30, 3.2);
    const n = towerName(tw);
    if (has(n)) {
      let [w, sh] = SZ(n, [L.hsz(n, h), h]); const miss = tw.lvl - +n.slice(-1);       // уровня нет в арте: тот же спрайт крупнее
      if (miss > 0) { w *= 1 + 0.2 * miss; sh *= 1 + 0.2 * miss; }
      const face = tw.type === 'bones' && Math.cos(tw.aim) < 0 ? -1 : 1;                                       // баллиста смотрит в сторону цели
      L.sprite(n, 0, 0, { m: M.of(M.t(x, y + 10), M.s(face / Math.sqrt(pop), pop * (1 - 0.04 * kick))), w, h: sh, pivot: [w / 2, sh] });
    } else placeholderTower(tw, x, y, h * pop, kick, t);
    // живые детали поверх спрайта
    if (tw.type === 'spirits') for (let i = 0; i < 1 + tw.lvl; i++) { const a = t * 1.3 + i * 6.283 / (1 + tw.lvl), r = 24 + 4 * tw.lvl;
      const gx = x + Math.cos(a) * r, gy = y - h * 0.62 + Math.sin(a) * r * 0.45 + 4 * Math.sin(t * 3 + i);
      L.glow(gx, gy, 16, COL.soul, 0.55); L.star(gx, gy, 5, COL.soul, 0.8); }
    if (tw.type === 'plague') for (let i = 0; i < 3; i++) { const k = (t * 0.6 + i / 3) % 1;
      L.puff(x + 8 * Math.sin(i * 2 + t), y - h * 0.62 - 50 * k, 9 + 14 * k, COL.poison, 0.35 * (1 - k), i + Math.floor(t * 0.6 + i / 3) * 3); }
    if (tw.type === 'dark') { const p = 0.5 + 0.5 * Math.sin(t * 2.2 + tw.cell); L.glow(x, y - h * 0.78, 34 + 8 * tw.lvl, COL.dark, 0.25 + 0.25 * p + 0.5 * kick); }
    if (tw.type === 'spirits') L.glow(x, y - h * 0.58, 30, COL.soul, 0.35 + 0.3 * kick);
    if (tw.perk) L.glow(x, y - 8, 30, TCOL[tw.type], 0.25 + 0.1 * Math.sin(t * 3));
    const [mx, my] = SIM.muzzle(ST, tw); L.anchor('muzzle_' + tw.type, [mx, my], [x, y - SIM.MUZZLE[tw.type] - (tw.lvl - 1) * 4], 2);
  };
  const placeholderTower = (tw, x, y, h, kick, t) => {
    const c = TCOL[tw.type], dk = c.map((v) => v * 0.45);
    L.solid(x - 30, y - 16, 60, 18, [0.32, 0.29, 0.40]);                 // каменное основание
    if (tw.type === 'bones') { L.solid(x - 6, y - h * 0.7, 12, h * 0.6, dk); L.solid(x, y - h * 0.7, 56, 7, c, tw.aim, 28, 3.5); L.solid(x, y - h * 0.7, 30 - 6 * kick, 4, [0.6, 0.5, 0.4], tw.aim, 0, 2); }
    if (tw.type === 'spirits') { L.solid(x - 5, y - h * 0.9, 10, h * 0.8, [0.25, 0.22, 0.32]); L.solid(x - 14, y - h * 0.75, 28, 30, c, 0, 0, 0, 0.9); }
    if (tw.type === 'plague') { L.solid(x - 28, y - h * 0.55, 56, 36, [0.15, 0.13, 0.18]); L.solid(x - 24, y - h * 0.58, 48, 8, c); }
    if (tw.type === 'dark') { for (let i = 0; i < 10; i++) { const k = i / 10, w = 30 * (1 - k); L.solid(x - w / 2, y - 16 - h * 0.8 * (k + 0.1), w, h * 0.08 + 1, i % 3 ? dk : c); } }
    for (let i = 0; i < tw.lvl; i++) L.solid(x - 12 + i * 9, y - 4, 6, 6, [1, 0.85, 0.4]);
  };

  // ---------------------------------------------------------------- враги
  const drawEnemy = (ST, e, GT, t) => {
    const def = C.ENEMIES[e.type], h = EH[e.type], x = Math.round(e.x), y = Math.round(e.y);
    const hit = Math.max(0, 1 - (GT - e.hitT) / 0.12), frozen = e.freezeT > 0, slowed = e.slowT > 0;
    const ph = e.walk / (e.type === 'cart' ? 40 : 22) * Math.PI;
    L.shadow(x, y + 2, h * (e.type === 'cart' ? 0.85 : 0.45), h * 0.16, 0.5);
    // своего арта нет (разведчик, знаменосец) — спрайт и риг другого типа в своём цвете (look в конфиге)
    const look = def.look, as = look ? look.as : e.type;
    const n = 'en_' + as, tint = frozen ? [0.6, 0.9, 1.2, 0.6] : hit > 0 ? [3, 3, 3, hit * 0.7] : e.curseT > 0 ? [0.9, 0.5, 1.2, 0.35] : look ? look.tint.slice() : [1, 1, 1, 0];
    if (e.haste > 0) for (let j = 0; j < 3; j++) { const k = (t * 3 + j / 3 + e.id * 0.37) % 1;   // ускорен знаменосцем: полосы ветра за спиной
      L.solid(x - e.face * (10 + 14 * k), y - h * (0.25 + 0.22 * j), 14, 2, COL.haste, 0, 7, 1, 0.7 * (1 - k)); }
    let rig = window.RIGS && window.RIGS[as];
    if (!rig && e.type === 'paladin' && window.RIGS && window.RIGS.knight) {          // запасной вид босса: рыцарь крупнее, в золоте
      rig = window.RIGS.knight; if (tint[3] === 0) tint.splice(0, 4, 1.25, 1.05, 0.55, 0.38);
      L.glow(x, y - h * 0.5, h * 0.9, [1, 0.8, 0.4], 0.22 + 0.06 * Math.sin(t * 3)); }
    if (rig && rig.parts.every((p) => has(p.tex))) {
      const k = h / rig.H, moving = !frozen, rph = e.walk / rig.stride * Math.PI, bob = moving ? Math.abs(Math.cos(rph)) * h * 0.025 : 0;
      for (const p of rig.parts) {
        const a = p.kind === 'wheel' ? e.walk / (p.r * k) : p.rest + (moving ? p.swing * Math.sin(rph + p.phase) : 0);
        const tw = window.ASSETS[p.tex], s = k * p.sc, w = tw.w * s, hh = tw.h * s, lift = p.kind === 'body' ? bob : 0;
        const tn = p.dark < 1 ? [tint[0] * p.dark, tint[1] * p.dark, tint[2] * p.dark, Math.max(tint[3], 1 - p.dark)] : tint;
        L.sprite(p.tex, 0, 0, { m: M.of(M.t(x, y + 1 - lift), M.s(e.face, 1), M.t(p.at[0] * k, p.at[1] * k), M.r(a)), w, h: hh, pivot: [p.jt[0] * s, p.jt[1] * s],
          u: { tint: p.dark < 1 && tint[3] === 0 ? [0.55, 0.5, 0.7, 1 - p.dark] : tn } });
      }
      if (rig.light) { const k2 = h / rig.H; rig.light.forEach((l, j) => L.glow(x + e.face * l[0] * k2, y + l[1] * k2 + 1 - (j ? 0 : 0), 18, COL.torch, 0.55 + 0.15 * Math.sin(t * 9 + e.id + j * 2) * Math.sin(t * 5.3 + e.id))); }
    } else if (has(n)) { const w = L.hsz(n, h);
      L.sprite(n, 0, 0, { m: M.of(M.t(x, y + 2), M.s(e.face, 1)), w, h, pivot: [w / 2, h], u: { tint } });
    } else {
      const base = { militia: [0.55, 0.50, 0.48], knight: [0.72, 0.74, 0.80], priest: [0.92, 0.88, 0.80], cart: [0.45, 0.28, 0.20], paladin: [0.85, 0.80, 0.55] }[e.type];
      const col = hit > 0 ? [1, 1, 1] : frozen ? [0.6, 0.85, 1] : base, bob = e.type === 'cart' ? 0 : Math.abs(Math.sin(ph)) * 2;
      if (e.type === 'cart') { L.solid(x - 30, y - h, 60, h - 10, col); for (const wx of [-20, 18]) L.solid(x + wx - 7, y - 14, 14, 14, [0.25, 0.18, 0.12], ph, 7, 7); L.glow(x - 26 * e.face, y - h + 4, 16, COL.torch, 0.6); }
      else { const w = h * 0.5; L.solid(x - w / 2, y - h - bob, w, h * 0.75, col); L.solid(x - w * 0.3, y - h * 1.12 - bob, w * 0.6, h * 0.3, [0.85, 0.72, 0.62]);
        for (const sd of [-1, 1]) L.solid(x + sd * w * 0.22 - 3, y - h * 0.3, 6, h * 0.3, [0.3, 0.27, 0.3], Math.sin(ph) * 0.5 * sd, 3, 0);
        if (e.type === 'knight' || e.type === 'paladin') L.solid(x + e.face * w * 0.45 - 6, y - h * 0.8 - bob, 12, h * 0.45, [0.75, 0.18, 0.2]);
        if (e.type === 'priest') L.glow(x + e.face * w * 0.6, y - h * 0.9, 12, COL.torch, 0.7 + 0.2 * Math.sin(t * 9 + e.id)); }
    }
    if (e.type === 'banner') { const wv = Math.sin(t * 6 + e.id), px = x - e.face * 8, top = y - h - 26;   // древко и полотнище знамени
      L.solid(px - 1.5, top, 3, h + 18, [0.35, 0.25, 0.18]);
      L.solid(e.face > 0 ? px - 18 : px, top + 2, 18, 12, [0.85, 0.18, 0.14], wv * 0.12, e.face > 0 ? 18 : 0, 0);   // полотнище вьётся назад L.star(px, top, 4, [1, 0.85, 0.4], 0.9); }
    if (e.ward > 0) L.glow(x, y - h * 0.5, h * 0.65, COL.ward, 0.22 + 0.08 * Math.sin(t * 8 + e.id));   // щит разведчика: первое попадание пройдёт мимо
    if (slowed && !frozen) L.glow(x, y - h * 0.4, h * 0.6, COL.soul, 0.18);
    if (e.curseT > 0) L.glow(x, y - h * 0.6, h * 0.55, COL.dark, 0.25);
    if (Object.keys(e.poison).length) L.puff(x, y - h * 0.4, h * 0.45, COL.poison, 0.22, e.id + Math.floor(t * 4));
  };

  // ---------------------------------------------------------------- клетки и радиус
  // рамка клетки: ok — можно строить (светлая), no — нельзя (красноватая), sel — выбранная (золотая)
  const drawCell = (ST, cell, kind, t) => {
    const x = (cell % ST.map.cols) * TILE, y = Math.floor(cell / ST.map.cols) * TILE, b = 3;
    const col = kind === 'sel' ? [1, 0.85, 0.5] : kind === 'ok' ? [0.80, 0.95, 0.90] : [1, 0.35, 0.35], a = kind === 'sel' ? 0.95 : 0.75 + 0.15 * Math.sin(t * 5);
    L.solid(x, y, TILE, TILE, col, 0, 0, 0, kind === 'no' ? 0.16 : 0.12);
    L.solid(x, y, TILE, b, col, 0, 0, 0, a); L.solid(x, y + TILE - b, TILE, b, col, 0, 0, 0, a);
    L.solid(x, y + b, b, TILE - 2 * b, col, 0, 0, 0, a); L.solid(x + TILE - b, y + b, b, TILE - 2 * b, col, 0, 0, 0, a);
  };
  // сетка игровых клеток (не дорога, не интерфейс, не препятствие): линии между клетками, слитые в отрезки — десятки квадов, а не сотни
  let gridKey = '', gridSegs = [];
  const gridOf = (ST) => { const m = ST.map, key = m.seed + ':' + m.road.join(','); if (key === gridKey) return gridSegs;
    const road = new Set(m.road), play = (x, y) => x >= 0 && y >= 0 && x < m.cols && y < m.rows && !road.has(y * m.cols + x) && !SIM.MAPGEN.hud(m, y * m.cols + x) && !SIM.MAPGEN.obstacle(m, y * m.cols + x), out = [];
    for (let r = 0; r <= m.rows; r++) for (let x = 0; x < m.cols;) { if (!(play(x, r - 1) || play(x, r))) { x++; continue; }
      const x0 = x; while (x < m.cols && (play(x, r - 1) || play(x, r))) x++; out.push([x0 * TILE, r * TILE - 1, (x - x0) * TILE, 2]); }
    for (let c = 0; c <= m.cols; c++) for (let y = 0; y < m.rows;) { if (!(play(c - 1, y) || play(c, y))) { y++; continue; }
      const y0 = y; while (y < m.rows && (play(c - 1, y) || play(c, y))) y++; out.push([c * TILE - 1, y0 * TILE, 2, (y - y0) * TILE]); }
    gridKey = key; gridSegs = out; return out; };
  const drawGrid = (ST, a) => { for (const [x, y, w, h] of gridOf(ST)) L.solid(x, y, w, h, [0.78, 0.74, 0.95], 0, 0, 0, a); };
  // клетки списка cells залить цветом col: подряд идущие в строке — одной полосой
  const fillCells = (ST, cells, col, a) => { const n = ST.map.cols; let run = null;
    const flush = () => { if (run) L.solid((run[0] % n) * TILE + 3, Math.floor(run[0] / n) * TILE + 3, run[1] * TILE - 6, TILE - 6, col, 0, 0, 0, a); run = null; };
    for (const c of cells) { if (run && c === run[0] + run[1] && Math.floor(c / n) === Math.floor(run[0] / n)) run[1]++; else { flush(); run = [c, 1]; } }
    flush(); };
  const drawRange = (x, y, r, col, t, a = 1) => {                // пунктирный круг дальности (как на референсе)
    L.ring(x, y, r, r * 0.92, col, 0.35 * a, 0.012);
    const n = Math.round(r / 7);
    for (let i = 0; i < n; i++) { const an = (i / n) * 6.283 + t * 0.15, px = x + Math.cos(an) * r, py = y + Math.sin(an) * r * 0.92;
      if (i % 2 === 0) L.solid(px - 4, py - 1.5, 8, 3, col, an + Math.PI / 2, 4, 1.5, 0.9 * a); }
  };

  // ---------------------------------------------------------------- особые клетки
  // на клетке: слабая заливка, уголки по краям и свечение — край клетки виден из-под башни; в правом верхнем углу — значок
  // (рисуется поверх всего; нижний угол клеток над карточками башен закрыт интерфейсом)
  const BLOCKED = ['road', 'obstacle'];                                   // на таких клетках подсветка красная, круга будущей башни нет
  const SPC = { mound: [1.0, 0.68, 0.30], well: COL.soul, cursed: [1.0, 0.22, 0.36] };
  const drawSpecialGround = (ST, t) => { const b = 3, l = 16;
    for (const s of ST.map.specials || []) {
      const x = (s.cell % ST.map.cols) * TILE, y = Math.floor(s.cell / ST.map.cols) * TILE, c = SPC[s.kind], p = 0.8 + 0.2 * Math.sin(t * 2 + s.cell);
      L.solid(x + 2, y + 2, TILE - 4, TILE - 4, c, 0, 0, 0, 0.13 * p);
      for (const [cx, cy, sx, sy] of [[x + 2, y + 2, 1, 1], [x + TILE - 2, y + 2, -1, 1], [x + 2, y + TILE - 2, 1, -1], [x + TILE - 2, y + TILE - 2, -1, -1]]) {
        L.solid(sx > 0 ? cx : cx - l, sy > 0 ? cy : cy - b, l, b, c, 0, 0, 0, 0.9 * p); L.solid(sx > 0 ? cx : cx - b, sy > 0 ? cy : cy - l, b, l, c, 0, 0, 0, 0.9 * p); }
      L.glow(x + TILE / 2, y + TILE / 2, TILE * 0.62, c, 0.16 + 0.06 * Math.sin(t * 1.5 + s.cell));
    } };
  // значок 22×22 с центром (x, y): курган — холм, источник — капля души, проклятая земля — череп
  const badge = (kind, x, y) => { const c = SPC[kind], q = (i, j, w, h, col) => L.solid(x - 8 + i * 2, y - 8 + j * 2, w * 2, h * 2, col);
    L.solid(x - 11, y - 11, 22, 22, [0.04, 0.03, 0.08], 0, 0, 0, 0.92); L.solid(x - 11, y - 11, 22, 2, c); L.solid(x - 11, y + 9, 22, 2, c); L.solid(x - 11, y - 9, 2, 18, c); L.solid(x + 9, y - 9, 2, 18, c);
    if (kind === 'mound') { q(3, 3, 2, 1, c); q(2, 4, 4, 1, c); q(1, 5, 6, 1, c); q(0, 6, 8, 2, [0.62, 0.42, 0.20]); q(3, 0, 2, 2, [1, 0.95, 0.75]); }
    else if (kind === 'well') { q(3, 0, 2, 1, c); q(2, 1, 4, 2, c); q(1, 3, 6, 3, c); q(2, 6, 4, 1, c); q(2, 2, 1, 2, [0.85, 1, 1]); }
    else { q(1, 0, 6, 5, [0.92, 0.88, 0.80]); q(2, 5, 4, 2, [0.92, 0.88, 0.80]); q(2, 2, 1, 2, c); q(5, 2, 1, 2, c); q(3, 6, 1, 1, [0.1, 0.05, 0.1]); q(4, 6, 1, 1, [0.1, 0.05, 0.1]); } };

  // ---------------------------------------------------------------- рендер
  S.render = (t) => {
    const ST = S.state || SIM.at(t), GT = ST.t, rnd = L.rnd, ui = S.ui;
    // тряска: прорыв к склепу, приход босса
    let shk = 0;
    for (const e of ST.ev) { const a = GT - e.t; if (a < 0) continue;
      if (e.k === 'leak' && a < 0.35) shk = Math.max(shk, (e.boss ? 9 : 4) * (1 - a / 0.35) ** 2);
      if (e.k === 'boss' && a < 0.8) shk = Math.max(shk, 5 * (1 - a / 0.8) ** 2); }
    const ox = shk * Math.sin(GT * 91), oy = shk * Math.sin(GT * 117);

    ensureBG(ST.map);
    L.beginBG([0.06, 0.05, 0.11, 1]);
    if (S.bgCode) L.sprite('bg_code', ox, oy, { w: W, h: H }); else drawPlaceholderMap(ST);
    L.beginComp();
    // свет склепа и ворот (пульс), вспышка при прорыве
    let leakFlash = 0; for (const e of ST.ev) { const a = GT - e.t; if (e.k === 'leak' && a >= 0 && a < 0.6) leakFlash = Math.max(leakFlash, 1 - a / 0.6); }
    const [kx, ky] = SIM.routeOf(ST.map).crypt;
    L.glow(kx + ox, ky - 20 + oy, 60, leakFlash > 0 ? [1, 0.3, 0.35] : COL.soul, 0.35 + 0.12 * Math.sin(t * 1.7) + 0.6 * leakFlash);
    S.LIGHTS.forEach(([lx, ly, kind], i) => { const [c, r, a] = LIGHT[kind], fl = kind === 'water' || kind === 'crypt' ? Math.sin(t * 0.9 + i) * 0.3 : Math.sin(t * 11 + i * 2.3) * Math.sin(t * 7.3 + i) * 0.35;
      L.glow(lx + ox, ly + oy, r, c, a * (1 + fl)); });

    drawSpecialGround(ST, t);
    // сетка проявляется в паузе между волнами и при выбранной башне; при переносе ярче, допустимые клетки подсвечены
    const moving = !ST.demo && ui.move >= 0 && !!ST.towers[ui.move];
    if (!ST.demo && (moving || ST.phase === 'prep' || (ui.sel >= 0 && ST.towers[ui.sel]))) drawGrid(ST, moving ? 0.26 : 0.12);
    if (moving) {
      const mt = ST.towers[ui.move], col = TCOL[mt.type], cells = SIM.moveCells(ST, ui.move), ok = ui.hover >= 0 && cells.includes(ui.hover);
      fillCells(ST, cells, [0.86, 0.94, 1.0], 0.17 + 0.05 * Math.sin(t * 4));        // светлая заливка: бирюза сливается с травой фона
      drawCell(ST, ui.move, 'sel', t);
      if (ui.hover >= 0 && ui.hover !== ui.move) drawCell(ST, ui.hover, ok ? 'ok' : 'no', t);
      if (ok) { const [x, y] = SIM.cellXY(ST, ui.hover), [fx, fy] = SIM.cellXY(ST, ui.move), d = Math.hypot(x - fx, y - fy), ang = Math.atan2(y - fy, x - fx);
        const lc = col.map((v) => v + (1 - v) * 0.45);                   // цвет башни, разбавленный белым: тёмные башни видно на тёмном фоне
        for (let k = 18; k < d - 18; k += 22) L.solid(fx + Math.cos(ang) * k, fy + Math.sin(ang) * k, 12, 4, lc, ang, 6, 2, 0.9);   // пунктир «откуда — куда»
        // превью радиуса на новой клетке: мягкая кайма и линия ровно по радиусу (кольцо L.ring лежит на 0.85 своего квада),
        // пунктир круга — не ярче пунктира «откуда — куда»
        const r = SIM.moveRangePx(ST, ui.move, ui.hover), R = r / 0.85;
        L.ring(x, y, R, R * 0.92, lc, 0.16, 0.15); L.ring(x, y, R, R * 0.92, lc, 0.3, 0.012); drawRange(x, y, r, lc, t, 0.75); }
    }
    // клетки: выбранная и под курсором; круг дальности выбранной башни или будущей башни (на выбранной клетке или под курсором)
    if (!ST.demo && !moving) {
      const selT = ui.sel >= 0 ? ST.towers[ui.sel] : null, pType = ui.preview || ui.armed || ui.last;
      if (ui.sel >= 0) drawCell(ST, ui.sel, 'sel', t);
      if (ui.hover >= 0 && ui.hover !== ui.sel && !ST.towers[ui.hover]) drawCell(ST, ui.hover, BLOCKED.includes(SIM.canBuild(ST, ui.hover, pType).reason) ? 'no' : 'ok', t);
      if (selT) { const [x, y] = SIM.cellXY(ST, ui.sel); drawRange(x, y, SIM.rangePx(ST, selT), TCOL[selT.type], t); }
      else if (ui.sel >= 0) { const [x, y] = SIM.cellXY(ST, ui.sel); drawRange(x, y, SIM.buildRangePx(ST, ui.sel, pType), TCOL[pType], t, 0.8); }
      else if (ui.hover >= 0 && ui.armed && !ST.towers[ui.hover] && !BLOCKED.includes(SIM.canBuild(ST, ui.hover, ui.armed).reason)) {
        const [x, y] = SIM.cellXY(ST, ui.hover); drawRange(x, y, SIM.buildRangePx(ST, ui.hover, ui.armed), TCOL[ui.armed], t, 0.7); }
      if (ui.hover >= 0 && ST.towers[ui.hover] && ui.hover !== ui.sel) { const h = ST.towers[ui.hover], [x, y] = SIM.cellXY(ST, ui.hover); drawRange(x, y, SIM.rangePx(ST, h), TCOL[h.type], t, 0.45); }
    }

    // облака яда (на земле)
    for (const c of ST.clouds) { const k = c.t / c.T, fade = Math.min(1, k * 3) * Math.min(1, (1 - k) * 8 + 0.2);
      for (let j = 0; j < 6; j++) { const an = j * 1.047 + rnd(c.x, j) * 2 + GT * 0.4, rr = c.r * (0.35 + 0.35 * rnd(c.y, j));
        L.puff(c.x + Math.cos(an) * rr, c.y + Math.sin(an) * rr * 0.6 - 6, c.r * 0.55, c.acid ? [0.7, 0.95, 0.2] : COL.poison, 0.32 * fade, j + Math.floor(c.x)); }
      L.glow(c.x, c.y, c.r * 1.1, COL.poison, 0.18 * fade); }
    // аура знаменосца на земле: кольцо ровно по радиусу ускорения (кольцо L.ring лежит на 0.85 своего квада)
    for (const e of ST.enemies) { const d = C.ENEMIES[e.type]; if (!d.haste) continue; const R = d.hasteR * C.UNIT / 0.85, p = 0.5 + 0.5 * Math.sin(t * 4 + e.id);
      L.ring(e.x, e.y, R, R * 0.92, COL.haste, 0.30 + 0.15 * p, 0.03); L.glow(e.x, e.y, d.hasteR * C.UNIT, COL.haste, 0.08 + 0.05 * p); }

    // y-сортировка
    const Y = [];
    ST.towers.forEach((tw) => { if (tw) Y.push([SIM.cellXY(ST, tw.cell)[1], 0, tw.id, () => drawTower(ST, tw, GT, t, ui.sel === tw.cell || ui.hover === tw.cell)]); });
    for (const e of ST.enemies) Y.push([e.y, 1, e.id, () => drawEnemy(ST, e, GT, t)]);
    Y.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]).forEach((d) => d[3]());
    if (S.bgCode) L.sprite('bg_over', ox, oy, { w: W, h: H });          // перемычки арок входа и склепа: враги проходят под ними

    // снаряды
    for (const s of ST.shots) {
      if (s.k === 'bolt') { const a = s.dx !== undefined ? Math.atan2(s.dy, s.dx) : Math.atan2(s.ly - s.y, s.lx - s.x);
        if (has('fx_bolt')) L.sprite('fx_bolt', 0, 0, { m: M.of(M.t(s.x, s.y), M.r(a)), w: 34, h: 10, pivot: [28, 5] });
        else { L.solid(s.x, s.y, 30, 4, COL.bone, a, 26, 2); L.solid(s.x, s.y, 8, 7, [0.95, 0.95, 0.9], a, 4, 3.5); } }
      else if (s.k === 'ghost') { const wob = Math.sin(GT * 14 + s.seed * 20) * 3;
        L.glow(s.x, s.y + wob, 22, COL.soul, 0.7); L.star(s.x, s.y + wob, 8, [0.8, 1, 1], 0.9);
        for (let j = 1; j < 4; j++) L.glow(s.x - (s.lx - s.x) * 0.02 * j, s.y + wob + j * 2, 12 - j * 2, COL.soul, 0.3 / j); }
      else if (s.k === 'blob') { L.glow(s.x, s.y, 18, COL.poison, 0.6); L.puff(s.x, s.y, 9, COL.poison, 0.9, s.tw); }
    }
    // лучи тьмы
    for (const b of ST.beams) { const a = GT - b.t, k = 1 - a / 0.35; if (k <= 0) continue;
      const dx = b.x1 - b.x0, dy = b.y1 - b.y0, len = Math.hypot(dx, dy), ang = Math.atan2(dy, dx);
      L.solid(b.x0, b.y0, len, 7 * k, COL.dark, ang, 0, 3.5 * k, 0.7 * k); L.solid(b.x0, b.y0, len, 2.5 * k, [1, 0.85, 1], ang, 0, 1.25 * k, 0.9 * k);
      L.glow(b.x1, b.y1, 30, COL.dark, 0.8 * k); L.glow(b.x0, b.y0, 22, COL.dark, 0.7 * k);
      if (has('fx_skull')) L.sprite('fx_skull', b.x0 + dx * (1 - k) - 9, b.y0 + dy * (1 - k) - 9, { w: 18, h: 18, u: { alpha: k } }); }

    // FX событий
    for (const e of ST.ev) { const a = GT - e.t; if (a < 0) continue;
      if (e.k === 'die' && a < 0.9) { const q = a / 0.9;
        for (let j = 0; j < 5; j++) L.puff(e.x + (rnd(e.t, j) - 0.5) * 30 * (0.4 + q), e.y - 10 - 26 * q * rnd(e.t, j + 5), 8 + 14 * q, [0.55, 0.5, 0.65], 0.45 * (1 - q), e.t * 7 + j);
        // душа летит к счётчику
        const u = Math.min(1, Math.max(0, (a - 0.15) / 0.75)), ease = u * u * (3 - 2 * u), sx = e.x, sy = e.y - 24;
        const px = sx + (HUD_SOULS[0] - sx) * ease, py = sy + (HUD_SOULS[1] - sy) * ease - Math.sin(Math.PI * u) * 80;
        if (u < 1) { L.glow(px, py, 18, COL.soul, 0.7); L.star(px, py, 7, [0.85, 1, 1], 0.9); } }
      if (e.k === 'hit' && a < 0.18) { const q = a / 0.18; L.star(e.x, e.y, 12 * (1 - q) + 4, e.kind === 'ghost' ? COL.soul : [1, 0.95, 0.85], 1 - q); }
      if (e.k === 'cloud' && a < 0.4) { const q = a / 0.4; L.ring(e.x, e.y, 20 + 30 * q, (20 + 30 * q) * 0.6, COL.poison, 0.8 * (1 - q), 0.2); }
      if ((e.k === 'build' || e.k === 'upgrade' || e.k === 'perk') && a < 0.7) { const q = a / 0.7, c = e.k === 'build' ? [0.85, 0.8, 0.95] : [1, 0.85, 0.45];
        L.ring(e.x, e.y, 30 + 50 * q, (30 + 50 * q) * 0.5, c, 0.9 * (1 - q), 0.15);
        for (let j = 0; j < 6; j++) L.puff(e.x + (j - 2.5) * 12 * (1 + q), e.y - 4 - 14 * q, 7 + 8 * q, [0.5, 0.45, 0.6], 0.4 * (1 - q), j + e.t);
        if (e.k !== 'build') for (let j = 0; j < 7; j++) { const an = j * 0.9 + e.t, rr = 20 + 50 * q; L.star(e.x + Math.cos(an) * rr, e.y - 50 - 40 * q + Math.sin(an) * rr * 0.5, 9, c, 1 - q); } }
      if (e.k === 'move' && a < 0.6) { const q = a / 0.6;                // перенос: пыль на старой клетке, кольцо на новой
        for (let j = 0; j < 6; j++) L.puff(e.fx + (j - 2.5) * 10, e.fy - 8 - 24 * q, 9 + 9 * q, [0.5, 0.45, 0.6], 0.45 * (1 - q), j + 3);
        L.ring(e.x, e.y, 26 + 40 * q, (26 + 40 * q) * 0.5, COL.soul, 0.8 * (1 - q), 0.15); }
      if (e.k === 'sell' && a < 0.6) { const q = a / 0.6; for (let j = 0; j < 8; j++) L.puff(e.x + (j - 3.5) * 9, e.y - 10 - 30 * q, 10 + 10 * q, [0.5, 0.45, 0.6], 0.5 * (1 - q), j); }
      if (e.k === 'heal' && e.any && a < 0.6) { const q = a / 0.6; L.ring(e.x, e.y - 14, 20 + 50 * q, (20 + 50 * q) * 0.55, COL.heal, 0.7 * (1 - q), 0.12); }
      if (e.k === 'miss' && a < 0.4) { const q = a / 0.4; L.ring(e.x, e.y, 18 + 26 * q, (18 + 26 * q) * 0.9, COL.ward, 0.8 * (1 - q), 0.15); }
      if (e.k === 'freeze' && a < 0.6) { const q = a / 0.6; for (let j = 0; j < 4; j++) L.star(e.x + (j - 1.5) * 8, e.y - 20 - 10 * q, 8, COL.frost, 1 - q); }
      if (e.k === 'leak' && a < 0.8) { const q = a / 0.8; L.ring(e.x, e.y - 20, 40 + 90 * q, (40 + 90 * q) * 0.6, [1, 0.35, 0.4], 0.9 * (1 - q), 0.12); }
      if (e.k === 'harvest' && a < 0.7) { const q = a / 0.7; L.glow(e.x, e.y - 30 - 30 * q, 14, COL.dark, 0.7 * (1 - q)); }
      if (e.k === 'fire' && e.type === 'bones' && a < 0.1) L.star(e.x, e.y, 10, [1, 0.95, 0.8], 1 - a / 0.1);
    }

    // атмосфера: бирюзовые огоньки-души над кладбищем (окна с джиттером, без точных периодов)
    for (let i = 0; i < 16; i++) { const per = 9 + rnd(i, 1) * 7, k = Math.floor((t + rnd(i, 2) * per) / per), u = ((t + rnd(i, 2) * per) / per) % 1;
      if (rnd(i, k + 3) < 0.25) continue;
      const x = 80 + rnd(i, k + 7) * (W - 160) + Math.sin(t * 0.7 + i) * 20, y = 120 + rnd(i, k + 9) * (H - 200) - u * 40;
      L.glow(x, y, 10, COL.soul, 0.35 * Math.sin(Math.PI * u)); }
    L.fog(H * 0.55, H * 0.5, [0.0016, 0.012, 0.55, 0.18], [0.35, 0.30, 0.55], 3, t, 0);

    L.finish(t, { bloom: [0.20, 0.18], vignette: 0.9, warm: 0.25, roll: 0.6, dither: 1 });

    // выбрана карточка башни: цена постройки на клетке под курсором (с наценкой особой клетки — красная)
    if (!ST.demo && ui.armed && ui.hover >= 0 && !ST.towers[ui.hover]) { const cb = SIM.canBuild(ST, ui.hover, ui.armed);
      if (!BLOCKED.includes(cb.reason)) { const [x, y] = SIM.cellXY(ST, ui.hover);
        L.label('buildcost', String(cb.cost), x, y - 40, { size: 20, col: cb.cost !== cb.base ? '#ff8aa0' : '#7ff5e6', out: '#14081a', al: 0.5 }); } }
    // значки особых клеток — поверх всего (и башен): метка видна, даже когда на клетке стоит башня
    for (const s of ST.map.specials || []) { const x = (s.cell % ST.map.cols) * TILE, y = Math.floor(s.cell / ST.map.cols) * TILE; badge(s.kind, x + TILE - 13, y + 13); }

    // полоски здоровья (как на референсе: тонкая полоса над головой)
    for (const e of ST.enemies) { const h = EH[e.type], k = Math.max(0, e.hp / e.max), w = e.type === 'paladin' ? 44 : e.type === 'cart' ? 40 : 24;
      const x = Math.round(e.x - w / 2), y = Math.round(e.y - h - 10);
      L.solid(x - 1, y - 1, w + 2, 6, [0.05, 0.03, 0.08]); L.solid(x, y, w, 4, [0.35, 0.08, 0.1]);
      L.solid(x, y, Math.round(w * k), 4, k > 0.5 ? COL.hpOk : k > 0.25 ? [0.95, 0.75, 0.25] : COL.hpLow); }
    // всплывающие души
    let fi = 0;
    for (const e of ST.ev) { const a = GT - e.t; if (a < 0 || a > 1.1) continue;
      if ((e.k === 'die' || e.k === 'harvest' || e.k === 'well') && e.souls) { const q = a / 1.1; L.label('f' + (fi++ % 40), '+' + e.souls, e.x, e.y - 40 - 30 * q, { size: 18, col: '#7ff5e6', out: '#0b2a2c', a: 1 - q * q, al: 0.5 }); }
      if (e.k === 'miss') { const q = a / 1.1; L.label('f' + (fi++ % 40), 'ПРОМАХ', e.x, e.y - 34 - 30 * q, { size: 17, col: '#c8ff9e', out: '#132a0b', a: 1 - q * q, al: 0.5 }); }
      if (e.k === 'leak') { const q = a / 1.1; L.label('f' + (fi++ % 40), '−' + e.dmg, e.x, e.y - 90 - 30 * q, { size: 26, col: '#ff6b6b', out: '#2a0b0b', a: 1 - q * q, al: 0.5 }); } }
  };

  // QA-хуки для qa.mjs: кадр как на референсе (волна 9), экраны HUD живут в DOM (ui.js) и проверяются tools/uicheck.mjs
  S.QA = () => {
    const match = SIM.at(12);
    // циклы ходьбы: один враг на прямом участке, 8 кадров на полный шаг
    const cycles = {}, sprites = {}, boxes = {};
    for (const type of Object.keys(window.RIGS || {})) {
      const rig = window.RIGS[type], arr = [];
      for (let i = 0; i < 8; i++) {
        const s = SIM.create(5); const e = { id: 1, type, d: 600, hp: 1, max: 1, lane: 0, slowK: 0, slowT: 0, freezeT: 0, curseT: 0, shred: 0, shredT: 0, poison: {}, hitT: -9, x: 700, y: 330, face: 1, walk: i * rig.stride * 2 / 8, aura: 0 };
        s.enemies = [e]; s.t = 10; arr.push(s);
      }
      cycles[type] = arr; sprites[type] = rig.parts.map((p) => p.tex); boxes[type] = [660, 330 - EH[type] - 14, 80, EH[type] + 20];
    }
    return { states: [['match', match]], cycles, sprites, box: (name) => boxes[name] || [0, 0, W, H] };
  };
})();
