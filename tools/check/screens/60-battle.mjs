// Живой бой: несколько башен разных типов, волна идёт на ускорении — видно карту, врагов, снаряды.
export const steps = {
  battle: async (ctx, g) => {
    await g.newGame(ctx, 1); await ctx.eval(() => { APP.play.souls = 2000; });
    const types = await g.towerTypes(ctx), spots = await g.spots(ctx);
    for (const [i, t] of types.entries()) await g.build(ctx, spots[i], t);
    await ctx.eval(() => { APP.cmd({ k: 'call' }); APP.speed = 2; });
    // кадр — когда враги на дороге и башни только что стреляли (а не через фиксированное время)
    await ctx.page.waitForFunction(() => { const S = APP.play; return S.enemies.length >= 3 && S.towers.filter((t) => t && S.t - t.fireT < 0.3).length >= 2; }, null, { timeout: 40000 })
      .catch(() => { throw new Error('бой не разгорелся: мало врагов на дороге или стреляющих башен'); });
    await ctx.shot('battle');
  },
};
