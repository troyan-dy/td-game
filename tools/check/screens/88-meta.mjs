// Открытия и рекорды: экран открытий нового профиля (рекордов нет, закрытое с условием), закрытая башня на карточках
// и в меню постройки, поражение на 10-й волне — экран итогов с тем, что открылось, экран открытий после забега
// (рекорд волны, выполненные достижения), «Открыть всё» — всё открыто, новый забег без закрытых башен.
const reload = async (ctx) => {
  await ctx.page.reload();
  await ctx.page.waitForFunction(() => window.__ready && window.UI && window.APP, null, { timeout: 20000 });
  await ctx.wait(200);
};
const metaState = (ctx) => ctx.eval(() => { const m = document.getElementById('meta');
  return { show: m.classList.contains('show'), text: m.textContent, off: m.querySelectorAll('.chip.off').length, on: m.querySelectorAll('.chip.on').length,
    done: m.querySelectorAll('.ach.on').length, all: document.getElementById('mt-all') && document.getElementById('mt-all').disabled }; });
const openMeta = async (ctx) => { await ctx.click('#m-meta'); await ctx.need('#meta.show'); await ctx.wait(100); return metaState(ctx); };
const back = async (ctx) => { await ctx.click('#mt-back'); await ctx.wait(100); };

export const steps = {
  meta_new: async (ctx, g) => {
    await ctx.eval((k) => localStorage.removeItem(k), g.PROFILE_KEY); await reload(ctx);
    const st = await openMeta(ctx);
    const want = await ctx.eval(() => { const C = SIM.CONFIG, U = C.UNLOCKS, R = C.RELICS ? Object.keys(C.RELICS).length : 0;
      return Math.max(0, C.TOWER_ORDER.length - U.startTowers) + Math.max(0, R - U.startRelics); });
    if (st.off !== want) throw new Error(`закрытого в новом профиле ${st.off}, ждали ${want}`);
    if (st.done || st.all || !st.text.includes('Лучшая волна') || !st.text.includes('Быстрейшая победа')) throw new Error('экран открытий нового профиля: ' + JSON.stringify(st));
    await ctx.shot('meta_new');
    await back(ctx);
  },
  meta_cards: async (ctx, g) => {
    await g.newGame(ctx);
    // новый профиль: закрыты типы после стартовых; если в конфиге их ещё нет — забег с закрытым последним типом (вид тот же)
    let lockedType = await ctx.eval(() => SIM.CONFIG.TOWER_ORDER.find((k) => APP.play.unlocked && !APP.play.unlocked.includes(k)) || null);
    if (!lockedType) lockedType = await ctx.eval(() => { const O = SIM.CONFIG.TOWER_ORDER; APP.newGame(5, { unlocked: O.slice(0, -1) }); return O[O.length - 1]; });
    await ctx.eval(() => { APP.play.souls = 99999; APP.play.prepT = 999; });
    const cell = (await g.spots(ctx))[0];
    await g.build(ctx, cell, lockedType);
    if (await ctx.eval((c) => !!APP.play.towers[c], cell)) throw new Error('закрытый тип ' + lockedType + ' построился');
    await g.select(ctx, cell); await ctx.wait(100);
    const card = `.card[data-type="${lockedType}"]`;
    if (!(await ctx.eval((s) => document.querySelector(s).classList.contains('locked'), card))) throw new Error('карточка закрытого типа без отметки');
    const menu = await ctx.eval(() => document.getElementById('panel').textContent);
    if (!menu.includes('закрыта')) throw new Error('меню постройки не отмечает закрытый тип: ' + menu);
    await ctx.page.hover(card); await ctx.wait(150);
    const tip = await ctx.eval(() => document.getElementById('tip').textContent);
    if (!tip.includes('Откроется')) throw new Error('подсказка закрытой карточки без условия: ' + tip);
    await ctx.shot('meta_cards');
  },
  meta_end: async (ctx, g) => {
    await ctx.click('#p-menu'); await g.newGame(ctx);                // в меню и новый забег — по профилю (новому)
    await ctx.eval(() => { const S = APP.play; S.wave = 10; S.phase = 'wave'; S.stats.kills = 140; S.hp = 0; });
    await ctx.need('#end.show', 5000); await ctx.wait(300);
    const t = await ctx.eval(() => { const u = document.querySelector('#end .unlocks'); return u ? u.textContent : ''; });
    if (!t.includes('Десятая волна')) throw new Error('экран итогов не показал достижения и открытия забега: ' + JSON.stringify(t));
    await ctx.shot('meta_end');
  },
  meta_progress: async (ctx) => {
    await ctx.click('#e-menu'); await ctx.wait(200);
    const st = await openMeta(ctx);
    if (!st.text.includes('Лучшая волна10') || st.done < 2) throw new Error('экран открытий после забега: ' + JSON.stringify(st));
    await ctx.shot('meta_progress');
  },
  meta_all: async (ctx, g) => {
    await ctx.click('#mt-all'); await ctx.wait(200);
    const st = await metaState(ctx);
    if (st.off || !st.all || !st.text.includes('Всё открыто')) throw new Error('«Открыть всё» открыло не всё: ' + JSON.stringify(st));
    await ctx.shot('meta_all');
    await back(ctx); await g.newGame(ctx);
    const run = await ctx.eval(() => ({ unlocked: APP.play.unlocked, locked: document.querySelectorAll('.card.locked').length }));
    if (run.unlocked !== null || run.locked) throw new Error('после «Открыть всё» забег с закрытым: ' + JSON.stringify(run));
  },
};
