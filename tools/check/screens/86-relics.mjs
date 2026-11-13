// Реликвии: экран выбора одной из трёх на худшем случае (самые длинные тексты), забег стоит до выбора, выбор клавишей
// и мышью, значки взятых в HUD с подсказкой, продолжение сохранённого забега прямо на экране выбора. Шаги ждут условий.

const expect = (cond, msg) => { if (!cond) throw new Error(msg); };
// сид, у которого предложение после 5-й волны с самыми длинными текстами (сначала самая длинная карточка, затем сумма)
const worstSeed = (ctx) => ctx.eval(() => { let best = null;
  for (let s = 1; s <= 300; s++) { const d = SIM.drawRelics(s, 5, [], null).map((id) => (SIM.CONFIG.RELICS[id].name + SIM.relicText(id)).length);
    const sc = Math.max(...d) * 1000 + d.reduce((a, b) => a + b, 0); if (!best || sc > best.sc) best = { s, sc }; }
  return best.s; });
// забег на сиде s доведён до выбора реликвии после волны n: волны отбиваются сразу, все враги уже встречены
// (окно «Новый враг» не закрывает экран), на выборах до n берётся первая
const toChoice = (ctx, s, n) => ctx.eval(([s, n]) => {
  const S = SIM.create(s); S.seen = Object.fromEntries(Object.keys(SIM.CONFIG.ENEMIES).map((k) => [k, 1])); S.souls = 2000;
  while (S.wave < n || S.phase !== 'relic') {
    if (S.phase === 'relic') { SIM.step(S, { cmds: [{ k: 'relic', i: 0 }] }); continue; }
    SIM.step(S, { cmds: [{ k: 'call' }] }); S.qi = S.queue.length; S.enemies = []; S.shots = []; SIM.step(S, null);
    if (S.wave > n) throw new Error('выбора после волны ' + n + ' нет'); }
  S.ev = []; APP.play = S; APP.paused = false; APP.speed = 1; SCENE.ui.sel = -1; }, [s, n]);
const waitOffer = (ctx, ids) => ctx.page.waitForFunction((ids) => { const b = document.getElementById('relics');
  return b.classList.contains('show') && [...b.querySelectorAll('.rcard')].length === ids.length; }, ids, { timeout: 5000 })
  .catch(() => { throw new Error('экран выбора реликвии не появился'); });
// карточки на экране — ровно предложение логики: название и описание
const cards = (ctx) => ctx.eval(() => { const o = SIM.relicOffer(APP.play) || [];
  const got = [...document.querySelectorAll('#relics .rcard')].map((c) => ({ name: c.querySelector('.rn').textContent, desc: c.querySelector('.rd').textContent }));
  return { ids: o.map((r) => r.id), ok: JSON.stringify(got) === JSON.stringify(o.map((r) => ({ name: r.name, desc: r.desc }))), got }; });
const KEY = 'necropolis.save';

export const steps = {
  relics_offer: async (ctx, g) => {
    await g.newGame(ctx, 1);
    await toChoice(ctx, await worstSeed(ctx), 5);
    const want = await ctx.eval(() => APP.play.offer.slice());
    await waitOffer(ctx, want);
    const c = await cards(ctx); expect(c.ok, 'карточки не сходятся с предложением: ' + JSON.stringify(c.got));
    // забег стоит: время, волна и отсчёт автоплея не идут (автоплей включён), кнопки волны нет
    await ctx.eval(() => APP.cmd({ k: 'auto', on: true })); await ctx.wait(50);
    const t0 = await ctx.eval(() => ({ t: APP.play.stats.time, w: APP.play.wave, p: APP.play.autoT })); await ctx.wait(600);
    const t1 = await ctx.eval(() => ({ t: APP.play.stats.time, w: APP.play.wave, p: APP.play.autoT, phase: APP.play.phase, wb: !document.getElementById('wavebtn').classList.contains('hidden') }));
    expect(t1.phase === 'relic' && t1.t === t0.t && t1.p === t0.p && !t1.wb, 'забег идёт на экране выбора: ' + JSON.stringify([t0, t1]));
    await ctx.shot('relics_offer');
  },
  relics_pick: async (ctx, g) => {
    await g.newGame(ctx, 1);
    const s = await worstSeed(ctx); await toChoice(ctx, s, 5);
    const offer = await ctx.eval(() => APP.play.offer.slice()); await waitOffer(ctx, offer);
    // клавиша 2 — вторая реликвия (а не карточка второй башни)
    await ctx.page.keyboard.press('Digit2');
    await ctx.page.waitForFunction((id) => APP.play.phase === 'prep' && APP.play.relics[0] === id && !document.getElementById('relics').classList.contains('show'), offer[1], { timeout: 5000 })
      .catch(() => { throw new Error('клавиша 2 не выбрала вторую реликвию'); });
    expect(await ctx.eval(() => !SCENE.ui.armed), 'клавиша 2 на экране выбора взяла карточку башни');
    // ещё два выбора мышью: после 10-й и 15-й волны
    for (const n of [10, 15]) {
      await ctx.eval((n) => { const S = APP.play;
        while (S.phase !== 'relic') { SIM.step(S, { cmds: [{ k: 'call' }] }); S.qi = S.queue.length; S.enemies = []; S.shots = []; SIM.step(S, null); if (S.wave > n) break; }
        S.ev = []; }, n);
      const o = await ctx.eval(() => APP.play.offer.slice()); await waitOffer(ctx, o);
      await ctx.click('#relics .rcard[data-i="0"]');
      await ctx.page.waitForFunction((id) => APP.play.relics.includes(id), o[0], { timeout: 5000 }).catch(() => { throw new Error('клик по карточке не выбрал реликвию'); });
    }
    const bar = await ctx.eval(() => [...document.querySelectorAll('#relicbar.show .rl')].map((e) => e.dataset.id));
    const taken = await ctx.eval(() => APP.play.relics.slice());
    expect(JSON.stringify(bar) === JSON.stringify(taken), `в HUD ${bar}, взяты ${taken}`);
    await ctx.page.locator('#relicbar .rl').last().hover({ timeout: 5000 });
    await ctx.page.waitForFunction((id) => { const t = document.getElementById('relic-tip'); return t.classList.contains('show') && t.textContent.includes(SIM.CONFIG.RELICS[id].name); }, taken[2], { timeout: 3000 })
      .catch(() => { throw new Error('подсказка реликвии в HUD не появилась'); });
    await ctx.shot('relics_hud');
  },
  relics_continue: async (ctx, g) => {
    await g.newGame(ctx, 1);
    await toChoice(ctx, 7, 10);
    const offer = await ctx.eval(() => APP.play.offer.slice()); await waitOffer(ctx, offer);
    await ctx.page.waitForFunction((k) => { try { return JSON.parse(localStorage.getItem(k)).S.phase === 'relic'; } catch (e) { return false; } }, KEY, { timeout: 5000 })
      .catch(() => { throw new Error('забег на экране выбора не сохранился'); });
    // новая вкладка: меню с «Продолжить», после него — тот же выбор
    await ctx.eval(() => addEventListener('pagehide', () => sessionStorage.clear()));
    await ctx.page.reload();
    await ctx.page.waitForFunction(() => window.__ready && window.UI && window.APP && document.getElementById('m-cont'), null, { timeout: 20000 })
      .catch(() => { throw new Error('после перезагрузки нет «Продолжить» у забега на экране выбора'); });
    await ctx.click('#m-cont');
    await waitOffer(ctx, offer);
    const same = await ctx.eval(() => APP.play.offer.slice());
    expect(JSON.stringify(same) === JSON.stringify(offer), `после продолжения другой выбор: ${same} вместо ${offer}`);
    const c = await cards(ctx); expect(c.ok, 'карточки не сходятся с предложением после продолжения');
    await ctx.shot('relics_continue');
  },
};
