// Продолжение забега после перезагрузки страницы: посреди волны в паузе — та же вкладка (забег сразу на месте) и новая
// вкладка (пустой sessionStorage: меню с «Продолжить», после нажатия — ровно то же состояние). Негодные сейвы (битый JSON,
// старая версия, башня неизвестного типа, законченный забег, крошечный шаг, пауза после последней волны, бесконечный режим до победы, ключ прежней сборки) «Продолжить» не дают и стираются.
const KEY = 'necropolis.save';
const reload = async (ctx, newTab) => {
  // новая вкладка: localStorage общий, sessionStorage свой. Дев-перезагрузка пишет забег в sessionStorage при уходе со страницы,
  // поэтому стираем его последним обработчиком ухода — как если бы вкладку закрыли и открыли игру заново
  if (newTab) await ctx.eval(() => addEventListener('pagehide', () => sessionStorage.clear()));
  await ctx.page.reload();
  await ctx.page.waitForFunction(() => window.__ready && window.UI && window.APP, null, { timeout: 20000 });
  await ctx.wait(200);
};
const snapshot = (ctx) => ctx.eval(() => JSON.stringify(APP.play));

// шаги делят снимок забега на паузе; окна идут параллельно, поэтому снимок свой у каждого вызова steps
export function steps() {
  let paused = null;
  return {
    continue_reload: async (ctx, g) => {
      await g.newGame(ctx); await ctx.eval(() => { APP.play.souls = 2000; });
      const types = await g.towerTypes(ctx), spots = await g.spots(ctx);
      for (const [i, t] of types.entries()) await g.build(ctx, spots[i], t);
      await ctx.eval(() => { APP.cmd({ k: 'call' }); APP.speed = 2; });
      await ctx.page.waitForFunction(() => APP.play.enemies.length >= 3, null, { timeout: 20000 });
      await ctx.page.keyboard.press('Space'); await ctx.wait(100);
      paused = await snapshot(ctx);
      await reload(ctx, false);
      const now = await snapshot(ctx), st = await ctx.eval(() => ({ paused: APP.paused, pause: document.getElementById('pause').classList.contains('show') }));
      if (now !== paused) throw new Error('после перезагрузки вкладки забег не тот же: ' + (now ? JSON.parse(now).t : 'меню') + ' против ' + JSON.parse(paused).t);
      if (!st.paused || !st.pause) throw new Error('забег на паузе после перезагрузки снят с паузы: ' + JSON.stringify(st));
      await ctx.shot('continue_reload');
    },
    continue_menu: async (ctx) => {
      if (!paused) ctx.skip('нет забега из предыдущего шага');
      await reload(ctx, true);
      const st = await ctx.eval(() => { const b = document.getElementById('m-cont'); return { play: !!APP.play, cont: b && b.textContent }; });
      const S = JSON.parse(paused);
      if (st.play || !st.cont || !st.cont.includes('волна ' + S.wave) || !st.cont.includes('сид ' + S.seed)) throw new Error('меню новой вкладки: ' + JSON.stringify(st));
      await ctx.shot('continue_menu');
    },
    continue_resume: async (ctx) => {
      if (!paused) ctx.skip('нет забега из предыдущего шага');
      await ctx.need('#m-cont');
      const now = await ctx.eval(() => { document.getElementById('m-cont').click(); APP.paused = true; return JSON.stringify(APP.play); });
      if (now !== paused) throw new Error('«Продолжить» загрузило не то состояние: t ' + JSON.parse(now).t + ' против ' + JSON.parse(paused).t);
      await ctx.eval(() => { APP.paused = false; }); const t0 = await ctx.eval(() => APP.play.t); await ctx.wait(500);
      if (!((await ctx.eval(() => APP.play.t)) > t0)) throw new Error('продолженный забег не идёт');
      await ctx.shot('continue_resume');
    },
    continue_bad: async (ctx) => {
      if (!paused) ctx.skip('нет забега из предыдущего шага');
      const [good, lastWave] = await ctx.eval((k) => { APP.toMenu(); return [localStorage.getItem(k), SIM.waveCount()]; }, KEY);
      const spoil = {
        'битый JSON': () => '{{{',
        'старая версия': (sv) => { sv.S.v -= 1; },
        'башня неизвестного типа': (sv) => { sv.S.towers[sv.S.towers.findIndex(Boolean)] = { type: 'nope' }; },
        'враг без полей': (sv) => { sv.S.enemies[0] = { type: sv.S.enemies[0].type }; },
        'законченный забег': (sv) => { sv.S.phase = 'lost'; },
        'крошечный шаг времени (меню не должно зависнуть)': (sv) => { sv.S.dt = 1e-9; },
        'пауза после последней волны': (sv) => { Object.assign(sv.S, { phase: 'prep', wave: lastWave, prepT: 10, enemies: [], queue: [], qi: 0 }); },
        'бесконечный режим до победы': (sv) => { sv.S.endless = true; },
      };
      for (const [name, f] of Object.entries(spoil)) {
        const sv = JSON.parse(good), v = f(sv);
        await ctx.eval(([k, v]) => { localStorage.setItem(k, v); localStorage.setItem(k + '.v1', '{"S":{"v":1}}'); }, [KEY, typeof v === 'string' ? v : JSON.stringify(sv)]);
        await reload(ctx, true);
        const st = await ctx.eval((k) => ({ cont: !!document.getElementById('m-cont'), menu: document.getElementById('menu').classList.contains('show'),
          keys: Object.keys(localStorage).filter((x) => x.startsWith(k)) }), KEY);
        if (st.cont || !st.menu || st.keys.length) throw new Error(`сейв «${name}»: ` + JSON.stringify(st));
      }
      await ctx.shot('continue_bad');
    },
  };
}
