// Гримуар: кнопка в HUD и клавиша G, окно с частично купленными линиями (бонусы видны в панели башни), нехватка душ
// с причиной словами, все линии на максимуме во время волны, закрытые типы не показываются, закрытие по Esc и клику мимо,
// покупки попадают в сейв.
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };
const isOpen = (ctx) => ctx.eval(() => document.getElementById('grim').classList.contains('show') && !!document.querySelector('#grim .gwin .gl'));
const waitOpen = (ctx, want, msg) => ctx.page.waitForFunction((want) => (document.getElementById('grim').classList.contains('show') && !!document.querySelector('#grim .gwin .gl')) === want, want, { timeout: 3000 })
  .catch(() => { throw new Error(msg); });
// строки окна против ответа логики: id, ступени (горящие деления) и подпись кнопки
const rows = (ctx) => ctx.eval(() => {
  const lines = SIM.grimLines(APP.play), got = [...document.querySelectorAll('#grim .gl')].map((r) => { const b = r.querySelector('.gb');
    return { id: b.dataset.l, on: r.querySelectorAll('.pips i.on').length, all: r.querySelectorAll('.pips i').length, cls: b.className, text: b.textContent }; });
  return { lines: lines.map((l) => ({ id: l.id, step: l.step, max: l.max, cost: l.cost })), got };
});
const same = (r) => r.lines.length === r.got.length && r.lines.every((l, i) => r.got[i].id === l.id && r.got[i].on === l.step && r.got[i].all === l.max
  && (l.cost === null ? /МАКСИМУМ/.test(r.got[i].text) : r.got[i].text.includes(String(l.cost))));
// новый забег в той же странице (после первого шага меню скрыто) с закрытым Гримуаром
const fresh = (ctx, seed, opts) => ctx.eval(([seed, opts]) => { GRIM.toggle(false); APP.play = SIM.create(seed, opts || {}); APP.paused = false; APP.speed = 1; SCENE.ui.sel = -1; }, [seed, opts]).then(() => ctx.wait(80));
const buy = (ctx, list) => ctx.eval((list) => { for (const [line, n] of list) for (let i = 0; i < n; i++) APP.cmd({ k: 'grim', line }); }, list).then(() => ctx.wait(80));

export const steps = {
  grim_partial: async (ctx, g) => {
    await g.newGame(ctx); await g.rich(ctx);
    const spot = (await g.spots(ctx))[0]; await g.build(ctx, spot, 'bones');
    const before = await ctx.eval((c) => SIM.towerStats(APP.play, APP.play.towers[c]).dmg, spot);
    await ctx.click('#b-grim'); await waitOpen(ctx, true, 'кнопка ✦ в HUD не открыла Гримуар');
    await ctx.click('#grim .gb[data-l="dmg"]'); await ctx.click('#grim .gb[data-l="bones"]');
    await ctx.page.waitForFunction(() => APP.play.grim.dmg === 1 && APP.play.grim.bones === 1, null, { timeout: 3000 }).catch(() => { throw new Error('клик по кнопке линии не купил ступень'); });
    await buy(ctx, [['dmg', 1], ['range', 3], ['spirits', 2]]);
    const r = await rows(ctx); expect(same(r), 'окно не сходится с логикой: ' + JSON.stringify(r));
    const st = await ctx.eval((c) => ({ dmg: SIM.towerStats(APP.play, APP.play.towers[c]).dmg, saved: (JSON.parse(localStorage.getItem('necropolis.save') || 'null') || { S: {} }).S.grim }), spot);
    expect(st.dmg > before, `урон башни не вырос после покупки: ${before} → ${st.dmg}`);
    expect(st.saved && st.saved.dmg === 2 && st.saved.range === 3, 'покупки Гримуара не попали в сейв: ' + JSON.stringify(st.saved));
    await ctx.shot('grim_partial');
    // Esc закрывает окно, а не ставит паузу; панель башни показывает строку Гримуара и выросший урон
    await ctx.page.keyboard.press('Escape'); await waitOpen(ctx, false, 'Esc не закрыл Гримуар');
    expect(!(await ctx.eval(() => APP.paused)), 'Esc при открытом Гримуаре поставил паузу');
    await g.select(ctx, spot);
    await ctx.page.waitForFunction(() => /Гримуар/.test((document.querySelector('#panel.show .grim') || {}).textContent || ''), null, { timeout: 3000 })
      .catch(() => { throw new Error('в панели башни нет строки Гримуара'); });
    await ctx.shot('grim_panel');
  },
  grim_poor: async (ctx) => {
    await fresh(ctx, 7); await ctx.eval(() => { APP.play.souls = 99999; });
    await buy(ctx, [['rate', 2], ['plague', 1]]);
    await ctx.eval(() => { APP.play.souls = 60; });
    await ctx.page.keyboard.press('KeyG'); await waitOpen(ctx, true, 'клавиша G не открыла Гримуар');
    await ctx.page.waitForFunction(() => [...document.querySelectorAll('#grim .gb')].every((b) => b.classList.contains('poor')), null, { timeout: 3000 })
      .catch(() => { throw new Error('при нехватке душ кнопки не помечены'); });
    await (await ctx.need('#grim .gb[data-l="range"]')).hover();
    const note = await ctx.eval(() => document.querySelector('#grim .note').textContent);
    expect(/Не хватает \d+ душ/.test(note), 'нет причины словами при нехватке душ: ' + note);
    const souls = await ctx.eval(() => APP.play.souls); await ctx.click('#grim .gb[data-l="range"]'); await ctx.wait(80);
    expect((await ctx.eval(() => APP.play.souls)) === souls, 'без душ покупка прошла');
    await ctx.shot('grim_poor');
    // клик мимо окна закрывает его
    await ctx.page.mouse.click(5, (ctx.page.viewportSize().height) * 0.6);
    await waitOpen(ctx, false, 'клик мимо окна не закрыл Гримуар');
  },
  grim_max: async (ctx) => {
    await fresh(ctx, 4294967295);
    await ctx.eval(() => { const S = APP.play; S.souls = 1e6; S.seen = Object.fromEntries(Object.keys(SIM.CONFIG.ENEMIES).map((k) => [k, 1])); S.hp = 1e6; APP.cmd({ k: 'call' }); });
    await ctx.page.waitForFunction(() => APP.play.phase === 'wave', null, { timeout: 5000 });
    await buy(ctx, await ctx.eval(() => SIM.grimLines(APP.play).map((l) => [l.id, l.max])));
    await ctx.eval(() => { APP.play.souls = 99999; });
    await ctx.page.keyboard.press('KeyG'); await waitOpen(ctx, true, 'во время волны Гримуар не открылся');
    const r = await rows(ctx);
    expect(same(r) && r.lines.every((l) => l.step === l.max), 'не все линии на максимуме во время волны: ' + JSON.stringify(r));
    await ctx.shot('grim_max');
  },
  grim_locked: async (ctx) => {
    await fresh(ctx, 5, { unlocked: ['bones', 'spirits'] });
    await ctx.page.keyboard.press('KeyG'); await waitOpen(ctx, true, 'Гримуар не открылся');
    const r = await rows(ctx);
    expect(same(r) && !r.got.some((x) => ['plague', 'dark'].includes(x.id)), 'видны линии закрытых типов: ' + JSON.stringify(r.got.map((x) => x.id)));
    expect(await isOpen(ctx), 'окно закрылось');
  },
};
