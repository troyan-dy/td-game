// node tools/balance.mjs [параметры] — ускоренный прогон баланс-ботов по сидам, параллельно по ядрам (worker_threads).
// Тяжёлый счёт: запускай через счётную очередь — node tools/slot.mjs --cpu node tools/balance.mjs …
//
//   --seeds N | A-B     сиды 1..N или A..B (по умолчанию 20)
//   --bots a,b,…        боты из tests/bots.mjs: idle, smart, grim, random, mono:<тип>, focus:<тип> (по умолчанию idle,smart,grim,random)
//   --open new|all      что открыто: как у нового профиля (первый забег человека, по умолчанию) или всё
//   --dt 30             шаг времени 1/N с (по умолчанию 30; точный шаг игры — 120)
//   --endless N         после победы играть ещё N волн бесконечного режима и показать, докуда дошли
//   --workers N         потоков (по умолчанию половина ядер, не больше 12)
//   --eff тип=k,…       поправки оценки башен у ботов (EFF в tests/bots.mjs) — подбор стратегии разумного бота
//   --set 'путь=выражение;…'  подмена чисел конфига на время прогона, без правки файла (подбор чисел), например
//                       --set 'HP_MULT=(w)=>1+0.13*(w-1);TOWERS.plague.base.dmg=9'
//   --list              строка на каждую партию
//   --json FILE         все итоги в файл (для сверки с моделью: node tools/model.mjs --sim FILE)
//
// Сводка на бота: доля побед; время победы (мин); прочность склепа у победителей; на какой волне проигрывают (гистограмма);
// в бесконечном режиме — сколько волн после 20-й прожили победители.
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const botOf = (B, name) => { const [k, arg] = name.split(':'); const f = B[k];
  if (typeof f !== 'function') throw new Error('нет бота ' + name);
  return arg ? f(arg) : f; };

// подмена: путь через точку в C, значение — выражение JS (функция, число, объект)
const setCfg = (C, list) => { for (const [path, expr] of list) { const keys = path.split('.'), last = keys.pop();
  const o = keys.reduce((x, k) => { if (!x || typeof x[k] !== 'object') throw new Error('нет поля конфига ' + path); return x[k]; }, C);
  if (!(last in o)) throw new Error('нет поля конфига ' + path);
  o[last] = new Function('C', 'return (' + expr + ')')(C); } };
const parseSet = (s) => String(s || '').split(';').map((x) => x.trim()).filter(Boolean).map((x) => { const i = x.indexOf('='); return [x.slice(0, i).trim(), x.slice(i + 1)]; });

if (!isMainThread) {
  const B = await import('../tests/bots.mjs');
  Object.assign(B.EFF, workerData.eff); if (process.env.PAIR_RUSH) B.PAIR.rush = +process.env.PAIR_RUSH; if (process.env.PAIR_SHARE) B.PAIR.share = +process.env.PAIR_SHARE;
  setCfg(B.SIM.CONFIG, workerData.set);
  parentPort.on('message', (job) => {
    if (!job) return process.exit(0);
    const t0 = Date.now(), r = B.play(botOf(B, job.bot), job.seed, 5400, 1 / job.dt, { unlocked: job.open === 'all' ? null : B.NEW_PROFILE, endless: job.endless });
    delete r.waveLog;
    parentPort.postMessage(Object.assign({ bot: job.bot, seed: job.seed, ms: Date.now() - t0 }, r));
  });
} else {
  const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i < 0 ? d : process.argv[i + 1] === undefined || process.argv[i + 1].startsWith('--') ? true : process.argv[i + 1]; };
  const sv = String(arg('seeds', 20)), [a, b] = sv.includes('-') ? sv.split('-').map(Number) : [1, +sv];
  const seeds = Array.from({ length: b - a + 1 }, (_, i) => a + i);
  const bots = String(arg('bots', 'idle,smart,grim,random')).split(','), open = arg('open', 'new'), dt = +arg('dt', 30), endless = +arg('endless', 0) || 0;
  const nW = Math.max(1, Math.min(+arg('workers', Math.min(12, Math.floor(os.cpus().length / 2))), bots.length * seeds.length));
  const set = parseSet(arg('set', ''));
  { const B = await import('../tests/bots.mjs'); for (const n of bots) botOf(B, n); setCfg(B.SIM.CONFIG, set); }   // опечатка — сразу, а не в потоке
  const jobs = []; for (const bot of bots) for (const seed of seeds) jobs.push({ bot, seed, dt, open, endless });
  const eff = Object.fromEntries(String(arg('eff', '')).split(',').filter(Boolean).map((kv) => { const [k, v] = kv.split('='); return [k, +v]; }));
  const res = [], t0 = Date.now();
  await new Promise((done) => { let live = nW;
    for (let i = 0; i < nW; i++) { const w = new Worker(fileURLToPath(import.meta.url), { workerData: { eff, set } });
      const next = () => w.postMessage(jobs.shift() || null);
      w.on('message', (r) => { res.push(r); next(); });
      w.on('error', (e) => { console.error('поток упал:', e); process.exitCode = 1; });
      w.on('exit', () => { if (--live === 0) done(); });
      next(); } });
  const avg = (x) => (x.length ? x.reduce((p, q) => p + q, 0) / x.length : NaN), f1 = (v) => (Number.isFinite(v) ? v.toFixed(1) : '—');
  console.log(`сидов ${seeds.length} (${a}–${b}), шаг 1/${dt}, открыто: ${open === 'all' ? 'всё' : 'новый профиль'}, потоков ${nW}, ${((Date.now() - t0) / 1000).toFixed(1)} с` + (Object.keys(eff).length ? ', EFF ' + JSON.stringify(eff) : '') + (set.length ? '\nподмена: ' + set.map((x) => x.join('=')).join('; ') : ''));
  for (const bot of bots) {
    const rs = res.filter((r) => r.bot === bot).sort((p, q) => p.seed - q.seed), won = rs.filter((r) => r.win !== null), lost = rs.filter((r) => r.win === null);
    const hist = {}; for (const r of lost) hist[r.wave] = (hist[r.wave] || 0) + 1;
    console.log(`${bot.padEnd(14)} побед ${String(won.length).padStart(3)}/${rs.length} (${Math.round(100 * won.length / rs.length)}%)` +
      ` | победа: ${f1(avg(won.map((r) => r.win / 60)))} мин (${won.length ? f1(Math.min(...won.map((r) => r.win / 60))) + '–' + f1(Math.max(...won.map((r) => r.win / 60))) : '—'}), прочность ${f1(avg(won.map((r) => r.hp)))}` +
      ` | проигрыш на волне: ${Object.entries(hist).map(([w, n]) => w + (n > 1 ? '×' + n : '')).join(' ') || '—'}` +
      (endless ? ` | бесконечный: +${f1(avg(won.map((r) => r.wave - 20)))} волн (мин ${won.length ? Math.min(...won.map((r) => r.wave - 20)) : '—'})` : '') +
      (bot.startsWith('grim') ? ` | в Гримуар ${Math.round(avg(rs.map((r) => r.grim)))} душ, первое слияние после волны ${f1(avg(rs.filter((r) => r.firstMerge).map((r) => r.firstMerge)))} (слияний ${f1(avg(rs.map((r) => r.merges)))})` : ''));
    const e10 = rs.filter((r) => r.earned10 !== null), e20 = rs.filter((r) => r.souls20 !== null);
    if (e10.length) console.log(`${''.padEnd(14)} заработано к 10-й ${Math.round(avg(e10.map((r) => r.earned10)))}, к 20-й ${e20.length ? Math.round(avg(e20.map((r) => r.earned20))) : '—'}; на руках к 20-й ${e20.length ? Math.round(avg(e20.map((r) => r.souls20))) : '—'} душ`);
    if (arg('list', false)) for (const r of rs) console.log(`   сид ${String(r.seed).padStart(4)} ${r.win !== null ? 'победа' : 'проигр'} волна ${String(r.wave).padStart(2)} hp ${String(r.hp).padStart(2)} ${String(Math.round((r.win || r.t) / 60)).padStart(3)} мин ${r.relics.join(',')} | ${r.towers}`);
  }
  const jf = arg('json', null); if (jf) fs.writeFileSync(jf, JSON.stringify({ dt, open, res }, null, 0));
}
