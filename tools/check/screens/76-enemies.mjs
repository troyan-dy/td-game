// Разведчик и знаменосец: строки в панели разведки со способностью и картинкой в своём цвете; на поле — щит разведчика,
// надпись «ПРОМАХ» после первого попадания, кольцо ауры знаменосца и ускоренный сосед. Шаги ждут условий, а не кадров.

const expect = (cond, msg) => { if (!cond) throw new Error(msg); };
// первая волна забега без свойства и босса, где идут оба
const pick = (ctx) => ctx.eval(() => {
  for (let s = 1; s <= 500; s++) for (let n = 6; n <= SIM.waveCount(); n++) { const w = WAVEGEN.wave(s, n), t = w.squads.map((q) => q.type);
    if (!w.trait && !w.boss && t.includes('scout') && t.includes('banner')) return { s, n }; }
  return null; });
// забег перед волной n: все враги уже встречены (окно «Новый враг» не закрывает поле), бездонный склеп
const before = (ctx, { s, n }) => ctx.eval(([s, n]) => { APP.play = SIM.create(s); const S = APP.play; S.wave = n - 1; S.souls = 99999; S.hp = 1e6;
  S.seen = Object.fromEntries(Object.keys(SIM.CONFIG.ENEMIES).map((k) => [k, 1])); APP.paused = false; APP.speed = 1; SCENE.ui.sel = -1; }, [s, n]);

export const steps = {
  enemies_scout: async (ctx) => {
    const at = await pick(ctx); expect(at, 'нет волны с разведчиком и знаменосцем');
    await before(ctx, at);
    await ctx.page.waitForFunction((n) => { const t = document.querySelector('#scout-panel.show .tt'); return !!t && t.textContent.includes('ВОЛНА ' + n); }, at.n, { timeout: 5000 })
      .catch(() => { throw new Error('разведка не раскрылась'); });
    const rows = await ctx.eval(() => [...document.querySelectorAll('#scout-panel .sq[data-tip]')].map((r) => ({ tip: r.dataset.tip, filter: (r.querySelector('img') || {}).style?.filter || '' })));
    for (const k of ['scout', 'banner']) {
      const d = await ctx.eval((k) => ({ name: SIM.CONFIG.ENEMIES[k].name, css: SIM.CONFIG.ENEMIES[k].look.css }), k);
      const r = rows.find((x) => x.tip.startsWith(d.name + ':'));
      expect(r && r.tip.length > d.name.length + 10, `в разведке нет строки ${d.name} со способностью: ${JSON.stringify(rows)}`);
      expect(r.filter && r.filter !== 'sepia(1) saturate(2.2)', `${d.name}: картинка не в своём цвете (${r.filter})`);
    }
    // подсказка способности знаменосца
    const name = await ctx.eval(() => SIM.CONFIG.ENEMIES.banner.name);
    await (await ctx.need(`#scout-panel .sq[data-tip^="${name}:"]`)).hover();
    await ctx.page.waitForFunction((nm) => { const t = document.getElementById('scout-tip'); return t.classList.contains('show') && t.textContent.startsWith(nm); }, name, { timeout: 3000 })
      .catch(() => { throw new Error('подсказка способности знаменосца не появилась'); });
    await ctx.shot('enemies_scout');
  },
  enemies_field: async (ctx) => {
    const at = await pick(ctx); expect(at, 'нет волны с разведчиком и знаменосцем');
    await before(ctx, at);
    await ctx.eval(() => { APP.cmd({ k: 'call' }); APP.speed = 3; });
    await ctx.page.waitForFunction(() => { const E = APP.play.enemies; return E.some((e) => e.type === 'banner' && e.d > 200) && E.some((e) => e.type === 'scout' && e.ward > 0); }, null, { timeout: 40000 })
      .catch(() => { throw new Error('разведчик и знаменосец не вышли на дорогу'); });
    // сосед у знаменосца (ускорен) и болт в разведчика: первое попадание — промах
    await ctx.eval(() => { const S = APP.play, b = S.enemies.find((e) => e.type === 'banner'), sc = S.enemies.find((e) => e.type === 'scout' && e.ward > 0);
      const m = S.enemies.find((e) => e !== b && e !== sc && e.type !== 'banner'); if (m) { m.d = Math.max(0, b.d - 20); m.lane = 6; }
      S.shots.push({ k: 'bolt', x: sc.x - 30, y: sc.y - 14, tid: sc.id, dmg: 50, sp: 900, tw: -1, lx: sc.x, ly: sc.y });
      APP.speed = 1; window.__scoutId = sc.id; window.__scoutHp = sc.hp; });
    await ctx.page.waitForFunction(() => APP.play.ev.some((e) => e.k === 'miss') && APP.play.enemies.some((e) => e.haste > 0), null, { timeout: 5000 })
      .catch(() => { throw new Error('нет промаха по разведчику или ускоренного соседа'); });
    await ctx.eval(() => { APP.paused = true; });
    const st = await ctx.eval(() => { const sc = APP.play.enemies.find((e) => e.id === window.__scoutId); return { hp: sc ? sc.hp : null, was: window.__scoutHp, ward: sc ? sc.ward : null }; });
    expect(st.hp === st.was && st.ward === 0, 'первое попадание по разведчику нанесло урон: ' + JSON.stringify(st));
    await ctx.wait(150);
    await ctx.shot('enemies_field');
    await ctx.eval(() => { APP.paused = false; });
  },
};
