// Вид и понятность (#19, часть 2): свой вид новых башен (процедурный рисунок одинаков на поле, карточке и в панели), роль на
// карточке, справка из меню паузы влезает в окно, тост — в верхней полосе и не закрывает панель, карточка босса в паузе
// перед его волной, экран поражения называет, кто отнял прочность склепа. Сид фиксированный.
const SEED = 4242;
const rect = (ctx, sel) => ctx.eval((sel) => { const e = document.querySelector(sel); if (!e || !e.offsetParent) return null; const r = e.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; }, sel);
const cross = (a, b) => a && b && Math.min(a[2], b[2]) > Math.max(a[0], b[0]) && Math.min(a[3], b[3]) > Math.max(a[1], b[1]);

export const steps = {
  polish_towers: async (ctx, g) => {
    await g.newGame(ctx, SEED);
    const types = ['bell', 'barracks', 'altar'], spots = await g.spots(ctx);
    await ctx.eval(() => { APP.play.souls = 5000; });
    for (let i = 0; i < types.length; i++) await g.build(ctx, spots[i], types[i]);
    // свой рисунок: текстура и картинка карточки — из towerart.js, роль подписана на карточке
    const bad = await ctx.eval((types) => types.filter((t) => { const n = 'tw_' + SIM.art(t).sprite + '_1', c = document.querySelector(`.card[data-type="${t}"]`);
      return !(window.TOWERART && TOWERART.get(n) && c && c.querySelector('img') && c.querySelector('img').src.startsWith('data:') && c.querySelector('.rl').textContent === SIM.CONFIG.TOWERS[t].tag); }), types);
    if (bad.length) throw new Error('нет своего вида или роли на карточке: ' + bad.join(', '));
    await g.select(ctx, spots[0]);
    const txt = await (await ctx.need('#panel.show .role')).innerText();
    if (txt !== await ctx.eval(() => SIM.CONFIG.TOWERS.bell.role)) throw new Error('в панели нет роли Колокола: ' + txt);
    await ctx.shot('polish_towers');
  },
  polish_toast: async (ctx, g) => {
    await g.pushEvent(ctx, { k: 'waveClear', wave: 3, bonus: 54 }); await g.frames(ctx);
    const t = await rect(ctx, '#toasts .toast'), p = await rect(ctx, '#panel.show'), sc = await rect(ctx, '#scout-panel.show');
    if (!t) throw new Error('тост не показан');
    if (cross(t, p) || cross(t, sc)) throw new Error('тост закрывает панель или разведку');
    await ctx.shot('polish_toast');
  },
  polish_help: async (ctx, g) => {
    await g.select(ctx, -1); await ctx.page.keyboard.press('Escape'); await ctx.need('#gmenu.show');
    await ctx.click('#p-help'); await ctx.need('#help.show');
    const r = await rect(ctx, '#help .box'), vp = ctx.page.viewportSize();
    if (!r || r[1] < 0 || r[3] > vp.height || r[0] < 0 || r[2] > vp.width) throw new Error('справка не влезает в окно: ' + JSON.stringify(r));
    await ctx.shot('polish_help');
    await ctx.page.keyboard.press('Escape'); if (await ctx.eval(() => document.getElementById('help').classList.contains('show'))) throw new Error('Esc не закрыл справку');
    await ctx.page.keyboard.press('Escape');
  },
  polish_boss: async (ctx, g) => {
    await ctx.eval(() => { const S = APP.play; S.wave = 9; S.phase = 'prep'; S.autoT = 0; APP.play.ev.push({ k: 'waveClear', t: S.t, wave: 9, bonus: 102 }); });
    await ctx.page.waitForFunction(() => document.getElementById('newenemy').classList.contains('show'), null, { timeout: 5000 }).catch(() => { throw new Error('нет карточки босса в паузе перед его волной'); });
    const txt = await ctx.eval(() => document.getElementById('newenemy').innerText);
    if (!/Босс 10-й волны/.test(txt)) throw new Error('карточка не про босса следующей волны: ' + txt.slice(0, 80));
    await ctx.shot('polish_boss');
    await ctx.page.keyboard.press('Enter');
  },
  polish_lost: async (ctx, g) => {
    await ctx.eval(() => { const S = APP.play; S.leakBy = { knight: 4, paladin: 1 }; S.hp = 0; });
    await ctx.need('#end.show', 5000); await ctx.page.waitForFunction(() => document.querySelector('#end .leaks'), null, { timeout: 5000 }).catch(() => { throw new Error('на экране поражения нет списка прорвавшихся'); });
    const txt = await ctx.eval(() => document.querySelector('#end .leaks').innerText);
    if (!/Паладин ×1/.test(txt) || !/−6/.test(txt) || !/Рыцарь со щитом ×4/.test(txt)) throw new Error('кто отнял прочность — неверно: ' + txt);
    await ctx.shot('polish_lost');
  },
};
