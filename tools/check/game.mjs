// tools/check/game.mjs — общая ИГРОВАЯ часть команды проверки tools/check.mjs. Каркас (сервер, браузер, сбор ошибок,
// сводка, код возврата) про игру не знает ничего; всё, что знает, — здесь и в tools/check/screens/.
//
// Устройство:
//   tools/check/game.mjs       — страница, окна, боты, открытие страницы, проверка вёрстки и ПОМОЩНИКИ состояния игры
//                                (новая партия, места под постройку, постройка, улучшение, выбор башни).
//   tools/check/screens/*.mjs  — по файлу на экран. Каркас берёт их по отсортированному имени; каждый файл получает
//                                свежую страницу (open) и экспортирует steps — упорядоченные шаги этого экрана.
//                                Файлы друг от друга не зависят: новый экран — новый файл, соседние не трогаются.
//
// Правила шагов: нет нужного элемента (ctx.need/ctx.click) или упал код шага — провал шага. Пропуск — только явный
// ctx.skip('причина'). В каждом окне должен пройти хотя бы один шаг и сняться хотя бы один скриншот.
//
// Здесь только общее для нескольких экранов. Помощник, нужный одному экрану, живёт в файле этого экрана.

// ---------------------------------------------------------------- боты
// Партии и ожидания — tests/runs.mjs (их же читает tests/game.test.mjs). Импорт ленивый: сломанный модуль ботов
// роняет только ботов, а не сценарий в браузере.
export async function bots() {
  const { RUNS, resultOf, results, describe } = await import('../../tests/runs.mjs');
  return RUNS.map((R) => ({ name: R.name, run: () => { const r = resultOf(R.name); return { line: describe(r), problem: R.ok(r, results) ? null : 'ждали: ' + R.want }; } }));
}

// ---------------------------------------------------------------- страница
export const PAGE = '/live/index.html';
export const VIEWPORTS = [{ width: 1280, height: 720 }, { width: 1920, height: 1080 }];

// Свежая страница: пустые localStorage и sessionStorage, игра загрузилась.
export async function open(ctx) {
  await ctx.goto(ctx.pagePath);
  await ctx.eval(() => { localStorage.clear(); sessionStorage.clear(); });
  await ctx.page.reload();
  await ctx.page.waitForFunction(() => window.__ready && window.UI && window.APP, null, { timeout: 60000 });
}

// ---------------------------------------------------------------- помощники состояния игры
// Новая партия через кнопку меню.
export async function newGame(ctx) {
  await ctx.click('#m-new');
  await ctx.page.waitForFunction(() => !!(window.APP && APP.play));
}
// Бесконечные души и прочие «худшие значения» для HUD.
export const rich = (ctx) => ctx.eval(() => { const S = APP.play; S.souls = 99999; S.hp = 20; S.wave = SIM.waveCount() - 1; S.phase = 'prep'; S.prepT = 9.4; APP.paused = false; });
// Типы башен в порядке карточек.
export const towerTypes = (ctx) => ctx.eval(() => SIM.CONFIG.TOWER_ORDER.slice());
// Места под постройку: индексы свободных клеток, где можно строить, по убыванию покрытия дороги (первые — у дороги,
// там башня сразу стреляет). Их понимают build/upgrade/perk/select.
export async function spots(ctx) {
  const ids = await ctx.eval(() => (window.SIM && APP.play ? SIM.rankCells(APP.play, 3.4) : null));
  if (!ids || !ids.length) throw new Error('нет свободных клеток под постройку (SIM.rankCells) — сначала новая партия');
  return ids;
}
export const build = (ctx, cell, type) => ctx.eval(([cell, type]) => { APP.play.towers[cell] = null; APP.cmd({ k: 'build', cell, type }); }, [cell, type]).then(() => ctx.wait(60));
export const upgrade = (ctx, cell, times = 1) => ctx.eval(([cell, n]) => { for (let i = 0; i < n; i++) APP.cmd({ k: 'upgrade', cell }); }, [cell, times]).then(() => ctx.wait(30));
// Перк с самым длинным текстом — худший случай для панели.
export const longestPerk = (ctx, type) => ctx.eval((t) => { const P = SIM.CONFIG.TOWERS[t].perks;
  return Object.keys(P).sort((a, b) => (P[b].name + P[b].desc).length - (P[a].name + P[a].desc).length)[0]; }, type);
export const perk = (ctx, cell, p) => ctx.eval(([cell, p]) => { APP.cmd({ k: 'perk', cell, p }); }, [cell, p]).then(() => ctx.wait(30));
export const select = (ctx, cell) => ctx.eval((c) => { SCENE.ui.sel = c; }, cell);
export const pushEvent = (ctx, ...evs) => ctx.eval((evs) => { for (const e of evs) APP.play.ev.push(Object.assign({ t: APP.play.t }, e)); }, evs);

// ---------------------------------------------------------------- вёрстка (бывший tools/uicheck.mjs)
// Тексты не вылезают из рамок, рамки не уходят за слой интерфейса, нет горизонтального переполнения. Каждый дефект — провал.
export async function inspect(page) {
  return page.evaluate(() => {
    const root = document.getElementById('ui'); if (!root) return ['нет слоя интерфейса #ui'];
    const out = [], ui = root.getBoundingClientRect(), BOX = '.frame,.btn,.card';
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
