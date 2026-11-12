// Главное меню: пустое поле сида без «Продолжить», справка «Как играть», поле сида с самым длинным допустимым
// значением и с негодным вводом, забег по введённому сиду (тот же сид в HUD и та же карта).
const fill = async (ctx, v) => { await ctx.need('#m-seed'); await ctx.page.fill('#m-seed', v); };
const seedUi = (ctx) => ctx.eval(() => ({ note: document.getElementById('m-seednote').textContent, bad: document.getElementById('m-seednote').classList.contains('bad'),
  off: document.getElementById('m-seedgo').disabled }));

export const steps = {
  menu: async (ctx) => {
    await ctx.need('#m-seed');
    const st = await ctx.eval(() => ({ cont: !!document.getElementById('m-cont'), off: document.getElementById('m-seedgo').disabled }));
    if (st.cont || !st.off) throw new Error('пустое меню без сейва: ' + JSON.stringify(st));
    await ctx.shot('menu');
  },
  menu_help: async (ctx) => { await ctx.click('#m-help'); await ctx.shot('menu_help'); await ctx.click('#m-help'); },
  menu_seed_long: async (ctx) => {
    const max = String(await ctx.eval(() => SIM.CONFIG.SEED.max));
    await fill(ctx, max); const st = await seedUi(ctx);
    if (st.off || st.bad || !st.note.includes(max)) throw new Error('самый длинный допустимый сид не принят: ' + JSON.stringify(st));
    await ctx.shot('menu_seed_long');
  },
  menu_seed_bad: async (ctx) => {
    // любой негодный ввод — понятная подпись и закрытая кнопка; Enter в поле забег не начинает
    for (const v of ['-5', '4294967296', 'некрополис', '1.5', '1e3', ' 4 2 ', '9'.repeat(40)]) {
      await fill(ctx, v); const st = await seedUi(ctx);
      if (!st.off || !st.bad || !st.note) throw new Error(`негодный сид ${JSON.stringify(v)} принят: ` + JSON.stringify(st));
    }
    await ctx.page.press('#m-seed', 'Enter');
    if (await ctx.eval(() => !!APP.play)) throw new Error('Enter на негодном сиде начал забег');
    await ctx.shot('menu_seed_huge');
    await fill(ctx, 'некрополис'); await ctx.shot('menu_seed_bad');
    await fill(ctx, '   '); const st = await seedUi(ctx);
    if (!st.off || st.bad) throw new Error('пробелы в поле сида — не пустое поле: ' + JSON.stringify(st));
  },
  menu_seed_play: async (ctx) => {
    await fill(ctx, ' 0042 '); await ctx.page.press('#m-seed', 'Enter');
    await ctx.page.waitForFunction(() => !!(window.APP && APP.play));
    await ctx.wait(200);
    const st = await ctx.eval(() => ({ seed: APP.play.seed, hud: document.getElementById('s-seed').textContent, phase: APP.play.phase, wave: APP.play.wave,
      same: JSON.stringify(APP.play.map) === JSON.stringify(SIM.create(42).map), menu: document.getElementById('menu').classList.contains('show') }));
    if (st.seed !== 42 || st.hud !== '42' || !st.same || st.menu) throw new Error('забег по сиду 42: ' + JSON.stringify(st));
    if (st.phase !== 'prep' || st.wave !== 0) throw new Error('Enter в поле сида ещё и призвал волну: ' + JSON.stringify(st));
    await ctx.shot('menu_seed_play');
  },
};
