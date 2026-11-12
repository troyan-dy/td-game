// tools/check.game.mjs — ИГРОВАЯ ЧАСТЬ команды проверки tools/check.mjs. Единственное место, которое правят игровые тикеты,
// когда меняется интерфейс игры: какую страницу открыть, какие экраны снять, куда кликнуть, какой итог ботов считать
// ожидаемым, как проверять вёрстку. Каркас (сервер, браузер, сбор ошибок, сводка, код возврата) живёт в tools/check.mjs
// и сюда не лезет.
//
// Что отдаёт этот модуль каркасу:
//   BOTS      — партии ботов и их ожидаемый итог; бегут в отдельном потоке, неожиданный итог валит проверку.
//   VIEWPORTS — размеры окна; сценарий проходится в каждом.
//   scenario  — шаги в браузере. ctx.step(имя, fn) — шаг; ctx.need/ctx.click — элемент, без которого шаг пропускается
//               (строка в сводке, не провал); ctx.skip(причина) — явный пропуск; ctx.shot(имя) — скриншот + inspect().
//               Ошибка внутри шага (например, исчез APP.cmd) — провал шага: значит, сценарий пора поправить здесь.
//   inspect   — проверка вёрстки на текущем экране (бывший tools/uicheck.mjs): тексты не вылезают из рамок, панели
//               не уходят за экран. Каждый найденный дефект валит проверку.
//
// После перехода на клетчатую карту (тикет #2) здесь устареют: шаг «panels» (площадки C.SLOTS, номера слотов 5+i,
// команды build/upgrade/perk со slot, перки PERK_L3), шаг «battle» (постройка на площадки) и BOTS, если поменяется
// API tests/bots.mjs. Пока площадок нет, эти шаги пропускаются со строкой в сводке, а не падают.

// ---------------------------------------------------------------- боты
// Ожидания повторяют tests/game.test.mjs: меняешь баланс или ботов — поправь оба места.
const fmt = (r) => `${r.phase.padEnd(4)} волна ${String(r.wave).padStart(2)} hp ${String(r.hp).padStart(2)} ${String(r.t).padStart(4)} с`;
// Боты грузятся лениво: если API tests/bots.mjs поменяется, упадут только боты, а сценарий в браузере пройдёт.
const bot = (name, run, ok, want) => ({ name, run: async () => { const r = run(await import('../tests/bots.mjs'));
  return { line: fmt(r), problem: ok(r) ? null : 'ждали ' + want }; } });
const smartOk = (r) => r.phase === 'won' && r.hp >= 2 && r.hp <= 14 && r.t >= 35 * 60 && r.t <= 55 * 60;
export const BOTS = [
  bot('idle s1', (B) => B.play(B.idle, 1), (r) => r.phase === 'lost' && r.wave <= 4, 'проигрыш к 4-й волне'),
  bot('smart s1', (B) => B.play(B.smart, 1), smartOk, 'победа, hp 2–14, 35–55 мин'),
  bot('smart s2', (B) => B.play(B.smart, 2), smartOk, 'победа, hp 2–14, 35–55 мин'),
  bot('smart s3', (B) => B.play(B.smart, 3), smartOk, 'победа, hp 2–14, 35–55 мин'),
  bot('bones s1', (B) => B.play(B.spamBones, 1), (r) => r.phase === 'lost' && r.wave >= 12 && r.wave <= 23, 'проигрыш на 12–23 волне'),
];

// ---------------------------------------------------------------- браузер
export const PAGE = '/live/index.html';
export const VIEWPORTS = [{ width: 1280, height: 720 }, { width: 1920, height: 1080 }];
const TOWERS = ['bones', 'spirits', 'plague', 'dark'];
const PERK_L3 = { bones: 'pierce', spirits: 'frost', plague: 'pestilence', dark: 'harvest' };   // перк с самым длинным текстом панели

export async function scenario(ctx) {
  const { step, shot, click, eval: ev } = ctx;
  const ok = await step('open', async () => {
    await ctx.goto(PAGE);
    await ev(() => { localStorage.clear(); sessionStorage.clear(); });
    await ctx.page.reload();
    await ctx.page.waitForFunction(() => window.__ready && window.UI && window.APP, null, { timeout: 30000 });
  }, { fatal: true });
  if (!ok) return;

  await step('menu', () => shot('menu'));
  await step('menu_help', async () => { await click('#m-help'); await shot('menu_help'); });
  await step('hud', async () => {
    await click('#m-new');
    await ev(() => { const S = APP.play; S.souls = 99999; S.hp = 20; S.wave = 24; S.phase = 'prep'; S.prepT = 9.4; APP.paused = false; });
    await shot('hud');
  });
  // Панель башни на худших значениях: каждый тип, уровни 1 и 3 с перком.
  for (const [i, t] of TOWERS.entries()) for (const lvl of [1, 3]) {
    await step(`panel_${t}_${lvl}`, async () => {
      if (!(await ev(() => !!(window.APP && APP.play && SIM.CONFIG.SLOTS && SIM.CONFIG.SLOTS.length)))) ctx.skip('нет площадок SIM.CONFIG.SLOTS — обнови шаг под новую постройку');
      const slot = 5 + i;
      await ev(([slot, t]) => { APP.play.towers[slot] = null; APP.cmd({ k: 'build', slot, type: t }); }, [slot, t]);
      await ctx.wait(60);
      await ev(([slot, lvl, perk]) => { for (let l = 1; l < lvl; l++) APP.cmd({ k: 'upgrade', slot }); if (perk) APP.cmd({ k: 'perk', slot, p: perk }); SCENE.ui.sel = slot; },
        [slot, lvl, lvl === 3 ? PERK_L3[t] : null]);
      await shot(`panel_${t}_${lvl}`);
    });
  }
  await step('panel_empty', async () => {
    if (!(await ev(() => !!(SIM.CONFIG.SLOTS && SIM.CONFIG.SLOTS.length)))) ctx.skip('нет площадок SIM.CONFIG.SLOTS');
    await ev(() => { SCENE.ui.sel = 0; }); await shot('panel_empty');
  });
  await step('cardtip', async () => {
    const card = await ctx.need('.card');
    await ev(() => { SCENE.ui.sel = -1; });
    await card.evaluate((el) => el.dispatchEvent(new PointerEvent('pointerover', { bubbles: true })));
    await shot('cardtip');
  });
  await step('newenemy', async () => { await ev(() => { APP.play.ev.push({ k: 'newEnemy', type: 'paladin', t: APP.play.t }); }); await shot('newenemy'); });
  await step('toasts', async () => {
    await ctx.page.keyboard.press('Enter');
    await ev(() => { APP.play.ev.push({ k: 'boss', name: 'Паладин-командор', t: APP.play.t, x: 1, y: 1 }, { k: 'wave', wave: 25, boss: true, t: APP.play.t + 0.001 }); });
    await shot('toasts');
  });
  await step('pause', async () => { await ctx.page.keyboard.press('Space'); await shot('pause'); await ctx.page.keyboard.press('Space'); });
  await step('end_won', async () => {
    await ev(() => { const s = APP.play.stats; s.time = 3599; s.kills = 99999; s.earned = 999999; APP.play.phase = 'won'; });
    await ctx.wait(1200); await shot('end_won');
  });
  // Живой бой: «Играть снова» с экрана итога, несколько башен, волна идёт на ускорении — видно карту, врагов, снаряды.
  await step('battle', async () => {
    if (!(await ev(() => !!(SIM.CONFIG.SLOTS && SIM.CONFIG.SLOTS.length)))) ctx.skip('нет площадок SIM.CONFIG.SLOTS — обнови постройку в шаге battle');
    await click('#e-again');
    await ev(() => {
      APP.play.souls = 2000;
      [[11, 'bones'], [5, 'spirits'], [6, 'plague'], [7, 'dark']].forEach(([slot, type]) => APP.cmd({ k: 'build', slot, type }));
      APP.cmd({ k: 'call' }); APP.speed = 2;
    });
    await ctx.wait(4000); await shot('battle');
  });
}

// ---------------------------------------------------------------- вёрстка (бывший tools/uicheck.mjs)
export async function inspect(page) {
  return page.evaluate(() => {
    const out = [], root = document.getElementById('ui'); if (!root) return out;
    const ui = root.getBoundingClientRect(), BOX = '.frame,.btn,.card';
    for (const el of root.querySelectorAll('*')) {
      const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden' || !el.offsetParent) continue;
      const b = el.getBoundingClientRect(); if (!b.width) continue;
      if (el.scrollWidth > el.clientWidth + 2 && cs.overflow !== 'visible' && el.clientWidth) out.push('overflow-x ' + (el.id || el.className) + ' ' + el.textContent.slice(0, 30));
      if (el.children.length === 0 && el.textContent.trim()) {                 // текстовый лист: внутри родительской рамки
        const par = el.closest(BOX); if (par) { const pb = par.getBoundingClientRect();
          if (b.right > pb.right + 1 || b.left < pb.left - 1 || b.bottom > pb.bottom + 1 || b.top < pb.top - 1) out.push('text-out ' + (par.id || par.className) + ': ' + el.textContent.trim().slice(0, 30)); }
      }
      if (el.matches(BOX) && (b.right > ui.right + 1 || b.left < ui.left - 1 || b.bottom > ui.bottom + 1 || b.top < ui.top - 1)) out.push('offscreen ' + (el.id || el.className));
    }
    return out;
  });
}
