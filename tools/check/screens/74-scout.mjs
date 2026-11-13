// Панель разведки на худших случаях: волна со свойством и наибольшим числом отрядов, босс с самой большой свитой,
// листание до предела, уступка панели башни, свёрнутая строка во время волны и сверка превью с врагами на дороге.

// Сид и волна забега, где показать больше всего: отряды, выходящие из убитых, длина описания свойства (или босс).
const worst = (ctx, boss) => ctx.eval((boss) => { let best = null;
  for (let s = 1; s <= 300; s++) for (let n = 3; n <= SIM.waveCount(); n++) {
    const w = WAVEGEN.wave(s, n); if (boss ? !w.boss : !w.trait) continue;
    const sc = w.squads.length * 1000 + w.extra.length * 100 + (w.trait ? JSON.stringify(w.trait).length : 0) + w.total.count / 1000;
    if (!best || sc > best.sc) best = { s, n, sc }; }
  return best; }, boss);
// Забег на сиде s перед волной n: разведка раскрывается заново, как в начале паузы.
const before = (ctx, { s, n }) => ctx.eval(([s, n]) => { APP.play = SIM.create(s); APP.play.wave = n - 1; APP.play.souls = 99999; APP.paused = false; }, [s, n]).then(() => ctx.wait(200));
// Раскрытая панель: какая волна показана и сходятся ли её строки с превью логики.
const shown = (ctx) => ctx.eval(() => {
  const p = document.getElementById('scout-panel'); if (!p.classList.contains('show')) return null;
  const n = +/ВОЛНА (\d+)/.exec(p.querySelector('.tt').textContent)[1], w = SIM.preview(APP.play, n);
  const rows = [...p.querySelectorAll('.sq:not(.head)')].map((r) => [...r.querySelectorAll(':scope > span')].map((x) => +x.textContent.replace(/\D/g, '')));
  const want = w.squads.map((q) => [q.hp, Math.round(q.armor * 100), Math.round(q.mres * 100), Math.round(q.speed), q.bounty]);
  return { n, ok: JSON.stringify(rows) === JSON.stringify(want), rows, want, trait: !!p.querySelector('.trait') === !!w.trait, boss: !!p.querySelector('.bossline') === w.boss };
});
// Панель не заходит на HUD, кнопку волны, карточки и строку разведки; строка разведки — в верхней неигровой строке.
const placed = (ctx) => ctx.eval(() => {
  const r = (e) => [e.offsetLeft, e.offsetTop, e.offsetWidth, e.offsetHeight], hit = (a, b) => a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];
  const p = r(document.getElementById('scout-panel')), bar = r(document.getElementById('scout')), bad = [];
  for (const id of ['stats', 'seedbox', 'wavebtn', 'cards', 'title']) { const e = document.getElementById(id); if (e && e.offsetParent && (hit(p, r(e)) || hit(bar, r(e)))) bad.push(id); }
  if (bar[1] + bar[3] > SIM.CONFIG.GRID.tile) bad.push('строка разведки ниже верхней строки HUD');
  return bad;
});
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };

export const steps = {
  scout_start: async (ctx, g) => {
    await g.newGame(ctx);
    const s = await shown(ctx); expect(s && s.n === 1 && s.ok, 'в начале забега разведка не раскрыта на 1-й волне: ' + JSON.stringify(s));
    const bad = await placed(ctx); expect(!bad.length, 'разведка заходит на: ' + bad.join(', '));
    await ctx.shot('scout_start');
  },
  scout_trait: async (ctx) => {
    await before(ctx, await worst(ctx, false));
    const s = await shown(ctx); expect(s && s.ok && s.trait, 'панель со свойством не сходится с превью: ' + JSON.stringify(s));
    const bad = await placed(ctx); expect(!bad.length, 'разведка заходит на: ' + bad.join(', '));
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
    for (let i = 0; i < ahead + 3; i++) { await ctx.click('#scout-panel .next'); await ctx.wait(40); }
    const s = await shown(ctx); expect(s && s.n === 3 + ahead && s.ok, `листание ушло не туда: ждали волну ${3 + ahead}, видна ${s && s.n}`);
    expect(await ctx.eval(() => !!document.querySelector('#scout-panel .next.off')), 'на последней доступной волне кнопка «дальше» не погасла');
    await ctx.shot('scout_last');
    await ctx.page.keyboard.press('ArrowLeft'); await ctx.wait(40);
    expect((await shown(ctx)).n === 2 + ahead, 'стрелка влево не листает назад');
  },
  scout_yields: async (ctx, g) => {
    await before(ctx, { s: 7, n: 4 });
    const spot = (await g.spots(ctx))[0];
    await g.build(ctx, spot, 'bones'); await g.select(ctx, spot); await ctx.wait(100);
    expect(await ctx.eval(() => document.getElementById('panel').classList.contains('show') && !document.getElementById('scout-panel').classList.contains('show')),
      'при открытой панели башни разведка не спряталась');
    await g.select(ctx, -1); await ctx.wait(100);
    expect(!!(await shown(ctx)), 'после закрытия панели башни разведка не вернулась');
    await ctx.page.keyboard.press('KeyI'); await ctx.wait(60);
    expect(!(await shown(ctx)), 'клавиша I не свернула разведку');
    await ctx.click('#scout'); await ctx.wait(60);
    expect(!!(await shown(ctx)), 'клик по строке не раскрыл разведку');
  },
  scout_wave: async (ctx) => {
    await before(ctx, await worst(ctx, false));
    const pv = await ctx.eval(() => SIM.preview(APP.play, APP.play.wave + 1));
    // все типы уже встречены: окно «Новый враг» не закрывает строку разведки на скриншоте
    await ctx.eval(() => { const S = APP.play; S.seen = Object.fromEntries(Object.keys(SIM.CONFIG.ENEMIES).map((k) => [k, 1])); APP.cmd({ k: 'call' }); APP.speed = 2; S.hp = 1e6; });
    await ctx.wait(5000);
    const st = await ctx.eval((pv) => {
      const S = APP.play, bar = document.getElementById('scout'), byType = Object.fromEntries(pv.squads.map((q) => [q.type, q]));
      const stats = Object.assign({}, pv.stats), wrong = [];
      for (const e of S.enemies) { const q = e.child ? stats[e.type] : byType[e.type];
        if (!q) { wrong.push('тип ' + e.type + ' не из превью'); continue; }
        for (const [k, v] of [['max', q.hp], ['armor', q.armor], ['mres', q.mres], ['speed', q.speed], ['bounty', q.bounty]]) if (e[k] !== v) wrong.push(`${e.type}.${k} ${e[k]} ≠ ${v}`); }
      return { panel: document.getElementById('scout-panel').classList.contains('show'), bar: bar.classList.contains('show') ? bar.textContent : null,
        remaining: SIM.remaining(S), onRoad: S.enemies.length, wrong: [...new Set(wrong)].slice(0, 5) };
    }, pv);
    expect(!st.panel, 'во время волны разведка раскрыта');
    expect(st.bar && new RegExp('осталось\\s*' + st.remaining + '\\b').test(st.bar), `строка разведки «${st.bar}» вместо оставшихся ${st.remaining}`);
    expect(st.onRoad > 0 && !st.wrong.length, `враги на дороге не совпадают с превью (${st.onRoad} на дороге): ${st.wrong.join('; ')}`);
    await ctx.shot('scout_wave');
  },
};
