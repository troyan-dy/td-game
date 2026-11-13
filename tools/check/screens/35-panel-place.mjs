// Где встаёт панель башни — на зафиксированных сидах, в том числе на случаях, где раньше было плохо (сид 3: башня в (0,1)
// закрывала 8 клеток дороги; сид 12: башня в (4,3) — панель наезжала на свою клетку; сид 77). Башни в углах поля и в
// верхнем ряду (под плашками HUD), самого высокого вида. Жёстко: панель не закрывает свою клетку и соседние, плашки
// интерфейса, вход и склеп с соседними клетками, не выходит за экран; клеток дороги под ней — не больше ROAD_MAX.
// Клик мышью по клетке поля мимо открытой панели выбирает эту клетку (сид 12: башня в (21,9), клик по (2,11) раньше
// попадал в «Продать»). Панель не встаёт на место кнопки вызова волны и во время волны.

const ROAD_MAX = 2;                                               // клеток дороги под панелью (сумма площадей наложения / клетка)

// ближайшая к (cx, cy) клетка, где можно строить
const nearest = (ctx, cx, cy) => ctx.eval(([cx, cy]) => { const S = APP.play, cols = S.map.cols; let best = -1, bd = Infinity;
  for (let i = 0; i < cols * S.map.rows; i++) { if (!SIM.canBuild(S, i, 'dark').ok) continue;
    const d = Math.hypot(i % cols - cx, Math.floor(i / cols) - cy); if (d < bd) { bd = d; best = i; } } return best; }, [cx, cy]);
const cross = (a, b) => Math.max(0, Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]));
// прямоугольники в координатах слоя интерфейса (1600×900): панель, своя клетка с соседями, вход и склеп с соседями, дорога, плашки
const layout = (ctx, cell) => ctx.eval((cell) => { const S = APP.play, T = SIM.CONFIG.GRID.tile, cols = S.map.cols;
  const r = (e) => [e.offsetLeft, e.offsetTop, e.offsetWidth, e.offsetHeight], at = (i) => [(i % cols) * T, Math.floor(i / cols) * T, T, T];
  const around = (i) => { const [x, y] = at(i); return [x - T, y - T, 3 * T, 3 * T]; }, road = S.map.road;
  return { panel: r(document.getElementById('panel')), own: around(cell), gate: around(road[0]), crypt: around(road[road.length - 1]), road: road.map(at), tile: T,
    center: SIM.cellXY(S, cell),
    // кнопка вызова волны — и когда её нет (во время волны): после волны она вернётся на своё место
    busy: ['stats', 'seedbox', 'title', 'cards', 'wavebtn'].map((id) => { const e = document.getElementById(id); if (!e) return null;
      const hid = e.classList.contains('hidden'); e.classList.remove('hidden'); const b = e.offsetParent ? [e.id, ...r(e)] : null; if (hid) e.classList.add('hidden'); return b; }).filter(Boolean) }; }, cell);
const checkPlace = async (ctx, cell) => {
  const L = await layout(ctx, cell), p = L.panel;
  if (!p[2]) throw new Error('панель не открылась');
  if (cross(p, L.own)) throw new Error(`панель закрывает свою клетку ${cell} или соседние: панель ${p}`);
  if (cross(p, L.gate)) throw new Error('панель закрывает вход'); if (cross(p, L.crypt)) throw new Error('панель закрывает склеп');
  if (p[0] < 0 || p[1] < 0 || p[0] + p[2] > 1600 || p[1] + p[3] > 900) throw new Error('панель выходит за экран: ' + p);
  for (const [id, ...b] of L.busy) if (cross(p, b)) throw new Error(`панель наезжает на #${id}`);
  const road = L.road.reduce((n, q) => n + cross(p, q), 0) / (L.tile * L.tile);
  if (road > ROAD_MAX) throw new Error(`под панелью ${road.toFixed(1)} клеток дороги (предел ${ROAD_MAX})`);
  return road;
};
// клик мышью по центру клетки (координаты страницы из координат слоя интерфейса)
const clickCell = (ctx, cell) => ctx.eval((cell) => { const S = APP.play, [x, y] = SIM.cellXY(S, cell), r = document.getElementById('c').getBoundingClientRect();
  return [r.left + x / SIM.VIEW.W * r.width, r.top + y / SIM.VIEW.H * r.height]; }, cell).then(([x, y]) => ctx.page.mouse.click(x, y));

// [имя, сид, x, y]: башня — на ближайшей к (x, y) клетке, где можно строить
const SPOTS = [['s3_tl', 3, 0, 1], ['s3_tr', 3, 24, 1], ['s3_bl', 3, 0, 13], ['s3_br', 3, 24, 13], ['s3_title', 3, 12, 1], ['s3_stats', 3, 19, 1],
  ['s12_43', 12, 4, 3], ['s12_219', 12, 21, 9], ['s77_mid', 77, 12, 7], ['s77_tl', 77, 0, 1], ['s77_br', 77, 24, 13]];
export async function steps(ctx, g) {
  await g.newGame(ctx);
  const out = {}; let seed = -1;
  for (const [name, sd, cx, cy] of SPOTS) out[`place_${name}`] = async () => {
    if (sd !== seed) { seed = sd; await ctx.eval((sd) => { APP.newGame(sd); }, sd); await g.rich(ctx); await ctx.wait(100); }
    const cell = await nearest(ctx, cx, cy);
    if (cell < 0) throw new Error('нет клетки под постройку');
    await g.build(ctx, cell, 'dark'); await g.maxOut(ctx, cell);    // самая высокая башня, вид 3, самая высокая панель
    await g.perk(ctx, cell, await g.longestPerk(ctx, 'dark'));
    await g.select(ctx, -1); await ctx.wait(30); await g.select(ctx, cell); await ctx.wait(80);
    await checkPlace(ctx, cell); await ctx.shot(`place_${name}`);
  };
  // во время волны кнопки вызова нет, но панель не встаёт на её место: кнопка вернётся после волны
  out.place_wave_button = async () => {
    await ctx.eval(() => { APP.newGame(3); APP.play.souls = 99999; }); await ctx.wait(100);
    const cell = await nearest(ctx, 4, 4);
    await g.build(ctx, cell, 'dark'); await ctx.eval(() => { APP.cmd({ k: 'call' }); }); await ctx.wait(200);
    if (!(await ctx.eval(() => document.getElementById('wavebtn').classList.contains('hidden')))) throw new Error('во время волны кнопка вызова видна');
    await g.select(ctx, cell); await ctx.wait(80); await checkPlace(ctx, cell); await ctx.shot('place_wave_button');
  };
  out.place_click_field = async () => {
    await ctx.eval(() => { APP.newGame(12); APP.play.souls = 99999; }); await ctx.wait(100);
    const tower = await nearest(ctx, 21, 9), target = await nearest(ctx, 2, 11);
    await g.build(ctx, tower, 'bones'); await g.select(ctx, tower); await ctx.wait(80);
    await checkPlace(ctx, tower);
    await clickCell(ctx, target); await ctx.wait(80);
    const st = await ctx.eval(([a, b]) => ({ sel: SCENE.ui.sel, tower: !!APP.play.towers[a], b }), [tower, target]);
    if (!st.tower) throw new Error('клик по полю продал башню');
    if (st.sel !== target) throw new Error(`клик по клетке ${target} выбрал ${st.sel}`);
    await ctx.shot('place_click_field');
  };
  return out;
}
