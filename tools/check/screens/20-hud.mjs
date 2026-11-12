// HUD партии на худших значениях: огромные души, последняя волна, отсчёт до волны.
export const steps = {
  hud: async (ctx, g) => { await g.newGame(ctx); await g.rich(ctx); await ctx.shot('hud'); },
};
