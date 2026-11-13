// node tools/model.mjs [параметры] — модель баланса без симуляции: по сиду для каждой волны угроза и оборона, кривая запаса.
//
//   Угроза волны n — урон в секунду, который нужен, чтобы убить её до склепа: эффективные HP (броня и защита от магии против
//   среднего состава урона MIX, лечение священников) за время, за которое волна проходит оборону (выход волны плюс путь через
//   накрытый башнями участок ZONE со средней скоростью врагов; знамя ускоряет). В запасе берётся типичная угроза — медиана
//   по сидам 1..TYPICAL с текущими числами конфига: своя угроза сида исход почти не предсказывает (состав волн меняется от
//   сида, а разумная оборона подстраивается под него), её показывает только таблица --seed.
//   Оборона к волне — урон в секунду, купленный на души, заработанные к ней (старт + награды и бонусы прошлых волн, половина
//   наград текущей): K · души^ALPHA · (насыщение покрытия лучших TOP клеток карты / SAT_REF)^BETA — от сида зависят карта и
//   души. Запас волны = оборона / угроза − 1; забег проходим по модели, если запас ни на одной волне не ниже нуля.
//   K, ALPHA, BETA подобраны под разумного бота (--fit), модель грубая: её дело — знак и форма кривой, а не точные числа.
//
//   --seed S            таблица по волнам одного сида
//   --seeds N | A-B     сводка по сидам (по умолчанию 1000): доля проходимых, на какой волне запас кончается, кривая запаса
//   --sim FILE          сверка с прогоном ботов (node tools/balance.mjs --json FILE), бот --bot (по умолчанию smart)
//   --fit FILE          подобрать K, ALPHA, BETA на первой половине сидов прогона, сверить на второй и на всех;
//                       --alpha A — подбирать только K и BETA при заданном ALPHA
//   --k K               свой K вместо записанного
//   --set 'путь=выражение;…'  подмена чисел конфига, как в tools/balance.mjs
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { createRequire } from 'node:module';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);

export const MODEL = { K: 0.36, ALPHA: 0.9, BETA: 1.5, MIX: { phys: 0.4, magic: 0.25, poison: 0.35 }, TOP: 20, SAT: 320, SAT_REF: 0.62, ZONE: 2500, TYPICAL: 200 };

const setCfg = (C, list) => { for (const [path, expr] of list) { const keys = path.split('.'), last = keys.pop();
  const o = keys.reduce((x, k) => { if (!x || typeof x[k] !== 'object') throw new Error('нет поля конфига ' + path); return x[k]; }, C);
  if (!(last in o)) throw new Error('нет поля конфига ' + path);
  o[last] = new Function('C', 'return (' + expr + ')')(C); } };
const parseSet = (s) => String(s || '').split(';').map((x) => x.trim()).filter(Boolean).map((x) => { const i = x.indexOf('='); return [x.slice(0, i).trim(), x.slice(i + 1)]; });

// ---------------------------------------------------------------- карта: насыщение лучших клеток и накрытый ими участок дороги
const mapInfo = (SIM, seed) => {
  const C = SIM.CONFIG, S = SIM.create(seed), L = SIM.pathLen(S), pts = [];
  for (let d = 4; d < L; d += 8) { const p = SIM.posAt(S, d); pts.push([p.x, p.y]); }
  const free = []; for (let i = 0; i < S.towers.length; i++) if (!S.map.road.includes(i) && !SIM.MAPGEN.hud(S.map, i) && !SIM.MAPGEN.obstacle(S.map, i)) free.push(i);
  const cells = free.map((i) => { const [x, y] = SIM.cellXY(S, i), b = SIM.cellBonus(S, i), r = (C.TYPICAL_RANGE + (b && b.range || 0)) * C.UNIT, hit = [];
    pts.forEach(([px, py], k) => { if ((px - x) ** 2 + (py - y) ** 2 <= r * r) hit.push(k); });
    return { hit, cov: hit.length * 8 }; }).sort((a, b) => b.cov - a.cov).slice(0, MODEL.TOP);
  const covered = new Set(); for (const c of cells) for (const k of c.hit) covered.add(k);
  return { L, zone: covered.size * 8, sat: cells.reduce((a, c) => a + c.cov / (c.cov + MODEL.SAT), 0) / cells.length };
};

// ---------------------------------------------------------------- волна: нужный урон в секунду и души
const waveInfo = (SIM, seed, n, zone) => {
  const C = SIM.CONFIG, w = SIM.WAVEGEN.wave(seed, n), M = MODEL.MIX;
  let ehp = 0, hp = 0, sp = 0, bounty = 0, haste = 0, cnt = 0;
  for (const q of w.squads.concat(w.extra)) { const d = C.ENEMIES[q.type];
    let h = q.hp / (M.phys * (1 - q.armor) + M.magic * (1 - q.mres) + M.poison);
    if (q.heal) h += q.heal * (d.healTargets || 1) * 3;                           // лечение: примерно три срабатывания за проход
    ehp += h * q.count; hp += q.hp * q.count; sp += q.speed * q.hp * q.count; bounty += q.bounty * q.count; cnt += q.count;
    if (d.haste) haste += q.count; }
  const speed = sp / hp * (1 + (haste ? Math.min(1, haste * 8 / cnt) * 0.3 : 0)), pass = w.duration + zone / speed;
  return { boss: w.boss, ehp, pass, need: ehp / pass, bounty, bonus: w.bonus };
};
// типичная угроза по волнам 1..waves: медиана по сидам 1..TYPICAL, путь через оборону — ZONE
const typical = (SIM, waves) => Array.from({ length: waves }, (_, i) => {
  const v = []; for (let s = 1; s <= MODEL.TYPICAL; s++) v.push(waveInfo(SIM, s, i + 1, MODEL.ZONE).need);
  return v.sort((a, b) => a - b)[v.length >> 1]; });

// весь забег по сиду без K: { seed, map, waves: [{ n, boss, own — своя угроза сида, need — типичная, have — души }] }
export const run = (SIM, seed, waves, typ) => {
  const C = SIM.CONFIG, mp = mapInfo(SIM, seed), out = []; let souls = C.START_SOULS;
  for (let n = 1; n <= waves; n++) { const w = waveInfo(SIM, seed, n, mp.zone);
    out.push({ n, boss: w.boss, ehp: Math.round(w.ehp), pass: w.pass, own: w.need, need: typ[n - 1], have: souls + w.bounty / 2 });
    souls += w.bounty + w.bonus; }
  return { seed, map: mp, waves: out };
};
const unitDef = (r, w, alpha = MODEL.ALPHA, beta = MODEL.BETA) => w.have ** alpha * (r.map.sat / MODEL.SAT_REF) ** beta;
// запас по волнам: { …r, waves: [+ def, margin], minMargin, breaks — первая волна с запасом ниже нуля }
export const judge = (r) => {
  const waves = r.waves.map((w) => { const def = MODEL.K * unitDef(r, w); return Object.assign({}, w, { def, margin: def / w.need - 1 }); });
  return Object.assign({}, r, { waves, minMargin: Math.min(...waves.map((x) => x.margin)), breaks: (waves.find((x) => x.margin < 0) || { n: null }).n });
};
// наименьший K, при котором забег проходим по модели
const kcrit = (r, alpha, beta) => Math.max(...r.waves.map((w) => w.need / unitDef(r, w, alpha, beta)));

if (!isMainThread) {
  const SIM = require('../live/sim.js'); setCfg(SIM.CONFIG, workerData.set); Object.assign(MODEL, workerData.model);
  const typ = typical(SIM, workerData.waves);
  parentPort.postMessage(workerData.seeds.map((s) => run(SIM, s, workerData.waves, typ)));
} else if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i < 0 ? d : process.argv[i + 1] === undefined || process.argv[i + 1].startsWith('--') ? true : process.argv[i + 1]; };
  const set = parseSet(arg('set', '')), SIM = require('../live/sim.js'); setCfg(SIM.CONFIG, set);
  const C = SIM.CONFIG, waves = C.RUN_WAVES; if (arg('k', null)) MODEL.K = +arg('k');
  const pct = (a, b) => Math.round(100 * a / Math.max(1, b)) + '%', t0 = Date.now();
  const many = async (seeds) => { const nW = Math.max(1, Math.min(12, Math.floor(os.cpus().length / 2), Math.ceil(seeds.length / 25))), parts = [];
    for (let i = 0; i < nW; i++) parts.push(seeds.filter((_, j) => j % nW === i));
    const res = await Promise.all(parts.map((p) => new Promise((ok, no) => { const w = new Worker(fileURLToPath(import.meta.url), { workerData: { seeds: p, waves, set, model: MODEL } });
      w.once('message', ok); w.once('error', no); })));
    return res.flat().sort((a, b) => a.seed - b.seed); };
  // согласие модели с исходами партий: [{ seed, win, pred, wave, breaks, min }]
  const agree = (model, rows) => rows.map((x) => { const m = judge(model.find((r) => r.seed === x.seed));
    return { seed: x.seed, win: x.win !== null, pred: m.minMargin >= 0, wave: x.wave, breaks: m.breaks, min: m.minMargin }; });
  const say = (what, a) => console.log(`${what}: модель согласна с исходом партии на ${a.filter((x) => x.win === x.pred).length} из ${a.length} сидов (${pct(a.filter((x) => x.win === x.pred).length, a.length)}); побед у бота ${a.filter((x) => x.win).length}, проходимых по модели ${a.filter((x) => x.pred).length}`);
  if (arg('seed', null) !== null) {
    const typ = typical(SIM, waves), r = judge(run(SIM, +arg('seed'), waves, typ));
    console.log(`сид ${r.seed}: дорога ${Math.round(r.map.L)} px, накрыто лучшими ${MODEL.TOP} клетками ${Math.round(r.map.zone)} px, насыщение ${r.map.sat.toFixed(2)}`);
    console.log('волна | эфф. HP | проход, с | угроза сида | типичная | души | оборона | запас');
    for (const w of r.waves) console.log(`${String(w.n).padStart(5)}${w.boss ? 'Б' : ' '}| ${String(w.ehp).padStart(7)} | ${w.pass.toFixed(0).padStart(9)} | ${w.own.toFixed(0).padStart(11)} | ${w.need.toFixed(0).padStart(8)} | ${String(Math.round(w.have)).padStart(5)} | ${w.def.toFixed(0).padStart(7)} | ${(w.margin >= 0 ? '+' : '') + Math.round(100 * w.margin)}%`);
    console.log(r.breaks ? `запас кончается на волне ${r.breaks}` : 'запаса хватает на весь забег');
  } else if (arg('fit', null) || arg('sim', null)) {
    const sim = JSON.parse(fs.readFileSync(arg('fit', null) || arg('sim', null), 'utf8')), bot = arg('bot', 'smart');
    const rows = sim.res.filter((x) => x.bot === bot).sort((a, b) => a.seed - b.seed), model = await many(rows.map((x) => x.seed));
    if (arg('fit', null)) {
      const train = rows.slice(0, rows.length >> 1), byS = new Map(model.map((r) => [r.seed, r])); let best = null;
      const alphas = arg('alpha', null) ? [+arg('alpha')] : Array.from({ length: 29 }, (_, i) => 0.1 + 0.05 * i);
      for (let beta = 0; beta <= 3; beta += 0.5) for (const alpha of alphas) {
        const kc = train.map((x) => kcrit(byS.get(x.seed), alpha, beta)), ks = kc.slice().sort((p, q) => p - q);
        for (let i = 0; i <= ks.length; i++) { const K = i === 0 ? ks[0] * 0.99 : i === ks.length ? ks[i - 1] * 1.01 : (ks[i - 1] + ks[i]) / 2;
          const ok = train.filter((x, j) => (kc[j] <= K) === (x.win !== null)).length;
          if (!best || ok > best.ok) best = { ok, K, alpha, beta }; } }
      Object.assign(MODEL, { K: +best.K.toPrecision(3), ALPHA: +best.alpha.toFixed(2), BETA: best.beta });
      console.log(`подобрано на сидах ${train[0].seed}–${train[train.length - 1].seed}: K = ${MODEL.K}, ALPHA = ${MODEL.ALPHA}, BETA = ${MODEL.BETA} (впиши в MODEL, если сверка устраивает)`);
      say(`  проверка на сидах ${rows[train.length].seed}–${rows[rows.length - 1].seed}`, agree(model, rows.slice(train.length)));
    }
    const a = agree(model, rows); say(`бот ${bot}, все ${a.length} сидов`, a);
    // кривая по набору: на какой волне кончается запас по модели и на какой проигрывает бот (доля сидов по третям забега)
    const part = (v) => (v <= 7 ? 0 : v <= 14 ? 1 : 2), share = (list) => [0, 1, 2].map((k) => pct(list.filter((v) => part(v) === k).length, a.length)).join(' / ');
    console.log(`  проигрыш на волнах 1–7 / 8–14 / 15–20: бот ${share(a.filter((x) => !x.win).map((x) => x.wave))}, модель ${share(a.filter((x) => !x.pred).map((x) => x.breaks))}`);
    const miss = a.filter((r) => r.win !== r.pred);
    console.log(`  расходится: ${miss.slice(0, 12).map((x) => `сид ${x.seed} (бот ${x.win ? 'победил' : 'проиграл на ' + x.wave + '-й'}, запас ${Math.round(100 * x.min)}%)`).join('; ')}${miss.length > 12 ? '; …' : ''}`);
  } else {
    const sv = String(arg('seeds', 1000)), [a, b] = sv.includes('-') ? sv.split('-').map(Number) : [1, +sv];
    const rs = (await many(Array.from({ length: b - a + 1 }, (_, i) => a + i))).map(judge), N = rs.length;
    const ok = rs.filter((r) => r.minMargin >= 0).length, hist = {};
    for (const r of rs) if (r.breaks) hist[r.breaks] = (hist[r.breaks] || 0) + 1;
    console.log(`сидов ${N} (${a}–${b}), ${((Date.now() - t0) / 1000).toFixed(1)} с; K = ${MODEL.K}, ALPHA = ${MODEL.ALPHA}, BETA = ${MODEL.BETA}${set.length ? '; подмена: ' + set.map((x) => x.join('=')).join('; ') : ''}`);
    console.log(`проходимых по модели: ${ok} (${pct(ok, N)}); запас кончается на волне: ${Object.entries(hist).map(([w, n]) => `${w}: ${pct(n, N)}`).join(', ') || '—'}`);
    console.log('волна | запас: медиана | 10% худших | 90% лучших | типичная угроза к прошлой волне');
    const q = (v, p) => { const s = v.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
    for (let n = 1; n <= waves; n++) { const m = rs.map((r) => r.waves[n - 1].margin), w = rs[0].waves, g = n > 1 ? w[n - 1].need / w[n - 2].need : null;
      const s = (v) => (v >= 0 ? '+' : '') + Math.round(100 * v) + '%', bar = '█'.repeat(Math.max(0, Math.min(40, Math.round(20 * (q(m, 0.5) + 1)))));
      console.log(`${String(n).padStart(5)}${w[n - 1].boss ? 'Б' : ' '}| ${s(q(m, 0.5)).padEnd(15)}| ${s(q(m, 0.1)).padEnd(11)}| ${s(q(m, 0.9)).padEnd(11)}| ${g ? '×' + g.toFixed(2) : ''}`.padEnd(70) + bar);
    }
  }
}
