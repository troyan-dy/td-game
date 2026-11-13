// Панель разведки на худших случаях: волна со свойством и наибольшим числом отрядов, босс с самой большой свитой,
// листание до предела, место панели (дорога под ней на фиксированных сидах), уступка полю и панели башни,
// свёрнутая строка во время волны и сверка превью с врагами на дороге. Шаги ждут условий, а не кадров.

const ROAD_MAX = 6;                                      // предел клеток дороги под раскрытой панелью на любом из сидов ниже
const SEEDS = [1, 7, 42, 99, 2024, 31337, 999999];       // фиксированные сиды для места панели (7 и 999999 — бывшие худшие)

// Сид и волна забега, где показать больше всего: отряды, выходящие из убитых, длина описания свойства (или босс).
const worst = (ctx, boss) => ctx.eval((boss) => { let best = null;
  for (let s = 1; s <= 300; s++) for (let n = 3; n <= SIM.waveCount(); n++) {
    const w = WAVEGEN.wave(s, n); if (boss ? !w.boss : !w.trait) continue;
    const sc = w.squads.length * 1000 + w.extra.length * 100 + (w.trait ? JSON.stringify(w.trait).length : 0) + w.total.count / 1000;
    if (!best || sc > best.sc) best = { s, n, sc }; }
  return best; }, boss);
const waitOpen = (ctx, want) => ctx.page.waitForFunction((want) => { const p = document.getElementById('scout-panel');
  return (p.classList.contains('show') && !!p.querySelector('.tt')) === want; }, want, { timeout: 5000 })
  .catch(() => { throw new Error(want ? 'разведка не раскрылась' : 'разведка не свернулась'); });
const waitWave = (ctx, n, msg) => ctx.page.waitForFunction((n) => { const t = document.querySelector('#scout-panel.show .tt');
  return !!t && new RegExp('ВОЛНА ' + n + '(\\D|$)').test(t.textContent); }, n, { timeout: 5000 })
  .catch(() => { throw new Error(msg || `разведка не раскрылась на ${n}-й волне`); });
// Забег на сиде s перед волной n: разведка раскрывается заново, как в начале паузы.
const before = async (ctx, { s, n }) => {
  await ctx.eval(([s, n]) => { APP.play = SIM.create(s); APP.play.wave = n - 1; APP.play.souls = 99999; APP.paused = false; SCENE.ui.sel = -1; }, [s, n]);
  await waitWave(ctx, n);
};
// Раскрытая панель: какая волна показана и сходятся ли её строки с превью логики.
const shown = (ctx) => ctx.eval(() => {
  const p = document.getElementById('scout-panel'); if (!p.classList.contains('show') || !p.querySelector('.tt')) return null;
  const n = +/ВОЛНА (\d+)/.exec(p.querySelector('.tt').textContent)[1], w = SIM.preview(APP.play, n);
  const rows = [...p.querySelectorAll('.sq:not(.head)')].map((r) => [...r.querySelectorAll(':scope > span')].map((x) => +x.textContent.replace(/\D/g, '')));
  const want = w.squads.map((q) => [q.hp, Math.round(q.armor * 100), Math.round(q.mres * 100), Math.round(q.speed), q.bounty]);
  return { n, ok: JSON.stringify(rows) === JSON.stringify(want), rows, want, trait: !!p.querySelector('.trait') === !!w.trait, boss: !!p.querySelector('.bossline') === w.boss };
});
// Панель не заходит на HUD, кнопку волны и карточки; строка разведки — в верхней неигровой строке.
// Под панелью — клетки дороги, вход, склеп: считается здесь по прямоугольнику панели и карте, без помощи scout.js.
const placed = (ctx) => ctx.eval(() => {
  const r = (e) => [e.offsetLeft, e.offsetTop, e.offsetWidth, e.offsetHeight], hit = (a, b) => a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];
  const p = r(document.getElementById('scout-panel')), bar = r(document.getElementById('scout')), bad = [];
  for (const id of ['stats', 'seedbox', 'wavebtn', 'cards', 'title']) { const e = document.getElementById(id); if (e && e.offsetParent && (hit(p, r(e)) || hit(bar, r(e)))) bad.push(id); }
  const T = SIM.CONFIG.GRID.tile; if (bar[1] + bar[3] > T) bad.push('строка разведки ниже верхней строки HUD');
  const m = APP.play.map, under = [];
  for (let i = 0; i < m.cols * m.rows; i++) { const cx = (i % m.cols) * T, cy = Math.floor(i / m.cols) * T;
    if (Math.min(cx + T, p[0] + p[2]) - Math.max(cx, p[0]) > 8 && Math.min(cy + T, p[1] + p[3]) - Math.max(cy, p[1]) > 8) under.push(i); }
  const crypt = m.road[m.road.length - 1], near = (i) => Math.abs(i % m.cols - crypt % m.cols) <= 1 && Math.abs(Math.floor(i / m.cols) - Math.floor(crypt / m.cols)) <= 1;
  return { bad, road: under.filter((i) => m.road.includes(i)).length, gate: under.includes(m.road[0]), crypt: under.some(near), rect: p };
});
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };

export const steps = {
  scout_start: async (ctx, g) => {
    await g.newGame(ctx, 1);
    await waitWave(ctx, 1, 'в начале забега разведка не раскрылась на 1-й волне');
    const s = await shown(ctx); expect(s && s.n === 1 && s.ok, 'панель 1-й волны не сходится с превью: ' + JSON.stringify(s));
    const pl = await placed(ctx); expect(!pl.bad.length, 'разведка заходит на: ' + pl.bad.join(', '));
    await ctx.shot('scout_start');
  },
  scout_place: async (ctx) => {
    for (const s of SEEDS) {
      await before(ctx, { s, n: 1 });
      const pl = await placed(ctx);
      expect(!pl.bad.length, `сид ${s}: разведка заходит на ${pl.bad.join(', ')}`);
      expect(!pl.gate && !pl.crypt, `сид ${s}: под разведкой ${pl.gate ? 'вход' : 'склеп'}`);
      expect(pl.road <= ROAD_MAX, `сид ${s}: под разведкой ${pl.road} клеток дороги, предел ${ROAD_MAX}`);
    }
    await ctx.shot('scout_place');                                  // последний сид — 999999
  },
  scout_trait: async (ctx) => {
    await before(ctx, await worst(ctx, false));
    const s = await shown(ctx); expect(s && s.ok && s.trait, 'панель со свойством не сходится с превью: ' + JSON.stringify(s));
    const pl = await placed(ctx); expect(!pl.bad.length, 'разведка заходит на: ' + pl.bad.join(', '));
    // подсказка способности по наведению на отряд
    await (await ctx.need('#scout-panel .sq[data-tip]')).hover();
    await ctx.page.waitForFunction(() => document.getElementById('scout-tip').classList.contains('show'), null, { timeout: 3000 })
      .catch(() => { throw new Error('подсказка способности не появилась'); });
    await ctx.shot('scout_trait');
  },
  scout_boss: async (ctx) => {
    await before(ctx, await worst(ctx, true));
    const s = await shown(ctx); expect(s && s.ok && s.boss, 'панель босса не сходится с превью: ' + JSON.stringify(s));
    await ctx.shot('scout_boss');
  },
  scout_pages: async (ctx) => {
    await before(ctx, { s: 7, n: 4 });
    const ahead = await ctx.eval(() => SIM.CONFIG.SCOUT_AHEAD);
    for (let i = 0; i < ahead + 3; i++) await ctx.click('#scout-panel .next');
    await waitWave(ctx, 3 + ahead, `листание не дошло до ${3 + ahead}-й волны`);
    await ctx.wait(100);
    const s = await shown(ctx); expect(s && s.n === 3 + ahead && s.ok, `листание ушло дальше предела: ждали волну ${3 + ahead}, видна ${s && s.n}`);
    expect(await ctx.eval(() => !!document.querySelector('#scout-panel .next.off')), 'на последней доступной волне кнопка «дальше» не погасла');
    await ctx.shot('scout_last');
    await ctx.page.keyboard.press('ArrowLeft');
    await waitWave(ctx, 2 + ahead, 'стрелка влево не листает назад');
  },
  scout_yields: async (ctx, g) => {
    await before(ctx, { s: 7, n: 4 });
    const spot = (await g.spots(ctx))[0];
    await g.build(ctx, spot, 'bones'); await g.select(ctx, spot);
    await ctx.page.waitForFunction(() => document.getElementById('panel').classList.contains('show') && !document.getElementById('scout-panel').classList.contains('show'), null, { timeout: 3000 })
      .catch(() => { throw new Error('при открытой панели башни разведка не спряталась'); });
    await g.select(ctx, -1); await waitOpen(ctx, true);
    await ctx.page.keyboard.press('KeyI'); await waitOpen(ctx, false);
    await ctx.click('#scout'); await waitOpen(ctx, true);
  },
  scout_click: async (ctx) => {
    // клетка у самой панели (справа или снизу), видимая и годная под постройку: настоящий клик мышью выбирает её
    await before(ctx, { s: 42, n: 1 });
    const at = await ctx.eval(() => {
      const S = APP.play, p = document.getElementById('scout-panel'), T = SIM.CONFIG.GRID.tile, cv = document.getElementById('c').getBoundingClientRect();
      const L = p.offsetLeft, R = L + p.offsetWidth, B = p.offsetTop + p.offsetHeight;
      const ok = (i) => SIM.canBuild(S, i, 'bones').reason !== 'road' && !SIM.MAPGEN.hud(S.map, i) && !S.towers[i];
      for (let i = 0; i < S.map.cols * S.map.rows; i++) { const x0 = (i % S.map.cols) * T, y0 = Math.floor(i / S.map.cols) * T;
        const beside = (x0 >= R && x0 < R + T && y0 + T > p.offsetTop && y0 < B) || (y0 >= B && y0 < B + T && x0 + T > L && x0 < R);
        if (beside && ok(i)) { const [x, y] = SIM.cellXY(S, i); return { i, x: cv.left + x / SIM.VIEW.W * cv.width, y: cv.top + y / SIM.VIEW.H * cv.height }; } }
      return null; });
    if (!at) ctx.skip('у панели нет свободной клетки на этом сиде');
    await ctx.page.mouse.click(at.x, at.y);
    await ctx.page.waitForFunction((i) => SCENE.ui.sel === i && document.getElementById('panel').classList.contains('show'), at.i, { timeout: 3000 })
      .catch(() => { throw new Error('клик по клетке рядом с разведкой не выбрал её'); });
  },
  scout_wave: async (ctx) => {
    await before(ctx, await worst(ctx, false));
    const pv = await ctx.eval(() => SIM.preview(APP.play, APP.play.wave + 1));
    // все типы уже встречены: окно «Новый враг» не закрывает строку разведки на скриншоте
    await ctx.eval(() => { const S = APP.play; S.seen = Object.fromEntries(Object.keys(SIM.CONFIG.ENEMIES).map((k) => [k, 1])); APP.cmd({ k: 'call' }); APP.speed = 2; S.hp = 1e6; });
    await ctx.page.waitForFunction(() => APP.play.enemies.length >= 5 && document.getElementById('scout').classList.contains('live'), null, { timeout: 15000 })
      .catch(() => { throw new Error('волна не началась или строка разведки не перешла в режим волны'); });
    const st = await ctx.eval((pv) => {
      const S = APP.play, bar = document.getElementById('scout'), byType = Object.fromEntries(pv.squads.map((q) => [q.type, q]));
      const wrong = [];
      for (const e of S.enemies) { const q = e.child ? pv.stats[e.type] : byType[e.type];
        if (!q) { wrong.push('тип ' + e.type + ' не из превью'); continue; }
        for (const [k, v] of [['max', q.hp], ['armor', q.armor], ['mres', q.mres], ['speed', q.speed], ['bounty', q.bounty]]) if (e[k] !== v) wrong.push(`${e.type}.${k} ${e[k]} ≠ ${v}`); }
      return { panel: document.getElementById('scout-panel').classList.contains('show'), bar: bar.classList.contains('show') ? bar.textContent : null,
        remaining: SIM.remaining(S), onRoad: S.enemies.length, wrong: [...new Set(wrong)].slice(0, 5) };
    }, pv);
    expect(!st.panel, 'во время волны разведка раскрыта');
    expect(st.bar && new RegExp('осталось\\s*' + st.remaining + '(\\D|$)').test(st.bar), `строка разведки «${st.bar}» вместо оставшихся ${st.remaining}`);
    expect(st.onRoad > 0 && !st.wrong.length, `враги на дороге не совпадают с превью (${st.onRoad} на дороге): ${st.wrong.join('; ')}`);
    await ctx.shot('scout_wave');
  },
};
