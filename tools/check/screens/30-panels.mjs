// Панель башни на худших значениях: каждый тип непрокачанным (перк закрыт, видно, сколько ступеней осталось) и со всеми
// ветками на потолке и самым длинным перком; перк открыт, но душ не хватает ни на ступень, ни на перк (причины словами
// в подсказках); потолок 8 ступеней; панель пустого места.
export async function steps(ctx, g) {
  await g.newGame(ctx, 1); await g.rich(ctx);   // отсчёт заморожен: шагов много, волна не должна начаться посреди экрана
  const types = await g.towerTypes(ctx), spots = await g.spots(ctx), out = {};
  types.forEach((t, i) => {
    out[`panel_${t}_0`] = async () => { await g.build(ctx, spots[i], t); await g.select(ctx, spots[i]); await ctx.shot(`panel_${t}_0`); };
    out[`panel_${t}_max`] = async () => {
      await g.maxOut(ctx, spots[i]); await g.perk(ctx, spots[i], await g.longestPerk(ctx, t));
      const st = await ctx.eval((c) => { const tw = APP.play.towers[c]; return { tracks: tw.tracks, cap: tw.cap, perk: SIM.perksOf(tw)[0] }; }, spots[i]);
      if (!st.perk || Object.values(st.tracks).some((n) => n !== st.cap)) throw new Error('башня не прокачана до потолка: ' + JSON.stringify(st));
      await g.select(ctx, spots[i]); await ctx.need('#panel .perk.chosen'); await ctx.shot(`panel_${t}_max`);
    };
  });
  const poor = spots[types.length];
  out.panel_perk_poor = async () => {
    await g.build(ctx, poor, types[types.length - 1]); await g.toPerk(ctx, poor);
    await ctx.eval(() => { APP.play.souls = 3; }); await g.select(ctx, poor); await ctx.wait(60);
    const n = await ctx.eval(() => document.querySelectorAll('#panel .tb.poor, #panel .perk.poor').length);
    if (n < 4) throw new Error(`без душ ступени и перки должны быть помечены (.poor), помечено ${n}`);
    await ctx.shot('panel_perk_poor');
  };
  // подсказка при наведении объясняет, почему действие недоступно
  const tipSays = async (sel, re, name) => {
    await (await ctx.need(sel)).dispatchEvent('mouseenter');
    const tip = await ctx.eval(() => document.getElementById('tip').textContent);
    if (!re.test(tip)) throw new Error(`подсказка ${sel} не объясняет, почему действие недоступно: ${tip}`);
    await ctx.shot(name);
  };
  out.panel_perk_tip = () => tipSays('#panel .perk', /не хватает/i, 'panel_perk_tip');
  out.panel_track_tip = () => tipSays('#panel .tb', /не хватает/i, 'panel_track_tip');
  // потолок 8 ступеней (так будет у гибрида): метки ступеней и кнопки веток помещаются в панель
  out.panel_cap8 = async () => {
    const cell = spots[types.length + 2];
    await ctx.eval(() => { APP.play.souls = 1e6; });
    await g.build(ctx, cell, types[0]); await ctx.eval((c) => { APP.play.towers[c].cap = 8; APP.play.towers[c].slots = 2; }, cell);
    await g.maxOut(ctx, cell);
    const st = await ctx.eval((c) => APP.play.towers[c].tracks, cell);
    if (Object.values(st).some((n) => n !== 8)) throw new Error('ветки не дошли до 8-й ступени: ' + JSON.stringify(st));
    await g.select(ctx, cell); await ctx.wait(80);
    if (await ctx.eval(() => document.querySelectorAll('#panel .pips i').length) !== 24) throw new Error('в панели не 24 метки ступеней');
    await ctx.shot('panel_cap8');
  };
  // характеристики изменились извне (алтарь, Гримуар, клетка — здесь имитация правкой базы типа): открытая панель их показывает
  out.panel_external = async () => {
    const cell = spots[0]; await g.select(ctx, cell); await ctx.wait(80);
    const read = () => ctx.eval(() => document.querySelector('#panel .st b').textContent);
    const before = await read();
    await ctx.eval((t) => { SIM.CONFIG.TOWERS[t].base.dmg *= 2; }, types[0]); await ctx.wait(120);
    const after = await read(); await ctx.eval((t) => { SIM.CONFIG.TOWERS[t].base.dmg /= 2; }, types[0]); await ctx.wait(120);
    if (after === before) throw new Error(`панель не обновила урон после изменения характеристик: ${before} → ${after}`);
  };
  out.panel_empty = async () => { await ctx.eval(() => { document.getElementById('tip').classList.remove('show'); APP.play.souls = 99999; });
    await g.select(ctx, spots[types.length + 1]); await ctx.shot('panel_empty'); };
  out.panel_upgrade_set = async () => {
    await g.newGame(ctx, 4);
    const cell = (await g.spots(ctx))[0];
    await g.build(ctx, cell, 'dark'); await g.select(ctx, cell);
    await ctx.eval(() => { APP.play.souls = 300; });
    const click = (selector) => ctx.page.locator(selector).click();
    await click('#panel .batch-open');
    for (const k of ['dmg', 'rate']) await click(`#panel [data-track="${k}"] [data-n="3"]`);
    const buy = ctx.page.locator('#panel .batch-buy');
    if (!await buy.isDisabled() || !((await ctx.page.locator('.batch-balance').innerText()).includes('85')))
      throw new Error('при 300 душах набор за 385 должен показать нехватку 85');
    await ctx.shot('panel_upgrade_set_poor');
    await ctx.eval(() => { APP.play.souls = 500; });
    await ctx.page.waitForFunction(() => !document.querySelector('.batch-buy').disabled);
    if (!(await buy.innerText()).includes('385') || !(await ctx.page.locator('.batch-balance').innerText()).includes('115'))
      throw new Error('цена набора или остаток душ не обновились');
    await ctx.shot('panel_upgrade_set');
    await click('#wavebtn'); await ctx.page.waitForFunction(() => APP.play.phase === 'wave');
    await buy.click(); await g.applied(ctx);
    const result = await ctx.eval((c) => ({ t: APP.play.towers[c].tracks, p: APP.play.towers[c].perks, souls: APP.play.souls }), cell);
    if (result.t.dmg !== 3 || result.t.rate !== 3 || result.t.range !== 0 || result.p.length || result.souls !== 115)
      throw new Error('неверный результат покупки в бою: ' + JSON.stringify(result));
    await ctx.shot('panel_upgrade_set_bought');
  };
  return out;
}
