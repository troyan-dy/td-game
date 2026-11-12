// live/sim.js — «Некрополис»: детерминированная симуляция tower defense (всё, что ПРОИСХОДИТ).
// Числа берутся из live/config.js, карта — из live/mapgen.js по сиду забега. Состояние — простой JSON (сейв и sessionStorage).
// Шаг времени — параметр забега (S.dt), по умолчанию C.DT. Клетка адресуется индексом i = y * cols + x.
// Особые клетки карты дают бонус башне на них (C.SPECIAL): он берётся от текущей клетки башни при каждом расчёте (cellBonus).
// Создание: create(seed, { dt, unlocked }). Ввод: inp.cmds = [{k:'build',cell,type} | {k:'upgrade',cell} | {k:'perk',cell,p} | {k:'sell',cell} | {k:'call'}].
(function () {
  const C = (typeof window !== 'undefined' && window.CONFIG) || require('./config.js');
  const MAPGEN = (typeof window !== 'undefined' && window.MAPGEN) || require('./mapgen.js');
  const RNG = (typeof window !== 'undefined' && window.RNG) || require('./rng.js');
  const UNIT = C.UNIT, W = 1600, H = 900;

  // ---------------------------------------------------------------- маршрут врагов: полилиния карты с длиной дуги (кэш по объекту карты)
  const ROUTES = new WeakMap();
  const routeOf = (map) => {
    let r = ROUTES.get(map); if (r) return r;
    const pts = MAPGEN.route(map), ps = [0], n = pts.length;
    for (let i = 1; i < n; i++) ps.push(ps[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    // касательная в вершинах — среднее соседних отрезков: смещённые по полосе враги поворачивают плавно, без скачков на изломах
    const dir = (i) => { const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i)], l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return [(b[0] - a[0]) / l, (b[1] - a[1]) / l]; };
    const tan = pts.map((_, i) => { const a = dir(i === 0 ? 1 : i), b = dir(i === n - 1 ? n - 1 : i + 1), x = a[0] + b[0], y = a[1] + b[1], l = Math.hypot(x, y) || 1; return [x / l, y / l]; });
    r = { pts, ps, tan, len: ps[n - 1], gate: MAPGEN.cellXY(map, map.road[0]), crypt: MAPGEN.cellXY(map, map.road[map.road.length - 1]) };
    ROUTES.set(map, r); return r;
  };
  const pathLen = (S) => routeOf(S.map).len;
  // позиция и касательная на расстоянии d от входа
  const posAt = (S, d) => {
    const R = routeOf(S.map), PS = R.ps, PTS = R.pts;
    d = Math.max(0, Math.min(R.len, d));
    let lo = 0, hi = PS.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (PS[m] <= d) lo = m; else hi = m; }
    const seg = PS[hi] - PS[lo] || 1, u = (d - PS[lo]) / seg, a = PTS[lo], b = PTS[hi], ta = R.tan[lo], tb = R.tan[hi];
    const x = ta[0] + (tb[0] - ta[0]) * u, y = ta[1] + (tb[1] - ta[1]) * u, l = Math.hypot(x, y) || 1;
    return { x: a[0] + (b[0] - a[0]) * u, y: a[1] + (b[1] - a[1]) * u, tx: x / l, ty: y / l };
  };

  // ---------------------------------------------------------------- случайность боя: поток 'battle' от сида забега, состояние в S.rs
  const rand = (S) => RNG.next(S, 'rs');

  // ---------------------------------------------------------------- помощники
  const TW = C.TOWERS, EN = C.ENEMIES;
  const cellXY = (S, i) => MAPGEN.cellXY(S.map, i);
  const cellCount = (S) => S.map.cols * S.map.rows;
  const towerStat = (tw, key) => { const v = TW[tw.type][key]; return Array.isArray(v) ? v[tw.lvl - 1] : v; };
  // бонус особой клетки: { kind, name, desc, range?, souls?, dmg?, cost? } или null. Всегда от клетки, где башня стоит сейчас
  const cellBonus = (S, cell) => { const k = MAPGEN.special(S.map, cell); return k ? Object.assign({ kind: k }, C.SPECIAL[k]) : null; };
  const bonusOf = (S, cell, key) => { const b = cellBonus(S, cell); return (b && b[key]) || 0; };
  // итоговый радиус башни (с бонусом клетки), px
  const rangePx = (S, tw) => (towerStat(tw, 'range') + bonusOf(S, tw.cell, 'range')) * UNIT;
  const rangeTiles = (units) => units * UNIT / C.GRID.tile;          // радиус в клетках сетки (для подписей)
  // точка, откуда башня стреляет (одна функция для сима и сцены): над основанием, на высоте «ствола»
  const MUZZLE = { bones: 58, spirits: 70, plague: 44, dark: 92 };
  const muzzle = (S, tw) => { const [x, y] = cellXY(S, tw.cell); return [x, y - MUZZLE[tw.type] - (tw.lvl - 1) * 4]; };
  // башня по id: снаряды, облака и яд помнят башню, а не клетку (перенос и слияние не путают, чей урон). Индекс строится лениво
  // и сбрасывается в начале каждого шага и после каждой команды: башни, изменённые между шагами, в нём не залеживаются.
  let IDX = null, IDX_S = null;
  const towerOf = (S, id) => {
    if (IDX_S !== S) { IDX = new Map(); for (const t of S.towers) if (t) IDX.set(t.id, t); IDX_S = S; }
    return IDX.get(id) || null; };
  const dropIndex = () => { IDX_S = null; };
  const upgradeCost = (tw) => (tw.lvl < 3 ? TW[tw.type].cost[tw.lvl] : null);
  const sellValue = (tw) => Math.floor(tw.invested * C.SELL_REFUND);
  const waveCount = () => C.WAVES.length;
  const ev = (S, k, o) => { S.ev.push(Object.assign({ k, t: S.t }, o || {})); };

  // seed — сид забега (карта и случайность боя); opts.dt — шаг времени; opts.unlocked — открытые id (null — открыто всё)
  const create = (seed, opts) => {
    seed = (seed === undefined ? 1234567 : seed) >>> 0; opts = opts || {};
    const map = MAPGEN.generate(seed);
    return {
      v: C.VERSION, seed, dt: opts.dt || C.DT, unlocked: opts.unlocked || null, map,
      t: 0, rs: RNG.seed(seed, 'battle'),
      souls: C.START_SOULS, hp: C.CRYPT_HP, wave: 0, phase: 'prep', prepT: -1, waveT: 0, qi: 0, queue: [],
      towers: new Array(map.cols * map.rows).fill(null), enemies: [], shots: [], clouds: [], beams: [], ev: [], nid: 1,
      stats: { kills: 0, earned: 0, leaked: 0, spent: 0, time: 0 }, seen: {},
    };
  };

  // ---------------------------------------------------------------- ответы интерфейсу
  // можно ли строить: { ok, reason: null | 'bounds' | 'road' | 'hud' | 'obstacle' | 'occupied' | 'type' | 'locked' | 'ended' | 'souls', cost }
  // cost — цена постройки на этой клетке с наценкой особой клетки (её и списывает команда build)
  const canBuild = (S, cell, type) => {
    const def = TW[type], inside = cell >= 0 && cell < cellCount(S) && cell === Math.floor(cell);
    const cost = def ? Math.round(def.cost[0] * (1 + (inside ? bonusOf(S, cell, 'cost') : 0))) : null, no = (reason) => ({ ok: false, reason, cost });
    if (!inside) return no('bounds');
    if (S.map.road.includes(cell)) return no('road');
    if (MAPGEN.hud(S.map, cell)) return no('hud');
    if (MAPGEN.obstacle(S.map, cell)) return no('obstacle');
    if (S.towers[cell]) return no('occupied');
    if (!def) return no('type');
    if (S.unlocked && !S.unlocked.includes(type)) return no('locked');
    if (S.phase === 'won' || S.phase === 'lost') return no('ended');
    if (S.souls < cost) return no('souls');
    return { ok: true, reason: null, cost };
  };
  // радиус будущей башни типа type на клетке cell, px (круг превью постройки)
  const buildRangePx = (S, cell, type) => (TW[type].range[0] + bonusOf(S, cell, 'range')) * UNIT;
  // годно ли состояние для продолжения (сейв, sessionStorage): текущая версия, годная карта, все поля на месте
  const loadable = (S) => {
    try {
      if (!S || typeof S !== 'object' || S.v !== C.VERSION || !S.map || MAPGEN.validate(S.map).length) return false;
      const num = (v) => typeof v === 'number' && Number.isFinite(v), arr = Array.isArray;
      return num(S.seed) && num(S.dt) && S.dt > 0 && S.dt <= C.DT_MAX && num(S.t) && num(S.rs) && num(S.souls) && num(S.hp) && num(S.wave) && num(S.nid)
        && ['prep', 'wave', 'won', 'lost'].includes(S.phase) && arr(S.towers) && S.towers.length === cellCount(S)
        && arr(S.enemies) && arr(S.shots) && arr(S.clouds) && arr(S.beams) && arr(S.ev) && arr(S.queue)
        && !!S.stats && typeof S.stats === 'object' && !!S.seen && typeof S.seen === 'object';
    } catch (e) { return false; }
  };
  // длина дороги (px), которую башня на клетке накрывает радиусом units
  const coverage = (S, cell, units) => { const [x, y] = cellXY(S, cell), r = units * UNIT, L = pathLen(S); let n = 0;
    for (let d = 0; d < L; d += 4) { const p = posAt(S, d); if (Math.hypot(p.x - x, p.y - y) <= r) n += 4; } return n; };
  // свободные клетки по убыванию покрытия дороги (боты, демо, подсказки)
  const rankCells = (S, units) => { const out = [];
    for (let i = 0; i < cellCount(S); i++) if (!S.map.road.includes(i) && !S.towers[i] && !MAPGEN.hud(S.map, i) && !MAPGEN.obstacle(S.map, i)) out.push([i, coverage(S, i, units)]);
    return out.sort((a, b) => b[1] - a[1] || a[0] - b[0]).map((c) => c[0]); };

  // ---------------------------------------------------------------- команды игрока
  const canAfford = (S, c) => S.souls >= c;
  const pay = (S, c) => { S.souls -= c; S.stats.spent += c; };
  const doCmd = (S, c) => {
    if (S.phase === 'won' || S.phase === 'lost') return;
    dropIndex();
    const tw = c.cell >= 0 && c.cell < cellCount(S) ? S.towers[c.cell] : null, at = tw ? cellXY(S, c.cell) : null;
    if (c.k === 'build') {
      const cb = canBuild(S, c.cell, c.type); if (!cb.ok) return;
      const [x, y] = cellXY(S, c.cell);
      pay(S, cb.cost);
      S.towers[c.cell] = { id: S.nid++, cell: c.cell, type: c.type, lvl: 1, perk: null, cd: 0.4, invested: cb.cost, kills: 0, dmg: 0, fireT: -9, aim: 0, built: S.t };
      ev(S, 'build', { cell: c.cell, type: c.type, x, y });
    } else if (c.k === 'upgrade') {
      if (!tw || tw.lvl >= 3) return; const cost = upgradeCost(tw); if (!canAfford(S, cost)) return;
      pay(S, cost); tw.lvl++; tw.invested += cost; tw.built = S.t;
      ev(S, 'upgrade', { cell: c.cell, lvl: tw.lvl, x: at[0], y: at[1] });
    } else if (c.k === 'perk') {
      if (!tw || tw.lvl < 3 || tw.perk) return; const p = TW[tw.type].perks[c.p]; if (!p || !canAfford(S, p.cost)) return;
      pay(S, p.cost); tw.perk = c.p; tw.invested += p.cost; tw.built = S.t;
      ev(S, 'perk', { cell: c.cell, p: c.p, x: at[0], y: at[1] });
    } else if (c.k === 'sell') {
      if (!tw) return; const v = sellValue(tw); S.souls += v; S.towers[c.cell] = null;
      ev(S, 'sell', { cell: c.cell, souls: v, type: tw.type, x: at[0], y: at[1] });
    } else if (c.k === 'call') {
      if (S.phase === 'prep' && S.wave < waveCount()) startWave(S);
    }
  };

  // ---------------------------------------------------------------- волны
  const startWave = (S) => {
    S.wave++; S.phase = 'wave'; S.waveT = 0; S.qi = 0; S.prepT = 0;
    const q = [];
    for (const g of C.WAVES[S.wave - 1]) for (let i = 0; i < g.n; i++) q.push({ at: g.at + i * g.gap, e: g.e });
    q.sort((a, b) => a.at - b.at || (a.e < b.e ? -1 : 1));
    S.queue = q;
    ev(S, 'wave', { wave: S.wave, boss: !!C.BOSSES[S.wave] });
  };
  const spawnEnemy = (S, type, d) => {
    const def = EN[type], w = Math.max(1, S.wave), boss = def.boss ? C.BOSSES[w] || { hp: def.hp, bounty: def.bounty, name: def.name } : null;
    const hp = boss ? boss.hp : Math.round(def.hp * C.HP_MULT(w));
    const e = { id: S.nid++, type, d: d || 0, hp, max: hp, bounty: boss ? boss.bounty : Math.round(def.bounty * C.BOUNTY_MULT(w)),
      lane: (rand(S) - 0.5) * (def.size > 1.5 ? 6 : 16), slowK: 0, slowT: 0, freezeT: 0, curseT: 0, shred: 0, shredT: 0, poison: {},
      healCD: (def.healEvery || 0) * rand(S), hitT: -9, x: 0, y: 0, face: 1, walk: 0, aura: 0, name: boss ? boss.name : def.name };
    placeEnemy(S, e, 0);
    S.enemies.push(e);
    if (!S.seen[type]) { S.seen[type] = 1; ev(S, 'newEnemy', { type }); }
    if (def.boss) ev(S, 'boss', { x: e.x, y: e.y, name: e.name });
    return e;
  };
  const placeEnemy = (S, e, moved) => {
    const p = posAt(S, e.d); e.x = p.x - p.ty * e.lane; e.y = p.y + p.tx * e.lane;
    if (Math.abs(p.tx) > 0.25) e.face = p.tx > 0 ? 1 : -1; e.walk += moved;
  };

  // ---------------------------------------------------------------- урон и смерть
  const damage = (S, e, amt, type, tw, opt) => {
    if (e.dead || amt <= 0) return 0;
    const def = EN[e.type];
    if (tw) amt *= 1 + bonusOf(S, tw.cell, 'dmg');                    // проклятая земля: бонус урона любой атаки башни, включая яд
    if (type === 'phys') amt *= 1 - Math.min(0.9, Math.max(0, def.armor + e.aura - e.shred));
    else if (type === 'magic' && !(opt && opt.ignoreMres)) amt *= 1 - def.mres;
    if (e.curseT > 0) amt *= 1 + TW.dark.perks.curse.mult;
    e.hp -= amt; if (type !== 'poison') e.hitT = S.t;
    if (tw) tw.dmg += amt;
    if (e.hp <= 0) kill(S, e, tw);
    return amt;
  };
  const kill = (S, e, tw) => {
    e.dead = true; const def = EN[e.type];
    S.souls += e.bounty; S.stats.kills++; S.stats.earned += e.bounty; if (tw) tw.kills++;
    ev(S, 'die', { x: e.x, y: e.y, type: e.type, souls: e.bounty, face: e.face, boss: !!def.boss });
    const well = tw ? bonusOf(S, tw.cell, 'souls') : 0;                // источник душ под башней-убийцей
    if (well) { S.souls += well; S.stats.earned += well; const [wx, wy] = cellXY(S, tw.cell); ev(S, 'well', { x: wx, y: wy - 40, souls: well, cell: tw.cell }); }
    for (const t of S.towers) if (t && t.type === 'dark' && t.perk === 'harvest') {
      const [sx, sy] = cellXY(S, t.cell); if (Math.hypot(e.x - sx, e.y - sy) <= rangePx(S, t)) { const g = TW.dark.perks.harvest.souls; S.souls += g; S.stats.earned += g; ev(S, 'harvest', { x: e.x, y: e.y, souls: g, cell: t.cell }); }
    }
    for (const key in e.poison) { const p = e.poison[key], t = towerOf(S, p.tw);
      if (p.chain && t && t.type === 'plague' && t.perk === 'pestilence') { const pk = TW.plague.perks.pestilence;
        S.clouds.push({ x: e.x, y: e.y, r: pk.cloudR * UNIT, t: pk.cloudTime, T: pk.cloudTime, dps: towerStat(t, 'dps'), tw: t.id, chain: false, acid: false });
        ev(S, 'cloud', { x: e.x, y: e.y, small: true }); break; } }
    if (def.spawnOnDeath) for (let i = 0; i < def.spawnOnDeath.n; i++) { const m = spawnEnemy(S, def.spawnOnDeath.type, Math.max(0, e.d - 12 - 16 * i)); m.lane = (i ? 1 : -1) * 9; placeEnemy(S, m, 0); }
  };

  // ---------------------------------------------------------------- башни
  const inRange = (S, tw) => { const [sx, sy] = cellXY(S, tw.cell), r = rangePx(S, tw), out = [];
    for (const e of S.enemies) if (!e.dead && Math.hypot(e.x - sx, e.y - sy) <= r) out.push(e); return out; };
  const firstOf = (list) => list.reduce((b, e) => (!b || e.d > b.d ? e : b), null);
  const fire = (S, tw) => {
    const cand = inRange(S, tw); if (!cand.length) return false;
    const def = TW[tw.type], [mx, my] = muzzle(S, tw);
    if (tw.type === 'bones') {
      const dmg = towerStat(tw, 'dmg');
      if (tw.perk === 'volley') {
        const pk = def.perks.volley, ts = cand.sort((a, b) => b.d - a.d).slice(0, pk.bolts);
        ts.forEach((e, i) => S.shots.push({ k: 'bolt', x: mx, y: my, tid: e.id, dmg: dmg * pk.mult, sp: def.boltSpeed, tw: tw.id, lx: e.x, ly: e.y, n: i }));
        tw.aim = Math.atan2(ts[0].y - my, ts[0].x - mx);
      } else {
        const e = firstOf(cand); tw.aim = Math.atan2(e.y - my, e.x - mx);
        if (tw.perk === 'pierce') {
          const fl = Math.hypot(e.x - mx, e.y - my) / def.boltSpeed, p = posAt(S, e.d + EN[e.type].speed * fl);
          const a = Math.atan2(p.y - my, p.x - mx); tw.aim = a;
          S.shots.push({ k: 'bolt', x: mx, y: my, dx: Math.cos(a), dy: Math.sin(a), left: rangePx(S, tw) * 1.3, dmg, sp: def.boltSpeed, tw: tw.id, pierce: def.perks.pierce.targets, hit: [] });
        } else S.shots.push({ k: 'bolt', x: mx, y: my, tid: e.id, dmg, sp: def.boltSpeed, tw: tw.id, lx: e.x, ly: e.y });
      }
    } else if (tw.type === 'spirits') {
      const e = firstOf(cand); tw.aim = Math.atan2(e.y - my, e.x - mx);
      S.shots.push({ k: 'ghost', x: mx, y: my, tid: e.id, dmg: towerStat(tw, 'dmg'), sp: def.ghostSpeed, tw: tw.id, lx: e.x, ly: e.y,
        bounces: tw.perk === 'pack' ? def.perks.pack.bounces : 0, hit: [], born: S.t, seed: rand(S) });
    } else if (tw.type === 'plague') {
      const e = firstOf(cand), fl = def.flight, p = posAt(S, e.d + EN[e.type].speed * (e.slowT > 0 ? 1 - e.slowK : 1) * fl * 0.85);
      S.shots.push({ k: 'blob', x0: mx, y0: my, x1: p.x, y1: p.y, x: mx, y: my, T: 0, dur: fl, tw: tw.id });
    } else if (tw.type === 'dark') {
      const e = cand.reduce((b, x) => (!b || x.hp > b.hp ? x : b), null), heavy = EN[e.type].heavy ? def.heavyMult : 1;
      tw.aim = Math.atan2(e.y - my, e.x - mx);
      if (tw.perk === 'curse') e.curseT = def.perks.curse.time;
      damage(S, e, towerStat(tw, 'dmg') * heavy, 'magic', tw, { ignoreMres: true });
      S.beams.push({ x0: mx, y0: my, x1: e.x, y1: e.y - 14, t: S.t, tw: tw.id });
    }
    tw.fireT = S.t; ev(S, 'fire', { cell: tw.cell, type: tw.type, x: mx, y: my });
    return true;
  };

  const findEnemy = (S, id) => { for (const e of S.enemies) if (e.id === id) return e; return null; };
  const stepShots = (S) => {
    const keep = [], DT = S.dt;
    for (const s of S.shots) {
      const tw = towerOf(S, s.tw);
      if (s.k === 'blob') {
        s.T += DT; const u = Math.min(1, s.T / s.dur);
        s.x = s.x0 + (s.x1 - s.x0) * u; s.y = s.y0 + (s.y1 - s.y0) * u - Math.sin(Math.PI * u) * 70;
        if (u >= 1) { const def = TW.plague, dps = tw ? towerStat(tw, 'dps') : def.dps[0];
          S.clouds.push({ x: s.x1, y: s.y1, r: def.cloudR * UNIT, t: def.cloudTime, T: def.cloudTime, dps, tw: s.tw, chain: true, acid: !!(tw && tw.perk === 'acid') });
          ev(S, 'cloud', { x: s.x1, y: s.y1 }); continue; }
        keep.push(s); continue;
      }
      if (s.pierce !== undefined) {                                   // прямой пронзающий болт
        // крупный шаг дробится на отрезки не длиннее шага по умолчанию: при C.DT проверка та же, при 1/30 болт не проскакивает врага
        const st = s.sp * DT, n = Math.max(1, Math.ceil(DT / C.DT - 1e-9)), sub = st / n;
        for (let k = 0; k < n && s.hit.length < s.pierce; k++) {
          s.x += s.dx * sub; s.y += s.dy * sub; s.left -= sub;
          for (const e of S.enemies) if (!e.dead && s.hit.length < s.pierce && !s.hit.includes(e.id) && Math.hypot(e.x - s.x, e.y - 14 - s.y) < 18) {
            damage(S, e, s.dmg * (1 - TW.bones.perks.pierce.falloff * s.hit.length), 'phys', tw); s.hit.push(e.id); ev(S, 'hit', { x: e.x, y: e.y - 14, kind: 'bolt' }); }
        }
        if (s.left > 0 && s.hit.length < s.pierce && s.x > -50 && s.x < W + 50 && s.y > -50 && s.y < H + 50) keep.push(s);
        continue;
      }
      const e = findEnemy(S, s.tid);
      if (e && !e.dead) { s.lx = e.x; s.ly = e.y - 14; }
      const dx = s.lx - s.x, dy = s.ly - s.y, d = Math.hypot(dx, dy), st = s.sp * DT;
      if (d <= st + 4) {
        if (e && !e.dead) {
          if (s.k === 'bolt') { damage(S, e, s.dmg, 'phys', tw); ev(S, 'hit', { x: s.lx, y: s.ly, kind: 'bolt' }); }
          else {                                                       // призрак: урон + замедление (+ перки)
            const def = TW.spirits, lvl = tw ? tw.lvl : 1;
            damage(S, e, s.dmg, 'magic', tw);
            const k = def.slow[lvl - 1]; if (k >= e.slowK || e.slowT <= 0) { e.slowK = k; } e.slowT = def.slowTime;
            if (tw && tw.perk === 'frost' && rand(S) < def.perks.frost.chance && !EN[e.type].boss) { e.freezeT = def.perks.frost.freeze; ev(S, 'freeze', { x: e.x, y: e.y }); }
            ev(S, 'hit', { x: s.lx, y: s.ly, kind: 'ghost' });
            s.hit.push(e.id);
            if (s.bounces > 0) {
              let nb = null, nd = def.perks.pack.bounceRange * UNIT;
              for (const o of S.enemies) if (!o.dead && !s.hit.includes(o.id)) { const dd = Math.hypot(o.x - e.x, o.y - e.y); if (dd < nd) { nd = dd; nb = o; } }
              if (nb) { s.bounces--; s.tid = nb.id; s.dmg *= def.perks.pack.bounceMult; s.lx = nb.x; s.ly = nb.y - 14; keep.push(s); continue; }
            }
          }
        }
        continue;
      }
      s.x += dx / d * st; s.y += dy / d * st;
      if (s.k === 'ghost' && (!e || e.dead) && d < 6) continue;
      keep.push(s);
    }
    S.shots = keep;
  };

  // ---------------------------------------------------------------- шаг
  const step = (S, inp) => {
    const DT = S.dt;
    dropIndex();
    if (inp && inp.cmds) for (const c of inp.cmds) doCmd(S, c);
    S.t += DT;
    if (S.phase === 'won' || S.phase === 'lost') { pruneEv(S); return; }
    S.stats.time += DT;
    if (S.phase === 'prep' && S.prepT > 0) { S.prepT -= DT; if (S.prepT <= 0) startWave(S); }
    if (S.phase === 'wave') {
      S.waveT += DT;
      while (S.qi < S.queue.length && S.queue[S.qi].at <= S.waveT) spawnEnemy(S, S.queue[S.qi++].e, 0);
    }
    // ауры паладинов
    const bosses = S.enemies.filter((e) => !e.dead && EN[e.type].aura);
    for (const e of S.enemies) { e.aura = 0; for (const b of bosses) if (b !== e && Math.hypot(b.x - e.x, b.y - e.y) <= EN[b.type].auraR * UNIT) e.aura = EN[b.type].aura; }
    // враги: статусы, лечение, движение
    for (const e of S.enemies) {
      if (e.dead) continue; const def = EN[e.type];
      if (e.slowT > 0) { e.slowT -= DT; if (e.slowT <= 0) e.slowK = 0; }
      if (e.freezeT > 0) e.freezeT -= DT;
      if (e.curseT > 0) e.curseT -= DT;
      if (e.shredT > 0) { e.shredT -= DT; if (e.shredT <= 0) e.shred = 0; }
      for (const key in e.poison) { const p = e.poison[key]; damage(S, e, p.dps * DT, 'poison', towerOf(S, p.tw)); p.t -= DT; if (p.t <= 0) delete e.poison[key]; if (e.dead) break; }
      if (e.dead) continue;
      if (def.heal) { e.healCD -= DT; if (e.healCD <= 0) { e.healCD = def.healEvery; const amt = def.heal * C.HP_MULT(S.wave); let any = false;
        const hurt = S.enemies.filter((o) => !o.dead && !EN[o.type].boss && o.hp < o.max && S.t - (o.healedT || -9) >= def.healLock && Math.hypot(o.x - e.x, o.y - e.y) <= def.healR * UNIT)
          .sort((p, q) => p.hp / p.max - q.hp / q.max || p.id - q.id).slice(0, def.healTargets);
        for (const o of hurt) { o.hp = Math.min(o.max, o.hp + amt); o.healedT = S.t; any = true; }
        ev(S, 'heal', { x: e.x, y: e.y, any }); } }
      const v = e.freezeT > 0 ? 0 : def.speed * (e.slowT > 0 ? 1 - e.slowK : 1);
      e.d += v * DT; placeEnemy(S, e, v * DT);
      if (e.d >= pathLen(S)) { const [cx, cy] = routeOf(S.map).crypt;
        e.dead = true; e.leaked = true; S.hp = Math.max(0, S.hp - def.leak); S.stats.leaked += def.leak; ev(S, 'leak', { x: cx, y: cy, dmg: def.leak, boss: !!def.boss }); }
    }
    // облака яда
    for (const c of S.clouds) {
      c.t -= DT; const tw = towerOf(S, c.tw);
      for (const e of S.enemies) if (!e.dead && Math.hypot(e.x - c.x, (e.y - c.y) * 1.4) <= c.r) {
        const key = 'p' + c.tw, old = e.poison[key];
        e.poison[key] = { dps: Math.max(c.dps, old ? old.dps : 0), t: TW.plague.poisonLinger, tw: c.tw, chain: c.chain || (old ? old.chain : false) };
        if (c.acid) { e.shred = TW.plague.perks.acid.shred; e.shredT = TW.plague.perks.acid.shredTime; }
      }
      if (!tw && c.t > 0.5) c.t = 0.5;
    }
    S.clouds = S.clouds.filter((c) => c.t > 0);
    // башни
    for (const tw of S.towers) { if (!tw) continue; tw.cd -= DT; if (tw.cd <= 0) { if (fire(S, tw)) tw.cd = towerStat(tw, 'rate'); else tw.cd = 0.05; } }
    stepShots(S);
    S.enemies = S.enemies.filter((e) => !e.dead);
    S.beams = S.beams.filter((b) => S.t - b.t < 0.35);
    // конец волны / партии
    if (S.hp <= 0 && S.phase !== 'lost') { S.phase = 'lost'; ev(S, 'lose', {}); }
    else if (S.phase === 'wave' && S.qi >= S.queue.length && !S.enemies.length) {
      const bonus = C.WAVE_BONUS(S.wave); S.souls += bonus; S.stats.earned += bonus;
      ev(S, 'waveClear', { wave: S.wave, bonus });
      if (S.wave >= waveCount()) { S.phase = 'won'; ev(S, 'win', {}); }
      else { S.phase = 'prep'; S.prepT = C.PREP_TIME; }
    }
    pruneEv(S);
  };
  const pruneEv = (S) => { if (S.ev.length > 300 || (S.ev.length && S.t - S.ev[0].t > 4)) S.ev = S.ev.filter((e) => S.t - e.t < 4).slice(-300); };

  // ---------------------------------------------------------------- демо (титульный экран): сгенерированная карта, оборона на лучших клетках, волна 9
  const DEMO_SEED = 99;
  const DEMO_BUILD = [['bones', 2], ['dark', 2], ['plague', 2], ['spirits', 2], ['dark', 2], ['bones', 2], ['plague', 2],
    ['spirits', 2], ['dark', 2], ['bones', 2], ['plague', 1], ['spirits', 2], ['dark', 2]];
  const demoState = () => {
    const S = create(DEMO_SEED), best = rankCells(S, 3.4); S.souls = 99999; S.demo = true;
    for (const [i, [type, lvl]] of DEMO_BUILD.entries()) { const cell = best[i];
      doCmd(S, { k: 'build', cell, type }); for (let l = 1; l < lvl; l++) doCmd(S, { k: 'upgrade', cell }); }
    S.wave = 8; startWave(S); S.souls = 340; S.hp = 16; S.ev = [];
    return S;
  };
  const LOOP = 60, WARM_ENEMIES = 10, WARM_MAX = 40;
  // шаг демо: зачищенная волна сразу начинается заново (prepT = шаг: таймер дойдёт до нуля на следующем шаге), души и прочность не меняются
  const demoStep = (S) => { step(S, null); if (S.phase === 'prep') { S.wave = 8; S.prepT = S.dt; } S.souls = 340; S.hp = 16; };
  let cache = null;
  const at = (t) => {
    const loop = Math.floor(t / LOOP), lt = t - loop * LOOP;
    if (!cache || cache.loop !== loop || cache.S.t - cache.warm > lt + 1e-9) {
      // прогрев: пока на дороге не наберётся WARM_ENEMIES врагов, чтобы первый кадр был заполнен
      const S0 = demoState(); while (S0.t < WARM_MAX && S0.enemies.length < WARM_ENEMIES) demoStep(S0); S0.ev = [];
      cache = { loop, S: S0, warm: S0.t };
    }
    const S = cache.S;
    while (S.t - cache.warm + S.dt <= lt) demoStep(S);
    return Object.assign({}, S, { loop });
  };

  // ---------------------------------------------------------------- самопроверка карты (tune.cjs и тесты): список нарушений
  const selfCheck = (S) => MAPGEN.validate((S || create()).map);

  const SIM = {
    VIEW: { W, H }, L: LOOP, HINT: '', CONFIG: C, MAPGEN,
    create, step, at, selfCheck, doCmd, waveCount, MUZZLE,
    canBuild, buildRangePx, cellBonus, loadable, coverage, rankCells, cellXY, routeOf, pathLen, posAt, muzzle, rangePx, rangeTiles, towerStat, upgradeCost, sellValue,
    spawn: () => create(), outOfPlay: () => false,
  };
  if (typeof module !== 'undefined') module.exports = SIM;
  if (typeof window !== 'undefined') window.SIM = SIM;
})();
