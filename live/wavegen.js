// live/wavegen.js — генератор волн «Некрополиса»: волна n — чистые данные от сида забега и номера, без симуляции и DOM.
// Случайность — свой поток RNG.stream(seed, 'waves', n): волна не зависит ни от боя, ни от соседних волн.
// Числа — в конфиге (C.WAVEGEN, C.TRAITS, поля threat/minWave/weight/gap/ability у C.ENEMIES); код свойства по имени не различает.
//
// WAVEGEN.wave(seed, n) → описание волны (оно же превью для разведки и вход модели баланса):
//   { n, boss, bossName, budget, threat, trait: null | { id, name, desc, mods },
//     squads: [{ type, count, at, gap, name, hp, armor, mres, speed, bounty, leak, heal, ability, boss }],
//     extra:  [{ type, count, from, …характеристики }]  — кто выходит из убитых (ополченцы из повозок),
//     stats:  { тип: характеристики в этой волне },   total: { count, extra, hp, bounty, leak }, bonus, duration }
// WAVEGEN.queue(wave) → [{ at, e }] — порядок выхода на дорогу; WAVEGEN.stats(type, n, traitId) — характеристики типа;
// WAVEGEN.isBoss(n) — волна с боссом.
(function () {
  const C = (typeof window !== 'undefined' && window.CONFIG) || require('./config.js');
  const RNG = (typeof window !== 'undefined' && window.RNG) || require('./rng.js');
  const WG = C.WAVEGEN, EN = C.ENEMIES, TR = C.TRAITS;
  const r2 = (v) => Math.round(v * 100) / 100;

  const isBoss = (n) => n > 0 && n % WG.bossEvery === 0;
  const mods = (id) => (id && TR[id]) || {};
  const mul = (m, k) => (m[k] === undefined ? 1 : m[k]);

  // характеристики типа на волне n со свойством traitId: множители волны, затем свойства; босс — по своей формуле
  const stats = (type, n, traitId) => {
    const d = EN[type], m = mods(traitId), boss = !!d.boss, k = Math.max(1, n);
    const s = {
      name: boss ? WG.bossNames[Math.min(WG.bossNames.length, Math.max(1, Math.round(k / WG.bossEvery))) - 1] : d.name,
      hp: boss ? WG.bossHp(k) : Math.round(d.hp * C.HP_MULT(k) * mul(m, 'hp')),
      armor: r2(Math.min(0.9, d.armor + (m.armor || 0))), mres: r2(Math.min(0.9, d.mres + (m.mres || 0))),
      speed: r2(d.speed * mul(m, 'speed')),
      bounty: boss ? WG.bossBounty(k) : Math.round(d.bounty * C.BOUNTY_MULT(k) * mul(m, 'bounty')),
      leak: d.leak, heal: d.heal ? Math.round(d.heal * C.HP_MULT(k) * mul(m, 'heal')) : 0, boss,
    };
    s.ability = ability(d, s);
    return s;
  };
  // строка способности: {поле} — из характеристик волны, иначе из описания врага (путь через точку); {поле%} — в процентах
  const ability = (d, s) => (d.ability || '').replace(/\{([\w.]+?)(%?)\}/g, (_, key, pct) => {
    let v = key in s ? s[key] : key.split('.').reduce((o, p) => (o == null ? o : o[p]), d);
    if (typeof v !== 'number') return '?';
    return pct ? String(Math.round(v * 100)) : String(v); });

  // порядок без повторов по весам (ключ −ln(u)/w)
  const weighted = (pairs, R) => pairs.map(([v, w]) => [v, -Math.log(1 - R()) / w]).sort((a, b) => a[1] - b[1]).map((p) => p[0]);
  const pickCount = (R) => { const tot = WG.squads.reduce((a, [, w]) => a + w, 0); let u = R() * tot;
    for (const [k, w] of WG.squads) { if ((u -= w) < 0) return k; } return WG.squads[WG.squads.length - 1][0]; };

  const wave = (seed, n) => {
    seed = seed >>> 0; n = Math.max(1, Math.floor(n));
    const R = RNG.stream(seed, 'waves', n), boss = isBoss(n), budget = WG.budget(n);
    // свойство
    let traitId = null;
    if (!boss && n >= WG.traitFrom) {
      const roll = R(), ids = Object.keys(TR).filter((id) => (TR[id].minWave || 1) <= n), which = R();
      if (roll < WG.traitChance && ids.length) traitId = ids[Math.floor(which * ids.length)];
    }
    const m = mods(traitId), B = budget * (boss ? WG.bossEscort : 1) * mul(m, 'budget');
    // отряды: типы, доступные к этой волне, по весам; свойство может добавить свой тип с долей бюджета
    const pool = Object.keys(EN).filter((k) => !EN[k].boss && EN[k].minWave <= n);
    const chosen = weighted(pool.map((k) => [k, EN[k].weight || 1]), R).slice(0, Math.min(pool.length, pickCount(R)));
    const forced = Object.entries(m.share || {}).filter(([k]) => pool.includes(k));
    for (const [k] of forced) if (!chosen.includes(k)) chosen.push(k);
    const free = chosen.filter((k) => !forced.some(([f]) => f === k));
    const fShare = forced.reduce((a, [, v]) => a + v, 0), w = free.map(() => WG.share[0] + R() * (WG.share[1] - WG.share[0])), wSum = w.reduce((a, b) => a + b, 0);
    const shareOf = (k) => { const f = forced.find(([x]) => x === k); if (f) return free.length ? f[1] : 1; return (1 - fShare) * w[free.indexOf(k)] / wSum; };
    let cnt = chosen.map((k) => Math.floor(shareOf(k) * B / EN[k].threat));
    let types = chosen.filter((_, i) => cnt[i] > 0); cnt = cnt.filter((c) => c > 0);
    if (!types.length) { types = ['militia']; cnt = [0]; }
    // остаток бюджета — самому дешёвому отряду
    const spent = () => types.reduce((a, k, i) => a + cnt[i] * EN[k].threat, 0);
    const cheap = types.reduce((b, k, i) => (EN[k].threat < EN[types[b]].threat ? i : b), 0);
    cnt[cheap] += Math.floor((B - spent()) / EN[types[cheap]].threat + 1e-9);
    if (cnt[cheap] < 1) cnt[cheap] = 1;
    // расписание: дешёвые отряды открывают волну, остальные вступают позже
    const order = types.map((k, i) => [k, cnt[i]]).sort((a, b) => EN[a[0]].threat - EN[b[0]].threat || (a[0] < b[0] ? -1 : 1));
    const squads = []; let first = 0;
    for (const [k, c] of order) {
      const gap = r2(EN[k].gap * WG.pace(n) * mul(m, 'gap'));
      const at = squads.length ? r2(R() * WG.stagger * first) : 0;
      if (!squads.length) first = (c - 1) * gap;
      squads.push(Object.assign({ type: k, count: c, at, gap }, stats(k, n, traitId)));
    }
    const endOf = (q) => q.at + (q.count - 1) * q.gap;
    let duration = Math.max(...squads.map(endOf)), bossName = null;
    if (boss) { const b = Object.assign({ type: WG.bossType, count: 1, at: r2(WG.bossAt * duration), gap: 1 }, stats(WG.bossType, n, null));
      squads.push(b); bossName = b.name; duration = Math.max(duration, b.at); }
    // кто выходит из убитых и характеристики всех типов волны
    const st = {}; for (const q of squads) st[q.type] = stats(q.type, n, traitId);
    const extra = [];
    for (const q of squads) { const sp = EN[q.type].spawnOnDeath; if (!sp) continue;
      if (!st[sp.type]) st[sp.type] = stats(sp.type, n, traitId);
      const ex = extra.find((x) => x.type === sp.type);
      if (ex) ex.count += q.count * sp.n; else extra.push(Object.assign({ type: sp.type, count: q.count * sp.n, from: q.type }, st[sp.type])); }
    const sum = (arr, f) => arr.reduce((a, q) => a + q.count * f(q), 0);
    const threat = sum(squads.filter((q) => !q.boss), (q) => EN[q.type].threat);
    return {
      n, boss, bossName, budget, threat,
      trait: traitId ? { id: traitId, name: TR[traitId].name, desc: TR[traitId].desc, mods: modsOf(traitId) } : null,
      squads, extra, stats: st,
      total: { count: sum(squads, () => 1), extra: sum(extra, () => 1), hp: sum(squads, (q) => q.hp) + sum(extra, (q) => q.hp),
        bounty: sum(squads, (q) => q.bounty) + sum(extra, (q) => q.bounty), leak: sum(squads, (q) => q.leak) },
      bonus: C.WAVE_BONUS(n), duration: r2(duration),
    };
  };
  // числовые поля свойства (без имени и описания) — их показывает разведка
  const modsOf = (id) => { const o = {}; for (const [k, v] of Object.entries(TR[id])) if (k !== 'name' && k !== 'desc' && k !== 'minWave') o[k] = v; return o; };

  // порядок выхода на дорогу: по времени, при равенстве — по типу
  const queue = (w) => { const q = [];
    for (const g of w.squads) for (let i = 0; i < g.count; i++) q.push({ at: r2(g.at + i * g.gap), e: g.type });
    return q.sort((a, b) => a.at - b.at || (a.e < b.e ? -1 : a.e > b.e ? 1 : 0)); };

  const WAVEGEN = { wave, queue, stats, isBoss };
  if (typeof module !== 'undefined') module.exports = WAVEGEN;
  if (typeof window !== 'undefined') window.WAVEGEN = WAVEGEN;
})();
