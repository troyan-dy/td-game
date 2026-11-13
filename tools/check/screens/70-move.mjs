// Перенос башни между волнами настоящей мышью: режим переноса с подсветкой допустимых клеток и превью под курсором,
// отказ на дорогу и на занятую клетку, отмена по Esc и правому клику, перенос, недоступная кнопка во время волны.
// Сид фиксирован; клетку для клика выбираем прямо перед кликом среди тех, что не закрыты интерфейсом (панель переноса
// может встать иначе, чем в предыдущем шаге), и перед кликом убеждаемся, что под курсором холст.
const SEED = 1;

// Экранная точка центра клетки (координаты страницы для page.mouse).
const cellPoint = (ctx, cell) => ctx.eval((cell) => { const r = document.getElementById('c').getBoundingClientRect(), [x, y] = SIM.cellXY(APP.play, cell);
  return [r.left + x / SIM.VIEW.W * r.width, r.top + y / SIM.VIEW.H * r.height]; }, cell);
// Первая клетка списка, центр которой не закрыт интерфейсом (под курсором холст, а не панель или карточки).
const openCell = (ctx, cells) => ctx.eval((cells) => { const r = document.getElementById('c').getBoundingClientRect();
  return cells.find((c) => { const [x, y] = SIM.cellXY(APP.play, c); return document.elementFromPoint(r.left + x / SIM.VIEW.W * r.width, r.top + y / SIM.VIEW.H * r.height).id === 'c'; }); }, cells);
const hover = async (ctx, cell) => { const [x, y] = await cellPoint(ctx, cell); await ctx.page.mouse.move(x, y); await ctx.wait(60); };
const clickCell = async (ctx, cell, button = 'left') => { const [x, y] = await cellPoint(ctx, cell);
  const under = await ctx.eval(([x, y]) => { const e = document.elementFromPoint(x, y); return e && e.id === 'c' ? null : e ? (e.id || e.className || e.tagName) : 'ничего'; }, [x, y]);
  if (under) throw new Error(`клетка ${cell} закрыта интерфейсом (${under}) — клик ушёл бы не в поле`);
  await ctx.page.mouse.click(x, y, { button }); await ctx.wait(80); };
const state = (ctx) => ctx.eval(() => ({ move: SCENE.ui.move, sel: SCENE.ui.sel, cells: APP.play.towers.map((t) => t && t.id) }));
// Башня на клетке без клетки и таймера выстрела (cd тикает каждый шаг) — всё, что перенос обязан сохранить, и души.
const snap = (ctx, cell) => ctx.eval((c) => { const t = APP.play.towers[c]; if (!t) return null; const o = Object.assign({}, t); delete o.cell; delete o.cd;
  return JSON.stringify({ souls: APP.play.souls, tower: o }); }, cell);
const expect = (cond, what, st) => { if (!cond) throw new Error(what + ': ' + JSON.stringify(st && { move: st.move, sel: st.sel })); };

export async function steps(ctx, g) {
  let from = -1, other = -1, id = 0, to = -1;
  const enter = async () => { await ctx.click('#panel .move'); await g.frames(ctx); const st = await state(ctx); expect(st.move === from, 'кнопка переноса не включила режим', st); };
  // допустимая клетка у дороги, не закрытая интерфейсом сейчас (в режиме переноса)
  const pickTo = async () => { const c = await openCell(ctx, await ctx.eval((c) => SIM.moveCells(APP.play, c).filter((i) => i >= 2 * APP.play.map.cols && SIM.coverage(APP.play, i, 3) > 200), from));
    if (c === undefined) throw new Error('нет допустимой клетки, не закрытой интерфейсом'); return c; };
  return {
    move_mode: async () => {
      await g.newGame(ctx, SEED); await ctx.eval(() => { APP.play.souls = 5000; });
      // башня — на лучшей клетке хотя бы с двумя свободными соседями (вторая башня может занять одного, а шагу move_near
      // нужна ближняя цель)
      const spots = await g.spots(ctx), roomy = await ctx.eval((ids) => { const S = APP.play, n = S.map.cols;
        return ids.find((c) => [-n - 1, -n, -n + 1, -1, 1, n - 1, n, n + 1].filter((d) => { const i = c + d; return Math.abs((i % n) - (c % n)) <= 1 && SIM.canBuild(S, i, 'bones').ok; }).length >= 2); }, spots);
      from = roomy === undefined ? spots[0] : roomy; other = spots.find((c) => c !== from);
      await g.build(ctx, from, 'dark'); await g.build(ctx, other, 'bones'); await g.toPerk(ctx, from);
      id = await ctx.eval((c) => APP.play.towers[c].id, from);
      const inv = await ctx.eval((c) => [APP.play.towers[c].invested, SIM.CONFIG.TOWERS.dark.base.cost], from);   // прокачка правда применилась
      if (!(inv[0] > inv[1])) throw new Error(`прокачка не применилась: вложено ${inv[0]}, постройка ${inv[1]} — правь помощник g.toPerk`);
      await clickCell(ctx, from); await enter();
      if (!await ctx.eval(() => document.querySelector('#panel .mv') && !document.querySelector('#panel .sell'))) throw new Error('в режиме переноса панель не сменилась на подсказку и отмену');
      to = await pickTo(); await hover(ctx, to); await ctx.shot('move_mode');
    },
    // в режиме переноса панель уходит с ближних целей: каждая допустимая клетка вокруг башни видна и кликается (холст, не панель)
    move_near: async () => {
      const near = await ctx.eval((c) => { const S = APP.play, cols = S.map.cols, ok = new Set(SIM.moveCells(S, c)), out = [];
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const i = c + dy * cols + dx; if ((dx || dy) && Math.abs((i % cols) - (c % cols)) <= 1 && ok.has(i)) out.push(i); }
        return out; }, from);
      if (!near.length) throw new Error('у башни нет соседней допустимой клетки — смени место');
      const open = await ctx.eval((cells) => { const r = document.getElementById('c').getBoundingClientRect();
        return cells.map((c) => { const [x, y] = SIM.cellXY(APP.play, c); return document.elementFromPoint(r.left + x / SIM.VIEW.W * r.width, r.top + y / SIM.VIEW.H * r.height).id === 'c'; }); }, near);
      const shut = near.filter((c, i) => !open[i]);
      if (shut.length) throw new Error('в режиме переноса панель закрывает соседние цели: ' + shut.join(', '));
      await ctx.shot('move_near');
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
      await enter(); to = await pickTo(); await clickCell(ctx, to, 'right'); st = await state(ctx);
      expect(st.move === -1 && st.cells[from] === id && st.cells[to] === null, 'правый клик не отменил перенос', st);
      await ctx.shot('move_cancel');
    },
    move_done: async () => {
      const before = await snap(ctx, from);
      await enter(); to = await pickTo(); await clickCell(ctx, to); await g.frames(ctx);
      const st = await state(ctx), after = await snap(ctx, to);
      expect(st.cells[to] === id && st.cells[from] === null && st.move === -1 && st.sel === to, 'башня не перенеслась', st);
      if (after !== before) throw new Error('перенос изменил души или башню (кроме клетки): ' + before + ' → ' + after);
      await ctx.wait(500); await ctx.shot('move_done');
    },
    move_wave: async () => {
      await ctx.eval(() => APP.cmd({ k: 'call' })); await ctx.page.waitForFunction(() => APP.play.phase === 'wave'); await g.frames(ctx);
      await ctx.need('#panel .move.off');
      await ctx.click('#panel .move'); await ctx.page.keyboard.press('KeyM'); await ctx.wait(60);
      const st = await state(ctx); expect(st.move === -1, 'во время волны включился режим переноса', st);
      await ctx.shot('move_wave');
    },
  };
}
