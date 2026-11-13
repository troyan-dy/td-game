// HUD партии на худших значениях: огромные души, последняя волна (кнопка волны без отсчёта: автоплей выключен).
export const steps = {
  hud: async (ctx, g) => { await g.newGame(ctx); await g.rich(ctx); await ctx.shot('hud'); },
};
