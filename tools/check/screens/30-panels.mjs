// Панель башни на худших значениях: каждый тип на уровне 1 и на уровне 3 с самым длинным перком; панель пустого места.
export async function steps(ctx, g) {
  await g.newGame(ctx); await g.rich(ctx);
  const types = await g.towerTypes(ctx), spots = await g.spots(ctx), out = {};
  types.forEach((t, i) => {
    for (const lvl of [1, 3]) out[`panel_${t}_${lvl}`] = async () => {
      const spot = spots[i];
      await g.build(ctx, spot, t);
      if (lvl === 3) { await g.upgrade(ctx, spot, 2); await g.perk(ctx, spot, await g.longestPerk(ctx, t)); }
      await g.select(ctx, spot); await ctx.shot(`panel_${t}_${lvl}`);
    };
  });
  out.panel_empty = async () => { await g.select(ctx, spots[types.length]); await ctx.shot('panel_empty'); };
  return out;
}
