// Слияние в гибрид: кнопка «Слить с соседом» в панели прокачанной башни и подсветка подходящих соседей, режим выбора соседа,
// превью гибрида до подтверждения (имя, примесь, характеристики, перки — недействующий зачёркнут), панель гибрида
// (ступени до 8 — 24 метки, перки двух типов) и гибрид на поле в бою (цвет второй башни, свечение, значок примеси).
// Сид фиксирован, пауза без таймера: волна не начнётся посреди экрана.
const SEED = 7;
// две соседние свободные клетки у дороги, по диагонали (слияние — по восьми направлениям)
const findPair = (ctx) => ctx.eval(() => { const S = APP.play, n = S.map.cols;
  for (const c of SIM.rankCells(S, SIM.CONFIG.TYPICAL_RANGE)) { const x = c % n, y = Math.floor(c / n);
    for (const [dx, dy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) { const X = x + dx, Y = y + dy, i = Y * n + X;
      if (X >= 0 && Y >= 0 && X < n && Y < S.map.rows && SIM.canBuild(S, i, 'bones').ok) return [c, i]; } }
  return null; });
// клик мышью по центру клетки на холсте
const clickCell = async (ctx, cell) => { const [x, y] = await ctx.eval((c) => { const r = document.getElementById('c').getBoundingClientRect(), [cx, cy] = SIM.cellXY(APP.play, c);
  return [r.left + cx / SIM.VIEW.W * r.width, r.top + cy / SIM.VIEW.H * r.height]; }, cell);
  await ctx.page.mouse.move(x, y); await ctx.page.mouse.click(x, y); await ctx.wait(150); };
const text = async (ctx) => (await (await ctx.need('#panel.show')).innerText()).replace(/\s+/g, ' ');
const until = async (ctx, fn, arg, sec, what) => { for (let i = 0; i < sec * 10; i++) { if (await ctx.eval(fn, arg)) return; await ctx.wait(100); } throw new Error('не дождались: ' + what); };

export async function steps(ctx, g) {
  await g.newGame(ctx); await ctx.eval((sd) => { APP.newGame(sd); APP.play.souls = 99999; }, SEED); await ctx.wait(150);
  const pair = await findPair(ctx); if (!pair) throw new Error('нет двух соседних клеток по диагонали');
  const [a, b] = pair, out = {};
  out.merge_button = async () => {
    await g.build(ctx, a, 'bones'); await g.maxOut(ctx, a); await g.perk(ctx, a, 'crush');
    await g.build(ctx, b, 'spirits'); await g.maxOut(ctx, b); await g.perk(ctx, b, 'pack');
    const t = await ctx.eval((a) => SIM.mergeTargets(APP.play, a), a);
    if (JSON.stringify(t) !== JSON.stringify([b])) throw new Error('логика не видит соседа для слияния: ' + JSON.stringify(t));
    await g.select(ctx, a); await ctx.wait(150);
    await (await ctx.need('#panel .merge.green')).hover(); await ctx.wait(100);
    const tip = await ctx.eval(() => document.getElementById('tip').textContent);
    if (!/гибрид/i.test(tip)) throw new Error('подсказка кнопки слияния не объясняет: ' + tip);
    await ctx.shot('merge_button');
  };
  out.merge_targets = async () => {
    await ctx.click('#panel .merge'); await ctx.wait(150);
    if (await ctx.eval(() => SCENE.ui.merge) !== a) throw new Error('режим слияния не включился');
    const s = await text(ctx); if (!s.includes('С кем слить')) throw new Error('в режиме слияния нет подсказки: ' + s);
    await ctx.shot('merge_targets');
  };
  out.merge_preview = async () => {
    await clickCell(ctx, b);
    if (await ctx.eval(() => SCENE.ui.mergeTo) !== b) throw new Error('клик по соседу не выбрал его для слияния');
    await ctx.need('#panel .mgo');
    const s = await text(ctx);
    for (const w of ['КОСТИ + ДУХИ', 'Замедление', 'не действует', 'Бронебой', 'освободится']) if (!s.includes(w)) throw new Error(`в превью нет «${w}»: ${s}`);
    if (await ctx.eval((a) => !!APP.play.towers[a].mix, a)) throw new Error('слилось без подтверждения');
    await ctx.shot('merge_preview');
  };
  out.merge_panel = async () => {
    await ctx.click('#panel .mgo');
    await until(ctx, (a) => APP.play.towers[a] && APP.play.towers[a].mix === 'spirits', a, 3, 'гибрид на клетке первой башни');
    if (await ctx.eval((b) => !!APP.play.towers[b], b)) throw new Error('клетка второй башни не освободилась');
    await g.select(ctx, a); await ctx.wait(200);
    const n = await ctx.eval(() => document.querySelectorAll('#panel .pips i').length); if (n !== 24) throw new Error('у гибрида не 24 метки ступеней: ' + n);
    const s = await text(ctx);
    for (const w of ['КОСТИ + ДУХИ', 'ПЕРК КОСТИ', 'ПЕРК ДУХИ', 'Замедление']) if (!s.includes(w)) throw new Error(`в панели гибрида нет «${w}»: ${s}`);
    if (await ctx.eval(() => document.querySelectorAll('#panel .perk.chosen').length) !== 2) throw new Error('у гибрида не два выбранных перка');
    if (!await ctx.eval(() => !!document.querySelector('#panel .perk.chosen.dead'))) throw new Error('недействующий перк не помечен');
    await ctx.shot('merge_panel');
  };
  // самое длинное имя гибрида и примесь Казармы — панель не расползается
  out.merge_long = async () => {
    const [c, d] = await ctx.eval(([a, b]) => { const S = APP.play, n = S.map.cols, ok = (i) => i !== a && i !== b && SIM.canBuild(S, i, 'bones').ok;
      for (const c of SIM.rankCells(S, SIM.CONFIG.TYPICAL_RANGE)) if (ok(c)) for (const d of [c + 1, c + n, c + n + 1, c + n - 1]) if (Math.abs((d % n) - (c % n)) <= 1 && ok(d)) return [c, d];
      return [-1, -1]; }, [a, b]);
    if (c < 0) throw new Error('нет второй пары соседних клеток');
    const names = await ctx.eval(() => { const T = SIM.CONFIG.TOWERS, O = SIM.CONFIG.TOWER_ORDER.filter((t) => T[t].attack), by = (t) => T[t].name.length;
      return [O.slice().sort((x, y) => by(y) - by(x))[0], SIM.CONFIG.TOWER_ORDER.slice().sort((x, y) => by(y) - by(x) || (y === 'barracks') - (x === 'barracks'))[0]]; });
    await g.build(ctx, c, names[0]); await g.maxOut(ctx, c); await g.build(ctx, d, names[1]); await g.maxOut(ctx, d);
    await ctx.eval(([c, d]) => APP.cmd({ k: 'merge', cell: c, other: d }), [c, d]);
    await until(ctx, (c) => !!(APP.play.towers[c] && APP.play.towers[c].mix), c, 3, 'второй гибрид');
    await g.select(ctx, c); await ctx.wait(200); await ctx.need('#panel .mixl');
    await ctx.shot('merge_long');
  };
  out.merge_battle = async () => {
    await g.select(ctx, -1);
    await ctx.eval(() => { for (const k of Object.keys(SIM.CONFIG.ENEMIES)) APP.play.seen[k] = 1; APP.play.wave = 3; APP.cmd({ k: 'call' }); APP.speed = 2; });
    await until(ctx, (a) => { const S = APP.play, tw = S.towers[a]; return tw.dmg > 0 && S.enemies.some((e) => e.slowT > 0); }, a, 60, 'гибрид бьёт и замедляет');
    await ctx.eval(() => { APP.paused = true; }); await ctx.wait(200);
    await ctx.shot('merge_battle');
    await ctx.eval(() => { APP.paused = false; APP.speed = 1; });
  };
  return out;
}
