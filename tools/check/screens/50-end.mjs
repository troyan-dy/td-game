// Конец забега: победа на последней волне с выбором (на худших значениях: час игры, огромные счётчики, длинный сид),
// «Закончить» — итоги, «Новый забег»; «Продолжить» — бесконечный режим (HUD, волна после последней), поражение в нём —
// итоги с достигнутой волной, «Переиграть сид» — новый забег с тем же сидом.
const endState = (ctx) => ctx.eval(() => { const e = document.getElementById('end'), S = APP.play;
  return { end: e.classList.contains('show'), text: e.textContent, ids: [...e.querySelectorAll('button')].map((b) => b.id),
    phase: S && S.phase, wave: S && S.wave, seed: S && S.seed, endless: S && S.endless }; });
// новая партия, сразу победившая на последней волне (с башней: подсказки обучения не показываются)
const winNow = async (ctx, g, worst) => {
  await g.newGame(ctx);
  await ctx.eval((worst) => { const S = APP.play, s = S.stats; S.wave = SIM.waveCount(); if (worst) S.seed = 999999;
    const b = SIM.rankCells(S, SIM.CONFIG.TYPICAL_RANGE)[0]; S.souls = 1e4; APP.cmd({ k: 'build', cell: b, type: 'bones' });
    if (worst) { s.time = 3599; s.kills = 99999; s.earned = 999999; } }, worst);
  await ctx.wait(100); await ctx.eval(() => { APP.play.phase = 'won'; });
  await ctx.need('#end.show', 5000); await ctx.wait(1000);
};
export const steps = {
  end_won: async (ctx, g) => {
    await winNow(ctx, g, true);
    if (await ctx.eval(() => document.getElementById('coach').classList.contains('show'))) throw new Error('за экраном итога видна подсказка обучения');
    const st = await endState(ctx);
    if (!st.ids.includes('e-endless') || !st.ids.includes('e-finish')) throw new Error('у победы нет выбора «продолжить / закончить»: ' + JSON.stringify(st.ids));
    await ctx.shot('end_won');
  },
  end_final: async (ctx) => {
    await ctx.click('#e-finish'); await ctx.wait(200);
    const st = await endState(ctx);
    for (const want of ['Сид', '999999', 'Волна', 'Время', '59:59', 'Врагов повержено', '99999']) if (!st.text.includes(want)) throw new Error('в итогах нет «' + want + '»: ' + st.text);
    if (!st.end || !['e-again', 'e-replay', 'e-menu'].every((id) => st.ids.includes(id))) throw new Error('итоги без кнопок нового забега и переигровки: ' + JSON.stringify(st));
    await ctx.shot('end_final');
  },
  end_again: async (ctx) => {
    const before = await ctx.eval(() => APP.play.seed);
    await ctx.click('#e-again'); await ctx.wait(300);
    const st = await endState(ctx);
    if (st.end || st.phase !== 'prep' || st.wave !== 0 || st.seed === before) throw new Error('«Новый забег» не начал новый забег: ' + JSON.stringify(st));
    await ctx.shot('end_again');
  },
  end_endless: async (ctx, g) => {
    await winNow(ctx, g, false);
    await ctx.click('#e-endless'); await ctx.wait(300);
    await ctx.eval(() => { for (const k in SIM.CONFIG.ENEMIES) APP.play.seen[k] = 1; });   // без окна «Новый враг»: оно ставит паузу
    const last = await ctx.eval(() => SIM.waveCount());
    let st = await endState(ctx);
    const hud = await ctx.eval(() => ({ wave: document.getElementById('s-wave').textContent, btn: document.getElementById('wavebtn').classList.contains('hidden') ? '' : document.getElementById('w-l1').textContent }));
    if (st.end || st.phase !== 'prep' || !st.endless || st.wave !== last) throw new Error('«Продолжить» не включило бесконечный режим: ' + JSON.stringify(st));
    if (!hud.wave.includes('∞') || !hud.btn.includes(String(last + 1))) throw new Error('HUD бесконечного режима: ' + JSON.stringify(hud));
    await ctx.click('#wavebtn');
    await ctx.page.waitForFunction(() => APP.play.phase === 'wave' && APP.play.enemies.length >= 1, null, { timeout: 20000 });
    st = await endState(ctx); if (st.wave !== last + 1) throw new Error('волна после последней не началась: ' + JSON.stringify(st));
    await ctx.shot('end_endless');
    await ctx.eval(() => { APP.play.hp = 0; });
    await ctx.need('#end.show', 5000); await ctx.wait(300);
    st = await endState(ctx);
    if (st.phase !== 'lost' || st.wave !== last + 1 || !st.text.includes(`${last + 1}-й волне`) || !st.ids.includes('e-replay')) throw new Error('итоги поражения в бесконечном режиме: ' + JSON.stringify(st));
    await ctx.shot('end_lost');
  },
  end_replay: async (ctx) => {
    const before = await ctx.eval(() => APP.play.seed);
    await ctx.click('#e-replay'); await ctx.wait(300);
    const st = await endState(ctx), road = await ctx.eval(() => JSON.stringify(APP.play.map.road) === JSON.stringify(SIM.create(APP.play.seed).map.road));
    if (st.end || st.phase !== 'prep' || st.wave !== 0 || st.endless || st.seed !== before || !road) throw new Error('«Переиграть сид» не начало забег с тем же сидом: ' + JSON.stringify(st));
    await ctx.shot('end_replay');
  },
};
