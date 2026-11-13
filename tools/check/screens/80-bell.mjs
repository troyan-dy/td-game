// Колокол: карточка внизу, панель башни (оглушение среди характеристик) и удар в бою — волна от башни и звёзды
// оглушения над врагами. Колокол ставится у дороги рядом со входом: враги первой волны доходят до него быстро.

// свободная клетка рядом с дорогой (с четвёртой клетки от входа), откуда малый радиус Колокола накрывает участок дороги
const nearGate = (ctx) => ctx.eval(() => { const S = APP.play, cols = S.map.cols, r = SIM.CONFIG.TOWERS.bell.base.range;
  for (const rc of S.map.road.slice(3)) { const x = rc % cols, y = Math.floor(rc / cols);
    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) { const nx = x + dx, ny = y + dy, c = ny * cols + nx;
      if (nx >= 0 && nx < cols && ny >= 0 && ny < S.map.rows && SIM.canBuild(S, c, 'bell').ok && SIM.coverage(S, c, r) > 120) return c; } }
  return -1; });

export async function steps(ctx, g) {
  let cell = -1;
  return {
    bell_panel: async () => {
      await g.newGame(ctx); await ctx.eval(() => { APP.play.souls = 5000; });
      const n = await ctx.eval(() => [document.querySelectorAll('#cards .card').length, SIM.CONFIG.TOWER_ORDER.length]);
      if (n[0] !== n[1]) throw new Error(`карточек ${n[0]}, типов башен ${n[1]}`);
      await ctx.need('#cards .card[data-type="bell"]');
      cell = await nearGate(ctx); if (cell < 0) throw new Error('нет клетки у дороги рядом со входом под Колокол');
      await g.build(ctx, cell, 'bell'); await g.select(ctx, cell); await ctx.need('#panel.show');
      const txt = await ctx.eval(() => document.getElementById('panel').textContent);
      if (!/Оглушение/.test(txt) || !/КОЛОКОЛ/.test(txt)) throw new Error('в панели Колокола нет строки оглушения: ' + txt.slice(0, 120));
      await ctx.shot('bell_panel');
    },
    // волна идёт на ускорении; кадр — через долю секунды после удара, пока волна расходится и враги оглушены
    bell_strike: async () => {
      await g.select(ctx, -1); await ctx.eval(() => { APP.cmd({ k: 'call' }); APP.speed = 2; });
      await ctx.page.waitForFunction(() => { const S = APP.play, p = S.ev.find((e) => e.k === 'pulse' && S.t - e.t > 0.08 && S.t - e.t < 0.25);
        if (!p || !S.enemies.some((e) => e.stunT > 0)) return false; APP.paused = true; return true; }, null, { timeout: 90000, polling: 'raf' });
      await ctx.wait(150);
      const st = await ctx.eval(() => ({ stunned: APP.play.enemies.filter((e) => e.stunT > 0).length, hurt: APP.play.enemies.filter((e) => e.hp < e.max).length }));
      if (!st.stunned || !st.hurt) throw new Error('после удара нет оглушённых и раненых врагов: ' + JSON.stringify(st));
      await ctx.shot('bell_strike');
      await ctx.eval(() => { APP.paused = false; });
    },
  };
}
