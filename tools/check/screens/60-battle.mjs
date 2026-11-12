// Живой бой: несколько башен разных типов, волна идёт на ускорении — видно карту, врагов, снаряды.
export const steps = {
  battle: async (ctx, g) => {
    await g.newGame(ctx); await ctx.eval(() => { APP.play.souls = 2000; });
    const types = await g.towerTypes(ctx), spots = await g.spots(ctx);
    for (const [i, t] of types.entries()) await g.build(ctx, spots[i], t);
    await ctx.eval(() => { APP.cmd({ k: 'call' }); APP.speed = 2; });
    await ctx.wait(4000); await ctx.shot('battle');
  },
};
