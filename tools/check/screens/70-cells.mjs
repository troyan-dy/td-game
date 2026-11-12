// Препятствия и особые клетки: меню постройки на кургане, источнике душ и проклятой земле (вид, бонус, цены с наценкой),
// башни на всех особых клетках (метки видны из-под башен), клик мышью по препятствию не открывает панель и не строит.
const special = (ctx, kind) => ctx.eval((k) => APP.play.map.specials.find((s) => s.kind === k).cell, kind);
// клик мышью по центру клетки на холсте
const clickCell = async (ctx, cell) => {
  const box = await (await ctx.need('#c')).boundingBox(), cols = await ctx.eval(() => APP.play.map.cols);
  await ctx.page.mouse.click(box.x + ((cell % cols) + 0.5) * 64 * box.width / 1600, box.y + (Math.floor(cell / cols) + 0.5) * 64 * box.height / 900);
  await ctx.wait(100);
};

const menu = (kind) => async (ctx, g) => {
  if (kind === 'mound') { await g.newGame(ctx); await g.rich(ctx); }
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
