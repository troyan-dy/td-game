// Казарма: панель башни (ветки значат своё — скелет, призыв, дальность; лимит скелетов), скелеты на дороге ещё до волны
// (подсвечены клетки дороги, куда башня их ставит) и бой: скелет держит врага — тот стоит, над схваткой скрещённые кости.
const barracks = (ctx) => ctx.eval(() => Object.values(APP.play.towers).find((t) => t && t.type === 'barracks'));
// ждём условия в игре до sec секунд (не паузы)
const until = async (ctx, fn, sec, what) => { for (let i = 0; i < sec * 10; i++) { if (await ctx.eval(fn)) return; await ctx.wait(100); } throw new Error('не дождались: ' + what); };

export const steps = {
  barracks_panel: async (ctx, g) => {
    await g.newGame(ctx, 1); await ctx.eval(() => { APP.play.souls = 5000; });
    const spots = await g.spots(ctx); await g.build(ctx, spots[0], 'barracks');
    if (!await barracks(ctx)) throw new Error('Казарма не построилась');
    await g.select(ctx, spots[0]); await ctx.wait(150);
    const text = (await (await ctx.need('#panel.show')).innerText()).replace(/\s+/g, ' ');
    for (const s of ['КАЗАРМА', 'Скелет', 'Призыв', 'Дальность', 'Скелетов', 'HP']) if (!text.includes(s)) throw new Error(`в панели Казармы нет «${s}»: ${text}`);
    await ctx.shot('barracks_panel');
  },
  barracks_skels: async (ctx) => {
    await until(ctx, () => APP.play.skels.length >= 1, 5, 'первый скелет');
    await ctx.eval(() => { for (const t of APP.play.towers) if (t && t.type === 'barracks') t.cd = 0; });     // второй — не ждать интервал призыва
    await until(ctx, () => APP.play.skels.length >= 2, 5, 'второй скелет');
    const bad = await ctx.eval(() => APP.play.skels.filter((s) => !APP.play.map.road.includes(s.cell)).length);
    if (bad) throw new Error('скелет не на дороге');
    await ctx.wait(500); await ctx.shot('barracks_skels');
  },
  barracks_fight: async (ctx, g) => {
    await g.select(ctx, -1);
    await ctx.eval(() => { APP.cmd({ k: 'call' }); APP.speed = 2; });
    await until(ctx, () => APP.play.skels.some((s) => s.foe), 60, 'скелет схватил врага');
    // удержанный враг стоит на месте
    const d0 = await ctx.eval(() => { const s = APP.play.skels.find((k) => k.foe), e = APP.play.enemies.find((o) => o.id === s.foe); return e ? [e.id, e.d] : null; });
    await ctx.wait(150);
    const d1 = await ctx.eval((id) => { const e = APP.play.enemies.find((o) => o.id === id), held = APP.play.skels.some((s) => s.foe === id); return e && held ? e.d : null; }, d0 && d0[0]);
    if (d0 && d1 !== null && d1 !== d0[1]) throw new Error(`удержанный враг идёт: ${d0[1]} → ${d1}`);
    await ctx.shot('barracks_fight');
    await ctx.eval(() => { APP.speed = 1; });
  },
};
