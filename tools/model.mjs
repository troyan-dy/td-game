// node tools/model.mjs [параметры] — модель баланса без симуляции: по сиду для каждой волны угроза и оборона, кривая запаса.
//
//   Угроза волны — урон в секунду, который нужен, чтобы убить её до склепа: эффективные HP (броня и защита от магии против
//   среднего состава урона MIX, лечение священников) делятся на время, за которое волна проходит оборону: выход волны плюс
//   путь через накрытый башнями участок дороги со средней скоростью врагов (знамя ускоряет).
//   Оборона к волне — урон в секунду, купленный на души, заработанные к ней (старт + награды и бонусы прошлых волн, половина
//   наград текущей): K · души^ALPHA, с поправкой на карту — насыщение покрытия лучших клеток (курган добавляет дальность).
//   Запас волны = оборона / угроза − 1. Забег проходим по модели, если запас ни на одной волне не ниже нуля.
//   K подобран под разумного бота (--fit), модель грубая: её дело — знак и форма кривой, а не точные числа.
//
//   --seed S            таблица по волнам одного сида
//   --seeds N | A-B     сводка по сидам (по умолчанию 1000): доля проходимых, на какой волне запас кончается, кривая запаса
//   --sim FILE          сверка с прогоном ботов (node tools/balance.mjs --json FILE), бот --bot (по умолчанию smart)
//   --fit FILE          подобрать K под прогон ботов и показать согласие
//   --k K               свой K вместо подобранного
//   --set 'путь=выражение;…'  подмена чисел конфига, как в tools/balance.mjs
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { createRequire } from 'node:module';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);

export const MODEL = { K: 0.074, ALPHA: 0.9, MIX: { phys: 0.4, magic: 0.25, poison: 0.35 }, TOP: 12, SAT: 320, SAT_REF: 0.62 };

const setCfg = (C, list) => { for (const [path, expr] of list) { const keys = path.split('.'), last = keys.pop();
  const o = keys.reduce((x, k) => { if (!x || typeof x[k] !== 'object') throw new Error('нет поля конфига ' + path); return x[k]; }, C);
  if (!(last in o)) throw new Error('нет поля конфига ' + path);
  o[last] = new Function('C', 'return (' + expr + ')')(C); } };
const parseSet = (s) => String(s || '').split(';').map((x) => x.trim()).filter(Boolean).map((x) => { const i = x.indexOf('='); return [x.slice(0, i).trim(), x.slice(i + 1)]; });

// ---------------------------------------------------------------- карта: насыщение лучших клеток и накрытый участок дороги
const mapInfo = (SIM, seed) => {
  const C = SIM.CONFIG, S = SIM.create(seed), L = SIM.pathLen(S), pts = [];
  for (let d = 4; d < L; d += 8) { const p = SIM.posAt(S, d); pts.push([p.x, p.y]); }
  const free = []; for (let i = 0; i < S.towers.length; i++) if (!S.map.road.includes(i) && !SIM.MAPGEN.hud(S.map, i) && !SIM.MAPGEN.obstacle(S.map, i)) free.push(i);
  const cells = free.map((i) => { const [x, y] = SIM.cellXY(S, i), b = SIM.cellBonus(S, i), r = (C.TYPICAL_RANGE + (b && b.range || 0)) * C.UNIT, hit = [];
    pts.forEach(([px, py], k) => { if ((px - x) ** 2 + (py - y) ** 2 <= r * r) hit.push(k); });
    return { i, hit, cov: hit.length * 8 }; }).sort((a, b) => b.cov - a.cov).slice(0, MODEL.TOP);
  const covered = new Set(); for (const c of cells) for (const k of c.hit) covered.add(k);
  const satAvg = cells.reduce((a, c) => a + c.cov / (c.cov + MODEL.SAT), 0) / cells.length;
  return { L, zone: covered.size * 8, sat: satAvg };
};

// ---------------------------------------------------------------- волны: угроза и души
const waveInfo = (SIM, seed, n, zone) => {
  const C = SIM.CONFIG, w = SIM.WAVEGEN.wave(seed, n), M = MODEL.MIX;
  let ehp = 0, hp = 0, sp = 0, bounty = 0, haste = 0, cnt = 0;
  for (const q of w.squads.concat(w.extra)) { const d = C.ENEMIES[q.type];
    const mult = 1 / (M.phys * (1 - q.armor) + M.magic * (1 - q.mres) + M.poison);
    let h = q.hp * mult; if (q.heal) h += q.heal * (d.healTargets || 1) * 3;      // лечение: примерно три срабатывания за проход
    ehp += h * q.count; hp += q.hp * q.count; sp += q.speed * q.hp * q.count; bounty += q.bounty * q.count; cnt += q.count;
    if (d.haste) haste += q.count; }
  const speed = sp / hp * (1 + (haste ? Math.min(1, haste * 8 / cnt) * 0.3 : 0));
  const pass = w.duration + zone / speed;
  return { n, boss: w.boss, ehp, hp, speed, pass, need: ehp / pass, bounty, bonus: w.bonus, count: cnt };
};

// весь забег по сиду без K: { seed, map, waves: [{ n, boss, ehp, pass, need, have }] } — оборону и запас считает judge
export const run = (SIM, seed, waves) => {
  const C = SIM.CONFIG, mp = mapInfo(SIM, seed), out = []; let souls = C.START_SOULS;
  for (let n = 1; n <= waves; n++) { const w = waveInfo(SIM, seed, n, mp.zone);
    out.push({ n, boss: w.boss, ehp: Math.round(w.ehp), pass: w.pass, need: w.need, have: souls + w.bounty / 2 });
    souls += w.bounty + w.bonus; }
  return { seed, map: mp, waves: out };
};
// оборона на волне без K (урон в секунду на единицу K)
const unitDef = (r, w, alpha) => w.have ** alpha * r.map.sat / MODEL.SAT_REF;
// запас по волнам с K и ALPHA: { …r, waves: [+ def, margin], minMargin, breaks — первая волна с запасом ниже нуля }
export const judge = (r, K = MODEL.K, alpha = MODEL.ALPHA) => {
  const waves = r.waves.map((w) => { const def = K * unitDef(r, w, alpha); return Object.assign({}, w, { def, margin: def / w.need - 1 }); });
  return Object.assign({}, r, { waves, minMargin: Math.min(...waves.map((x) => x.margin)), breaks: (waves.find((x) => x.margin < 0) || { n: null }).n });
};
// наименьший K, при котором забег проходим по модели
const kcrit = (r, alpha) => Math.max(...r.waves.map((w) => w.need / unitDef(r, w, alpha)));

if (!isMainThread) {
  const SIM = require('../live/sim.js'); setCfg(SIM.CONFIG, workerData.set); Object.assign(MODEL, workerData.model);
  parentPort.postMessage(workerData.seeds.map((s) => run(SIM, s, workerData.waves)));
} else if (process.argv[1] && fileURLToPath(import.meta.url).toLowerCase() === process.argv[1].toLowerCase().replace(/\//g, '\\') || process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i < 0 ? d : process.argv[i + 1] === undefined || process.argv[i + 1].startsWith('--') ? true : process.argv[i + 1]; };
  const set = parseSet(arg('set', '')), SIM = require('../live/sim.js'); setCfg(SIM.CONFIG, set);
  const C = SIM.CONFIG, waves = C.RUN_WAVES; if (arg('k', null)) MODEL.K = +arg('k');
  const f2 = (v) => v.toFixed(2), pct = (a, b) => Math.round(100 * a / Math.max(1, b)) + '%';
  const many = async (seeds) => { const nW = Math.max(1, Math.min(12, Math.floor(os.cpus().length / 2), Math.ceil(seeds.length / 20))), parts = [];
    for (let i = 0; i < nW; i++) parts.push(seeds.filter((_, j) => j % nW === i));
    const res = await Promise.all(parts.map((p) => new Promise((ok, no) => { const w = new Worker(fileURLToPath(import.meta.url), { workerData: { seeds: p, waves, set, model: MODEL } });
      w.once('message', ok); w.once('error', no); })));
    return res.flat().sort((a, b) => a.seed - b.seed).map((r) => judge(r)); };
  // сверка с ботами: знак запаса (проходим ли забег) против исхода партии бота
  const agree = (model, sim, bot) => { let ok = 0, n = 0, rows = [];
    for (const r of sim.res.filter((x) => x.bot === bot)) { const m = model.find((x) => x.seed === r.seed); if (!m) continue; n++;
      const win = r.win !== null, pred = m.minMargin >= 0; if (win === pred) ok++; rows.push({ seed: r.seed, win, pred, wave: r.wave, breaks: m.breaks, min: m.minMargin }); }
    return { ok, n, rows }; };
  const t0 = Date.now();
  if (arg('seed', null) !== null) {
    const r = judge(run(SIM, +arg('seed'), waves));
    console.log(`сид ${r.seed}: дорога ${Math.round(r.map.L)} px, накрыто лучшими ${MODEL.TOP} клетками ${Math.round(r.map.zone)} px, насыщение ${f2(r.map.sat)}`);
    console.log('волна | эфф. HP | проход, с | нужно урона/с | души | оборона урона/с | запас');
    for (const w of r.waves) console.log(`${String(w.n).padStart(5)}${w.boss ? 'Б' : ' '}| ${String(w.ehp).padStart(7)} | ${w.pass.toFixed(0).padStart(9)} | ${w.need.toFixed(0).padStart(13)} | ${String(w.souls).padStart(5)} | ${w.def.toFixed(0).padStart(15)} | ${(w.margin >= 0 ? '+' : '') + Math.round(100 * w.margin)}%`);
    console.log(r.breaks ? `запас кончается на волне ${r.breaks}` : 'запаса хватает на весь забег');
  } else if (arg('fit', null) || arg('sim', null)) {
    const sim = JSON.parse(fs.readFileSync(arg('fit', null) || arg('sim', null), 'utf8')), bot = arg('bot', 'smart');
    const seeds = [...new Set(sim.res.filter((x) => x.bot === bot).map((x) => x.seed))];
    let model = await many(seeds);
    if (arg('fit', null)) { let best = null;
      const runs = sim.res.filter((x) => x.bot === bot).map((x) => ({ win: x.win !== null, r: model.find((m) => m.seed === x.seed) }));
      for (let alpha = 0.7; alpha <= 1.51; alpha += 0.05) { const ks = runs.map((x) => kcrit(x.r, alpha)).sort((p, q) => p - q);
        for (let i = 0; i <= ks.length; i++) { const K = i === 0 ? ks[0] * 0.99 : i === ks.length ? ks[i - 1] * 1.01 : (ks[i - 1] + ks[i]) / 2;
          const ok = runs.filter((x) => (kcrit(x.r, alpha) <= K) === x.win).length;
          if (!best || ok > best.ok) best = { ok, K, alpha }; } }
      MODEL.K = best.K; MODEL.ALPHA = +best.alpha.toFixed(2); model = model.map((r) => judge(r));
      console.log(`подобрано: K = ${MODEL.K.toPrecision(3)}, ALPHA = ${MODEL.ALPHA} (впиши в MODEL, если сверка устраивает)`); }
    const a = agree(model, sim, bot);
    console.log(`бот ${bot}, сидов ${a.n}: модель согласна с исходом партии на ${a.ok} (${pct(a.ok, a.n)}), расходится на ${a.n - a.ok} (${pct(a.n - a.ok, a.n)})`);
    console.log(`  побед у бота ${a.rows.filter((x) => x.win).length}, проходимых по модели ${a.rows.filter((x) => x.pred).length}`);
    for (const x of a.rows.filter((r) => r.win !== r.pred)) console.log(`  сид ${x.seed}: бот ${x.win ? 'победил' : 'проиграл на ' + x.wave + '-й'}, модель — ${x.pred ? 'проходим' : 'запас кончается на ' + x.breaks + '-й'} (мин. запас ${Math.round(100 * x.min)}%)`);
  } else {
    const sv = String(arg('seeds', 1000)), [a, b] = sv.includes('-') ? sv.split('-').map(Number) : [1, +sv];
    const rs = await many(Array.from({ length: b - a + 1 }, (_, i) => a + i)), N = rs.length;
    const ok = rs.filter((r) => r.minMargin >= 0).length, hist = {};
    for (const r of rs) if (r.breaks) hist[r.breaks] = (hist[r.breaks] || 0) + 1;
    console.log(`сидов ${N} (${a}–${b}), ${((Date.now() - t0) / 1000).toFixed(1)} с; K = ${MODEL.K}${set.length ? '; подмена: ' + set.map((x) => x.join('=')).join('; ') : ''}`);
    console.log(`проходимых по модели: ${ok} (${pct(ok, N)}); запас кончается на волне: ${Object.entries(hist).map(([w, n]) => `${w}: ${pct(n, N)}`).join(', ') || '—'}`);
    console.log('волна | запас: медиана | 10% худших | 90% | угроза к прошлой волне (медиана)');
    const med = (v, q) => { const s = v.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
    for (let n = 1; n <= waves; n++) { const m = rs.map((r) => r.waves[n - 1].margin), g = n > 1 ? rs.map((r) => r.waves[n - 1].need / r.waves[n - 2].need) : null;
      const bar = '█'.repeat(Math.max(0, Math.min(40, Math.round(20 * (med(m, 0.5) + 1)))));
      console.log(`${String(n).padStart(5)}${rs[0].waves[n - 1].boss ? 'Б' : ' '}| ${(med(m, 0.5) >= 0 ? '+' : '') + Math.round(100 * med(m, 0.5))}%`.padEnd(20) + `| ${Math.round(100 * med(m, 0.1))}%`.padEnd(8) + `| ${Math.round(100 * med(m, 0.9))}%`.padEnd(8) + `| ${g ? '×' + f2(med(g, 0.5)) : ''}`.padEnd(8) + ' ' + bar);
    }
  }
}
