// Перенос башни между волнами настоящей мышью: режим переноса с подсветкой допустимых клеток и превью под курсором,
// отказ на дорогу и на занятую клетку, отмена по Esc и правому клику, перенос, недоступная кнопка во время волны.

// Экранная точка центра клетки (координаты страницы для page.mouse).
const cellPoint = (ctx, cell) => ctx.eval((cell) => { const r = document.getElementById('c').getBoundingClientRect(), [x, y] = SIM.cellXY(APP.play, cell);
  return [r.left + x / SIM.VIEW.W * r.width, r.top + y / SIM.VIEW.H * r.height]; }, cell);
// Первая клетка списка, центр которой не закрыт интерфейсом (под курсором холст, а не панель или карточки).
const openCell = (ctx, cells) => ctx.eval((cells) => { const r = document.getElementById('c').getBoundingClientRect();
  return cells.find((c) => { const [x, y] = SIM.cellXY(APP.play, c); return document.elementFromPoint(r.left + x / SIM.VIEW.W * r.width, r.top + y / SIM.VIEW.H * r.height).id === 'c'; }); }, cells);
const hover = async (ctx, cell) => { const [x, y] = await cellPoint(ctx, cell); await ctx.page.mouse.move(x, y); await ctx.wait(60); };
const clickCell = async (ctx, cell, button = 'left') => { const [x, y] = await cellPoint(ctx, cell); await ctx.page.mouse.click(x, y, { button }); await ctx.wait(80); };
const state = (ctx) => ctx.eval(() => ({ move: SCENE.ui.move, sel: SCENE.ui.sel, cells: APP.play.towers.map((t) => t && t.id) }));
// Башня на клетке без клетки и таймера выстрела (cd тикает каждый шаг) — всё, что перенос обязан сохранить, и души.
const snap = (ctx, cell) => ctx.eval((c) => { const t = APP.play.towers[c]; if (!t) return null; const o = Object.assign({}, t); delete o.cell; delete o.cd;
  return JSON.stringify({ souls: APP.play.souls, tower: o }); }, cell);
const expect = (cond, what, st) => { if (!cond) throw new Error(what + ': ' + JSON.stringify(st && { move: st.move, sel: st.sel })); };

export async function steps(ctx, g) {
  let from = -1, other = -1, id = 0, to = -1;
  const enter = async () => { await ctx.click('#panel .move'); await ctx.wait(60); const st = await state(ctx); expect(st.move === from, 'кнопка переноса не включила режим', st); };
  return {
    move_mode: async () => {
      await g.newGame(ctx); await ctx.eval(() => { APP.play.souls = 5000; });
      const spots = await g.spots(ctx); from = spots[0]; other = spots[1];
      await g.build(ctx, from, 'dark'); await g.build(ctx, other, 'bones'); await g.upgrade(ctx, from, 2);
      id = await ctx.eval((c) => APP.play.towers[c].id, from);
      const inv = await ctx.eval((c) => [APP.play.towers[c].invested, SIM.CONFIG.TOWERS.dark.cost[0]], from);   // прокачка правда применилась
      if (!(inv[0] > inv[1])) throw new Error(`улучшение не применилось: вложено ${inv[0]}, постройка ${inv[1]} — правь помощник g.upgrade`);
      await clickCell(ctx, from); await enter();
      if (!await ctx.eval(() => document.querySelector('#panel .mv') && !document.querySelector('#panel .sell'))) throw new Error('в режиме переноса панель не сменилась на подсказку и отмену');
      to = await openCell(ctx, await ctx.eval((c) => SIM.moveCells(APP.play, c).filter((i) => i >= 2 * APP.play.map.cols && SIM.coverage(APP.play, i, 3) > 200), from));
      if (to === undefined) throw new Error('нет допустимой клетки, не закрытой интерфейсом');
      await hover(ctx, to); await ctx.shot('move_mode');
    },
    move_reject: async () => {
      const road = await openCell(ctx, await ctx.eval(() => APP.play.map.road.slice(5)));
      for (const [cell, what] of [[road, 'дорогу'], [other, 'занятую клетку']]) {
        await clickCell(ctx, cell); const st = await state(ctx);
        expect(st.move === from && st.cells[from] === id, `перенос на ${what} не отклонён`, st);
      }
      await hover(ctx, road); await ctx.shot('move_reject');
    },
    move_cancel: async () => {
      await ctx.page.keyboard.press('Escape'); await ctx.wait(60); let st = await state(ctx);
      expect(st.move === -1 && st.sel === from && st.cells[from] === id, 'Esc не отменил перенос (башня должна остаться выбранной)', st);
      await enter(); await clickCell(ctx, to, 'right'); st = await state(ctx);
      expect(st.move === -1 && st.cells[from] === id && st.cells[to] === null, 'правый клик не отменил перенос', st);
      await ctx.shot('move_cancel');
    },
    move_done: async () => {
      const before = await snap(ctx, from);
      await enter(); await clickCell(ctx, to); await ctx.wait(60);
      const st = await state(ctx), after = await snap(ctx, to);
      expect(st.cells[to] === id && st.cells[from] === null && st.move === -1 && st.sel === to, 'башня не перенеслась', st);
      if (after !== before) throw new Error('перенос изменил души или башню (кроме клетки): ' + before + ' → ' + after);
      await ctx.wait(500); await ctx.shot('move_done');
    },
    move_wave: async () => {
      await ctx.eval(() => APP.cmd({ k: 'call' })); await ctx.wait(300);
      await ctx.need('#panel .move.off');
      await ctx.click('#panel .move'); await ctx.page.keyboard.press('KeyM'); await ctx.wait(60);
      const st = await state(ctx); expect(st.move === -1, 'во время волны включился режим переноса', st);
      await ctx.shot('move_wave');
    },
  };
}
