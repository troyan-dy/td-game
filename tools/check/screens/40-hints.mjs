// Подсказки и всплывающие окна во время партии: тултип карточки, «новый враг», тосты босса и волны, пауза (без меню, с меткой).
export const steps = {
  cardtip: async (ctx, g) => {
    await g.newGame(ctx); await g.rich(ctx); await g.select(ctx, -1);
    await (await ctx.need('.card')).evaluate((el) => el.dispatchEvent(new PointerEvent('pointerover', { bubbles: true })));
    await ctx.shot('cardtip');
  },
  newenemy: async (ctx, g) => { await g.pushEvent(ctx, { k: 'newEnemy', type: 'paladin' }); await ctx.need('#newenemy.show'); await ctx.shot('newenemy'); },
  toasts: async (ctx, g) => {
    await ctx.page.keyboard.press('Enter');                       // закрывает окно «новый враг»
    await g.pushEvent(ctx, { k: 'boss', name: 'Паладин-командор', x: 1, y: 1 }, { k: 'wave', wave: 20, boss: true });
    await ctx.shot('toasts');
  },
  pause: async (ctx) => {
    await ctx.page.keyboard.press('Space'); await ctx.need('#ui.paused #title .pz');
    if (await ctx.eval(() => !APP.paused || document.getElementById('gmenu').classList.contains('show'))) throw new Error('Пробел: нет паузы или открылось меню');
    await ctx.shot('pause'); await ctx.page.keyboard.press('Space');
    if (await ctx.eval(() => APP.paused)) throw new Error('повторный Пробел не снял паузу');
  },
};
