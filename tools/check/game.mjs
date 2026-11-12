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
// Переход на клетчатую карту (тикет #2) правит здесь помощники spots/build/upgrade/perk/select (сейчас они про
// площадки SIM.CONFIG.SLOTS и команды со slot) и, если поменяется, open(); экраны их только вызывают. Ожидания ботов —
// в tests/runs.mjs. Пока помощники не перенесены, шаги панелей и боя падают — так и задумано.

// ---------------------------------------------------------------- боты
// Партии и ожидания — tests/runs.mjs (их же читает tests/game.test.mjs). Импорт ленивый: сломанный модуль ботов
// роняет только ботов, а не сценарий в браузере.
export async function bots() {
  const { RUNS, playRun, describe } = await import('../../tests/runs.mjs');
  return RUNS.map((R) => ({ name: R.name, run: () => { const r = playRun(R); return { line: describe(r), problem: R.ok(r) ? null : 'ждали: ' + R.want }; } }));
}

// ---------------------------------------------------------------- страница
export const PAGE = '/live/index.html';
export const VIEWPORTS = [{ width: 1280, height: 720 }, { width: 1920, height: 1080 }];

// Свежая страница: пустые localStorage и sessionStorage, игра загрузилась.
export async function open(ctx) {
  await ctx.goto(ctx.pagePath);
  await ctx.eval(() => { localStorage.clear(); sessionStorage.clear(); });
  await ctx.page.reload();
  await ctx.page.waitForFunction(() => window.__ready && window.UI && window.APP, null, { timeout: 20000 });
}

// ---------------------------------------------------------------- помощники состояния игры
// Новая партия через кнопку меню.
export async function newGame(ctx) {
  await ctx.click('#m-new');
  await ctx.page.waitForFunction(() => !!(window.APP && APP.play));
}
// Бесконечные души и прочие «худшие значения» для HUD.
export const rich = (ctx) => ctx.eval(() => { const S = APP.play; S.souls = 99999; S.hp = 20; S.wave = 24; S.phase = 'prep'; S.prepT = 9.4; APP.paused = false; });
// Типы башен в порядке карточек.
export const towerTypes = (ctx) => ctx.eval(() => SIM.CONFIG.TOWER_ORDER.slice());
// Места под постройку: идентификаторы, которые понимают build/upgrade/perk/select; первыми — места у дороги,
// где башня сразу стреляет (для боя).
const GOOD = [11, 5, 6, 7];
export async function spots(ctx) {
  const ids = await ctx.eval((good) => (window.SIM && SIM.CONFIG.SLOTS
    ? [...good, ...SIM.CONFIG.SLOTS.map((s, i) => i).filter((i) => !good.includes(i))].filter((i) => i < SIM.CONFIG.SLOTS.length) : null), GOOD);
  if (!ids || !ids.length) throw new Error('нет мест под постройку (SIM.CONFIG.SLOTS) — перенеси помощники в tools/check/game.mjs на новую постройку');
  return ids;
}
export const build = (ctx, spot, type) => ctx.eval(([slot, type]) => { APP.play.towers[slot] = null; APP.cmd({ k: 'build', slot, type }); }, [spot, type]).then(() => ctx.wait(60));
export const upgrade = (ctx, spot, times = 1) => ctx.eval(([slot, n]) => { for (let i = 0; i < n; i++) APP.cmd({ k: 'upgrade', slot }); }, [spot, times]).then(() => ctx.wait(30));
// Перк с самым длинным текстом — худший случай для панели.
export const longestPerk = (ctx, type) => ctx.eval((t) => { const P = SIM.CONFIG.TOWERS[t].perks;
  return Object.keys(P).sort((a, b) => (P[b].name + P[b].desc).length - (P[a].name + P[a].desc).length)[0]; }, type);
export const perk = (ctx, spot, p) => ctx.eval(([slot, p]) => { APP.cmd({ k: 'perk', slot, p }); }, [spot, p]).then(() => ctx.wait(30));
export const select = (ctx, spot) => ctx.eval((s) => { SCENE.ui.sel = s; }, spot);
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
