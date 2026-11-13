// node tools/diag.mjs [сид] [бот] [--dt 30] [--open new|all] — одна партия бота по волнам: прочность и души после волны,
// сколько прочности отняли прорвавшиеся, урон и вложенное по типам башен, что куплено (+тип — постройка, у/д/с — ступени
// веток урон/дальность/скорость, *перк, Gлиния — Гримуар, ⚭ — слияние). Бот — как в tools/balance.mjs (smart, grim, random, mono:bones…).
import * as B from '../tests/bots.mjs';
const SIM = B.SIM;
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i < 0 ? d : process.argv[i + 1]; };
const pos = process.argv.slice(2).filter((x, i, a) => !x.startsWith('--') && !(i > 0 && a[i - 1].startsWith('--')));
const seed = +pos[0] || 1, name = pos[1] || 'smart', [k, a] = name.split(':'), bot = a ? B[k](a) : B[k];
const S = SIM.create(seed, { dt: 1 / +arg('dt', 30), unlocked: arg('open', 'new') === 'all' ? null : B.NEW_PROFILE }), mem = {};
SIM.step(S, { cmds: [{ k: 'call' }] });
let i = 0, w = 1, leaked = 0; const every = Math.max(1, Math.round(0.1 / S.dt)), bought = [];
const sum = (f) => { const o = {}; for (const t of S.towers) if (t) o[t.type] = (o[t.type] || 0) + Math.round(f(t)); return JSON.stringify(o); };
while (S.phase === 'prep' || S.phase === 'wave' || S.phase === 'relic') {
  const c = (i++ % every === 0) ? bot(S, mem) : null;
  if (c) for (const x of c) bought.push(x.k === 'build' ? '+' + x.type : x.k === 'upgrade' ? { dmg: 'у', range: 'д', rate: 'с' }[x.track] : x.k === 'perk' ? '*' + x.p : x.k === 'grim' ? 'G' + x.line : x.k === 'merge' ? '⚭' : x.k);
  SIM.step(S, c ? { cmds: c } : null);
  if (S.wave !== w || S.phase === 'won' || S.phase === 'lost') {
    console.log(`волна ${w}: прочность ${S.hp}, души ${S.souls}, отнято прорвавшимися ${S.stats.leaked - leaked} | урон ${sum((t) => t.dmg)} | вложено ${sum((t) => t.invested)}`);
    console.log('   куплено: ' + bought.join(' ')); bought.length = 0; leaked = S.stats.leaked; w = S.wave; }
}
console.log(S.phase, 'волна', S.wave, 'прочность', S.hp, 'время', Math.round(S.t), 'с');
