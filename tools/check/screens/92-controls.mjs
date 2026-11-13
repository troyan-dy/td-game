// Управление забегом (сид 42): пауза Пробелом и кнопкой — без меню, с меткой, поле и панель башни видны, действия ждут;
// меню отдельной кнопкой и Esc — ставит паузу и при закрытии возвращает прежнюю; волна без автоплея сама не начинается,
// автоплей (A и кнопка) начинает её через задержку из конфига; скорость ×1 ×2 ×4 — кнопками и F по кругу, ×4 вчетверо
// быстрее, запоминается; верхняя полоса на худших значениях — плашки не наезжают друг на друга и на поле.
const SEED = 42;
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };
const st = (ctx) => ctx.eval(() => ({ paused: APP.paused, label: document.getElementById('ui').classList.contains('paused'), menu: document.getElementById('gmenu').classList.contains('show'),
  panel: document.getElementById('panel').classList.contains('show'), t: APP.play.t, phase: APP.play.phase, wave: APP.play.wave, auto: APP.play.auto, speed: APP.speed }));
// волна идёт: башня у дороги, все враги уже встречены (окно «Новый враг» не ставит паузу)
const battle = async (ctx, g) => {
  await ctx.eval((sd) => { APP.newGame(sd); const S = APP.play; S.souls = 5000; S.seen = Object.fromEntries(Object.keys(SIM.CONFIG.ENEMIES).map((k) => [k, 1])); APP.speed = 1; }, SEED);
  const cell = (await g.spots(ctx))[0]; await g.build(ctx, cell, 'bones');
  await ctx.eval(() => APP.cmd({ k: 'call' }));
  await ctx.page.waitForFunction(() => APP.play.enemies.length >= 2, null, { timeout: 20000 });
  return cell;
};

export const steps = {
  controls_pause: async (ctx, g) => {
    await g.newGame(ctx); const cell = await battle(ctx, g);
    await g.select(ctx, cell); await ctx.wait(100);
    await ctx.page.keyboard.press('Space'); await ctx.wait(100);
    let s = await st(ctx);
    expect(s.paused && s.label && !s.menu && s.panel, 'Пробел: ждали паузу с меткой, без меню, с открытой панелью: ' + JSON.stringify(s));
    const t0 = s.t; await ctx.wait(400); expect((await st(ctx)).t === t0, 'время идёт в паузе');
    // действие в паузе не выполняется: ступень ветки
    const before = await ctx.eval((c) => JSON.stringify(APP.play.towers[c].tracks), cell);
    await ctx.click('#panel .tb'); await ctx.wait(100);
    expect(before === await ctx.eval((c) => JSON.stringify(APP.play.towers[c].tracks), cell), 'ступень куплена в паузе');
    expect(await ctx.eval(() => /Пауза/.test(document.getElementById('panel').textContent)), 'панель не говорит, почему кнопки недоступны');
    await ctx.shot('controls_pause');
    await ctx.click('#b-pause'); await ctx.wait(300);
    s = await st(ctx); expect(!s.paused && !s.label && s.t > t0, 'кнопка паузы не продолжила игру: ' + JSON.stringify(s));
    await ctx.click('#b-pause'); expect((await st(ctx)).paused, 'кнопка паузы не поставила паузу'); await ctx.click('#b-pause');
  },
  controls_menu: async (ctx, g) => {
    await g.select(ctx, -1); await ctx.wait(50);
    // меню поверх паузы: закрытие возвращает паузу
    await ctx.page.keyboard.press('Space'); await ctx.click('#b-menu'); await ctx.wait(100);
    let s = await st(ctx); expect(s.menu && s.paused, 'кнопка меню: ' + JSON.stringify(s));
    await ctx.page.keyboard.press('Space'); expect((await st(ctx)).menu, 'Пробел под меню закрыл меню');
    await ctx.page.keyboard.press('Escape'); await ctx.wait(100);
    s = await st(ctx); expect(!s.menu && s.paused && s.label, 'после меню поверх паузы пауза не вернулась: ' + JSON.stringify(s));
    // меню во время игры: Esc открывает, «Продолжить» возвращает игру
    await ctx.page.keyboard.press('Space'); await ctx.page.keyboard.press('Escape'); await ctx.wait(100);
    s = await st(ctx); expect(s.menu && s.paused, 'Esc не открыл меню: ' + JSON.stringify(s));
    await ctx.shot('controls_menu');
    await ctx.click('#p-resume'); await ctx.wait(300);
    s = await st(ctx); const t0 = s.t; expect(!s.menu && !s.paused, '«Продолжить» не вернуло игру: ' + JSON.stringify(s));
    await ctx.wait(300); expect((await st(ctx)).t > t0, 'после меню игра стоит');
  },
  controls_auto: async (ctx) => {
    const delay = await ctx.eval(() => SIM.CONFIG.RUN_CONTROL.autoDelay);
    // волна отбита: без автоплея следующая не начинается, кнопка без отсчёта
    await ctx.eval(() => { const S = APP.play; S.queue = []; S.qi = 0; S.enemies = []; S.shots = []; });
    await ctx.page.waitForFunction(() => APP.play.phase === 'prep', null, { timeout: 5000 });
    // ждём по времени игры (без видеокарты кадров мало и игра идёт медленнее настоящего времени), на ×4
    await ctx.eval(() => { APP.speed = 4; window.__t0 = APP.play.t; });
    await ctx.page.waitForFunction((d) => APP.play.t - window.__t0 >= d + 1.5, delay, { timeout: 60000 });
    await ctx.eval(() => { APP.speed = 1; });
    let s = await st(ctx); const l2 = await ctx.eval(() => document.getElementById('w-l2').textContent);
    expect(s.phase === 'prep' && s.wave === 1 && !s.auto, 'без автоплея волна началась сама: ' + JSON.stringify(s));
    expect(!/через|\d+\s*с/.test(l2), 'кнопка волны показывает отсчёт без автоплея: ' + l2);
    await ctx.shot('controls_auto_off');
    await ctx.page.keyboard.press('KeyA'); await ctx.wait(400);
    s = await st(ctx); const on = await ctx.eval(() => ({ cls: document.getElementById('autobtn').classList.contains('on'), l2: document.getElementById('w-l2').textContent }));
    expect(s.auto && on.cls && /через/.test(on.l2), 'автоплей не включился или не виден: ' + JSON.stringify([s, on]));
    await ctx.shot('controls_auto_on');
    await ctx.page.waitForFunction(() => APP.play.phase === 'wave' && APP.play.wave === 2, null, { timeout: 60000 })
      .catch(() => { throw new Error('автоплей не начал волну 2 за задержку'); });
    await ctx.click('#autobtn'); expect(!(await st(ctx)).auto, 'кнопка автоплея не выключила его');
  },
  controls_speed: async (ctx) => {
    const on = () => ctx.eval(() => [...document.querySelectorAll('#speeds .sp')].map((b) => (b.classList.contains('on') ? b.dataset.s : '')).join(''));
    expect(await ctx.eval(() => document.querySelectorAll('#speeds .sp').length === 3), 'не три кнопки скорости');
    expect(await on() === '1', 'активна не ×1: ' + await on());
    // ×4 — вчетверо быстрее ×1 (сравнение в одном окне: без видеокарты кадров мало, и обе скорости идут медленнее настоящего времени)
    const rate = async () => { const a = await ctx.eval(() => [APP.play.t, performance.now()]); await ctx.wait(1200); const b = await ctx.eval(() => [APP.play.t, performance.now()]);
      return (b[0] - a[0]) / ((b[1] - a[1]) / 1000); };
    const r1 = await rate();
    await ctx.page.keyboard.press('KeyF'); await ctx.wait(50); expect((await st(ctx)).speed === 2 && await on() === '2', 'F: не ×2');
    await ctx.page.keyboard.press('KeyF'); await ctx.wait(50); expect((await st(ctx)).speed === 4 && await on() === '4', 'F: не ×4');
    const k = (await rate()) / r1; expect(k > 3.3 && k < 4.7, '×4 идёт как ×' + k.toFixed(2) + ' от ×1');
    await ctx.page.keyboard.press('KeyF'); await ctx.wait(50); expect((await st(ctx)).speed === 1, 'F после ×4 — не ×1');
    await ctx.click('#speeds .sp[data-s="4"]'); await ctx.wait(50); expect((await st(ctx)).speed === 4 && await on() === '4', 'кнопка ×4');
    // худшие значения верхней полосы: длинный сид, бесконечный режим далеко, огромные души
    await ctx.eval(() => { const S = APP.play; S.seed = SIM.CONFIG.SEED.max; S.endless = true; S.wave = 125; S.souls = 9999999; APP.paused = true; });
    await ctx.wait(200);
    const bad = await ctx.eval(() => { const r = (e) => e.getBoundingClientRect(), k = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--k')) || 1;
      const els = [...document.querySelectorAll('#seedbox, #scout, #title, #stats > *')].filter((e) => e.offsetParent && getComputedStyle(e).visibility !== 'hidden');
      const out = [];
      for (let i = 0; i < els.length; i++) { const p = r(els[i]); if (p.bottom > 58 * k) out.push('ниже полосы: ' + (els[i].id || els[i].className));
        for (let j = i + 1; j < els.length; j++) { const q = r(els[j]); if (Math.min(p.right, q.right) - Math.max(p.left, q.left) > 1 && Math.min(p.bottom, q.bottom) - Math.max(p.top, q.top) > 1) out.push(`${els[i].id || els[i].className} × ${els[j].id || els[j].className}`); } }
      return out; });
    expect(!bad.length, 'верхняя полоса: ' + bad.join('; '));
    await ctx.shot('controls_speed');
    // скорость запоминается в настройках браузера: новая вкладка (пустой sessionStorage) — та же
    await ctx.eval(() => addEventListener('pagehide', () => sessionStorage.clear()));
    await ctx.page.reload(); await ctx.page.waitForFunction(() => window.__ready && window.UI && window.APP, null, { timeout: 20000 });
    expect(await ctx.eval(() => APP.speed) === 4, 'скорость не запомнилась');
  },
};
