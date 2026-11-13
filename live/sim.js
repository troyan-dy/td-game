// live/sim.js — «Некрополис»: детерминированная симуляция tower defense (всё, что ПРОИСХОДИТ).
// Числа берутся из live/config.js, карта — из live/mapgen.js, волны — из live/wavegen.js по сиду забега. Состояние — простой JSON (сейв и sessionStorage).
// Шаг времени — параметр забега (S.dt), по умолчанию C.DT. Клетка адресуется индексом i = y * cols + x.
// Особые клетки карты дают бонус башне на них (C.SPECIAL): он берётся от текущей клетки башни при каждом расчёте (cellBonus).
// Создание: create(seed, { dt, unlocked }). Ввод: inp.cmds = [{k:'build',cell,type} | {k:'upgrade',cell,track} | {k:'perk',cell,p} | {k:'sell',cell} | {k:'call'}].
// Перенос: {k:'move',cell,to} — башня с клетки cell на клетку to, только в паузе между волнами (SIM.canMove, SIM.moveCells).
// Слияние: {k:'merge',cell,other} — башня с клетки other становится примесью башни на cell, только в паузе между волнами
// (SIM.canMerge, SIM.mergeTargets, превью SIM.mergeInfo; описание стоящего гибрида — SIM.hybridInfo). Счётчик — S.stats.merges.
// Гримуар: {k:'grim',line} — ступень линии общей прокачки в любой фазе (SIM.grimLines, SIM.canGrim); ступени — в S.grim.
// Конец забега: победа на последней волне (C.RUN_WAVES) — фаза 'won'; {k:'endless'} после неё (SIM.canEndless) продолжает забег
// в бесконечном режиме (S.endless): волны идут дальше без предела (SIM.lastWave), забег кончается только поражением.
// Реликвии (C.RELICS): после волн, где положена реликвия (relicDue), забег в фазе 'relic' стоит, пока не выбрана реликвия
// {k:'relic',i} — номер в предложении S.offer (SIM.relicOffer); взятые — S.relics (SIM.relicsOf). Взята ли — только hasRelic.
// Скелеты Казармы — S.skels (раздел «скелеты»): держат врагов на дороге; без своей башни рассыпаются.
(function () {
  const C = (typeof window !== 'undefined' && window.CONFIG) || require('./config.js');
  const MAPGEN = (typeof window !== 'undefined' && window.MAPGEN) || require('./mapgen.js');
  const RNG = (typeof window !== 'undefined' && window.RNG) || require('./rng.js');
  const WAVEGEN = (typeof window !== 'undefined' && window.WAVEGEN) || require('./wavegen.js');
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
  // имя из команды или сейва — ключ данных, только если это строка и собственное поле объекта: 'constructor', '__proto__',
  // 'toString' и массивы ключами не бывают
  const own = (o, k) => typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k);
  const typeDef = (type) => (own(TW, type) ? TW[type] : null);
  // все перки всех типов по id (id уникальны: гибрид хранит перки обоих своих типов)
  const PERKS = {};
  for (const type of Object.keys(TW)) for (const id of Object.keys(TW[type].perks)) {
    if (own(PERKS, id)) throw new Error(`перк ${id} есть у ${PERKS[id].type} и у ${type}: id перков должны быть уникальны`);
    PERKS[id] = { type, def: TW[type].perks[id] }; }
  const perkDef = (id) => (own(PERKS, id) ? PERKS[id].def : null);
  // действует ли перк id на башне: перк с needs — только при этом виде атаки (у гибрида — атака первой башни), остальные — всегда
  const perkOn = (tw, id) => { const pd = perkDef(id); return !!pd && (!pd.needs || pd.needs === TW[tw.type].attack); };
  // реликвии: id из конфига (в его порядке — от него зависит выбор по сиду); открытое — общий список с башнями
  const RL = C.RELICS, RELIC_IDS = Object.keys(RL);
  for (const id of RELIC_IDS) if (own(TW, id)) throw new Error(`реликвия ${id} совпадает по id с башней: список открытого общий`);
  const hasRelic = (S, id) => S.relics.includes(id);                 // единственная проверка «взята ли реликвия»
  const relicSum = (S, key) => { let n = 0; for (const id of S.relics) n += RL[id][key] || 0; return n; };   // числовые реликвии: сумма поля по взятым
  // предложение после волны n: до C.RELIC_OFFER открытых и не взятых, от сида и номера волны (поток 'relics') — ход боя не влияет
  const drawRelics = (seed, n, taken, unlocked) => {
    const pool = RELIC_IDS.filter((id) => !taken.includes(id) && (!unlocked || unlocked.includes(id))), R = RNG.stream(seed, 'relics', n);
    for (let i = 0; i < Math.min(C.RELIC_OFFER, pool.length); i++) { const j = i + Math.floor(R() * (pool.length - i)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    return pool.slice(0, C.RELIC_OFFER); };
  // перк открывается с этой суммы ступеней (Раннее озарение — раньше)
  const perkAt = (S) => (hasRelic(S, 'insight') ? RL.insight.perkAt : C.PERK_AT);
  // перки с наградой за убийство в радиусе (harvest): только для башен с ними смерть врага считает характеристики
  const KILL_PERKS = new Set(Object.keys(PERKS).filter((id) => PERKS[id].def.set && 'harvest' in PERKS[id].def.set));
  const cellXY = (S, i) => MAPGEN.cellXY(S.map, i);
  const cellCount = (S) => S.map.cols * S.map.rows;
  // бонус особой клетки: { kind, name, desc, range?, souls?, dmg?, cost? } или null. Всегда от клетки, где башня стоит сейчас
  const cellBonus = (S, cell) => { const k = MAPGEN.special(S.map, cell); return k ? Object.assign({ kind: k }, C.SPECIAL[k]) : null; };
  // одно число бонуса (range, souls, dmg, cost) — без промежуточных объектов
  const bonusOf = (S, cell, key) => { const k = MAPGEN.special(S.map, cell); return k ? C.SPECIAL[k][key] || 0 : 0; };
  const towerAt = (S, cell) => (cell >= 0 && cell < cellCount(S) && S.towers[cell]) || null;
  const ended = (S) => S.phase === 'won' || S.phase === 'lost';

  // ---------------------------------------------------------------- башня
  // Поля башни: type, cell; tracks {dmg, range, rate} — ступени веток; cap — потолок ступеней этой башни;
  // perks — взятые перки (id), slots — сколько перков башня может держать (обычная — C.PERK_SLOTS, гибрид — C.MERGE.slots);
  // mix — тип второй башни у гибрида (её примесь), у обычной башни null: гибрид — башня с mix, повторно не сливается;
  // после постройки ещё id, invested (всё вложенное: постройка, ступени, перки, у гибрида — обе башни и слияние), kills,
  // dmg (нанесённый урон) и служебные cd, fireT, aim, built, raiseT (когда гибрид с примесью Казармы последний раз поднял скелета). Перки читаются только через hasPerk / freeSlots / perksOf.
  const fresh = (cell, type) => ({ cell, type, tracks: Object.fromEntries(C.TRACKS.map((k) => [k, 0])), cap: C.TRACK_MAX, perks: [], slots: C.PERK_SLOTS, mix: null });
  const steps = (tw) => C.TRACKS.reduce((n, k) => n + tw.tracks[k], 0);
  const look = (tw) => 1 + C.LOOK_AT.filter((n) => steps(tw) >= n).length;
  const perksOf = (tw) => tw.perks.slice();
  const hasPerk = (tw, p) => tw.perks.includes(p);
  const freeSlots = (tw) => Math.max(0, tw.slots - tw.perks.length);
  const isHybrid = (tw) => !!tw && tw.mix !== null && tw.mix !== undefined;
  // перки, из которых башня выбирает: группы { type, ids } — у обычной и у гибрида одинаковых типов одна, у гибрида разных — две
  const perkGroups = (tw) => (isHybrid(tw) && tw.mix !== tw.type ? [tw.type, tw.mix] : [tw.type]).map((type) => ({ type, ids: Object.keys(TW[type].perks) }));
  // Гримуар: линии из C.GRIMOIRE — общие по веткам (id = ветка) и по одной на тип (id = тип). Ступень линии — S.grim[id],
  // ступеней — сколько цен. { id, group: 'all' | 'type', type, track — какую ветку усиливает, k — доля за ступень, cost }
  const GRIM = C.TRACKS.map((id) => Object.assign({ id, group: 'all', type: null, track: id }, C.GRIMOIRE.all[id]))
    .concat(C.TOWER_ORDER.map((type) => Object.assign({ id: type, group: 'type', type }, C.GRIMOIRE.type, TW[type].grim || {})));
  const GRIM_BY = {};
  for (const l of GRIM) { if (own(GRIM_BY, l.id)) throw new Error(`линия Гримуара ${l.id} повторяется: id веток и типов должны различаться`); GRIM_BY[l.id] = l; }
  const grimStep = (S, id) => (S.grim && S.grim[id]) || 0;
  // доли прибавки Гримуара к веткам башни типа type: { dmg, range, rate } — общие линии плюс линия типа
  const grimBonus = (S, type) => { const b = Object.fromEntries(C.TRACKS.map((k) => [k, 0]));
    for (const l of GRIM) if (l.group === 'all' || l.type === type) b[l.track] += l.k * grimStep(S, l.id);
    return b; };
  // Характеристики башни считаются только здесь, в два явных этапа; стрельба, снаряды, панель и подсказки читают результат.
  //  ownStats   — СВОИ: база типа → ветки (основные dmg/range/rate и прибавки also к extra) → примесь гибрида (add её типа)
  //               → действующие перки башни (set — из двух установок одной характеристики большая, затем mul, затем add).
  //               От них считаются эффекты, которые башня даёт другим (аура Алтаря берёт свои характеристики соседа, а не
  //               итоговые — иначе два алтаря рядом зациклились бы).
  //  towerStats — ИТОГОВЫЕ: свои плюс внешние бонусы (externalBonus: клетка, аура соседей, Гримуар, реликвии).
  // plus — ветка, в которую мысленно добавлена ещё одна ступень (панель показывает, что даст следующая ступень).
  // { dmg, rate (секунд между выстрелами), range (единицы UNIT), rangePx, ...extra типа, ...параметры перков }
  const ownStats = (S, tw, plus) => {
    const d = TW[tw.type], b = d.base, g = d.tracks, n = (k) => tw.tracks[k] + (plus === k ? 1 : 0);
    const o = Object.assign({}, d.extra || {}, { dmg: b.dmg * (1 + g.dmg.k * n('dmg')), range: b.range * (1 + g.range.k * n('range')), rate: b.rate / (1 + g.rate.k * n('rate')) });
    for (const k of C.TRACKS) if (g[k].also) for (const [key, v] of Object.entries(g[k].also)) o[key] = (o[key] || 0) + v * n(k);
    if (isHybrid(tw)) for (const [key, v] of Object.entries(TW[tw.mix].mix.add)) o[key] = (o[key] || 0) + v;
    const pds = tw.perks.filter((p) => perkOn(tw, p)).map(perkDef), set = {};
    for (const pd of pds) for (const [key, v] of Object.entries(pd.set || {})) set[key] = own(set, key) ? Math.max(set[key], v) : v;
    Object.assign(o, set);
    for (const pd of pds) for (const [key, v] of Object.entries(pd.mul || {})) o[key] = (o[key] || 0) * v;
    for (const pd of pds) for (const [key, v] of Object.entries(pd.add || {})) o[key] = (o[key] || 0) + v;
    o.rangePx = o.range * UNIT;
    return o;
  };
  // внешние бонусы к своим характеристикам o — единственное место для них. Сейчас — особая клетка под башней: курган
  // прибавляет дальность после веток, проклятая земля умножает итоговый урон (у облака — яд в секунду), источник душ
  // кладёт своё число (well); затем реликвии; последним Гримуар умножает ветки (grimBonus). Дальше сюда же — аура соседей (от их ownStats). Меняет o на месте.
  const externalBonus = (S, tw, o) => {
    if (tw.cell >= 0) { o.range += bonusOf(S, tw.cell, 'range'); o.dmg *= 1 + bonusOf(S, tw.cell, 'dmg'); const w = bonusOf(S, tw.cell, 'souls'); if (w) o.well = w; }
    // реликвии про башни (поле tower в C.RELICS): для своих типов (only) и своей особой клетки (on) — set, mul, add, haste
    for (const id of S.relics) { const b = RL[id].tower;
      if (!b || (b.only && !b.only.includes(tw.type)) || (b.on && (tw.cell < 0 || MAPGEN.special(S.map, tw.cell) !== b.on))) continue;
      Object.assign(o, b.set || {});
      for (const [key, v] of Object.entries(b.mul || {})) o[key] = (o[key] || 0) * v;
      for (const [key, v] of Object.entries(b.add || {})) o[key] = (o[key] || 0) + v;
      if (b.haste) o.rate /= 1 + b.haste; }
    const g = grimBonus(S, tw.type); o.dmg *= 1 + g.dmg; o.range *= 1 + g.range; o.rate /= 1 + g.rate;   // Гримуар — после клетки и реликвий
    const at = auraType(tw); if (at) auraGrim(S, at, o);                                          // Алтарь (и примесь Алтаря): сила ауры с Гримуаром
    const au = auraOn(S, tw); if (au) { o.dmg *= 1 + au.dmg; o.rate /= 1 + au.rate; o.range += au.range; o.altar = au; }   // Алтарь крови
    o.rangePx = o.range * UNIT; return o; };
  // ---- аура Алтаря крови (#8). Тип с аурой — с auraR в extra. Аура действует на башни с видом атаки на клетках не дальше
  // auraR по сетке и берётся от СВОИХ характеристик алтаря (ownStats): алтари рядом не зацикливаются, алтарь ауру не получает.
  // Несколько алтарей не складываются: по каждой прибавке (урон, скорость, дальность) — сильнейший.
  const hasAura = (type) => own(TW, type) && !!TW[type].extra && own(TW[type].extra, 'auraR');
  // чья аура у башни: тип с аурой — свой (Алтарь) или примеси (гибрид с Алтарём второй башней); null — ауры нет
  const auraType = (tw) => (hasAura(tw.type) ? tw.type : isHybrid(tw) && hasAura(tw.mix) ? tw.mix : null);
  // Гримуар у алтаря усиливает ауру: прибавка ветки dmg | range | rate — к auraDmg | auraRange | auraRate (меняет o на месте)
  const AURA_OF = { dmg: 'auraDmg', range: 'auraRange', rate: 'auraRate' };
  const auraGrim = (S, type, o) => { const g = grimBonus(S, type); for (const k of C.TRACKS) o[AURA_OF[k]] *= 1 + g[k]; return o; };
  // характеристики, от которых алтарь a даёт ауру: свои плюс Гримуар (без ауры соседей — рекурсии нет)
  const auraStats = (S, a) => auraGrim(S, auraType(a), ownStats(S, a));
  const gridDist = (S, a, b) => { const n = S.map.cols; return Math.max(Math.abs(a % n - b % n), Math.abs(Math.floor(a / n) - Math.floor(b / n))); };
  // { dmg, rate, range } — что башня tw получает от алтарей вокруг, или null
  const auraOn = (S, tw) => {
    if (!(tw.cell >= 0) || !attackOf(tw)) return null; let out = null;
    for (const a of S.towers) if (a && a !== tw && a.cell !== tw.cell && auraType(a)) { const st = auraStats(S, a);
      if (gridDist(S, a.cell, tw.cell) > st.auraR) continue;
      out = out || { dmg: 0, rate: 0, range: 0 };
      out.dmg = Math.max(out.dmg, st.auraDmg); out.rate = Math.max(out.rate, st.auraRate); out.range = Math.max(out.range, st.auraRange); }
    return out; };
  // алтарь на клетке cell: будущий типа type (превью постройки) или стоящий там (type не задан); null — там не алтарь
  const altarAt = (S, cell, type) => { if (!(cell >= 0 && cell < cellCount(S))) return null; const tw = type === undefined ? towerAt(S, cell) : own(TW, type) ? fresh(cell, type) : null; return tw && auraType(tw) ? tw : null; };
  // клетки башен, которые усилит алтарь на клетке cell (превью постройки, подсветка на карте); [] — не алтарь или некого
  const auraTargets = (S, cell, type) => { const tw = altarAt(S, cell, type), out = []; if (!tw) return out;
    const r = ownStats(S, tw).auraR;
    for (const t of S.towers) if (t && t !== tw && t.cell !== cell && attackOf(t) && gridDist(S, t.cell, cell) <= r) out.push(t.cell);
    return out; };
  // клетки поля, которые накрывает аура алтаря на клетке cell (рамка ауры на карте), с самой клеткой; [] — не алтарь
  const auraCells = (S, cell, type) => { const tw = altarAt(S, cell, type), out = []; if (!tw) return out;
    const r = ownStats(S, tw).auraR;
    for (let i = 0; i < cellCount(S); i++) if (gridDist(S, i, cell) <= r) out.push(i);
    return out; };
  const towerStats = (S, tw, plus) => externalBonus(S, tw, ownStats(S, tw, plus));
  const rangePx = (S, tw) => towerStats(S, tw).rangePx;
  // итоговые характеристики будущей башни типа type на клетке cell (подсказка карточки, меню постройки); cell -1 — без клетки
  const buildStats = (S, cell, type) => towerStats(S, fresh(cell, type));
  const rangeTiles = (units) => units * UNIT / C.GRID.tile;          // радиус в клетках сетки (для подписей)
  // Шаблон текста из данных (описания перков, строки характеристик): {key} — число, {key%} — доля в процентах,
  // {key+%} — множитель как прибавка в процентах (1.4 → 40%), {key п} — доля в пунктах (0.12 → 12), {key кл} — единицы UNIT в клетках,
  // {key /с} — интервал в секундах как частота «в секунду» (1 / v), {base:key} — значение extra типа без перков. vals — откуда брать key, base — extra типа.
  const fmtNum = (v) => String(Math.round(v * 100) / 100);
  const fill = (text, vals, base) => text.replace(/\{(base:)?(\w+)(%|\+%| п| кл| \/с)?\}/g, (m, isBase, key, f) => {
    const src = isBase ? base : vals, v = src && own(src, key) ? src[key] : undefined;
    if (typeof v !== 'number') throw new Error(`шаблон «${text}»: нет числа ${key}`);
    return f === '%' ? Math.round(v * 100) + '%' : f === '+%' ? Math.round((v - 1) * 100) + '%' : f === ' п' ? String(Math.round(v * 100)) : f === ' кл' ? rangeTiles(v).toFixed(1) + ' кл.' : f === ' /с' ? (1 / v).toFixed(2) + '/с' : fmtNum(v); });
  // описание перка с числами из его же данных (set, add, mul) и extra его типа
  // внешний вид типа: art типа поверх C.ART (сцена, интерфейс и звук берут вид только отсюда)
  const art = (type) => Object.assign({}, C.ART, (own(TW, type) && TW[type].art) || {});
  // вид стоящей башни: у гибрида — спрайт первой башни в цвете второй (её перекраска или цвет), свечение и значок примеси
  // (hybrid, icon, mixColor, mixUi, own — цвет первой); у обычной — вид типа
  const towerArt = (tw) => { const a = art(tw.type); if (!isHybrid(tw)) return a;
    const m = art(tw.mix), [k, s] = C.MERGE.tint, tint = m.tint || [m.color[0] * k, m.color[1] * k, m.color[2] * k, s];
    return Object.assign(a, { tint, css: `${a.css || ''} drop-shadow(0 0 4px ${m.ui}) drop-shadow(0 0 2px ${m.ui})`.trim(), own: a.color, color: m.color,
      hybrid: true, icon: TW[tw.mix].mix.icon, mixColor: m.color, mixUi: m.ui }); };
  // значение ветки track башни для панели — по шаблону fmt типа (или C.TRACK_FMT) из характеристик st
  const trackText = (type, track, st) => fill(((own(TW, type) && TW[type].fmt) || {})[track] || C.TRACK_FMT[track], st, (TW[type] && TW[type].extra) || {});
  const perkText = (id) => { const P = PERKS[id], pd = P.def, base = TW[P.type].extra || {};
    return fill(pd.desc, Object.assign({}, base, pd.mul || {}, pd.add || {}, pd.set || {}), base); };
  // описание примеси типа (второй башни гибрида) с числами из её данных
  const mixText = (type) => { const m = TW[type].mix; return fill(m.desc, m.add, TW[type].extra || {}); };
  // действует ли примесь гибрида на его атаке (skip — виды урона, на которых ей нечего делать)
  const mixOn = (tw) => !isHybrid(tw) || !(TW[tw.mix].mix.skip || []).includes(TW[tw.type].dmgType);
  // точка, откуда башня стреляет (одна функция для сима и сцены): над основанием, на высоте «ствола» типа (muzzle в конфиге);
  // выше с каждым видом, но не выше линии HUD (C.VIEW_TOP), под которую сцена ужимает высокие башни верхнего ряда
  const muzzleH = (tw) => TW[tw.type].muzzle + (look(tw) - 1) * C.LOOK_MUZZLE;
  const muzzle = (S, tw) => { const [x, y] = cellXY(S, tw.cell); return [x, Math.max(C.VIEW_TOP, y - muzzleH(tw))]; };
  // башня по id: снаряды, облака и яд помнят башню, а не клетку (перенос и слияние не путают, чей урон). Индекс строится лениво
  // и сбрасывается в начале каждого шага и после каждой команды: башни, изменённые между шагами, в нём не залеживаются.
  let IDX = null, IDX_S = null;
  const towerOf = (S, id) => {
    if (IDX_S !== S) { IDX = new Map(); for (const t of S.towers) if (t) IDX.set(t.id, t); IDX_S = S; }
    return IDX.get(id) || null; };
  const dropIndex = () => { IDX_S = null; };
  // сколько вернёт продажа (Честная сделка — всё вложенное); без S — обычная доля
  const sellValue = (tw, S) => Math.floor(tw.invested * (S && hasRelic(S, 'deal') ? RL.deal.refund : C.SELL_REFUND));
  const waveCount = () => C.RUN_WAVES;                                       // волн в обычном забеге (победа на последней)
  const lastWave = (S) => (S.endless ? Infinity : C.RUN_WAVES);           // последняя волна этого забега: в бесконечном режиме предела нет
  const canEndless = (S) => S.phase === 'won' && !S.endless;
  // положена ли реликвия после волны n: волны забега из C.RELIC.waves, в бесконечном режиме — каждая endlessEvery-я
  const relicDue = (n) => (n > C.RUN_WAVES ? n % C.RELIC.endlessEvery === 0 : C.RELIC.waves.includes(n));
  const isBoss = (n) => WAVEGEN.isBoss(n);
  const ev = (S, k, o) => { S.ev.push(Object.assign({ k, t: S.t }, o || {})); };

  // seed — сид забега (карта и случайность боя); opts.dt — шаг времени; opts.unlocked — открытые id (null — открыто всё)
  const create = (seed, opts) => {
    seed = (seed === undefined ? 1234567 : seed) >>> 0; opts = opts || {};
    const map = MAPGEN.generate(seed);
    return {
      v: C.VERSION, seed, dt: opts.dt || C.DT, unlocked: opts.unlocked || null, map,
      t: 0, rs: RNG.seed(seed, 'battle'),
      souls: C.START_SOULS, hp: C.CRYPT_HP, wave: 0, phase: 'prep', endless: false, prepT: -1, waveT: 0, qi: 0, queue: [],
      towers: new Array(map.cols * map.rows).fill(null), enemies: [], shots: [], clouds: [], beams: [], ev: [], nid: 1, skels: [],
      stats: { kills: 0, earned: 0, leaked: 0, spent: 0, time: 0, merges: 0 }, seen: {}, waveStats: null,
      wonStats: null,                                                       // счётчики на момент победы (время победы — для рекордов)
      relics: [], offer: null, waveMoved: 0,       // взятые реликвии, предложение (только в фазе 'relic'), волна последнего переноса посреди боя
      grim: Object.fromEntries(GRIM.map((l) => [l.id, 0])),
    };
  };

  // ---------------------------------------------------------------- ответы интерфейсу
  // можно ли поставить башню на клетку — сама клетка, без типа и цены (общее для постройки и переноса):
  // null — можно, иначе причина 'bounds' | 'road' | 'hud' | 'obstacle' | 'occupied'
  const cellBlock = (S, cell) => {
    if (!(cell >= 0 && cell < cellCount(S)) || cell !== Math.floor(cell)) return 'bounds';
    if (S.map.road.includes(cell)) return 'road';
    if (MAPGEN.hud(S.map, cell)) return 'hud';
    if (MAPGEN.obstacle(S.map, cell)) return 'obstacle';
    if (S.towers[cell]) return 'occupied';
    return null;
  };
  // можно ли строить: { ok, reason: null | 'bounds' | 'road' | 'hud' | 'obstacle' | 'occupied' | 'type' | 'locked' | 'ended' | 'souls', cost, base }
  // cost — цена постройки на этой клетке с наценкой особой клетки (её и списывает команда build), base — цена без наценки
  const canBuild = (S, cell, type) => {
    const def = typeDef(type), blk = cellBlock(S, cell), base = def ? def.base.cost : null;
    const markup = blk === 'bounds' || hasRelic(S, 'hallowed') ? 0 : bonusOf(S, cell, 'cost');                  // Освящённая скверна — без наценки
    const first = hasRelic(S, 'cornerstone') && !S.towers.some((t) => t && t.type === type) ? 1 - RL.cornerstone.firstOff : 1;   // Первый камень
    const cost = def ? Math.round(base * (1 + markup) * first) : null, no = (reason) => ({ ok: false, reason, cost, base });
    if (blk) return no(blk);
    if (!def) return no('type');
    if (S.unlocked && !S.unlocked.includes(type)) return no('locked');
    if (S.phase === 'won' || S.phase === 'lost') return no('ended');
    if (S.souls < cost) return no('souls');
    return { ok: true, reason: null, cost, base };
  };
  // можно ли перенести башню с клетки from: { ok, reason: null | 'none' | 'ended' | 'phase' } — без to (кнопка в панели);
  // с to — ещё и на клетку to: та же проверка клетки, что у постройки (cellBlock), плюс 'same'. Перенос бесплатный, души не нужны.
  const canMove = (S, from, to) => {
    const no = (reason) => ({ ok: false, reason });
    if (!(from >= 0 && from < cellCount(S)) || !S.towers[from]) return no('none');
    if (S.phase === 'won' || S.phase === 'lost') return no('ended');
    // в паузе между волнами; Беспокойные мёртвые — ещё и раз за волну посреди боя
    if (S.phase !== 'prep' && !(S.phase === 'wave' && hasRelic(S, 'restless') && S.waveMoved !== S.wave)) return no('phase');
    if (to === undefined) return { ok: true, reason: null };
    if (to === from) return no('same');
    const blk = cellBlock(S, to); return blk ? no(blk) : { ok: true, reason: null };
  };
  // все клетки, куда можно перенести башню с from (подсветка в интерфейсе); пусто, если переносить нельзя
  const moveCells = (S, from) => { const out = [];
    if (canMove(S, from).ok) for (let i = 0; i < cellCount(S); i++) if (canMove(S, from, i).ok) out.push(i);
    return out; };
  // радиус башни с клетки from, если перенести её на to, px (круг превью переноса)
  const moveRangePx = (S, from, to) => towerStats(S, Object.assign({}, S.towers[from], { cell: to })).rangePx;
  // ---- слияние (#9). Можно ли слить башню с клетки cell (первую — её атака) с башней на other (вторую — её примесь):
  // { ok, reason, cost }. Без other — можно ли сливать эту башню вообще (кнопка в панели): reason null | 'none' | 'hybrid'
  // (уже гибрид) | 'first' (без вида атаки — Алтарь — бывает только второй) | 'tracks' (не все ветки на потолке обычной башни) |
  // 'ended' | 'phase' (не пауза между волнами). С other — ещё 'same' | 'empty' (там нет башни) | 'far' (не сосед по восьми
  // направлениям) | 'mixed' (вторая — уже гибрид) | 'unready' (у второй не все ветки на потолке) | 'souls'. cost — C.MERGE.cost
  const ready = (tw) => C.TRACKS.every((k) => tw.tracks[k] >= C.TRACK_MAX);
  const canMerge = (S, cell, other) => {
    const tw = Number.isInteger(cell) ? towerAt(S, cell) : null, cost = C.MERGE.cost, no = (reason) => ({ ok: false, reason, cost });
    if (!tw) return no('none');
    if (isHybrid(tw)) return no('hybrid');
    if (!attackOf(tw)) return no('first');
    if (!ready(tw)) return no('tracks');
    if (ended(S)) return no('ended');
    if (S.phase !== 'prep') return no('phase');
    if (other === undefined) return { ok: true, reason: null, cost };
    if (other === cell) return no('same');
    const o = Number.isInteger(other) ? towerAt(S, other) : null;
    if (!o) return no('empty');
    if (gridDist(S, cell, other) > 1) return no('far');
    if (isHybrid(o)) return no('mixed');
    if (!ready(o)) return no('unready');
    if (S.souls < cost) return no('souls');
    return { ok: true, reason: null, cost };
  };
  // соседи башни на cell, с которыми её можно слить (подсветка в интерфейсе); нехватка душ соседа из списка не убирает
  const mergeTargets = (S, cell) => { const out = []; if (!canMerge(S, cell).ok) return out;
    const n = S.map.cols, x = cell % n, y = Math.floor(cell / n);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const X = x + dx, Y = y + dy, i = Y * n + X;
      if ((dx || dy) && X >= 0 && Y >= 0 && X < n && Y < S.map.rows && [null, 'souls'].includes(canMerge(S, cell, i).reason)) out.push(i); }
    return out.sort((p, q) => p - q); };
  // гибрид из башни a (первая) и b (вторая) — новый объект на клетке a; он же и превью, и результат команды merge
  const hybridOf = (a, b) => Object.assign({}, a, { mix: b.type, cap: C.MERGE.cap, slots: C.MERGE.slots, tracks: Object.assign({}, a.tracks),
    perks: a.perks.concat(b.perks.filter((p) => !a.perks.includes(p))), invested: a.invested + b.invested + C.MERGE.cost, kills: a.kills + b.kills, dmg: a.dmg + b.dmg });
  // описание гибрида для интерфейса (панель и превью): { type, mix, name, title, icon, mixName, mixText, mixOn (примесь
  // действует на этой атаке), stats (итоговые), cap, slots, invested, perks: [{ id, type, name, on, text }] }; не гибрид — null
  const hybridInfo = (S, hw) => { if (!isHybrid(hw)) return null; const m = TW[hw.mix].mix;
    return { type: hw.type, mix: hw.mix, name: `${TW[hw.type].name} + ${TW[hw.mix].name}`, title: TW[hw.type].title, icon: m.icon, mixName: m.name,
      mixText: mixText(hw.mix), mixOn: mixOn(hw), stats: towerStats(S, hw), cap: hw.cap, slots: hw.slots, invested: hw.invested,
      perks: hw.perks.map((id) => ({ id, type: PERKS[id].type, name: PERKS[id].def.name, on: perkOn(hw, id), text: perkText(id) })) }; };
  // превью слияния башни на cell с соседом other: описание будущего гибрида (характеристики — уже без второй башни: её аура,
  // если это алтарь, уйдёт вместе с ней) плюс { ok, reason, cost, frees — клетка, которая освободится }; нет двух башен — null
  const mergeInfo = (S, cell, other) => {
    const a = Number.isInteger(cell) ? towerAt(S, cell) : null, b = Number.isInteger(other) ? towerAt(S, other) : null;
    if (!a || !b || a === b) return null;
    const cm = canMerge(S, cell, other), hw = hybridOf(a, b); let info;
    S.towers[other] = null; dropIndex();
    try { info = hybridInfo(S, hw); } finally { S.towers[other] = b; dropIndex(); }
    return Object.assign(info, { ok: cm.ok, reason: cm.reason, cost: cm.cost, frees: other }); };
  // радиус будущей башни типа type на клетке cell, px (круг превью постройки)
  const buildRangePx = (S, cell, type) => buildStats(S, cell, type).rangePx;
  // можно ли поднять ветку track башни на клетке: { ok, reason, cost }. reason: null | 'none' (нет башни) | 'track' (нет такой
  // ветки) | 'max' (ветка на потолке башни) | 'price' (до потолка есть ступени, но цены этой ступени в конфиге нет) | 'ended' | 'souls'.
  // cost — цена следующей ступени (null на потолке и без цены)
  const canUpgrade = (S, cell, track) => {
    const tw = towerAt(S, cell), no = (reason, cost = null) => ({ ok: false, reason, cost });
    if (!tw) return no('none');
    if (typeof track !== 'string' || !C.TRACKS.includes(track)) return no('track');
    const n = tw.tracks[track]; if (n >= tw.cap) return no('max');
    const price = TW[tw.type].tracks[track].cost[n]; if (typeof price !== 'number') return no('price');
    const cost = Math.round(price * (1 - relicSum(S, 'trackDiscount')));          // Резец каменщика
    if (ended(S)) return no('ended', cost);
    if (S.souls < cost) return no('souls', cost);
    return { ok: true, reason: null, cost };
  };
  // можно ли взять перк p: { ok, reason, cost, need }. reason: null | 'none' | 'perk' (у типов башни нет такого перка) |
  // 'chosen' (этот перк уже взят) | 'taken' (слоты заняты другими; у гибрида разных типов — перк этого типа уже взят) |
  // 'dead' (перк не действует на атаке этого гибрида) | 'steps' (мало ступеней) | 'ended' | 'souls';
  // need — сколько ступеней ещё вложить до выбора перка
  const canPerk = (S, cell, p) => {
    const tw = towerAt(S, cell), P = tw && own(PERKS, p) && (PERKS[p].type === tw.type || (isHybrid(tw) && PERKS[p].type === tw.mix)) ? PERKS[p] : null;
    const pd = P ? P.def : null, cost = pd ? pd.cost : null;
    const need = tw ? Math.max(0, perkAt(S) - steps(tw)) : perkAt(S), no = (reason) => ({ ok: false, reason, cost, need });
    if (!tw) return no('none');
    if (!pd) return no('perk');
    if (hasPerk(tw, p)) return no('chosen');
    if (!freeSlots(tw)) return no('taken');
    if (isHybrid(tw) && tw.mix !== tw.type && tw.perks.some((q) => PERKS[q].type === P.type)) return no('taken');
    if (!perkOn(tw, p)) return no('dead');
    if (need > 0) return no('steps');
    if (ended(S)) return no('ended');
    if (S.souls < cost) return no('souls');
    return { ok: true, reason: null, cost, need };
  };
  // можно ли купить следующую ступень линии Гримуара id: { ok, reason, cost, step, max }. reason: null | 'line' (нет такой
  // линии) | 'locked' (линия закрытого типа) | 'max' | 'ended' | 'phase' (выбор реликвии) | 'souls'. Гримуар доступен и во время волны.
  // cost — цена следующей ступени (null на пределе), step — купленных ступеней, max — всего ступеней
  const canGrim = (S, id) => {
    const l = own(GRIM_BY, id) ? GRIM_BY[id] : null, step = l ? grimStep(S, id) : 0, max = l ? l.cost.length : 0;
    const cost = l && step < max ? l.cost[step] : null, no = (reason) => ({ ok: false, reason, cost, step, max });
    if (!l) return no('line');
    if (l.type && S.unlocked && !S.unlocked.includes(l.type)) return no('locked');
    if (step >= max) return no('max');
    if (ended(S)) return no('ended');
    if (S.phase === 'relic') return no('phase');                         // на выборе реликвии забег стоит, команды не действуют
    if (S.souls < cost) return no('souls');
    return { ok: true, reason: null, cost, step, max };
  };
  // линии Гримуара для окна, без закрытых типов: общие по порядку веток, затем типы по порядку карточек.
  // { id, group, type, track, k, step, max, costs, cost — следующей ступени или null, bonus — доля сейчас, next — после покупки или null }
  const grimLines = (S) => GRIM.filter((l) => !l.type || !S.unlocked || S.unlocked.includes(l.type)).map((l) => {
    const step = grimStep(S, l.id), max = l.cost.length, more = step < max;
    return { id: l.id, group: l.group, type: l.type, track: l.track, k: l.k, step, max, costs: l.cost.slice(), cost: more ? l.cost[step] : null,
      bonus: l.k * step, next: more ? l.k * (step + 1) : null }; });
  // ---------------------------------------------------------------- сид и сейв
  // сид из поля ввода: целое 0..C.SEED.max цифрами; пробелы по краям и ведущие нули не мешают.
  // → { ok, seed, reason: null | 'empty' | 'negative' | 'big' | 'format' }; причину словами показывает интерфейс
  const parseSeed = (text) => {
    const s = text === null || text === undefined ? '' : String(text).trim(), no = (reason) => ({ ok: false, seed: null, reason });
    if (!s) return no('empty');
    if (/^-[0-9]+$/.test(s)) return no('negative');
    if (!/^[0-9]+$/.test(s)) return no('format');
    const d = s.replace(/^0+(?=[0-9])/, '');
    if (d.length > String(C.SEED.max).length || +d > C.SEED.max) return no('big');
    return { ok: true, seed: +d, reason: null };
  };

  // Годно ли состояние для продолжения (сейв, sessionStorage). Три слоя:
  //  1) форма: состояние, каждая башня и каждый враг повторяют образец — то, что создают сами create, постройка и появление
  //     врага. Каждое поле образца есть и того же рода; новые поля образца проверяются сами, лишние не мешают.
  //     Новый вид сущности в состоянии (не башня и не враг) требует своего образца в shapes() и строки проверки здесь.
  //     Числа: по модулю не больше C.SAVE_NUM_MAX и не меньше нуля (таймеры — не глубже одного шага), кроме координат
  //     и направлений (SIGNED) и полей, отрицательных уже в образце (метки времени −9, prepT −1);
  //  2) смысл: версия, карта ровно та, что генератор даёт от сида, типы башен, перков и врагов из конфига, башня на своей
  //     клетке по правилу постройки, фаза согласована с номером волны и таймером паузы, id без повторов;
  //  3) проба: копия состояния живёт C.SAVE_TRIAL секунд игры — логика не бросает исключений, числа остаются в границах.
  const SIGNED = new Set(['x', 'y', 'lane', 'aim', 'face', 'dx', 'dy']);
  const kind = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);
  const num = (v, t, tol, key) => typeof v === 'number' && Math.abs(v) <= C.SAVE_NUM_MAX && (v >= -tol || t < 0 || SIGNED.has(key));
  const like = (v, t, tol, key) => { const k = kind(t);
    if (k === 'null') return true;                                    // в образце null — поле может быть чем угодно (перк, открытое)
    if (k === 'number') return num(v, t, tol, key);
    if (kind(v) !== k) return false;
    if (k === 'object') for (const key of Object.keys(t)) if (!like(v[key], t[key], tol, key)) return false;
    return true; };
  const bounded = (o) => { if (typeof o === 'number') return Math.abs(o) <= C.SAVE_NUM_MAX;   // NaN и ±Infinity сюда не проходят
    if (o && typeof o === 'object') for (const k in o) if (!bounded(o[k])) return false; return true; };
  const int = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
  let SHAPE = null, MAPC = { seed: null, json: '' };
  const shapes = () => {
    if (SHAPE) return SHAPE;
    const state = JSON.parse(JSON.stringify(create(DEMO_SEED))), S = create(DEMO_SEED), cells = rankCells(S, 3), towers = {}, enemies = {};
    S.souls = 1e9; S.wave = 1;
    Object.keys(TW).forEach((type, i) => { doCmd(S, { k: 'build', cell: cells[i], type }); towers[type] = S.towers[cells[i]]; });
    for (const type of Object.keys(EN)) enemies[type] = spawnEnemy(S, type, 0);
    const skel = makeSkel(S, towers[Object.keys(TW)[0]], S.map.road[0], { hp: 1, dmg: 1, hit: 1, reach: 1 }, 0);
    // образец, который не создался, молча отключил бы проверку формы своего типа: это ошибка разработки, падаем громко
    for (const [what, all] of [['башни', towers], ['врага', enemies]]) for (const type in all)
      if (kind(all[type]) !== 'object' || all[type].type !== type) throw new Error(`SIM.loadable: не создался образец ${what} ${type}`);
    // мелочь боя, у которой нет одного создателя: только поля, без которых шаг или кадр споткнутся
    return (SHAPE = JSON.parse(JSON.stringify({ state, towers, enemies, skel, queue: { at: 0, e: '' }, poison: { dps: 0, t: 0, tw: 0, pest: null },
      shot: { k: '', x: 0, y: 0 }, cloud: { x: 0, y: 0, r: 0, t: 0, T: 0, dps: 0, linger: 0 }, beam: { x0: 0, y0: 0, x1: 0, y1: 0, t: 0 }, ev: { k: '', t: 0 } })));
  };
  // карта забега ровно та, что генератор даёт от его сида (иначе сид в HUD не воспроизводит карту); генерация ~15 мс — помним последнюю
  const mapOfSeed = (seed) => { if (MAPC.seed !== seed) MAPC = { seed, json: JSON.stringify(MAPGEN.generate(seed)) }; return MAPC.json; };
  // башня по смыслу своей модели: ступень каждой ветки — целое 0..cap; cap — целый, от потолка обычной башни до числа
  // заданных цен; слотов перков не меньше, чем у обычной башни; перки — без повторов, не больше слотов, все — перки её типа.
  // Гибрид (mix — тип из конфига): первая башня — с видом атаки, потолок и слоты — ровно гибрида (C.MERGE), ветки не ниже
  // потолка обычной башни (сливаются только прокачанные), перки — его типа или примеси, у разных типов — не больше одного на тип
  const towerOk = (tw, def) => {
    const prices = Math.min(...C.TRACKS.map((k) => def.tracks[k].cost.length)), hy = tw.mix !== null;
    if (hy && !(typeof tw.mix === 'string' && own(TW, tw.mix) && own(ATTACKS, def.attack) && tw.cap === C.MERGE.cap && tw.slots === C.MERGE.slots
      && C.TRACKS.every((k) => tw.tracks[k] >= C.TRACK_MAX))) return false;
    const from = (p) => (own(def.perks, p) ? tw.type : hy && own(TW[tw.mix].perks, p) ? tw.mix : null);
    return int(tw.cap, C.TRACK_MAX, prices) && C.TRACKS.every((k) => int(tw.tracks[k], 0, tw.cap)) && int(tw.slots, C.PERK_SLOTS, C.SAVE_NUM_MAX)
      && Array.isArray(tw.perks) && tw.perks.length <= tw.slots && new Set(tw.perks).size === tw.perks.length && tw.perks.every((p) => typeof p === 'string' && from(p))
      && (!hy || tw.mix === tw.type || new Set(tw.perks.map(from)).size === tw.perks.length);
  };
  // фаза согласована с номером волны, режимом и таймером паузы. Обычный забег: волны 1..RUN_WAVES, пауз после последней нет,
  // победа — на последней. Бесконечный режим начинается паузой после победы (волна RUN_WAVES): дальше волны без предела, победы нет.
  const phaseOk = (S) => {
    const R = C.RUN_WAVES, E = S.endless, prepOk = S.prepT === -1 || (S.prepT >= 0 && S.prepT <= C.PREP_TIME);
    if (S.phase === 'prep') return (E ? int(S.wave, R, Infinity) : int(S.wave, 0, R - 1)) && prepOk;
    if (S.phase === 'wave') return E ? int(S.wave, R + 1, Infinity) : int(S.wave, 1, R);
    if (S.phase === 'relic') return relicDue(S.wave) && (E ? S.wave > R : int(S.wave, 1, R - 1)) && S.prepT >= 0 && S.prepT <= C.PREP_TIME;
    if (S.phase === 'won') return !E && S.wave === R;
    if (S.phase === 'lost') return E ? int(S.wave, R + 1, Infinity) : int(S.wave, 0, R);
    return false;
  };
  // реликвии: известные, без повторов, не больше, чем было выборов к этой волне; предложение — только в фазе выбора и ровно то,
  // что даёт сид (иначе после загрузки игрок выбирал бы из чужого набора); перенос посреди боя — не позже текущей волны
  const relicsOk = (S) => {
    if (!Array.isArray(S.relics) || !S.relics.every((id) => own(RL, id)) || new Set(S.relics).size !== S.relics.length) return false;
    if (!int(S.waveMoved, 0, S.wave)) return false;
    const cleared = S.phase === 'wave' || S.phase === 'lost' ? S.wave - 1 : S.wave; let chances = S.phase === 'relic' ? -1 : 0;
    for (let n = 1; n <= cleared && chances < S.relics.length; n++) if (relicDue(n)) chances++;
    if (S.relics.length > chances) return false;
    if (S.phase !== 'relic') return S.offer === null;
    return Array.isArray(S.offer) && S.offer.length > 0 && JSON.stringify(S.offer) === JSON.stringify(drawRelics(S.seed, S.wave, S.relics, S.unlocked)); };
  const loadable = (S) => {
    const sh = shapes();
    try {
      if (kind(S) !== 'object' || S.v !== C.VERSION || kind(S.map) !== 'object') return false;
      if (!(S.dt >= C.DT_MIN && S.dt <= C.DT_MAX)) return false;               // мельче — проба шла бы бесконечно
      if (!like(S, sh.state, S.dt) || !bounded(S)) return false;
      if (!int(S.seed, 0, C.SEED.max) || JSON.stringify(S.map) !== mapOfSeed(S.seed) || !int(S.rs, 0, 0xFFFFFFFF)) return false;
      if (!phaseOk(S) || !int(S.qi, 0, S.queue.length) || S.towers.length !== cellCount(S)) return false;
      if (S.unlocked !== null && !(Array.isArray(S.unlocked) && S.unlocked.every((u) => typeof u === 'string'))) return false;
      if (!relicsOk(S)) return false;
      if (!GRIM.every((l) => int(S.grim[l.id], 0, l.cost.length))) return false;   // ступени Гримуара — целые до предела линии
      const ids = new Set(), freshId = (x) => { if (!int(x, 1, S.nid - 1) || ids.has(x)) return false; ids.add(x); return true; };
      for (let i = 0; i < S.towers.length; i++) { const tw = S.towers[i]; if (tw === null) continue;
        const def = kind(tw) === 'object' && own(TW, tw.type) ? TW[tw.type] : null, blk = def && tw.cell === i ? cellBlock(S, i) : 'bounds';
        if (!def || !like(tw, sh.towers[tw.type], S.dt) || (blk && blk !== 'occupied')) return false;   // клетка — по правилу постройки, занята собой
        if (!towerOk(tw, def) || !freshId(tw.id)) return false; }
      for (const e of S.enemies) {
        if (kind(e) !== 'object' || !own(EN, e.type) || !like(e, sh.enemies[e.type], S.dt) || !freshId(e.id)) return false;
        for (const k in e.poison) if (!like(e.poison[k], sh.poison, S.dt)) return false; }
      for (const q of S.queue) if (!like(q, sh.queue, 0) || !own(EN, q.e)) return false;
      for (const s of S.skels) if (!like(s, sh.skel, S.dt) || !freshId(s.id) || !S.map.road.includes(s.cell)) return false;   // скелет — на клетке дороги
      const loose = (list, t) => list.every((x) => like(x, t, Infinity));     // координаты снарядов и лучей бывают за краем поля
      if (!loose(S.shots, sh.shot) || !loose(S.clouds, sh.cloud) || !loose(S.beams, sh.beam)) return false;
      if (!S.ev.every((e) => like(e, sh.ev, Infinity) && ['x', 'y'].every((k) => e[k] === undefined || num(e[k], 0, Infinity, k)))) return false;
      const R = JSON.parse(JSON.stringify(S)), n = Math.min(Math.ceil(C.SAVE_TRIAL / R.dt), Math.ceil(C.SAVE_TRIAL / C.DT_MIN));
      for (let i = 0; i < n; i++) step(R, null);
      return bounded(R);
    } catch (e) { return false; }
  };
  // превью волны n для разведки: только с текущей+1 по текущую+SCOUT_AHEAD и не дальше конца забега, иначе null.
  // Свежий объект на каждый вызов: менять его можно, на бой это не влияет.
  const scoutRange = (S) => ({ from: S.wave + 1, to: Math.min(lastWave(S), S.wave + C.SCOUT_AHEAD) });
  const preview = (S, n) => { const r = scoutRange(S); return Number.isInteger(n) && n >= r.from && n <= r.to ? WAVEGEN.wave(S.seed, n) : null; };
  // сколько врагов волны ещё осталось: не вышедшие на дорогу и живые — вместе с теми, кто выйдет из них при смерти
  // (повозка считается за себя и своих ополченцев сразу, поэтому число только убывает)
  const remaining = (S) => { let n = 0;
    for (let i = S.qi; i < S.queue.length; i++) n += WAVEGEN.spawnsOf(S.queue[i].e);
    for (const e of S.enemies) if (!e.dead) n += WAVEGEN.spawnsOf(e.type);
    return n; };
  // характеристики врага типа type в текущей волне (их получает враг при выходе на дорогу; карточка «Новый враг»)
  const enemyStats = (S, type) => (S.waveStats && S.waveStats[type]) || WAVEGEN.stats(type, Math.max(1, S.wave), null);
  // длина дороги (px), которую башня на клетке накрывает радиусом units
  const coverage = (S, cell, units) => { const [x, y] = cellXY(S, cell), r = units * UNIT, L = pathLen(S); let n = 0;
    for (let d = 0; d < L; d += 4) { const p = posAt(S, d); if (Math.hypot(p.x - x, p.y - y) <= r) n += 4; } return n; };
  // покрытие дороги будущей башней на клетке: типичный радиус C.TYPICAL_RANGE плюс бонус клетки (меню постройки)
  const spotCoverage = (S, cell) => coverage(S, cell, C.TYPICAL_RANGE + bonusOf(S, cell, 'range'));
  // свободные клетки по убыванию покрытия дороги (боты, демо, подсказки)
  const rankCells = (S, units) => { const out = [];
    for (let i = 0; i < cellCount(S); i++) if (!S.map.road.includes(i) && !S.towers[i] && !MAPGEN.hud(S.map, i) && !MAPGEN.obstacle(S.map, i)) out.push([i, coverage(S, i, units)]);
    return out.sort((a, b) => b[1] - a[1] || a[0] - b[0]).map((c) => c[0]); };

  // ---------------------------------------------------------------- команды игрока
  const pay = (S, c) => { S.souls -= c; S.stats.spent += c; };
  // клетки команды (cell, у переноса to, у слияния other) — только целые числа: строка '171' или [171] как индекс массива
  // нашли бы башню, а мусор и недостающий аргумент не должны ни менять забег, ни бросать исключение
  const CELL_ARGS = { build: ['cell'], upgrade: ['cell'], perk: ['cell'], sell: ['cell'], move: ['cell', 'to'], merge: ['cell', 'other'] };
  const doCmd = (S, c) => {
    if (!c || typeof c !== 'object' || (own(CELL_ARGS, c.k) && !CELL_ARGS[c.k].every((key) => Number.isInteger(c[key])))) return;
    if (c.k === 'endless') {                                               // продолжить после победы: пауза перед следующей волной, по кнопке
      if (canEndless(S)) { S.endless = true; S.phase = 'prep'; S.prepT = -1; ev(S, 'endless', { wave: S.wave }); }
      return; }
    if (S.phase === 'won' || S.phase === 'lost') return;
    if (S.phase === 'relic' && c.k !== 'relic') return;               // на выборе реликвии забег стоит: другие команды не действуют
    dropIndex();
    const tw = c.cell >= 0 && c.cell < cellCount(S) ? S.towers[c.cell] : null, at = tw ? cellXY(S, c.cell) : null;
    if (c.k === 'build') {
      const cb = canBuild(S, c.cell, c.type); if (!cb.ok) return;
      const [x, y] = cellXY(S, c.cell);
      pay(S, cb.cost);
      S.towers[c.cell] = Object.assign(fresh(c.cell, c.type), { id: S.nid++, cd: 0.4, invested: cb.cost, kills: 0, dmg: 0, fireT: -9, aim: 0, built: S.t, raiseT: -9 });
      ev(S, 'build', { cell: c.cell, type: c.type, x, y });
    } else if (c.k === 'upgrade') {                                   // { k: 'upgrade', cell, track: 'dmg' | 'range' | 'rate' }
      const cu = canUpgrade(S, c.cell, c.track); if (!cu.ok) return;
      pay(S, cu.cost); tw.tracks[c.track]++; tw.invested += cu.cost; tw.built = S.t;
      ev(S, 'upgrade', { cell: c.cell, track: c.track, step: tw.tracks[c.track], x: at[0], y: at[1] });
    } else if (c.k === 'perk') {
      const cp = canPerk(S, c.cell, c.p); if (!cp.ok) return;
      pay(S, cp.cost); tw.perks.push(c.p); tw.invested += cp.cost; tw.built = S.t;
      ev(S, 'perk', { cell: c.cell, p: c.p, x: at[0], y: at[1] });
    } else if (c.k === 'sell') {
      if (!tw) return; const v = sellValue(tw, S); S.souls += v; S.towers[c.cell] = null; dismiss(S, tw);
      ev(S, 'sell', { cell: c.cell, souls: v, type: tw.type, x: at[0], y: at[1] });
    } else if (c.k === 'move') {
      // башня переезжает целиком, тем же объектом: меняется только клетка, всё остальное (прокачка, перк, счётчики) едет с ней
      if (!canMove(S, c.cell, c.to).ok) return; const [x, y] = cellXY(S, c.to);
      S.towers[c.to] = tw; S.towers[c.cell] = null; tw.cell = c.to; if (S.phase === 'wave') S.waveMoved = S.wave; dismiss(S, tw);   // скелеты у старой клетки рассыпаются
      ev(S, 'move', { cell: c.to, from: c.cell, type: tw.type, x, y, fx: at[0], fy: at[1] });
    } else if (c.k === 'merge') {                                     // { k: 'merge', cell, other } — other становится примесью башни на cell
      if (!canMerge(S, c.cell, c.other).ok) return; const o = S.towers[c.other], [fx, fy] = cellXY(S, c.other);
      pay(S, C.MERGE.cost); Object.assign(tw, hybridOf(tw, o), { built: S.t }); S.towers[c.other] = null; S.stats.merges++;
      dismiss(S, o);                                                  // скелеты второй башни (Казармы) рассыпаются, первой — остаются при гибриде
      ev(S, 'merge', { cell: c.cell, other: c.other, type: tw.type, mix: tw.mix, x: at[0], y: at[1], fx, fy });
    } else if (c.k === 'grim') {                                      // { k: 'grim', line } — ступень линии Гримуара
      const cg = canGrim(S, c.line); if (!cg.ok) return;
      pay(S, cg.cost); S.grim[c.line]++;
      ev(S, 'grim', { line: c.line, step: S.grim[c.line] });
    } else if (c.k === 'call') {
      if (S.phase !== 'prep' || S.wave >= lastWave(S)) return;
      if (S.prepT > 0 && hasRelic(S, 'haste')) { const g = Math.floor(S.prepT * RL.haste.perSec);   // Нетерпение: души за оставшуюся паузу
        if (g) { S.souls += g; S.stats.earned += g; ev(S, 'haste', { souls: g }); } }
      startWave(S);
    } else if (c.k === 'relic') {                                     // { k: 'relic', i } — номер в предложении S.offer
      if (S.phase !== 'relic' || !int(c.i, 0, S.offer.length - 1)) return;
      const id = S.offer[c.i], take = RL[id].take || {};
      S.relics.push(id); S.offer = null; S.phase = 'prep';
      if (take.souls) S.souls += take.souls; if (take.hp) S.hp += take.hp;
      ev(S, 'relic', { id });
    }
  };

  // ---------------------------------------------------------------- волны
  const startWave = (S) => {
    S.wave++; S.phase = 'wave'; S.waveT = 0; S.qi = 0; S.prepT = 0;
    // описание волны считается заново от сида и номера; её характеристики врагов живут в состоянии забега до следующей волны
    const w = WAVEGEN.wave(S.seed, S.wave);
    S.queue = WAVEGEN.queue(w); S.waveStats = w.stats;
    ev(S, 'wave', { wave: S.wave, boss: w.boss, trait: w.trait ? w.trait.id : null });
  };
  // характеристики врага — из описания волны (те же, что видит разведка); child — вышел из убитого (ополченцы из повозки)
  const spawnEnemy = (S, type, d, child) => {
    const def = EN[type], st = enemyStats(S, type);
    const e = { id: S.nid++, type, d: d || 0, hp: st.hp, max: st.hp, bounty: st.bounty, armor: st.armor, mres: st.mres, speed: st.speed, heal: st.heal, child: !!child,
      lane: (rand(S) - 0.5) * (def.size > 1.5 ? 6 : 16), slowK: 0, slowT: 0, freezeT: 0, stunT: 0, stunG: 0, curse: 0, curseT: 0, shred: 0, shredT: 0, poison: {},
      healCD: (def.healEvery || 0) * rand(S), hitT: -9, x: 0, y: 0, face: 1, walk: 0, aura: 0, name: st.name,
      ward: def.ward || 0, haste: 0 };   // ward — сколько первых попаданий ещё пройдут мимо; haste — ускорение от знаменосца
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
  // opt — параметры удара (fx снаряда): pen / mpen — доля брони / магической защиты, которую удар не замечает
  const damage = (S, e, amt, type, tw, opt) => {
    if (e.dead || amt <= 0) return 0;
    if (e.ward > 0) { e.ward--; ev(S, 'miss', { x: e.x, y: e.y - 14 }); return 0; }   // разведчик: первое попадание любого урона — мимо
    // броня и защита — с врага (свойство волны их меняет); бонус клетки уже в уроне снаряда (towerStats при выстреле)
    if (type === 'phys') amt *= 1 - Math.min(0.9, Math.max(0, e.armor + e.aura - e.shred) * (1 - Math.min(1, (opt && opt.pen) || 0)));
    else if (type === 'magic') amt *= 1 - e.mres * (1 - Math.min(1, (opt && opt.mpen) || 0));
    if (e.curseT > 0) amt *= 1 + e.curse;
    e.hp -= amt; if (type !== 'poison') e.hitT = S.t;
    if (tw) tw.dmg += amt;
    if (e.hp <= 0) kill(S, e, tw);
    return amt;
  };
  const kill = (S, e, tw) => {
    e.dead = true; const def = EN[e.type];
    const coin = relicSum(S, 'killSouls');                              // Кровавая монета
    S.souls += e.bounty + coin; S.stats.kills++; S.stats.earned += e.bounty + coin; if (tw) tw.kills++;
    ev(S, 'die', { x: e.x, y: e.y, type: e.type, souls: e.bounty, face: e.face, boss: !!def.boss });
    const well = tw ? bonusOf(S, tw.cell, 'souls') : 0;                // источник душ под башней-убийцей
    if (well) { S.souls += well; S.stats.earned += well; const [wx, wy] = cellXY(S, tw.cell); ev(S, 'well', { x: wx, y: wy - 40, souls: well, cell: tw.cell }); }
    // души за смерть в радиусе башни (Жатва): параметр перка — из итоговых характеристик башни
    for (const t of S.towers) if (t && t.perks.some((p) => KILL_PERKS.has(p))) { const st = towerStats(S, t); if (!st.harvest) continue;
      const [sx, sy] = cellXY(S, t.cell); if (Math.hypot(e.x - sx, e.y - sy) <= st.rangePx) { const g = st.harvest; S.souls += g; S.stats.earned += g; ev(S, 'harvest', { x: e.x, y: e.y, souls: g, cell: t.cell }); }
    }
    // Мор: яд, полученный из облака башни с этим перком, при смерти оставляет малое облако (без цепной реакции)
    for (const key in e.poison) { const p = e.poison[key];
      if (p.pest) { S.clouds.push({ x: e.x, y: e.y, r: p.pest.r, t: p.pest.t, T: p.pest.t, dps: p.dps, linger: p.pest.linger, tw: p.tw, pest: null, fx: null, hit: [] });
        ev(S, 'cloud', { x: e.x, y: e.y, small: true }); break; } }
    if (tw) raise(S, e, tw);                                           // примесь Казармы: убитый встаёт скелетом гибрида
    if (def.spawnOnDeath) for (let i = 0; i < def.spawnOnDeath.n; i++) { const m = spawnEnemy(S, def.spawnOnDeath.type, Math.max(0, e.d - 12 - 16 * i), true); m.lane = (i ? 1 : -1) * 9; placeEnemy(S, m, 0); }
  };

  // ---------------------------------------------------------------- эффекты попадания
  // Единый слой: всё, что попадание делает с врагом, кроме урона, — из параметров удара fx. fx снимается с итоговых
  // характеристик в момент выстрела (fxOf) и едет в снаряде, облаке или ударе: проданная или прокачанная башня его не меняет.
  // Его вызывают все точки попадания (strike: болт, призрак и его отскоки, луч, удар колокола; облако — при касании), поэтому
  // перк или примесь второй башни гибрида действуют на чужой атаке. Новый эффект — ключ в FX и строка в effects.
  //   kind — вид урона; pen, mpen — пробой брони и защиты (в damage); slow, slowTime — замедление (не выше C.SLOW_MAX);
  //   freezeChance, freeze — шанс сковать; curse, curseTime — проклятие; shred, shredTime — снижение брони; venom, venomTime —
  //   яд при попадании (доля урона в секунду); pest — облако Мора при смерти отравленного; stunChance, stunMini — мини-оглушение;
  //   drag, dragTime — замедление после оглушения (Гул); pierceN, pierceK, pierceR — пронзание: ещё враги рядом с целью.
  const FX = ['pen', 'mpen', 'slow', 'slowTime', 'freezeChance', 'freeze', 'curse', 'curseTime', 'shred', 'shredTime', 'venom', 'venomTime',
    'stunChance', 'stunMini', 'drag', 'dragTime', 'pierceN', 'pierceK', 'pierceR'];
  const fxOf = (tw, st) => { const d = TW[tw.type], fx = { kind: d.dmgType };
    for (const k of FX) if (st[k]) fx[k] = st[k];
    if (d.ignoreMres) fx.mpen = 1;                                     // Тьма не замечает магической защиты
    if (st.pestR) fx.pest = { r: st.pestR * UNIT, t: st.pestTime, linger: st.linger || st.venomTime || 1 };
    return fx; };
  // эффекты удара по врагу e (amt — урон удара до брони, src — id башни). first — первое касание: шансы срабатывают только
  // на нём (облако обновляет эффекты каждый шаг, пока враг внутри, а шансы и пронзание — один раз)
  const effects = (S, e, amt, fx, src, first) => {
    if (!fx || typeof fx !== 'object' || e.dead) return;
    const boss = !!EN[e.type].boss;
    if (fx.slow > 0) slowHit(e, Math.min(C.SLOW_MAX, fx.slow), fx.slowTime);
    if (first && fx.freezeChance > 0 && rand(S) < fx.freezeChance && !boss) { e.freezeT = fx.freeze; ev(S, 'freeze', { x: e.x, y: e.y }); }
    if (fx.curse > 0) { e.curse = Math.max(e.curseT > 0 ? e.curse : 0, fx.curse); e.curseT = Math.max(e.curseT, fx.curseTime); }
    if (fx.shred > 0) { e.shred = Math.max(e.shredT > 0 ? e.shred : 0, fx.shred); e.shredT = Math.max(e.shredT, fx.shredTime); }
    if (fx.venom > 0 && amt > 0) { const key = 'v' + src, old = e.poison[key];
      e.poison[key] = { dps: Math.max(fx.venom * amt, old ? old.dps : 0), t: fx.venomTime, tw: src, pest: fx.pest || null }; }
    if (first && fx.stunChance > 0 && rand(S) < fx.stunChance && !boss) { e.stunT = Math.max(e.stunT, fx.stunMini); ev(S, 'stun', { x: e.x, y: e.y }); }
    if (fx.drag > 0) slowHit(e, fx.drag, (e.stunT > 0 ? e.stunT : 0) + fx.dragTime);
  };
  // пронзание: до pierceN ближайших врагов в pierceR от цели получают долю pierceK урона удара (их эффекты — без шансов и без
  // нового пронзания)
  const pierce = (S, e, amt, fx, tw, src) => {
    if (!(fx && fx.pierceN > 0)) return; const R = (fx.pierceR || 0) * UNIT;
    const near = S.enemies.filter((o) => !o.dead && o !== e && Math.hypot(o.x - e.x, o.y - e.y) <= R)
      .sort((p, q) => Math.hypot(p.x - e.x, p.y - e.y) - Math.hypot(q.x - e.x, q.y - e.y) || p.id - q.id).slice(0, fx.pierceN);
    for (const o of near) { strike(S, o, amt * fx.pierceK, fx, tw, src, false); ev(S, 'pierce', { x: e.x, y: e.y - 14, x1: o.x, y1: o.y - 14 }); } };
  // попадание: промах по щиту разведчика — без эффектов; иначе эффекты, урон, пронзание. Возвращает нанесённый урон
  const strike = (S, e, amt, fx, tw, src, first = true) => {
    if (e.dead) return 0;
    const kind = fx && fx.kind;
    if (e.ward > 0) return damage(S, e, amt, kind, tw, fx);
    effects(S, e, amt, fx, src, first);
    const got = damage(S, e, amt, kind, tw, fx);
    if (first) pierce(S, e, amt, fx, tw, src);
    return got; };

  // ---------------------------------------------------------------- башни
  const inRange = (S, tw, r) => { const [sx, sy] = cellXY(S, tw.cell), out = [];
    for (const e of S.enemies) if (!e.dead && Math.hypot(e.x - sx, e.y - sy) <= r) out.push(e); return out; };
  const firstOf = (list) => list.reduce((b, e) => (!b || e.d > b.d ? e : b), null);
  // Виды атаки (поле attack типа в конфиге): { run(S, tw, st, cand, mx, my, fx) → сработал ли (true — перезарядка st.rate),
  //   idle — true, если вид действует и без целей в радиусе (выставить скелета заранее): тогда run зовётся и при пустом cand }.
  // st — итоговые характеристики, cand — враги в радиусе, (mx, my) — точка выстрела, fx — параметры эффектов попадания
  // (fxOf). Снаряд запоминает все свои числа (урон, fx) в момент выстрела: проданная, прокачанная или перенесённая башня их не
  // меняет. Каждое попадание — через strike (эффекты, урон, пронзание). Тип без attack не действует.
  // Новый вид атаки — новая запись здесь и, если снаряд новый, ветка в stepShots и отрисовка в сцене.
  const ATTACKS = {
    // болт: первая по дороге цель. Залп — болты по нескольким первым целям, каждый с долей урона; Пронзающий болт — болт
    // летит прямо в упреждённую точку и пробивает врагов по линии. Оба перка вместе (гибрид Кости + Кости): каждый болт залпа пронзающий
    bolt: { run: (S, tw, st, cand, mx, my, fx) => {
      const ts = st.bolts ? cand.sort((a, b) => b.d - a.d).slice(0, st.bolts) : [firstOf(cand)], dmg = st.bolts ? st.dmg * st.boltMult : st.dmg;
      ts.forEach((e, i) => {
        const n = st.bolts ? { n: i } : {};
        if (st.pierce) {
          const fl = Math.hypot(e.x - mx, e.y - my) / st.speed, p = posAt(S, e.d + e.speed * fl), a = Math.atan2(p.y - my, p.x - mx);
          if (!i) tw.aim = a;
          S.shots.push(Object.assign({ k: 'bolt', x: mx, y: my, dx: Math.cos(a), dy: Math.sin(a), left: st.rangePx * 1.3, dmg, fx, sp: st.speed, tw: tw.id,
            pierce: st.pierce, falloff: st.pierceFalloff, hit: [] }, n));
        } else {
          if (!i) tw.aim = Math.atan2(e.y - my, e.x - mx);
          S.shots.push(Object.assign({ k: 'bolt', x: mx, y: my, tid: e.id, dmg, fx, sp: st.speed, tw: tw.id, lx: e.x, ly: e.y }, n));
        } });
      return true;
    } },
    ghost: { run: (S, tw, st, cand, mx, my, fx) => {                        // призрак: урон и замедление (fx); Стая — отскоки
      const e = firstOf(cand); tw.aim = Math.atan2(e.y - my, e.x - mx);
      S.shots.push({ k: 'ghost', x: mx, y: my, tid: e.id, dmg: st.dmg, fx, sp: st.speed, tw: tw.id, lx: e.x, ly: e.y,
        bounces: st.bounces || 0, bounceMult: st.bounceMult || 1, bounceR: (st.bounceRange || 0) * UNIT, hit: [], born: S.t, seed: rand(S) });
      return true;
    } },
    blob: { run: (S, tw, st, cand, mx, my, fx) => {                         // ком яда навесом: облако на месте падения; Мор, Миазмы
      const e = firstOf(cand), fl = st.flight, p = posAt(S, e.d + e.speed * (e.slowT > 0 ? 1 - e.slowK : 1) * fl * 0.85);
      S.shots.push({ k: 'blob', x0: mx, y0: my, x1: p.x, y1: p.y, x: mx, y: my, T: 0, dur: fl, tw: tw.id, dps: st.dmg, r: st.cloudR * UNIT, ct: st.cloudTime, linger: st.linger,
        fx, pest: st.pestR ? { r: st.pestR * UNIT, t: st.pestTime, linger: st.linger } : null });
      return true;
    } },
    beam: { run: (S, tw, st, cand, mx, my, fx) => {                         // луч мгновенно по самой живучей цели; Двойной луч
      const byHp = cand.sort((a, b) => b.hp - a.hp || a.id - b.id), hits = byHp.slice(0, st.split ? 2 : 1);
      tw.aim = Math.atan2(hits[0].y - my, hits[0].x - mx);
      hits.forEach((e, i) => { const heavy = EN[e.type].heavy ? st.heavy || 1 : 1, mult = i ? st.split : 1;
        strike(S, e, st.dmg * heavy * mult, fx, tw, tw.id);
        S.beams.push({ x0: mx, y0: my, x1: e.x, y1: e.y - 14, t: S.t, tw: tw.id }); });
      return true;
    } },
    // удар колокола: урон всем в радиусе разом, оглушение на st.stun всем, кроме боссов и невосприимчивых (stunG — оглушение
    // плюс st.guard); проклятие Погребального звона и замедление Гула — эффекты попадания (fx), Гул — после оглушения
    pulse: { run: (S, tw, st, cand, mx, my, fx) => {
      const [x, y] = cellXY(S, tw.cell);
      for (const e of cand) {
        if (e.ward > 0) { strike(S, e, st.dmg, fx, tw, tw.id); continue; }   // разведчик: удар мимо — и без оглушения
        const stun = !EN[e.type].boss && !(e.stunG > 0);
        if (stun) { e.stunT = st.stun; e.stunG = st.stun + st.guard; }
        strike(S, e, st.dmg, fx, tw, tw.id);
      }
      ev(S, 'pulse', { x, y, r: st.rangePx, cell: tw.cell, type: tw.type });
      return true;
    } },
    summon: { idle: true, run: (S, tw, st) => summon(S, tw, st) },        // Казарма: скелет на дорогу (раздел «скелеты»)
  };
  const attackOf = (tw) => { const a = TW[tw.type].attack; return own(ATTACKS, a) ? ATTACKS[a] : null; };
  // выстрел (или действие без целей): итоговые характеристики, если сработал (по ним перезарядка), иначе null
  const fire = (S, tw) => {
    const atk = attackOf(tw); if (!atk) return null;
    const st = towerStats(S, tw), cand = inRange(S, tw, st.rangePx); if (!cand.length && !atk.idle) return null;
    const [mx, my] = muzzle(S, tw);
    if (!atk.run(S, tw, st, cand, mx, my, fxOf(tw, st))) return null;
    tw.fireT = S.t; ev(S, 'fire', { cell: tw.cell, type: tw.type, x: mx, y: my });
    return st;
  };
  // замедление: более сильное заменяет слабое; такое же продлевает; более слабое сильное не трогает (и не продлевает)
  const slowHit = (e, k, t) => { if (e.slowT <= 0 || k > e.slowK) { e.slowK = k; e.slowT = t; } else if (k === e.slowK) e.slowT = Math.max(e.slowT, t); };

  const findEnemy = (S, id) => { for (const e of S.enemies) if (e.id === id) return e; return null; };
  // параметры удара снаряда; снаряд без них (собранный руками) бьёт видом урона своего снаряда и без эффектов
  const SHOT_FX = { bolt: { kind: 'phys' }, ghost: { kind: 'magic' } };
  const shotFx = (s) => s.fx || SHOT_FX[s.k];
  const stepShots = (S) => {
    const keep = [], DT = S.dt;
    for (const s of S.shots) {
      const tw = towerOf(S, s.tw);
      if (s.k === 'blob') {
        s.T += DT; const u = Math.min(1, s.T / s.dur);
        s.x = s.x0 + (s.x1 - s.x0) * u; s.y = s.y0 + (s.y1 - s.y0) * u - Math.sin(Math.PI * u) * 70;
        if (u >= 1) {
          S.clouds.push({ x: s.x1, y: s.y1, r: s.r, t: s.ct, T: s.ct, dps: s.dps, linger: s.linger, tw: s.tw, pest: s.pest, fx: s.fx, hit: [] });
          ev(S, 'cloud', { x: s.x1, y: s.y1 }); continue; }
        keep.push(s); continue;
      }
      if (s.pierce !== undefined) {                                   // прямой пронзающий болт
        // крупный шаг дробится на отрезки не длиннее шага по умолчанию: при C.DT проверка та же, при 1/30 болт не проскакивает врага
        const st = s.sp * DT, n = Math.max(1, Math.ceil(DT / C.DT - 1e-9)), sub = st / n;
        for (let k = 0; k < n && s.hit.length < s.pierce; k++) {
          s.x += s.dx * sub; s.y += s.dy * sub; s.left -= sub;
          for (const e of S.enemies) if (!e.dead && s.hit.length < s.pierce && !s.hit.includes(e.id) && Math.hypot(e.x - s.x, e.y - 14 - s.y) < 18) {
            strike(S, e, s.dmg * (1 - s.falloff * s.hit.length), shotFx(s), tw, s.tw); s.hit.push(e.id); ev(S, 'hit', { x: e.x, y: e.y - 14, kind: 'bolt' }); }
        }
        if (s.left > 0 && s.hit.length < s.pierce && s.x > -50 && s.x < W + 50 && s.y > -50 && s.y < H + 50) keep.push(s);
        continue;
      }
      const e = findEnemy(S, s.tid);
      if (e && !e.dead) { s.lx = e.x; s.ly = e.y - 14; }
      const dx = s.lx - s.x, dy = s.ly - s.y, d = Math.hypot(dx, dy), st = s.sp * DT;
      if (d <= st + 4) {
        if (e && !e.dead) {
          if (s.k === 'bolt') { strike(S, e, s.dmg, shotFx(s), tw, s.tw); ev(S, 'hit', { x: s.lx, y: s.ly, kind: 'bolt' }); }
          else {                                                       // призрак: попадание (замедление и перки — в fx снаряда) и отскоки
            strike(S, e, s.dmg, shotFx(s), tw, s.tw);
            ev(S, 'hit', { x: s.lx, y: s.ly, kind: 'ghost' });
            s.hit.push(e.id);
            if (s.bounces > 0) {
              let nb = null, nd = s.bounceR;
              for (const o of S.enemies) if (!o.dead && !s.hit.includes(o.id)) { const dd = Math.hypot(o.x - e.x, o.y - e.y); if (dd < nd) { nd = dd; nb = o; } }
              if (nb) { s.bounces--; s.tid = nb.id; s.dmg *= s.bounceMult; s.lx = nb.x; s.ly = nb.y - 14; keep.push(s); continue; }
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

  // ---------------------------------------------------------------- скелеты Казармы
  // Скелет — сущность состояния S.skels: { id, tw (id башни), cell (клетка дороги), x, y, hp, max, dmg, hit (с между ударами),
  //   cd (до удара), reach (px), foe (id удерживаемого врага, 0 — свободен), face, born, hitT, grip, burst, burstR (px) }.
  // Числа — из итоговых характеристик башни в момент призыва (как у снаряда). Свободный скелет хватает ближайшего врага в reach,
  // которого не держит другой скелет; враг с unstoppable (босс) не хватается. Удержанный враг стоит и бьёт скелета
  // с силой melee своего типа в секунду; скелет бьёт его раз в hit с. Погибший скелет сдвигает призыв своей башни на её интервал.
  // Без своей башни скелет рассыпается (продажа, перенос, башня убрана из состояния).
  // клетки дороги в радиусе башни, от ближней к дальней (куда Казарма ставит скелетов; подсветка в сцене)
  const skelCells = (S, tw, st) => { const [x, y] = cellXY(S, tw.cell), r = (st || towerStats(S, tw)).rangePx, out = [];
    for (const c of S.map.road) { const [cx, cy] = cellXY(S, c), d = Math.hypot(cx - x, cy - y); if (d <= r) out.push([c, d]); }
    return out.sort((a, b) => a[1] - b[1] || a[0] - b[0]).map((c) => c[0]); };
  const SKEL_FX = { kind: 'phys' };
  // примесь Казармы: враг e, убитый гибридом tw, встаёт его скелетом на ближайшей клетке дороги — не чаще раза в raiseCd с и не
  // больше raiseMax поднятых сразу (числа из итоговых характеристик гибрида)
  const raise = (S, e, tw) => {
    if (!isHybrid(tw) || !TW[tw.mix].mix.add.raiseCd) return; const st = towerStats(S, tw);
    if (!(st.raiseCd > 0) || S.t - tw.raiseT < st.raiseCd || S.skels.filter((s) => s.tw === tw.id && s.raised).length >= st.raiseMax) return;
    let cell = S.map.road[0], bd = Infinity; for (const c of S.map.road) { const [x, y] = cellXY(S, c), d = Math.hypot(x - e.x, y - e.y); if (d < bd) { bd = d; cell = c; } }
    const s = makeSkel(S, tw, cell, Object.assign({}, st, { hp: st.raiseHp, dmg: st.dmg * st.raiseDmg, hit: st.raiseHit, reach: st.raiseReach }), 0);
    s.x = e.x; s.y = e.y; s.raised = true; S.skels.push(s); tw.raiseT = S.t;
    ev(S, 'summon', { x: s.x, y: s.y, cell: tw.cell, raised: true }); };
  // новый скелет башни tw на клетке дороги cell; n — сколько её скелетов уже на этой клетке (сдвиг вбок, чтобы не слипались)
  const makeSkel = (S, tw, cell, st, n) => { const [x, y] = cellXY(S, cell), off = n ? (n % 2 ? 1 : -1) * 14 * Math.ceil(n / 2) : 0;
    return { id: S.nid++, tw: tw.id, cell, x: x + off, y: y + Math.abs(off) * 0.3, hp: st.hp, max: st.hp, dmg: st.dmg, hit: st.hit, cd: 0, reach: st.reach * UNIT,
      foe: 0, face: 1, born: S.t, hitT: -9, grip: st.grip || 0, burst: (st.burst || 0) * st.dmg, burstR: (st.burstR || 0) * UNIT, fx: fxOf(tw, st) }; };
  // призыв: до лимита; клетка — ближайшая из тех, где своих скелетов меньше всего. Сработал ли (перезарядка — по нему)
  const summon = (S, tw, st) => {
    const mine = S.skels.filter((s) => s.tw === tw.id); if (mine.length >= st.limit) return false;
    const cells = skelCells(S, tw, st); if (!cells.length) return false;
    const on = (c) => mine.filter((s) => s.cell === c).length, cell = cells.reduce((b, c) => (on(c) < on(b) ? c : b), cells[0]);
    const s = makeSkel(S, tw, cell, st, on(cell)); S.skels.push(s);
    ev(S, 'summon', { x: s.x, y: s.y, cell: tw.cell });
    return true; };
  // скелеты башни рассыпаются (продажа, перенос)
  const dismiss = (S, tw) => { S.skels = S.skels.filter((s) => { if (s.tw !== tw.id) return true; ev(S, 'skelDie', { x: s.x, y: s.y }); return false; }); };
  // шаг скелетов — до движения врагов. Возвращает id удержанных врагов: в этом шаге они стоят
  const stepSkels = (S) => {
    const held = new Set(); if (!S.skels.length) return held;
    const DT = S.dt, keep = [];
    S.skels = S.skels.filter((s) => towerOf(S, s.tw));
    for (const s of S.skels) { const e = s.foe ? findEnemy(S, s.foe) : null;
      if (e && !e.dead && !held.has(e.id)) held.add(e.id); else s.foe = 0; }
    for (const s of S.skels) if (!s.foe) { let best = null, bd = s.reach;
      for (const e of S.enemies) if (!e.dead && !held.has(e.id) && !EN[e.type].unstoppable) { const d = Math.hypot(e.x - s.x, e.y - s.y); if (d <= bd) { bd = d; best = e; } }
      if (best) { s.foe = best.id; held.add(best.id); } }
    for (const s of S.skels) {
      if (s.cd > 0) s.cd -= DT;
      const e = s.foe ? findEnemy(S, s.foe) : null; if (!e) continue;
      s.face = e.x >= s.x ? 1 : -1;
      if (s.grip) { e.curse = Math.max(e.curseT > 0 ? e.curse : 0, s.grip); e.curseT = Math.max(e.curseT, 0.25); }   // Мёртвая хватка
      if (s.cd <= 0) { s.cd = Math.max(0, s.cd + s.hit); s.hitT = S.t;
        ev(S, 'hit', { x: e.x, y: e.y - 14, kind: 'skel' });
        strike(S, e, s.dmg, s.fx || SKEL_FX, towerOf(S, s.tw), s.tw);   // удар — с эффектами башни (примесь гибрида)
        if (e.dead) { s.foe = 0; continue; } }
      s.hp -= (EN[e.type].melee === undefined ? C.MELEE : EN[e.type].melee) * DT;
    }
    for (const s of S.skels) { if (s.hp > 0) { keep.push(s); continue; }
      const tw = towerOf(S, s.tw); ev(S, 'skelDie', { x: s.x, y: s.y });
      if (s.burst) { for (const e of S.enemies) if (!e.dead && Math.hypot(e.x - s.x, e.y - s.y) <= s.burstR) damage(S, e, s.burst, 'phys', tw);   // Костяной взрыв
        ev(S, 'burst', { x: s.x, y: s.y, r: s.burstR }); }
      if (s.foe) held.delete(s.foe);
      if (tw) tw.cd = Math.max(tw.cd, towerStats(S, tw).rate); }
    S.skels = keep;
    return held;
  };

  // ---------------------------------------------------------------- шаг
  const step = (S, inp) => {
    const DT = S.dt;
    dropIndex();
    if (inp && Array.isArray(inp.cmds)) for (const c of inp.cmds) doCmd(S, c);
    S.t += DT;
    if (S.phase === 'won' || S.phase === 'lost' || S.phase === 'relic') { pruneEv(S); return; }   // на выборе реликвии время забега стоит
    S.stats.time += DT;
    // таймер паузы стартует только существующую волну (как и команда вызова): забег после последней волны не падает
    if (S.phase === 'prep' && S.prepT > 0) { S.prepT -= DT; if (S.prepT <= 0 && S.wave < lastWave(S)) startWave(S); }
    if (S.phase === 'wave') {
      S.waveT += DT;
      while (S.qi < S.queue.length && S.queue[S.qi].at <= S.waveT) spawnEnemy(S, S.queue[S.qi++].e, 0);
    }
    // ауры паладинов
    const bosses = S.enemies.filter((e) => !e.dead && EN[e.type].aura);
    for (const e of S.enemies) { e.aura = 0; for (const b of bosses) if (b !== e && Math.hypot(b.x - e.x, b.y - e.y) <= EN[b.type].auraR * UNIT) e.aura = EN[b.type].aura; }
    // знамёна: соседи знаменосца быстрее (не складываются); убит знаменосец — на следующем шаге ускорения нет
    const banners = S.enemies.filter((e) => !e.dead && EN[e.type].haste);
    for (const e of S.enemies) { e.haste = 0; for (const b of banners) if (b !== e && Math.hypot(b.x - e.x, b.y - e.y) <= EN[b.type].hasteR * UNIT) e.haste = Math.max(e.haste, EN[b.type].haste); }
    const held = stepSkels(S);                                        // скелеты: схватка, удары, гибель; кого держат
    // враги: статусы, лечение, движение
    for (const e of S.enemies) {
      if (e.dead) continue; const def = EN[e.type];
      if (e.slowT > 0) { e.slowT -= DT; if (e.slowT <= 0) e.slowK = 0; }
      if (e.freezeT > 0) e.freezeT -= DT;
      if (e.stunT > 0) e.stunT -= DT;
      if (e.stunG > 0) e.stunG -= DT;
      if (e.curseT > 0) e.curseT -= DT;
      if (e.shredT > 0) { e.shredT -= DT; if (e.shredT <= 0) e.shred = 0; }
      for (const key in e.poison) { const p = e.poison[key]; damage(S, e, p.dps * DT, 'poison', towerOf(S, p.tw)); p.t -= DT; if (p.t <= 0) delete e.poison[key]; if (e.dead) break; }
      if (e.dead) continue;
      if (def.heal) { e.healCD -= DT; if (e.healCD <= 0) { e.healCD = def.healEvery; const amt = e.heal; let any = false;
        const hurt = S.enemies.filter((o) => !o.dead && !EN[o.type].boss && o.hp < o.max && S.t - (o.healedT || -9) >= def.healLock && Math.hypot(o.x - e.x, o.y - e.y) <= def.healR * UNIT)
          .sort((p, q) => p.hp / p.max - q.hp / q.max || p.id - q.id).slice(0, def.healTargets);
        for (const o of hurt) { o.hp = Math.min(o.max, o.hp + amt); o.healedT = S.t; any = true; }
        ev(S, 'heal', { x: e.x, y: e.y, any }); } }
      const v = e.freezeT > 0 || e.stunT > 0 || held.has(e.id) ? 0 : e.speed * (1 + e.haste) * (e.slowT > 0 ? 1 - e.slowK : 1);
      e.d += v * DT; placeEnemy(S, e, v * DT);
      if (e.d >= pathLen(S)) { const [cx, cy] = routeOf(S.map).crypt;
        e.dead = true; e.leaked = true; S.hp = Math.max(0, S.hp - def.leak); S.stats.leaked += def.leak; ev(S, 'leak', { x: cx, y: cy, dmg: def.leak, boss: !!def.boss });
        if (hasRelic(S, 'toll')) { S.souls += e.bounty; S.stats.earned += e.bounty; ev(S, 'toll', { x: cx, y: cy - 40, souls: e.bounty }); } }   // Плата за проход
    }
    // облака яда
    for (const c of S.clouds) {
      c.t -= DT; const tw = towerOf(S, c.tw);
      for (const e of S.enemies) if (!e.dead && Math.hypot(e.x - c.x, (e.y - c.y) * 1.4) <= c.r) {
        const key = 'p' + c.tw, old = e.poison[key];
        e.poison[key] = { dps: Math.max(c.dps, old ? old.dps : 0), t: c.linger, tw: c.tw, pest: c.pest || (old ? old.pest : null) };
        if (!old && hasRelic(S, 'caustic')) damage(S, e, c.dps * RL.caustic.burst, 'poison', tw);   // Едкая плоть: урон сразу при заражении
        // эффекты попадания облака (Кислота и примеси) — каждый шаг внутри; шансы и пронзание — при первом касании (c.hit).
        // Удар облака — его яд за секунду. Щит разведчика гасит первое касание, как и любое попадание
        if (e.dead || e.ward > 0) continue;
        if (!Array.isArray(c.hit)) c.hit = [];
        const first = !c.hit.includes(e.id); if (first) c.hit.push(e.id);
        effects(S, e, c.dps, c.fx, c.tw, first); if (first) pierce(S, e, c.dps, c.fx, tw, c.tw);
      }
      if (!tw && c.t > 0.5) c.t = 0.5;
    }
    S.clouds = S.clouds.filter((c) => c.t > 0);
    // башни
    // перезарядка с переносом остатка шага: средний интервал выстрелов — ровно rate при любом шаге (иначе крупный шаг
    // округляет каждый интервал вверх до целого числа шагов и скорострельные башни теряют до нескольких процентов урона)
    for (const tw of S.towers) { if (!tw || !attackOf(tw)) continue; tw.cd -= DT; if (tw.cd <= 0) { const st = fire(S, tw); tw.cd = st ? Math.max(0, tw.cd + st.rate) : 0.05; } }
    stepShots(S);
    S.enemies = S.enemies.filter((e) => !e.dead);
    S.beams = S.beams.filter((b) => S.t - b.t < 0.35);
    // конец волны / партии
    if (S.hp <= 0 && S.phase !== 'lost') { S.phase = 'lost'; ev(S, 'lose', {}); }
    else if (S.phase === 'wave' && S.qi >= S.queue.length && !S.enemies.length) {
      // Десятина — сумма по реликвиям; Ростовщик — доля душ в запасе до награды
      const interest = hasRelic(S, 'usury') ? Math.min(RL.usury.interestMax, Math.floor(S.souls * RL.usury.interest)) : 0;
      const bonus = C.WAVE_BONUS(S.wave) + relicSum(S, 'waveSouls') + interest; S.souls += bonus; S.stats.earned += bonus;
      ev(S, 'waveClear', { wave: S.wave, bonus });
      if (S.wave >= lastWave(S)) { S.phase = 'won'; S.wonStats = Object.assign({}, S.stats); ev(S, 'win', {}); }
      else { S.phase = 'prep'; S.prepT = C.PREP_TIME; if (relicDue(S.wave)) offerRelics(S); }
    }
    pruneEv(S);
  };
  // выбор реликвии после волны: забег встаёт, пока игрок не выберет (таймер паузы ждёт полным); открытых не осталось — выбора нет
  const offerRelics = (S) => { const o = drawRelics(S.seed, S.wave, S.relics, S.unlocked); if (!o.length) return;
    S.offer = o; S.phase = 'relic'; ev(S, 'relicOffer', { wave: S.wave }); };
  // реликвия для интерфейса: { id, name, icon, kind, desc } — описание с числами из её данных
  const relicText = (id) => { const r = RL[id], t = r.tower || {};
    return fill(r.desc, Object.assign({}, r, r.take || {}, t, t.set || {}, t.mul || {}, t.add || {})); };
  const relicInfo = (id) => ({ id, name: RL[id].name, icon: RL[id].icon, kind: RL[id].kind, desc: relicText(id) });
  const relicOffer = (S) => (S.phase === 'relic' && S.offer ? S.offer.map(relicInfo) : null);
  const relicsOf = (S) => S.relics.map(relicInfo);
  const pruneEv = (S) => { if (S.ev.length > 300 || (S.ev.length && S.t - S.ev[0].t > 4)) S.ev = S.ev.filter((e) => S.t - e.t < 4).slice(-300); };

  // ---------------------------------------------------------------- демо (титульный экран): сгенерированная карта, оборона на лучших клетках, самая людная волна
  const DEMO_SEED = 99;
  // волна демо: из 5–12-й без босса — с наибольшим числом врагов, укладывающаяся в 0.8 петли (по дороге всё время идут
  // враги); если после перенастройки ни одна не укладывается — самая людная из них, если и таких нет — 5-я
  const demoN = () => { const ws = [5, 6, 7, 8, 9, 10, 11, 12].map((n) => WAVEGEN.wave(DEMO_SEED, n)).filter((w) => !w.boss);
    const by = (a, b) => b.total.count - a.total.count || a.n - b.n, fit = ws.filter((w) => w.duration <= LOOP * 0.8).sort(by);
    return (fit[0] || ws.sort(by)[0] || { n: 5 }).n; };
  // [тип, ступеней]: ступени раскладываются по веткам по кругу DEMO_UP
  const DEMO_BUILD = [['bones', 6], ['dark', 5], ['plague', 3], ['spirits', 5], ['dark', 3], ['bones', 3], ['plague', 5],
    ['spirits', 3], ['dark', 10], ['bones', 3], ['plague', 0], ['spirits', 3], ['dark', 3]];
  const DEMO_UP = ['dmg', 'rate', 'range'];
  const demoState = () => {
    const S = create(DEMO_SEED), best = rankCells(S, C.TYPICAL_RANGE); S.souls = 99999; S.demo = true;
    for (const [i, [type, n]] of DEMO_BUILD.entries()) { const cell = best[i];
      doCmd(S, { k: 'build', cell, type }); for (let l = 0; l < n; l++) doCmd(S, { k: 'upgrade', cell, track: DEMO_UP[l % DEMO_UP.length] }); }
    S.demoWave = demoN(); S.wave = S.demoWave - 1; startWave(S); S.souls = 340; S.hp = 16; S.ev = [];
    return S;
  };
  const LOOP = 60, WARM_ENEMIES = 10, WARM_MAX = 40;
  // шаг демо: зачищенная волна сразу начинается заново (prepT = шаг: таймер дойдёт до нуля на следующем шаге), души и прочность не меняются
  const demoStep = (S) => { step(S, null); if (S.phase === 'prep') { S.wave = S.demoWave - 1; S.prepT = S.dt; } S.souls = 340; S.hp = 16; };
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
    create, step, at, selfCheck, doCmd, waveCount, lastWave, canEndless, relicDue, isBoss, preview, scoutRange, remaining, enemyStats, WAVEGEN, fill, perkText, perksOf, hasPerk, freeSlots, muzzleH,
    canBuild, buildRangePx, buildStats, cellBonus, spotCoverage, canUpgrade, canPerk, towerStats, ownStats, rangePx, ATTACKS, art, trackText, steps, look, loadable, parseSeed, coverage, rankCells, cellXY, routeOf, pathLen, posAt, muzzle, rangeTiles, sellValue,
    spawn: () => create(), outOfPlay: () => false,
    canMove, moveCells, moveRangePx, canGrim, grimLines, grimBonus,
    hasRelic, drawRelics, relicOffer, relicsOf, relicText, perkAt,
    hasAura, auraTargets, auraCells, auraOf: (tw) => !!auraType(tw),
    canMerge, mergeTargets, mergeInfo, hybridInfo, isHybrid, towerArt, perkOn, perkGroups, mixText, mixOn,
    skelCells,
  };
  if (typeof module !== 'undefined') module.exports = SIM;
  if (typeof window !== 'undefined') window.SIM = SIM;
})();
