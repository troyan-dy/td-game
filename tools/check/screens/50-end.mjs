// Конец забега: победа на последней волне с выбором (на худших значениях: час игры, огромные счётчики, длинный сид),
// перезагрузка страницы на выборе — тот же выбор без второго зачёта победы (в той же вкладке и через «Продолжить» в новой),
// «Закончить» — итоги и сейв стёрт, «Новый забег»; «Продолжить» — бесконечный режим (HUD, волна после последней),
// поражение в нём — итоги с достигнутой волной, «Переиграть сид» — новый забег с тем же сидом.
const endState = (ctx) => ctx.eval(() => { const e = document.getElementById('end'), S = APP.play;
  return { end: e.classList.contains('show'), text: e.textContent, ids: [...e.querySelectorAll('button')].map((b) => b.id),
    phase: S && S.phase, wave: S && S.wave, seed: S && S.seed, endless: S && S.endless }; });
const SAVE = 'necropolis.save';
// новая партия на сиде seed, честно победившая на последней волне: волна вызвана, её враги считаются вышедшими и убитыми
// (сейв такого забега годен); с башней — подсказки обучения не показываются
const winNow = async (ctx, g, seed, worst) => {
  await g.newGame(ctx, seed);
  await ctx.eval((worst) => { const S = APP.play, s = S.stats; S.wave = SIM.waveCount() - 1; S.souls = 1e4;
    APP.cmd({ k: 'build', cell: SIM.rankCells(S, SIM.CONFIG.TYPICAL_RANGE)[0], type: 'bones' }); APP.cmd({ k: 'call' });
    if (worst) { s.time = 3599; s.kills = 99999; s.earned = 999999; } }, worst);
  await g.applied(ctx);
  await ctx.eval(() => { const S = APP.play; S.qi = S.queue.length; S.enemies = []; S.shots = []; });
  await ctx.page.waitForFunction(() => APP.play.phase === 'won', null, { timeout: 5000 }).catch(() => { throw new Error('последняя волна не дала победу'); });
  await ctx.need('#end.show', 5000); await ctx.wait(600);                              // экран итога проявляется
};
const wins = (ctx, g) => ctx.eval((k) => JSON.parse(localStorage.getItem(k)).wins, g.PROFILE_KEY);
const savedPhase = (ctx) => ctx.eval((k) => { try { return JSON.parse(localStorage.getItem(k)).S.phase; } catch (e) { return null; } }, SAVE);
const reload = async (ctx, newTab) => {
  if (newTab) await ctx.eval(() => addEventListener('pagehide', () => sessionStorage.clear()));   // как закрыть вкладку и открыть игру заново
  await ctx.page.reload();
  await ctx.page.waitForFunction(() => window.__ready && window.UI && window.APP, null, { timeout: 20000 });
};
const choice = async (ctx, what) => {
  await ctx.need('#end.show #e-endless', 5000).catch(() => { throw new Error(what + ': нет выбора «продолжить / закончить»'); });
  const st = await endState(ctx); if (st.phase !== 'won' || !st.ids.includes('e-finish')) throw new Error(what + ': ' + JSON.stringify(st));
};
export const steps = {
  end_won: async (ctx, g) => {
    await winNow(ctx, g, 999999, true);
    if (await ctx.eval(() => document.getElementById('coach').classList.contains('show'))) throw new Error('за экраном итога видна подсказка обучения');
    const st = await endState(ctx);
    if (!st.ids.includes('e-endless') || !st.ids.includes('e-finish')) throw new Error('у победы нет выбора «продолжить / закончить»: ' + JSON.stringify(st.ids));
    await ctx.shot('end_won');
  },
  end_won_reload: async (ctx, g) => {
    await ctx.page.waitForFunction((k) => { try { return JSON.parse(localStorage.getItem(k)).S.phase === 'won'; } catch (e) { return false; } }, SAVE, { timeout: 5000 })
      .catch(() => { throw new Error('забег на выборе после победы не сохранился'); });
    const w = await wins(ctx, g); if (w !== 1) throw new Error('победа не засчитана в профиль один раз: побед ' + w);
    await reload(ctx, false); await choice(ctx, 'перезагрузка вкладки');
    await reload(ctx, true);
    await ctx.need('#m-cont').catch(() => { throw new Error('после перезагрузки нет «Продолжить» у забега на выборе после победы'); });
    await ctx.click('#m-cont'); await choice(ctx, '«Продолжить» в новой вкладке');
    if ((await wins(ctx, g)) !== 1) throw new Error('победа засчитана повторно после перезагрузки: побед ' + (await wins(ctx, g)));
    await ctx.wait(600); await ctx.shot('end_won_reload');
  },
  end_final: async (ctx) => {
    await ctx.click('#e-finish'); await ctx.wait(200);
    if ((await savedPhase(ctx)) !== null) throw new Error('«Закончить забег» не стёр сейв');
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
    await winNow(ctx, g, 5, false);
    await ctx.click('#e-endless'); await ctx.wait(300);
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
