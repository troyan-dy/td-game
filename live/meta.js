// live/meta.js — «Некрополис»: открытия и рекорды между забегами. Чистые функции без DOM и хранилища: профиль + итог
// забега → новый профиль и список открытого. Хранит профиль в браузере только интерфейс (live/ui.js).
// Силы между забегами не прибавляется: профиль только решает, какие башни и реликвии забег получает (SIM.create(seed, { unlocked })).
//
// Профиль — чистый JSON:
//   { v, best, wins, fastest, runs, totals, done, unlocked, all }
//   best — лучшая достигнутая волна; wins — побед; fastest — быстрейшая победа, с игры (null — побед нет); runs — забегов;
//   totals — суммы счётчиков забегов (S.stats) за все забеги; done — id выполненных достижений; unlocked — открытые id
//   (башни и реликвии вместе, как ждёт SIM.create); all — «Открыть всё»: открыто всё, и то, что появится в конфиге позже.
// Каталог (catalog) — что вообще открывается: строится из конфига (C.UNLOCKS, C.TOWER_ORDER, пул C.RELICS), тесты дают свой конфиг.
(function () {
  const C = (typeof window !== 'undefined' && window.CONFIG) || require('./config.js');
  const VERSION = 1;

  // id реликвий пула по порядку конфига: объект id → описание или массив { id, … }; пула нет — пусто
  const relicList = (cfg) => { const R = cfg.RELICS; if (!R) return [];
    return Array.isArray(R) ? R.map((r) => [r.id, r]) : Object.keys(R).map((id) => [id, R[id]]); };
  // каталог: items — { id, kind: 'tower' | 'relic', name, full (полное имя башни), start, by } (by — id достижения, которое открывает предмет, или null);
  // achievements — из конфига, с item — id предмета, который достижение открывает (null — предмета не хватило)
  const catalog = (cfg) => {
    cfg = cfg || C; const U = cfg.UNLOCKS, T = cfg.TOWERS || {};
    const items = cfg.TOWER_ORDER.map((id, i) => ({ id, kind: 'tower', name: (T[id] && (T[id].name || T[id].title)) || id, full: (T[id] && T[id].title) || '', start: i < U.startTowers, by: null }))
      .concat(relicList(cfg).map(([id, r], i) => ({ id, kind: 'relic', name: (r && r.name) || id, start: i < U.startRelics, by: null })));
    const achievements = U.achievements.map((a) => Object.assign({}, a, { item: null }));
    for (const kind of ['tower', 'relic']) {
      const locked = items.filter((it) => it.kind === kind && !it.start);
      achievements.filter((a) => a.gives === kind).forEach((a, i) => { if (locked[i]) { a.item = locked[i].id; locked[i].by = a.id; } });
    }
    return { items, achievements };
  };
  let CAT = null;
  const cat0 = (cat) => cat || CAT || (CAT = catalog());

  const fresh = (cat) => { cat = cat0(cat);
    return { v: VERSION, best: 0, wins: 0, fastest: null, runs: 0, totals: {}, done: [], unlocked: cat.items.filter((it) => it.start).map((it) => it.id), all: false }; };

  // открытое по профилю: стартовое, записанное в профиле и то, что дают выполненные достижения (предмет мог появиться позже достижения)
  const openSet = (p, cat) => {
    if (p.all) return new Set(cat.items.map((it) => it.id).concat(p.unlocked));
    const s = new Set(p.unlocked);
    for (const it of cat.items) if (it.start || (it.by && p.done.includes(it.by))) s.add(it.id);
    return s; };
  // список открытого для SIM.create: id по порядку каталога; null — открыто всё
  const unlocked = (p, cat) => { cat = cat0(cat); if (p.all) return null; const s = openSet(p, cat);
    return cat.items.map((it) => it.id).filter((id) => s.has(id)).concat([...s].filter((id) => !cat.items.some((it) => it.id === id))); };

  // выполнено ли достижение: run — итог забега, tot — суммы за все забеги вместе с этим (и runs, wins)
  const met = (a, run, tot) => {
    const st = (k) => +(run.stats && run.stats[k]) || 0;
    if (a.wave !== undefined && !(run.wave >= a.wave)) return false;
    if (a.win && !run.won) return false;
    if (a.faster !== undefined && !(run.won && run.time !== null && run.time <= a.faster)) return false;
    if (a.run && !Object.keys(a.run).every((k) => st(k) >= a.run[k])) return false;
    if (a.runMax && !Object.keys(a.runMax).every((k) => st(k) <= a.runMax[k])) return false;
    if (a.total && !Object.keys(a.total).every((k) => (tot[k] || 0) >= a.total[k])) return false;
    return true; };

  // Итог забега из состояния сима: { wave, won, endless, time, stats, base }. wave — достигнутая волна; won — забег победил
  // (и тогда, когда после победы продолжился бесконечный режим); time — время победы (S.wonStats; null — победы нет);
  // endless — итог бесконечного режима: сама победа уже засчитана, когда случилась, base — счётчики на момент победы.
  const result = (S) => { const won = S.phase === 'won' || !!S.endless, at = S.wonStats || (won ? S.stats : null);
    return { wave: S.wave, won, endless: !!S.endless, time: at ? at.time : null, stats: S.stats, base: S.endless ? at : null }; };

  // профиль + итог забега → { profile (новый объект, вход не меняется), opened — открытые сейчас предметы
  // [{ id, kind, name, by, byName }], done — id достижений, выполненных этим итогом }.
  // Итог бесконечного режима — продолжение уже засчитанной победы: забег и победа не считаются второй раз, в суммы идёт
  // только прибавка после победы (stats − base).
  const apply = (p, run, cat) => {
    cat = cat0(cat);
    const q = JSON.parse(JSON.stringify(p)), before = openSet(p, cat), base = run.endless && run.base ? run.base : {};
    if (!run.endless) { q.runs++; if (run.won) { q.wins++; if (run.time !== null && (q.fastest === null || run.time < q.fastest)) q.fastest = run.time; } }
    q.best = Math.max(q.best, run.wave || 0);
    for (const k in run.stats || {}) { const v = run.stats[k] - (+base[k] || 0); if (typeof run.stats[k] === 'number' && isFinite(v)) q.totals[k] = (q.totals[k] || 0) + Math.max(0, v); }
    const tot = Object.assign({}, q.totals, { runs: q.runs, wins: q.wins }), done = [];
    for (const a of cat.achievements) if (!q.done.includes(a.id) && met(a, run, tot)) { q.done.push(a.id); done.push(a.id); }
    const after = openSet(q, cat);
    q.unlocked = unlocked(q, cat) || [...after];
    const opened = cat.items.filter((it) => after.has(it.id) && !before.has(it.id))
      .map((it) => ({ id: it.id, kind: it.kind, name: it.name, by: it.by, byName: (cat.achievements.find((a) => a.id === it.by) || {}).name || '' }));
    return { profile: q, opened, done };
  };

  // «Открыть всё»: всё каталога и то, что появится позже; рекорды и достижения остаются
  const unlockAll = (p, cat) => { cat = cat0(cat); const q = JSON.parse(JSON.stringify(p)); q.all = true;
    q.unlocked = [...new Set(q.unlocked.concat(cat.items.map((it) => it.id)))]; return q; };

  // профиль из хранилища: годный — как есть, любой другой (битый, чужой версии, с порчей) — новый профиль
  const cnt = (v) => Number.isInteger(v) && v >= 0;
  const valid = (p) => !!p && typeof p === 'object' && !Array.isArray(p) && p.v === VERSION && cnt(p.best) && cnt(p.wins) && cnt(p.runs)
    && (p.fastest === null || (typeof p.fastest === 'number' && isFinite(p.fastest) && p.fastest >= 0))
    && !!p.totals && typeof p.totals === 'object' && !Array.isArray(p.totals) && Object.values(p.totals).every((v) => typeof v === 'number' && isFinite(v) && v >= 0)
    && [p.done, p.unlocked].every((a) => Array.isArray(a) && a.every((x) => typeof x === 'string')) && typeof p.all === 'boolean';
  const load = (raw, cat) => (valid(raw) ? raw : fresh(cat));

  // экран открытий: что открыто и чем открывается закрытое
  const view = (p, cat) => { cat = cat0(cat); const s = openSet(p, cat);
    return { items: cat.items.map((it) => Object.assign({}, it, { open: s.has(it.id), ach: cat.achievements.find((a) => a.id === it.by) || null })),
      achievements: cat.achievements.map((a) => Object.assign({}, a, { done: p.done.includes(a.id) })) }; };

  const META = { VERSION, catalog, fresh, load, result, apply, unlocked, unlockAll, view };
  if (typeof module !== 'undefined') module.exports = META;
  if (typeof window !== 'undefined') window.META = META;
})();
