// HUD партии на худших значениях: огромные души, последняя волна.
export const steps = {
  hud: async (ctx, g) => { await g.newGame(ctx, 1); await g.rich(ctx); await ctx.shot('hud'); },
};
