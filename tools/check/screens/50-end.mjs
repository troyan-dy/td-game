// Экран итога партии на худших значениях: час игры, огромные счётчики.
export const steps = {
  end_won: async (ctx, g) => {
    await g.newGame(ctx);
    await ctx.eval(() => { const s = APP.play.stats; s.time = 3599; s.kills = 99999; s.earned = 999999; APP.play.phase = 'won'; });
    await ctx.need('#end.show', 5000); await ctx.wait(1000); await ctx.shot('end_won');
  },
};
