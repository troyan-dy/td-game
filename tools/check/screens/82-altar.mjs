// Алтарь крови: превью соседей при постройке (меню клетки и подсветка на карте при наведении на карточку), панель алтаря,
// панель усиленного соседа со строкой бонуса, перенос и продажа алтаря сразу снимают бонус в открытой панели соседа.
// клетка, где можно строить и на ней, и хотя бы на трёх соседних клетках; соседи — по порядку
const findSpot = (ctx) => ctx.eval(() => { const S = APP.play, n = S.map.cols;
  for (const c of SIM.rankCells(S, SIM.CONFIG.TYPICAL_RANGE)) { const x = c % n, y = Math.floor(c / n), nb = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const i = (y + dy) * n + x + dx;
      if ((dx || dy) && x + dx >= 0 && x + dx < n && y + dy >= 0 && y + dy < S.map.rows && SIM.canBuild(S, i, 'bones').ok) nb.push(i); }
    if (nb.length >= 3) return [c, nb.slice(0, 3)]; }
  return null; });
// ждать условия на странице (панель обновляется на следующих кадрах)
const until = async (ctx, fn, arg, what) => { for (let i = 0; i < 40; i++) { if (await ctx.eval(fn, arg)) return; await ctx.wait(80); } throw new Error('не дождались: ' + what); };

export async function steps(ctx, g) {
  await g.newGame(ctx); await g.rich(ctx);
  const spot = await findSpot(ctx); if (!spot) throw new Error('нет клетки с тремя свободными соседями');
  const [c, nb] = spot, out = {};
  out.altar_preview = async () => {
    for (const [i, t] of ['bones', 'spirits', 'dark'].entries()) await g.build(ctx, nb[i], t);
    await g.select(ctx, c); await ctx.wait(120);
    await (await ctx.need('.card[data-type="altar"]')).hover(); await ctx.wait(200);
    const want = await ctx.eval((c) => SIM.auraTargets(APP.play, c, 'altar').length, c);
    if (want !== 3) throw new Error(`превью алтаря: логика видит ${want} соседей, ждали 3`);
    const text = await (await ctx.need('#panel.show .note.aura')).innerText();
    if (!text.includes('усилит') || !text.includes(String(want))) throw new Error('в меню клетки нет превью соседей: ' + text);
    if (await ctx.eval(() => SCENE.ui.preview) !== 'altar') throw new Error('наведение на карточку не включило превью алтаря');
    await ctx.shot('altar_preview');
    await ctx.page.mouse.move(5, 5);
  };
  out.altar_panel = async () => {
    await g.build(ctx, c, 'altar'); await g.select(ctx, c); await ctx.wait(150);
    const text = await (await ctx.need('#panel.show')).innerText();
    for (const s of ['АЛТАРЬ', 'Усиливает', '3 баш.', 'Охват']) if (!text.includes(s)) throw new Error(`в панели алтаря нет «${s}»: ${text.replace(/\s+/g, ' ')}`);
    await ctx.shot('altar_panel');
  };
  out.altar_neighbor = async () => {
    await g.select(ctx, nb[0]); await ctx.wait(150);
    const pct = await ctx.eval((n) => Math.round(SIM.towerStats(APP.play, APP.play.towers[n]).altar.dmg * 100), nb[0]);
    const text = await (await ctx.need('#panel.show .boost')).innerText();
    if (!text.includes(`+${pct}% урона`)) throw new Error(`строка бонуса соседа без +${pct}% урона: ${text}`);
    await ctx.shot('altar_neighbor');
  };
  out.altar_move_sell = async () => {
    const far = await ctx.eval(([c, n]) => SIM.moveCells(APP.play, c).find((i) => !SIM.auraCells(APP.play, i, 'altar').includes(n)), [c, nb[0]]);
    await ctx.eval(([c, far]) => APP.cmd({ k: 'move', cell: c, to: far }), [c, far]);
    await until(ctx, () => !document.querySelector('#panel.show .boost'), null, 'бонус ушёл из панели соседа после переноса алтаря');
    await ctx.eval(([c, far]) => APP.cmd({ k: 'move', cell: far, to: c }), [c, far]);
    await until(ctx, () => !!document.querySelector('#panel.show .boost'), null, 'бонус вернулся вместе с алтарём');
    await ctx.eval((c) => APP.cmd({ k: 'sell', cell: c }), c);
    await until(ctx, () => !document.querySelector('#panel.show .boost'), null, 'бонус ушёл из панели соседа после продажи алтаря');
    await ctx.shot('altar_sold');
  };
  // бой с алтарём среди башен: ничего не выбрано — аура и усиленные башни видны слабо
  out.altar_battle = async () => {
    await g.build(ctx, c, 'altar'); await g.select(ctx, -1);
    // окно «Новый враг» закрыло бы поле: все враги уже «видены»
    await ctx.eval(() => { for (const k of Object.keys(SIM.CONFIG.ENEMIES)) APP.play.seen[k] = 1; APP.cmd({ k: 'call' }); }); await ctx.wait(2500);
    if (!await ctx.eval((n) => !!SIM.towerStats(APP.play, APP.play.towers[n]).altar, nb[0])) throw new Error('в бою сосед не усилен');
    await ctx.shot('altar_battle');
  };
  return out;
}
