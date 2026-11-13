// Препятствия и особые клетки: меню постройки на кургане, источнике душ и проклятой земле (вид, бонус, цены с наценкой),
// цена с наценкой до клика в режиме «сначала карточка», башни на всех особых клетках (метки видны из-под башен),
// клик мышью по препятствию не открывает панель и не строит.
const special = (ctx, kind) => ctx.eval((k) => APP.play.map.specials.find((s) => s.kind === k).cell, kind);
// клик мышью по центру клетки на холсте
const cellPoint = async (ctx, cell) => { const box = await (await ctx.need('#c')).boundingBox(), cols = await ctx.eval(() => APP.play.map.cols);
  return [box.x + ((cell % cols) + 0.5) * 64 * box.width / 1600, box.y + (Math.floor(cell / cols) + 0.5) * 64 * box.height / 900]; };
const clickCell = async (ctx, cell) => { await ctx.page.mouse.click(...await cellPoint(ctx, cell)); await ctx.wait(100); };

const menu = (kind) => async (ctx, g) => {
  // пауза не кончается посреди экрана: иначе волна и окно «Новый враг» закроют поле от мыши
  if (kind === 'mound') { await g.newGame(ctx, 1); await g.rich(ctx); }
  const cell = await special(ctx, kind); await g.select(ctx, cell); await ctx.wait(100);
  const want = await ctx.eval(([k, cell]) => ({ name: SIM.CONFIG.SPECIAL[k].name, desc: SIM.CONFIG.SPECIAL[k].desc,
    costs: SIM.CONFIG.TOWER_ORDER.map((t) => SIM.canBuild(APP.play, cell, t).cost) }), [kind, cell]);
  const text = await (await ctx.need('#panel.show')).innerText();
  for (const s of [want.name, want.desc, ...want.costs.map(String)]) if (!text.toLowerCase().includes(s.toLowerCase())) throw new Error(`в меню постройки нет «${s}»: ${text.replace(/\s+/g, ' ')}`);
  await ctx.shot('cells_menu_' + kind);
};

export const steps = {
  cells_menu_mound: menu('mound'),
  cells_menu_well: menu('well'),
  cells_menu_cursed: menu('cursed'),
  // сначала карточка, потом клетка: цена с наценкой видна до клика — на карточке и над клеткой под курсором
  cells_armed_price: async (ctx, g) => {
    const types = await g.towerTypes(ctx), t = types[types.length - 1];
    await g.select(ctx, -1); await ctx.eval((t) => { SCENE.ui.armed = t; }, t);
    for (let i = 0; i < 30 && await ctx.eval(() => document.getElementById('panel').classList.contains('show')); i++) await ctx.wait(50);
    // проклятая клетка, до которой мышь достаёт: на части карт клетку закрывает плашка интерфейса (кнопка волны, разведка)
    let cell = -1, pt = null;
    for (const c of await ctx.eval(() => APP.play.map.specials.filter((s) => s.kind === 'cursed').map((s) => s.cell))) {
      const p = await cellPoint(ctx, c); if (await ctx.eval(([x, y]) => document.elementFromPoint(x, y) === document.getElementById('c'), p)) { cell = c; pt = p; break; } }
    if (cell < 0) return ctx.skip('все проклятые клетки этой карты закрыты интерфейсом');
    await ctx.page.mouse.move(pt[0] + 20, pt[1] + 20); await ctx.page.mouse.move(...pt); await ctx.wait(150);
    const want = await ctx.eval(([c, t]) => SIM.canBuild(APP.play, c, t), [cell, t]);
    const price = await ctx.need(`.card[data-type="${t}"] .pr`);
    let shown = await price.innerText();                        // цена обновляется на следующем кадре: ждём условия, а не паузы
    for (let i = 0; i < 30 && !shown.includes(String(want.cost)); i++) { await ctx.wait(100); shown = await price.innerText(); }
    if (want.cost === want.base || !shown.includes(String(want.cost))) throw new Error(`на карточке «${shown.trim()}», ждали цену проклятой земли ${want.cost} (база ${want.base})`);
    await ctx.shot('cells_armed_price');
    await ctx.eval(() => { SCENE.ui.armed = null; });
  },
  cells_towers: async (ctx, g) => {
    const types = await g.towerTypes(ctx), cells = await ctx.eval(() => APP.play.map.specials.map((s) => s.cell));
    for (const [i, cell] of cells.entries()) await g.build(ctx, cell, types[i % types.length]);
    if (await ctx.eval((cs) => cs.some((c) => !APP.play.towers[c]), cells)) throw new Error('на особой клетке не построилась башня');
    await g.select(ctx, -1); await ctx.wait(200); await ctx.shot('cells_towers');
  },
  cells_obstacle: async (ctx, g) => {
    const ob = await ctx.eval(() => APP.play.map.obstacles.find((o) => o.kind !== 'arch').cell);
    await g.select(ctx, -1); await ctx.eval(() => { SCENE.ui.armed = null; });
    await clickCell(ctx, ob);
    const st = await ctx.eval((c) => ({ sel: SCENE.ui.sel, panel: document.getElementById('panel').classList.contains('show'), tower: !!APP.play.towers[c] }), ob);
    if (st.sel !== -1 || st.panel || st.tower) throw new Error('клик по препятствию открыл панель или построил башню: ' + JSON.stringify(st));
    await ctx.shot('cells_obstacle');
  },
};
