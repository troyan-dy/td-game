// Баланс-боты: играют партию headless на сгенерированной карте и возвращают итог. Используются в tests/runs.mjs (ожидания),
// тестах, tools/balance.mjs (параллельный прогон по сидам) и tools/model.mjs (сверка модели с симуляцией).
//
// Бот — функция (S, mem) → команды или null; mem — память бота на партию. Боты:
//   idle        — ничего не строит (на выборе реликвии берёт первую — иначе забег стоит);
//   smart       — разумный: жадно покупает то, что даёт больше всего силы обороны на душу (постройка любого открытого типа
//                 на клетке по покрытию дороги и особым клеткам, ступень ветки, перк), реликвию выбирает по оценке;
//   grim        — smart плюс Гримуар (и слияния башен, когда они появятся: см. mergeMoves);
//   random      — строит, качает и берёт перки наугад;
//   mono(type)  — smart, но только один тип башни (спам); focus(type) — smart, который тот тип ценит вдвое (упор в тип);
//   planned(mix, perks) — старый простой бот: клетки по покрытию, типы по кругу (тесты перков).
// Сила обороны в оценке бота — урон в секунду по средней цели ближайших волн (броня, защита, тяжёлые — из превью волн)
// с поправкой на вид атаки и перки, умноженный на насыщение покрытия дороги. Коэффициенты ниже — грубые, их задача —
// разумный порядок покупок, а не точность.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
export const SIM = require('../live/sim.js');
const META = require('../live/meta.js');
const C = SIM.CONFIG, TW = C.TOWERS, MG = SIM.MAPGEN, WG = SIM.WAVEGEN;

// открытое у нового профиля (первый забег человека); null — открыто всё
export const NEW_PROFILE = META.unlocked(META.fresh());

// ---------------------------------------------------------------- покрытие дороги (кэш на карту)
const ROAD = new WeakMap();
const roadPts = (S) => { let p = ROAD.get(S.map); if (p) return p;
  p = []; const L = SIM.pathLen(S); for (let d = 4; d < L; d += 8) { const q = SIM.posAt(S, d); p.push(q.x, q.y); }
  p = { pts: p, cov: new Map() }; ROAD.set(S.map, p); return p; };
// длина дороги, px, в радиусе units от центра клетки
const cover = (S, cell, units) => { const R = roadPts(S), key = cell * 4096 + Math.round(units * 40); let v = R.cov.get(key);
  if (v === undefined) { const [x, y] = SIM.cellXY(S, cell), r2 = (units * C.UNIT) ** 2, P = R.pts; v = 0;
    for (let i = 0; i < P.length; i += 2) { const dx = P[i] - x, dy = P[i + 1] - y; if (dx * dx + dy * dy <= r2) v += 8; }
    R.cov.set(key, v); }
  return v; };
const SAT = 320;                                     // покрытие, при котором башня занята половину времени волны
const sat = (cov) => cov / (cov + SAT);

// ---------------------------------------------------------------- противник ближайших волн (по превью, как у игрока)
// { armor, mres — средние по HP; heavy — доля HP тяжёлых; crowd — врагов в волне }
const foes = (S, mem) => {
  const from = S.phase === 'wave' ? S.wave : S.wave + 1;
  if (mem.foes && mem.foes.from === from) return mem.foes;
  let hp = 0, ar = 0, mr = 0, hv = 0, n = 0, k = 0;
  for (let w = from; w < from + 3; w++) { const v = WG.wave(S.seed, Math.max(1, w)); k++;
    for (const q of v.squads.concat(v.extra)) { const h = q.hp * q.count; hp += h; ar += q.armor * h; mr += q.mres * h;
      if (C.ENEMIES[q.type].heavy) hv += h; n += q.count; } }
  return (mem.foes = { from, armor: ar / hp, mres: mr / hp, heavy: hv / hp, crowd: n / k });
};

// ---------------------------------------------------------------- сила башни
// EFF — поправка типа: во сколько раз его «урон в секунду» по формуле ниже стоит больше или меньше настоящего
export const EFF = { bones: 1, spirits: 0.7, plague: 1.5, dark: 1, bell: 1, barracks: 0.25 };
const SLOW_W = 20, STUN_W = 45, HOLD_W = 14;
const resist = (type, st, P) => { const d = TW[type];
  if (d.dmgType === 'phys') return 1 - Math.max(0, P.armor - (st.shred || 0)) * (1 - (st.pen || 0));
  if (d.dmgType === 'magic') return d.ignoreMres ? 1 : 1 - P.mres * (1 - (st.mpen || 0));
  return 1; };
// эффекты примеси гибрида (общий слой попадания): множитель к урону и прибавка за контроль
const mixK = (st) => (1 + (st.venom || 0) * Math.min(st.venomTime || 0, 2) + (st.pierceN || 0) * (st.pierceK || 0) * 0.6);
const mixC = (st) => (st.stunChance ? STUN_W * st.stunChance * st.stunMini / st.rate : 0) + (st.raiseMax ? HOLD_W * st.raiseMax * 0.5 : 0);
// «урон в секунду» башни типа type с характеристиками st против противника P (без покрытия)
const dps = (type, st, P) => {
  return base(type, st, P) * mixK(st) + mixC(st);
};
const base = (type, st, P) => {
  const r = resist(type, st, P), sup = 1 + 1.5 * ((st.curse || 0) + (st.grip || 0)) + (st.drag || 0);
  switch (TW[type].attack) {
    case 'bolt': return st.dmg / st.rate * r * (st.bolts ? st.bolts * st.boltMult * 0.85 : st.pierce ? 1.7 : 1) * sup;
    case 'ghost': return (st.dmg / st.rate * r * (1 + (st.bounces || 0) * (st.bounceMult || 0) * 0.6)
      + SLOW_W * st.slow * Math.min(1, st.slowTime / st.rate) + 30 * (st.freezeChance || 0) * (st.freeze || 0) / st.rate) * sup;
    case 'blob': { const cross = 2 * st.cloudR * C.UNIT / 48;           // секунд, за которые враг проходит облако; в облаке — тем больше, чем гуще волна
      return st.dmg * (Math.min(st.cloudTime, cross) + st.linger) / st.rate * (1 + P.crowd / 25) * (st.cloudR / 0.9) * (1 + (st.pestR ? 0.3 : 0) + (st.shred || 0)) * sup; }
    case 'beam': return st.dmg / st.rate * r * (1 + (st.heavy - 1) * P.heavy) * (1 + (st.split || 0)) * sup;
    case 'pulse': return (st.dmg / st.rate * r * 2.5 + STUN_W * Math.min(1, st.stun / st.rate)) * sup;
    case 'summon': return (st.limit * st.dmg / st.hit * r * 0.5 + HOLD_W * st.limit * Math.min(1, st.hp / 12 / st.rate)) * (1 + (st.burst ? 0.3 : 0)) * sup;
    default: return 0;
  }
};
// сила башни типа type на клетке cell с характеристиками st
const power = (S, mem, type, cell, st) => {
  if (!TW[type].attack) return 0;
  const cov = TW[type].attack === 'summon' ? (SIM.skelCells(S, { cell }, { rangePx: st.range * C.UNIT }).length ? 400 : 0) : cover(S, cell, st.range);
  return EFF[type] * dps(type, st, foes(S, mem)) * sat(cov);
};
const towerPower = (S, mem, tw, plus) => power(S, mem, tw.type, tw.cell, SIM.towerStats(S, tw, plus));
// сила всех башен (для Гримуара и алтаря)
const totalPower = (S, mem, only) => { let v = 0; for (const t of S.towers) if (t && (!only || only(t))) v += towerPower(S, mem, t); return v; };

// ---------------------------------------------------------------- ходы
const open = (S, type) => !S.unlocked || S.unlocked.includes(type);
// клетки-кандидаты под постройку: лучшие по покрытию типичным радиусом и все особые клетки у дороги
const candidates = (S, mem) => {
  if (!mem.cells) { const ranked = SIM.rankCells(S, C.TYPICAL_RANGE).slice(0, 48), sp = [];
    for (let i = 0; i < S.towers.length; i++) if (MG.special(S.map, i) && !ranked.includes(i)) sp.push(i);
    mem.cells = ranked.concat(sp); }
  return mem.cells.filter((c) => !S.towers[c]);
};
const gridDist = (S, a, b) => { const n = S.map.cols; return Math.max(Math.abs(a % n - b % n), Math.abs(Math.floor(a / n) - Math.floor(b / n))); };
// сила, которую добавит изменение f (меняет S и возвращает отмену): мерим всё поле до и после
const delta = (S, mem, f, only) => { const before = totalPower(S, mem, only), undo = f(); const after = totalPower(S, mem, only); undo(); return after - before; };
const near = (S, cell, r) => (t) => gridDist(S, t.cell, cell) <= r + 1;

// все ходы с оценкой: [{ cmd, cost, gain }]
const moves = (S, mem, o) => {
  const out = [], types = (o.types || C.TOWER_ORDER).filter((t) => open(S, t)), cnt = {};
  for (const t of S.towers) if (t) cnt[t.type] = (cnt[t.type] || 0) + 1;
  const free = candidates(S, mem);
  // постройка: стреляющие типы — на клетках-кандидатах
  for (const type of types) { if (!TW[type].attack) continue;
    const st0 = SIM.buildStats(S, -1, type), mix = (o.like && o.like[type] || 1) * 0.9 ** (cnt[type] || 0);
    let best = null;
    for (const cell of free) { const b = SIM.cellBonus(S, cell), st = Object.assign({}, st0, { range: st0.range + (b && b.range || 0), dmg: st0.dmg * (1 + (b && b.dmg || 0)) });
      const cost = SIM.canBuild(S, cell, type).cost, gain = power(S, mem, type, cell, st) * mix + (b && b.souls ? 4 : 0);
      if (!best || gain / cost > best.gain / best.cost) best = { cmd: { k: 'build', cell, type }, cost, gain }; }
    if (best) out.push(best); }
  // алтарь: клетка рядом с тремя и больше стреляющими башнями, где их ещё никто не усиливает
  for (const type of types) { if (TW[type].attack || !SIM.hasAura(type)) continue;
    const seen = new Set(); let best = null;
    for (const t of S.towers) if (t && TW[t.type].attack) for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const x = t.cell % S.map.cols + dx, y = Math.floor(t.cell / S.map.cols) + dy, cell = y * S.map.cols + x;
      if (x < 0 || y < 0 || x >= S.map.cols || y >= S.map.rows || seen.has(cell)) continue; seen.add(cell);
      const cb = SIM.canBuild(S, cell, type); if (cb.reason && cb.reason !== 'souls') continue;
      if (SIM.auraTargets(S, cell, type).length < 3) continue;
      const gain = delta(S, mem, () => { S.towers[cell] = Object.assign({ cell, type, tracks: { dmg: 0, range: 0, rate: 0 }, cap: C.TRACK_MAX, perks: [], slots: C.PERK_SLOTS }); return () => { S.towers[cell] = null; }; }, near(S, cell, 2));
      if (!best || gain > best.gain) best = { cmd: { k: 'build', cell, type }, cost: cb.cost, gain: gain * (o.like && o.like[type] || 1) }; }
    if (best && best.gain > 0) out.push(best); }
  // ступени и перки
  const pair = o.merge ? pairOf(S, mem) : null, bonus = pair ? pairBonus(S, mem, pair) : 0;
  for (const tw of S.towers) { if (!tw) continue;
    const aura = SIM.hasAura(tw.type), base = aura ? 0 : towerPower(S, mem, tw), like = o.like && o.like[tw.type] || 1, inPair = pair && pair.includes(tw.cell);
    for (const track of C.TRACKS) { const cu = SIM.canUpgrade(S, tw.cell, track); if (cu.cost === null) continue;
      const gain = aura ? delta(S, mem, () => { tw.tracks[track]++; return () => { tw.tracks[track]--; }; }, near(S, tw.cell, 3)) : towerPower(S, mem, tw, track) - base;
      out.push({ cmd: { k: 'upgrade', cell: tw.cell, track }, cost: cu.cost, gain: gain * like + (inPair && tw.tracks[track] < C.TRACK_MAX ? bonus : 0) }); }
    if (SIM.freeSlots(tw)) { let best = null;
      for (const p of Object.keys(TW[tw.type].perks)) { const cp = SIM.canPerk(S, tw.cell, p); if (cp.reason && cp.reason !== 'souls') continue;
        const gain = aura ? delta(S, mem, () => { tw.perks.push(p); return () => { tw.perks.pop(); }; }, near(S, tw.cell, 3))
          : power(S, mem, tw.type, tw.cell, SIM.towerStats(S, Object.assign({}, tw, { perks: tw.perks.concat(p) }))) - base;
        if (!best || gain > best.gain) best = { cmd: { k: 'perk', cell: tw.cell, p }, cost: cp.cost, gain: gain * like }; }
      if (best) out.push(best); } }
  // Гримуар: линия усиливает все подходящие башни, и будущие — небольшая надбавка за то, что ещё будет построено
  if (o.grim) for (const l of SIM.grimLines(S)) { const cg = SIM.canGrim(S, l.id); if (cg.cost === null || (cg.reason && cg.reason !== 'souls')) continue;
    const gain = delta(S, mem, () => { S.grim[l.id]++; return () => { S.grim[l.id]--; }; }, l.type ? (t) => t.type === l.type : null);
    out.push({ cmd: { k: 'grim', line: l.id }, cost: cg.cost, gain: gain * 1.1 }); }
  if (o.merge) out.push(...mergeMoves(S, mem));
  return out;
};
// Пара под слияние (сильный бот): две соседние стреляющие башни, не гибриды, ближе всех к потолку веток. Первая — та, что
// сильнее (гибрид атакует как первая). [первая, вторая] или null. Каждой недостающей до потолка ступени пары бот прибавляет
// к выгоде долю будущей выгоды слияния (pairBonus) — так он доводит пару до слияния, а не ждёт, пока она дорастёт сама.
// Сильный бот идёт на слияние целенаправленно: пока прошлая волна прошла без потерь прочности, будущая выгода слияния
// в ступенях пары считается без вычета цены докачки и вдвое (рывок к гибриду); как только склеп начал терять прочность —
// только чистая выгода (за вычетом второй башни и докачки гибрида по цене такой же новой башни), то есть сначала оборона.
export const PAIR = { rush: 2, share: 0.4 };
// Рывок — только пока в паре не больше PAIR.share всего вложенного: остальная оборона растёт вместе с парой
const pairBonus = (S, mem, pair) => { let inv = 0, all = 0; for (const t of S.towers) if (t) { all += t.invested; if (pair.includes(t.cell)) inv += t.invested; }
  return calm(S, mem) && inv <= PAIR.share * all ? PAIR.rush * pairBonus0(S, mem, pair, 0) : pairBonus0(S, mem, pair, 1); };
// прошлая волна прошла без потерь прочности (прочность в начале текущей и прошлой волны помнится в mem)
const calm = (S, mem) => { if (mem.hpWave !== S.wave) { mem.hpPrev = mem.hpNow === undefined ? S.hp : mem.hpNow; mem.hpNow = S.hp; mem.hpWave = S.wave; }
  return S.hp >= mem.hpPrev; };
const pairBonus0 = (S, mem, [ca, cb], PAIR_COST) => { const a = S.towers[ca], b = S.towers[cb], M = C.MERGE;
  const left = C.TRACKS.reduce((n, k) => n + Math.max(0, C.TRACK_MAX - a.tracks[k]) + Math.max(0, C.TRACK_MAX - b.tracks[k]), 0); if (!left) return 0;
  const hw = Object.assign({}, a, { mix: b.type, cap: M.cap, slots: M.slots, tracks: Object.fromEntries(C.TRACKS.map((k) => [k, M.cap])), perks: a.perks.concat(b.perks) });
  const top = (t) => Object.assign({}, t, { tracks: Object.fromEntries(C.TRACKS.map((k) => [k, C.TRACK_MAX])) });
  // сколько стоит башня на потолке и докачка гибрида — и что на эти души дала бы такая же новая башня
  const price = (t, from, to) => C.TRACKS.reduce((n, k) => n + TW[t.type].tracks[k].cost.slice(from, to).reduce((x, y) => x + y, 0), 0);
  const pa = towerPower(S, mem, top(a)), perSoul = pa / (TW[a.type].base.cost + price(a, 0, C.TRACK_MAX));
  const net = towerPower(S, mem, hw) - pa - (towerPower(S, mem, top(b)) + (M.cost + price(a, C.TRACK_MAX, M.cap)) * perSoul) * PAIR_COST;
  return Math.max(0, net) / left; };
const pairOf = (S, mem) => {
  const ok = (t) => t && TW[t.type].attack && !SIM.isHybrid(t);
  if (mem.pair && mem.pair.every((c) => ok(S.towers[c]))) return mem.pair;
  const ts = S.towers.filter(ok); mem.pair = null; if (ts.length < 4) return null;
  let best = null;
  for (const a of ts) for (const b of ts) if (a !== b && gridDist(S, a.cell, b.cell) === 1) {
    if (towerPower(S, mem, a) < towerPower(S, mem, b)) continue;
    const v = SIM.steps(a) + SIM.steps(b); if (!best || v > best.v) best = { v, p: [a.cell, b.cell] }; }
  return (mem.pair = best ? best.p : null);
};
// Слияние башен в гибриды: две соседние башни на потолке всех веток → гибрид первой с примесью второй (вторая уходит
// с поля), потолок веток выше. Оценка смотрит вперёд: гибрид, докачанный до нового потолка, против двух башен сейчас;
// в цену хода (per) входят и будущие ступени — платится сейчас только само слияние (cost).
const mergeMoves = (S, mem) => {
  const out = []; if (S.phase !== 'prep' || !SIM.canMerge) return out;
  for (const a of S.towers) { if (!a || !SIM.canMerge(S, a.cell).ok) continue;
    for (const o of SIM.mergeTargets(S, a.cell)) { const b = S.towers[o], M = C.MERGE;
      const hw = Object.assign({}, a, { mix: b.type, cap: M.cap, slots: M.slots, tracks: Object.fromEntries(C.TRACKS.map((k) => [k, M.cap])),
        perks: a.perks.concat(b.perks.filter((p) => !a.perks.includes(p))) });
      let later = 0; for (const k of C.TRACKS) for (let n = a.tracks[k]; n < M.cap; n++) later += TW[a.type].tracks[k].cost[n] || 0;
      const gain = towerPower(S, mem, hw) - towerPower(S, mem, a) - towerPower(S, mem, b);
      const planned = mem.pair && mem.pair[0] === a.cell && mem.pair[1] === o;   // задуманная пара сливается при первой возможности
      if (gain > 0 || planned) out.push({ cmd: { k: 'merge', cell: a.cell, other: o }, cost: M.cost, per: planned ? Infinity : gain / (M.cost + later), gain: Math.max(gain, 1) }); } }
  return out;
};

// ---------------------------------------------------------------- реликвии: оценка в душах
const relicScore = (S, id) => {
  const r = C.RELICS[id], left = Math.max(1, C.RUN_WAVES - S.wave), perWave = S.stats.earned / Math.max(1, S.wave);
  const future = perWave * left, inv = {}; let all = 0;
  for (const t of S.towers) if (t) { inv[t.type] = (inv[t.type] || 0) + t.invested; all += t.invested; }
  const base = all + future * 0.8, t = r.tower;
  if (t) { const share = t.on ? S.towers.filter((x) => x && MG.special(S.map, x.cell) === t.on).reduce((a, x) => a + x.invested, 0) / Math.max(1, all) * 0.5
      : t.only ? t.only.reduce((a, k) => a + (inv[k] || 0), 0) / Math.max(1, all) : 1;
    const m = t.mul || {}, eff = (m.dmg || 1) / (m.rate || 1) * (1 + (t.haste || 0)) - 1 + (t.add ? 0.15 : 0);
    return base * share * eff; }
  switch (id) {
    case 'tithe': return r.waveSouls * left;
    case 'coin': return r.killSouls * S.stats.kills / Math.max(1, S.wave) * left;
    case 'ossuary': return r.take.hp * (S.hp < 10 ? 90 : 25);
    case 'hoard': return r.take.souls;
    case 'chisel': return r.trackDiscount * future * 0.5;
    case 'caustic': return 0.1 * (inv.plague || 0);
    case 'usury': return Math.min(r.interestMax, 300 * r.interest) * left;
    case 'cornerstone': return 60;
    case 'insight': return 80;
    case 'hallowed': return 40;
    default: return 10;
  }
};
const pickRelic = (S) => { let bi = 0, bs = -Infinity; S.offer.forEach((id, i) => { const s = relicScore(S, id); if (s > bs) { bs = s; bi = i; } }); return [{ k: 'relic', i: bi }]; };

// ---------------------------------------------------------------- жадный игрок
// Думает не чаще раза в THINK с; копит на лучший ход, но берёт доступный, если тот почти так же выгоден (TAKE от лучшего)
const THINK = 0.5, TAKE = 0.8;
export const greedy = (o = {}) => (S, mem) => {
  if (S.phase === 'relic') return pickRelic(S);
  if (S.phase !== 'prep' && S.phase !== 'wave') return null;
  if (mem.next > S.t && S.souls < (mem.need || 0)) return null;
  mem.next = S.t + THINK;
  const all = moves(S, mem, o).filter((m) => m.gain > 0 && m.cost > 0);
  if (!all.length) { mem.need = Infinity; return null; }
  const per = (m) => (m.per !== undefined ? m.per : m.gain / m.cost);
  let best = all[0]; for (const m of all) if (per(m) > per(best)) best = m;
  let go = best.cost <= S.souls ? best : null;
  if (!go) for (const m of all) if (m.cost <= S.souls && per(m) >= TAKE * per(best) && (!go || per(m) > per(go))) go = m;
  if (!go) { mem.need = best.cost; return null; }
  mem.need = 0; mem.next = 0;                         // сделал ход — следующий можно сразу
  return [go.cmd];
};
export const smart = greedy();
export const grim = greedy({ grim: true, merge: true });
export const mono = (type) => greedy({ types: [type] });
export const focus = (type) => greedy({ like: { [type]: 2 } });
export const spamBones = mono('bones');
export const idle = (S) => (S.phase === 'relic' ? [{ k: 'relic', i: 0 }] : null);

// Случайный игрок: раз в секунду, если хватает душ, — постройка случайного открытого типа на случайной клетке у дороги,
// ступень случайной ветки случайной башни или перк; реликвия — случайная. Случайность — своя, от сида забега.
export const random = (S, mem) => {
  if (!mem.r) { let x = (S.seed * 2654435761 + 12345) >>> 0; mem.r = () => ((x = (x * 1664525 + 1013904223) >>> 0) / 4294967296); }
  const R = mem.r, pick = (a) => a[Math.floor(R() * a.length)];
  if (S.phase === 'relic') return [{ k: 'relic', i: Math.floor(R() * S.offer.length) }];
  if (mem.next > S.t) return null; mem.next = S.t + 1;
  if (!mem.near) mem.near = SIM.rankCells(S, C.TYPICAL_RANGE).filter((c) => cover(S, c, 3) > 0);
  const towers = S.towers.filter(Boolean), roll = R();
  if (roll < 0.4 || !towers.length) { const cell = pick(mem.near.filter((c) => !S.towers[c])), type = pick(C.TOWER_ORDER.filter((t) => open(S, t)));
    return cell !== undefined && SIM.canBuild(S, cell, type).ok ? [{ k: 'build', cell, type }] : null; }
  const tw = pick(towers);
  if (roll < 0.9) { const track = pick(C.TRACKS); return SIM.canUpgrade(S, tw.cell, track).ok ? [{ k: 'upgrade', cell: tw.cell, track }] : null; }
  const p = pick(Object.keys(TW[tw.type].perks)); return SIM.canPerk(S, tw.cell, p).ok ? [{ k: 'perk', cell: tw.cell, p }] : null;
};

// ---------------------------------------------------------------- старый простой бот (тесты перков)
const PERK = { bones: 'volley', spirits: 'pack', plague: 'acid', dark: 'curse', bell: 'drone', altar: 'offering', barracks: 'grip' };
const WEIGHT = { dmg: 1, rate: 1.2, range: 1.8 };
const nextUp = (S, t, perk) => {
  if (SIM.freeSlots(t)) { const cp = SIM.canPerk(S, t.cell, perk); if (cp.ok || cp.reason === 'souls') return { cmd: { k: 'perk', cell: t.cell, p: perk }, cost: cp.cost }; }
  let best = null;
  for (const track of C.TRACKS) { const cu = SIM.canUpgrade(S, t.cell, track); if (cu.cost === null) continue;
    const w = (t.tracks[track] + 1) * WEIGHT[track]; if (!best || w < best.w) best = { w, cmd: { k: 'upgrade', cell: t.cell, track }, cost: cu.cost }; }
  return best;
};
// строит на клетках с лучшим покрытием дороги типы из mix по кругу, качает ветки и берёт перки (perks — какой перк у типа)
export const planned = (mix, perks = PERK) => (S, mem) => {
  if (S.phase === 'relic') return [{ k: 'relic', i: 0 }];
  const cells = mem.plan || (mem.plan = SIM.rankCells(S, C.TYPICAL_RANGE).slice(0, 18)), built = S.towers.filter(Boolean).length;
  const k = cells.findIndex((c) => !S.towers[c]), next = k >= 0 ? [cells[k], mix[k % mix.length]] : null;
  const nextCost = next ? SIM.canBuild(S, next[0], next[1]).cost : Infinity;
  let up = null, upW = Infinity;
  for (const t of S.towers) if (t) { const u = nextUp(S, t, perks[t.type]); if (!u) continue;
    const w = u.cost * (1 + SIM.steps(t) / 4); if (w < upW) { upW = w; up = u; } }
  const wantBuild = next && (built < 7 || nextCost <= (up ? up.cost : Infinity) * 3 || !up);
  if (wantBuild) return S.souls >= nextCost ? [{ k: 'build', cell: next[0], type: next[1] }] : null;
  if (up && S.souls >= up.cost) return [up.cmd];
  return null;
};

// ---------------------------------------------------------------- партия
// Первая волна по кнопке, дальше автоплей (бот не зовёт раньше). dt — шаг времени; opts.unlocked — открытое (по умолчанию
// всё); opts.endless — сколько волн играть после победы в бесконечном режиме (0 — закончить на победе).
// Итог: { phase, wave, hp, t — секунд игры, win — время победы (секунд идущих волн, как в рекордах) или null, kills, souls, towers, waveLog, grim — душ в Гримуар }
export const play = (bot, seed = 1, maxT = 5400, dt, opts = {}) => {
  const S = SIM.create(seed, { dt, unlocked: opts.unlocked || null }), mem = {};
  SIM.step(S, { cmds: [{ k: 'call' }, { k: 'auto', on: true }] });
  let i = 0, win = null;
  const waveLog = [], every = Math.max(1, Math.round(0.1 / S.dt)), stop = C.RUN_WAVES + (opts.endless || 0);
  let firstMerge = null, souls20 = null, earned10 = null, earned20 = null;
  while (S.phase !== 'lost' && S.t < maxT + (opts.endless ? 3600 : 0)) {
    if (S.phase === 'won') { win = Math.round(S.stats.time); if (!opts.endless) break; SIM.step(S, { cmds: [{ k: 'endless' }, { k: 'call' }] }); continue; }
    if (S.endless && S.phase === 'prep' && S.wave >= stop) break;
    if (!S.endless && S.t >= maxT) break;
    const cmds = (i++ % every === 0) ? bot(S, mem) : null;          // бот «кликает» 10 раз в секунду
    const w = S.wave;
    SIM.step(S, cmds ? { cmds } : null);
    if (S.wave !== w) { waveLog.push({ wave: w, t: +S.t.toFixed(0), hp: S.hp, souls: S.souls });
      if (S.wave === 11) earned10 = S.stats.earned; if (S.wave === C.RUN_WAVES) { souls20 = S.souls; earned20 = S.stats.earned; } }
    if (firstMerge === null && S.stats.merges) firstMerge = S.wave;
  }
  const grimSpent = SIM.grimLines(S).reduce((a, l) => a + l.costs.slice(0, l.step).reduce((x, y) => x + y, 0), 0);
  // firstMerge — после какой волны первое слияние; souls20 — душ на руках к началу последней волны; earned10/20 — заработано к 10-й и 20-й
  return { phase: win !== null ? 'won' : S.phase, end: S.phase, wave: S.wave, hp: S.hp, t: Math.round(S.t), win, kills: S.stats.kills, souls: S.souls, grim: grimSpent,
    merges: S.stats.merges || 0, firstMerge, souls20, earned10, earned20,
    relics: S.relics.slice(), towers: S.towers.filter(Boolean).map((t) => t.type[0] + SIM.steps(t) + '*'.repeat(SIM.perksOf(t).length)).join(' '), waveLog };
};
