// Где встаёт панель башни: у башен в четырёх углах поля и в верхнем ряду (под плашками HUD) панель не закрывает свою
// клетку и башню, не наезжает на плашки интерфейса и не выходит за экран; высокие башни верхнего ряда (вид 3) не уходят
// под HUD. Клик мышью по клетке поля мимо открытой панели выбирает эту клетку, а не нажимает кнопки панели (сид 12:
// башня в (21,9), клик по (2,11) раньше попадал в «Продать»).

// ближайшая к (cx, cy) клетка, где можно строить
const nearest = (ctx, cx, cy) => ctx.eval(([cx, cy]) => { const S = APP.play, cols = S.map.cols; let best = -1, bd = Infinity;
  for (let i = 0; i < cols * S.map.rows; i++) { if (!SIM.canBuild(S, i, 'dark').ok) continue;
    const d = Math.hypot(i % cols - cx, Math.floor(i / cols) - cy); if (d < bd) { bd = d; best = i; } } return best; }, [cx, cy]);
// прямоугольники в координатах слоя интерфейса (1600×900): панель, клетка с башней, плашки
const layout = (ctx, cell) => ctx.eval((cell) => { const S = APP.play, T = SIM.CONFIG.GRID.tile, cols = S.map.cols;
  const r = (e) => [e.offsetLeft, e.offsetTop, e.offsetWidth, e.offsetHeight];
  return { panel: r(document.getElementById('panel')), cell: [(cell % cols) * T, Math.floor(cell / cols) * T, T, T],
    busy: ['stats', 'seedbox', 'title', 'cards', 'wavebtn'].map((id) => document.getElementById(id)).filter((e) => e && e.offsetParent).map((e) => [e.id, ...r(e)]) }; }, cell);
const cross = (a, b) => Math.max(0, Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]));
const checkPlace = async (ctx, cell) => {
  const L = await layout(ctx, cell), p = L.panel;
  if (!p[2]) throw new Error('панель не открылась');
  if (cross(p, L.cell)) throw new Error(`панель закрывает свою клетку ${cell}: панель ${p}, клетка ${L.cell}`);
  if (p[0] < 0 || p[1] < 0 || p[0] + p[2] > 1600 || p[1] + p[3] > 900) throw new Error('панель выходит за экран: ' + p);
  for (const [id, ...b] of L.busy) if (cross(p, b)) throw new Error(`панель наезжает на #${id}`);
};
// клик мышью по центру клетки (координаты страницы из координат слоя интерфейса)
const clickCell = (ctx, cell) => ctx.eval((cell) => { const S = APP.play, [x, y] = SIM.cellXY(S, cell), r = document.getElementById('c').getBoundingClientRect();
  return [r.left + x / SIM.VIEW.W * r.width, r.top + y / SIM.VIEW.H * r.height]; }, cell).then(([x, y]) => ctx.page.mouse.click(x, y));

const SPOTS = [['corner_tl', 0, 1], ['corner_tr', 24, 1], ['corner_bl', 0, 13], ['corner_br', 24, 13], ['top_title', 12, 1], ['top_stats', 19, 1]];
export async function steps(ctx, g) {
  await g.newGame(ctx); await g.rich(ctx); await ctx.eval(() => { APP.play.prepT = 999; });   // шагов много: волна не должна начаться посреди экрана
  const out = {}, used = new Set();
  for (const [name, cx, cy] of SPOTS) out[`place_${name}`] = async () => {
    const cell = await nearest(ctx, cx, cy);
    if (cell < 0) throw new Error('нет клетки под постройку');
    if (!used.has(cell)) { used.add(cell); await g.build(ctx, cell, 'dark'); await g.maxOut(ctx, cell); }   // самая высокая башня, вид 3
    await g.select(ctx, -1); await ctx.wait(30); await g.select(ctx, cell); await ctx.wait(80);
    await checkPlace(ctx, cell); await ctx.shot(`place_${name}`);
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
