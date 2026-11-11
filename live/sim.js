// live/sim.js — «Некрополис»: детерминированная симуляция tower defense (всё, что ПРОИСХОДИТ).
// Числа берутся из live/config.js. Состояние — простой JSON (сейв и sessionStorage). Шаг фиксированный, DT = 1/120.
// Ввод: inp.cmds = [{k:'build',slot,type} | {k:'upgrade',slot} | {k:'perk',slot,p} | {k:'sell',slot} | {k:'call'}].
(function () {
  const C = (typeof window !== 'undefined' && window.CONFIG) || require('./config.js');
  const DT = 1 / 120, CELL = C.CELL, W = 1600, H = 900;

  // ---------------------------------------------------------------- путь: Catmull-Rom → полилиния с длиной дуги
  const catmull = (pts, n) => {
    const P = [pts[0], ...pts, pts[pts.length - 1]], out = [];
    for (let i = 1; i < P.length - 2; i++) {
      const [p0, p1, p2, p3] = [P[i - 1], P[i], P[i + 1], P[i + 2]];
      for (let k = 0; k < n; k++) {
        const t = k / n, t2 = t * t, t3 = t2 * t;
        out.push([0, 1].map((j) => 0.5 * (2 * p1[j] + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3)));
      }
    }
    out.push(pts[pts.length - 1]);
    return out;
  };
  const PTS = catmull(C.PATH, 12), PS = [0];
  for (let i = 1; i < PTS.length; i++) PS.push(PS[i - 1] + Math.hypot(PTS[i][0] - PTS[i - 1][0], PTS[i][1] - PTS[i - 1][1]));
  const PATH_LEN = PS[PS.length - 1];
  // позиция и касательная на расстоянии d от ворот
  const posAt = (d) => {
    d = Math.max(0, Math.min(PATH_LEN, d));
    let lo = 0, hi = PS.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (PS[m] <= d) lo = m; else hi = m; }
    const seg = PS[hi] - PS[lo] || 1, u = (d - PS[lo]) / seg, a = PTS[lo], b = PTS[hi];
    const tx = (b[0] - a[0]) / seg, ty = (b[1] - a[1]) / seg;
    return { x: a[0] + (b[0] - a[0]) * u, y: a[1] + (b[1] - a[1]) * u, tx, ty };
  };
  // ближайшая точка пути (для тестов и подсказок покрытия)
  const distToPath = (x, y) => { let best = 1e9; for (const p of PTS) best = Math.min(best, Math.hypot(p[0] - x, p[1] - y)); return best; };

  // ---------------------------------------------------------------- случайность (mulberry32, состояние в S.rs)
  const rand = (S) => { let t = (S.rs = (S.rs + 0x6D2B79F5) >>> 0); t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

  // ---------------------------------------------------------------- помощники
  const TW = C.TOWERS, EN = C.ENEMIES;
  const slotOf = (i) => C.SLOTS[i];
  const towerStat = (tw, key) => { const v = TW[tw.type][key]; return Array.isArray(v) ? v[tw.lvl - 1] : v; };
  const rangePx = (tw) => towerStat(tw, 'range') * CELL;
  // точка, откуда башня стреляет (одна функция для сима и сцены): над основанием, на высоте «ствола»
  const MUZZLE = { bones: 58, spirits: 70, plague: 44, dark: 92 };
  const muzzle = (tw) => { const s = slotOf(tw.slot); return [s.x, s.y - MUZZLE[tw.type] - (tw.lvl - 1) * 4]; };
  const upgradeCost = (tw) => (tw.lvl < 3 ? TW[tw.type].cost[tw.lvl] : null);
  const sellValue = (tw) => Math.floor(tw.invested * C.SELL_REFUND);
  const waveCount = () => C.WAVES.length;
  const ev = (S, k, o) => { S.ev.push(Object.assign({ k, t: S.t }, o || {})); };

  const create = (seed) => ({
    v: C.VERSION, t: 0, rs: (seed === undefined ? 1234567 : seed) >>> 0,
    souls: C.START_SOULS, hp: C.CRYPT_HP, wave: 0, phase: 'prep', prepT: -1, waveT: 0, qi: 0, queue: [],
    towers: C.SLOTS.map(() => null), enemies: [], shots: [], clouds: [], beams: [], ev: [], nid: 1,
    stats: { kills: 0, earned: 0, leaked: 0, spent: 0, time: 0 }, seen: {},
  });

  // ---------------------------------------------------------------- команды игрока
  const canAfford = (S, c) => S.souls >= c;
  const pay = (S, c) => { S.souls -= c; S.stats.spent += c; };
  const doCmd = (S, c) => {
    if (S.phase === 'won' || S.phase === 'lost') return;
    const tw = c.slot !== undefined ? S.towers[c.slot] : null;
    if (c.k === 'build') {
      const def = TW[c.type]; if (!def || tw || !slotOf(c.slot) || !canAfford(S, def.cost[0])) return;
      pay(S, def.cost[0]);
      S.towers[c.slot] = { id: S.nid++, slot: c.slot, type: c.type, lvl: 1, perk: null, cd: 0.4, invested: def.cost[0], kills: 0, dmg: 0, fireT: -9, aim: 0, built: S.t };
      ev(S, 'build', { slot: c.slot, type: c.type, x: slotOf(c.slot).x, y: slotOf(c.slot).y });
    } else if (c.k === 'upgrade') {
      if (!tw || tw.lvl >= 3) return; const cost = upgradeCost(tw); if (!canAfford(S, cost)) return;
      pay(S, cost); tw.lvl++; tw.invested += cost; tw.built = S.t;
      ev(S, 'upgrade', { slot: c.slot, lvl: tw.lvl, x: slotOf(c.slot).x, y: slotOf(c.slot).y });
    } else if (c.k === 'perk') {
      if (!tw || tw.lvl < 3 || tw.perk) return; const p = TW[tw.type].perks[c.p]; if (!p || !canAfford(S, p.cost)) return;
      pay(S, p.cost); tw.perk = c.p; tw.invested += p.cost; tw.built = S.t;
      ev(S, 'perk', { slot: c.slot, p: c.p, x: slotOf(c.slot).x, y: slotOf(c.slot).y });
    } else if (c.k === 'sell') {
      if (!tw) return; const v = sellValue(tw); S.souls += v; S.towers[c.slot] = null;
      ev(S, 'sell', { slot: c.slot, souls: v, type: tw.type, x: slotOf(c.slot).x, y: slotOf(c.slot).y });
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
    placeEnemy(e, 0);
    S.enemies.push(e);
    if (!S.seen[type]) { S.seen[type] = 1; ev(S, 'newEnemy', { type }); }
    if (def.boss) ev(S, 'boss', { x: e.x, y: e.y, name: e.name });
    return e;
  };
  const placeEnemy = (e, moved) => {
    const p = posAt(e.d); e.x = p.x - p.ty * e.lane; e.y = p.y + p.tx * e.lane;
    if (Math.abs(p.tx) > 0.25) e.face = p.tx > 0 ? 1 : -1; e.walk += moved;
  };

  // ---------------------------------------------------------------- урон и смерть
  const damage = (S, e, amt, type, tw, opt) => {
    if (e.dead || amt <= 0) return 0;
    const def = EN[e.type];
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
    for (const t of S.towers) if (t && t.type === 'dark' && t.perk === 'harvest') {
      const s = slotOf(t.slot); if (Math.hypot(e.x - s.x, e.y - s.y) <= rangePx(t)) { const g = TW.dark.perks.harvest.souls; S.souls += g; S.stats.earned += g; ev(S, 'harvest', { x: e.x, y: e.y, souls: g, slot: t.slot }); }
    }
    for (const key in e.poison) { const p = e.poison[key], t = S.towers[p.slot];
      if (p.chain && t && t.type === 'plague' && t.perk === 'pestilence') { const pk = TW.plague.perks.pestilence;
        S.clouds.push({ x: e.x, y: e.y, r: pk.cloudR * CELL, t: pk.cloudTime, T: pk.cloudTime, dps: towerStat(t, 'dps'), slot: t.slot, chain: false, acid: false });
        ev(S, 'cloud', { x: e.x, y: e.y, small: true }); break; } }
    if (def.spawnOnDeath) for (let i = 0; i < def.spawnOnDeath.n; i++) { const m = spawnEnemy(S, def.spawnOnDeath.type, Math.max(0, e.d - 12 - 16 * i)); m.lane = (i ? 1 : -1) * 9; placeEnemy(m, 0); }
  };

  // ---------------------------------------------------------------- башни
  const inRange = (S, tw) => { const s = slotOf(tw.slot), r = rangePx(tw), out = [];
    for (const e of S.enemies) if (!e.dead && Math.hypot(e.x - s.x, e.y - s.y) <= r) out.push(e); return out; };
  const firstOf = (list) => list.reduce((b, e) => (!b || e.d > b.d ? e : b), null);
  const fire = (S, tw) => {
    const cand = inRange(S, tw); if (!cand.length) return false;
    const def = TW[tw.type], [mx, my] = muzzle(tw);
    if (tw.type === 'bones') {
      const dmg = towerStat(tw, 'dmg');
      if (tw.perk === 'volley') {
        const pk = def.perks.volley, ts = cand.sort((a, b) => b.d - a.d).slice(0, pk.bolts);
        ts.forEach((e, i) => S.shots.push({ k: 'bolt', x: mx, y: my, tid: e.id, dmg: dmg * pk.mult, sp: def.boltSpeed, slot: tw.slot, lx: e.x, ly: e.y, n: i }));
        tw.aim = Math.atan2(ts[0].y - my, ts[0].x - mx);
      } else {
        const e = firstOf(cand); tw.aim = Math.atan2(e.y - my, e.x - mx);
        if (tw.perk === 'pierce') {
          const fl = Math.hypot(e.x - mx, e.y - my) / def.boltSpeed, p = posAt(e.d + EN[e.type].speed * fl);
          const a = Math.atan2(p.y - my, p.x - mx); tw.aim = a;
          S.shots.push({ k: 'bolt', x: mx, y: my, dx: Math.cos(a), dy: Math.sin(a), left: rangePx(tw) * 1.3, dmg, sp: def.boltSpeed, slot: tw.slot, pierce: def.perks.pierce.targets, hit: [] });
        } else S.shots.push({ k: 'bolt', x: mx, y: my, tid: e.id, dmg, sp: def.boltSpeed, slot: tw.slot, lx: e.x, ly: e.y });
      }
    } else if (tw.type === 'spirits') {
      const e = firstOf(cand); tw.aim = Math.atan2(e.y - my, e.x - mx);
      S.shots.push({ k: 'ghost', x: mx, y: my, tid: e.id, dmg: towerStat(tw, 'dmg'), sp: def.ghostSpeed, slot: tw.slot, lx: e.x, ly: e.y,
        bounces: tw.perk === 'pack' ? def.perks.pack.bounces : 0, hit: [], born: S.t, seed: rand(S) });
    } else if (tw.type === 'plague') {
      const e = firstOf(cand), fl = def.flight, p = posAt(e.d + EN[e.type].speed * (e.slowT > 0 ? 1 - e.slowK : 1) * fl * 0.85);
      S.shots.push({ k: 'blob', x0: mx, y0: my, x1: p.x, y1: p.y, x: mx, y: my, T: 0, dur: fl, slot: tw.slot });
    } else if (tw.type === 'dark') {
      const e = cand.reduce((b, x) => (!b || x.hp > b.hp ? x : b), null), heavy = EN[e.type].heavy ? def.heavyMult : 1;
      tw.aim = Math.atan2(e.y - my, e.x - mx);
      if (tw.perk === 'curse') e.curseT = def.perks.curse.time;
      damage(S, e, towerStat(tw, 'dmg') * heavy, 'magic', tw, { ignoreMres: true });
      S.beams.push({ x0: mx, y0: my, x1: e.x, y1: e.y - 14, t: S.t, slot: tw.slot });
    }
    tw.fireT = S.t; ev(S, 'fire', { slot: tw.slot, type: tw.type, x: mx, y: my });
    return true;
  };

  const findEnemy = (S, id) => { for (const e of S.enemies) if (e.id === id) return e; return null; };
  const stepShots = (S) => {
    const keep = [];
    for (const s of S.shots) {
      const tw = S.towers[s.slot];
      if (s.k === 'blob') {
        s.T += DT; const u = Math.min(1, s.T / s.dur);
        s.x = s.x0 + (s.x1 - s.x0) * u; s.y = s.y0 + (s.y1 - s.y0) * u - Math.sin(Math.PI * u) * 70;
        if (u >= 1) { const def = TW.plague, dps = tw ? towerStat(tw, 'dps') : def.dps[0];
          S.clouds.push({ x: s.x1, y: s.y1, r: def.cloudR * CELL, t: def.cloudTime, T: def.cloudTime, dps, slot: s.slot, chain: true, acid: !!(tw && tw.perk === 'acid') });
          ev(S, 'cloud', { x: s.x1, y: s.y1 }); continue; }
        keep.push(s); continue;
      }
      if (s.pierce !== undefined) {                                   // прямой пронзающий болт
        const st = s.sp * DT; s.x += s.dx * st; s.y += s.dy * st; s.left -= st;
        for (const e of S.enemies) if (!e.dead && s.hit.length < s.pierce && !s.hit.includes(e.id) && Math.hypot(e.x - s.x, e.y - 14 - s.y) < 18) {
          damage(S, e, s.dmg * (1 - TW.bones.perks.pierce.falloff * s.hit.length), 'phys', tw); s.hit.push(e.id); ev(S, 'hit', { x: e.x, y: e.y - 14, kind: 'bolt' }); }
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
              let nb = null, nd = def.perks.pack.bounceRange * CELL;
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
    for (const e of S.enemies) { e.aura = 0; for (const b of bosses) if (b !== e && Math.hypot(b.x - e.x, b.y - e.y) <= EN[b.type].auraR * CELL) e.aura = EN[b.type].aura; }
    // враги: статусы, лечение, движение
    for (const e of S.enemies) {
      if (e.dead) continue; const def = EN[e.type];
      if (e.slowT > 0) { e.slowT -= DT; if (e.slowT <= 0) e.slowK = 0; }
      if (e.freezeT > 0) e.freezeT -= DT;
      if (e.curseT > 0) e.curseT -= DT;
      if (e.shredT > 0) { e.shredT -= DT; if (e.shredT <= 0) e.shred = 0; }
      for (const key in e.poison) { const p = e.poison[key]; damage(S, e, p.dps * DT, 'poison', S.towers[p.slot]); p.t -= DT; if (p.t <= 0) delete e.poison[key]; if (e.dead) break; }
      if (e.dead) continue;
      if (def.heal) { e.healCD -= DT; if (e.healCD <= 0) { e.healCD = def.healEvery; const amt = def.heal * C.HP_MULT(S.wave); let any = false;
        const hurt = S.enemies.filter((o) => !o.dead && !EN[o.type].boss && o.hp < o.max && S.t - (o.healedT || -9) >= def.healLock && Math.hypot(o.x - e.x, o.y - e.y) <= def.healR * CELL)
          .sort((p, q) => p.hp / p.max - q.hp / q.max || p.id - q.id).slice(0, def.healTargets);
        for (const o of hurt) { o.hp = Math.min(o.max, o.hp + amt); o.healedT = S.t; any = true; }
        ev(S, 'heal', { x: e.x, y: e.y, any }); } }
      const v = e.freezeT > 0 ? 0 : def.speed * (e.slowT > 0 ? 1 - e.slowK : 1);
      e.d += v * DT; placeEnemy(e, v * DT);
      if (e.d >= PATH_LEN) { e.dead = true; e.leaked = true; S.hp = Math.max(0, S.hp - def.leak); S.stats.leaked += def.leak; ev(S, 'leak', { x: C.CRYPT[0], y: C.CRYPT[1], dmg: def.leak, boss: !!def.boss }); }
    }
    // облака яда
    for (const c of S.clouds) {
      c.t -= DT; const tw = S.towers[c.slot];
      for (const e of S.enemies) if (!e.dead && Math.hypot(e.x - c.x, (e.y - c.y) * 1.4) <= c.r) {
        const key = 'p' + c.slot, old = e.poison[key];
        e.poison[key] = { dps: Math.max(c.dps, old ? old.dps : 0), t: TW.plague.poisonLinger, slot: c.slot, chain: c.chain || (old ? old.chain : false) };
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

  // ---------------------------------------------------------------- демо (титульный экран): кадр как на референсе, волна 9
  const DEMO_BUILD = [[0, 'bones', 2], [2, 'spirits', 2], [4, 'plague', 2], [5, 'dark', 2], [6, 'plague', 2], [9, 'bones', 2], [10, 'spirits', 2],
    [8, 'dark', 2], [11, 'bones', 2], [12, 'dark', 2], [13, 'spirits', 2], [15, 'plague', 1], [17, 'dark', 2]];
  const demoState = () => {
    const S = create(99); S.souls = 99999; S.demo = true;
    for (const [slot, type, lvl] of DEMO_BUILD) { doCmd(S, { k: 'build', slot, type }); for (let l = 1; l < lvl; l++) doCmd(S, { k: 'upgrade', slot }); }
    S.wave = 8; startWave(S); S.souls = 340; S.hp = 16; S.ev = [];
    return S;
  };
  const LOOP = 60;
  let cache = null;
  const at = (t) => {
    const loop = Math.floor(t / LOOP), lt = t - loop * LOOP;
    const WARM = 46;                                   // прогрев: стартуем с середины волны, чтобы кадр был заполнен как на скрине
    if (!cache || cache.loop !== loop || cache.S.t - WARM > lt + 1e-9) {
      const S0 = demoState(); for (let i = 0; i < 120 * WARM; i++) step(S0, null); S0.ev = [];
      cache = { loop, S: S0 };
    }
    const S = cache.S;
    while (S.t - WARM + DT <= lt) { step(S, null); if (S.phase === 'prep') { S.prepT = 0.01; S.wave = 8; } S.souls = 340; S.hp = 16; }
    return Object.assign({}, S, { loop });
  };

  // ---------------------------------------------------------------- самопроверка уровня (tune.cjs и тесты)
  const selfCheck = () => {
    const f = [];
    if (C.SLOTS.length !== 18) f.push('площадок не 18: ' + C.SLOTS.length);
    for (const s of C.SLOTS) {
      const d = distToPath(s.x, s.y); if (d < C.ROAD_HALF + C.SLOT_R) f.push(`площадка ${s.id} на дороге (${d.toFixed(0)})`);
      for (const o of C.SLOTS) if (o.id > s.id && Math.hypot(o.x - s.x, o.y - s.y) < 2 * C.SLOT_R + 6) f.push(`площадки ${s.id} и ${o.id} перекрываются`);
    }
    const end = posAt(PATH_LEN); if (Math.hypot(end.x - C.CRYPT[0], end.y - C.CRYPT[1]) > 30) f.push('путь не доходит до склепа');
    if (C.WAVES.length !== 25) f.push('волн не 25');
    return f;
  };
  // доля пути (в ед.), которую площадка покрывает радиусом r клеток
  const coverage = (slot, cells) => { const s = slotOf(slot), r = cells * CELL; let n = 0; for (let d = 0; d < PATH_LEN; d += 4) { const p = posAt(d); if (Math.hypot(p.x - s.x, p.y - s.y) <= r) n += 4; } return n; };

  const SIM = {
    DT, VIEW: { W, H }, L: LOOP, HINT: '', CONFIG: C, PATH_LEN, PTS, posAt, distToPath, coverage, muzzle, rangePx, towerStat, upgradeCost, sellValue,
    create, step, at, selfCheck, doCmd, waveCount, MUZZLE,
    spawn: () => create(), outOfPlay: () => false,
  };
  if (typeof module !== 'undefined') module.exports = SIM;
  if (typeof window !== 'undefined') window.SIM = SIM;
})();
