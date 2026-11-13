// Экран итога партии на худших значениях (последняя волна, час игры, огромные счётчики, длинный сид) и «Играть снова».
export const steps = {
  end_won: async (ctx, g) => {
    await g.newGame(ctx);
    await ctx.eval(() => { const S = APP.play, s = S.stats; S.wave = SIM.waveCount(); S.seed = 999999;
      const b = SIM.rankCells(S, SIM.CONFIG.TYPICAL_RANGE)[0]; S.souls = 1e4; APP.cmd({ k: 'build', cell: b, type: 'bones' });   // с башней подсказки обучения не показываются
      s.time = 3599; s.kills = 99999; s.earned = 999999; });
    await ctx.wait(100); await ctx.eval(() => { APP.play.phase = 'won'; });
    await ctx.need('#end.show', 5000); await ctx.wait(1000);
    if (await ctx.eval(() => document.getElementById('coach').classList.contains('show'))) throw new Error('за экраном итога видна подсказка обучения');
    await ctx.shot('end_won');
  },
  end_again: async (ctx) => {
    const before = await ctx.eval(() => APP.play.seed);
    await ctx.click('#e-again'); await ctx.wait(300);
    const st = await ctx.eval(() => ({ end: document.getElementById('end').classList.contains('show'), phase: APP.play && APP.play.phase, wave: APP.play && APP.play.wave, seed: APP.play && APP.play.seed }));
    if (st.end || st.phase !== 'prep' || st.wave !== 0 || st.seed === before) throw new Error('«Играть снова» не начало новый забег: ' + JSON.stringify(st));
    await ctx.shot('end_again');
  },
};
