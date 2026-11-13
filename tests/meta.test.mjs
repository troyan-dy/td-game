// node --test tests/*.test.mjs — открытия и рекорды (live/meta.js): новый профиль, достижения и что они открывают,
// рекорды, бесконечный режим без двойного счёта, «Открыть всё», порча профиля, итог забега из состояния сима.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const SIM = require('../live/sim.js');
const META = require('../live/meta.js');
const C = SIM.CONFIG, U = C.UNLOCKS, RUN = SIM.waveCount();

// конфиг «как в спецификации»: семь типов башен и пул из 20 реликвий — каталог не привязан к именам
const NEW = ['t5', 't6', 't7'], RELICS = Array.from({ length: 20 }, (_, i) => 'r' + (i + 1));
const fullCfg = (relics = RELICS, extra = NEW) => Object.assign({}, C, {
  TOWER_ORDER: C.TOWER_ORDER.slice(0, 4).concat(extra),
  TOWERS: Object.assign({}, C.TOWERS, Object.fromEntries(extra.map((id) => [id, { name: id.toUpperCase(), title: 'Башня ' + id }]))),
  RELICS: Object.fromEntries(relics.map((id) => [id, { name: 'Реликвия ' + id }])),
});
const FULL = META.catalog(fullCfg());
const BARE = META.catalog(Object.assign({}, C, { TOWER_ORDER: C.TOWER_ORDER.slice(0, 4), RELICS: undefined }));
const OLD = C.TOWER_ORDER.slice(0, 4);
const ach = (id) => U.achievements.find((a) => a.id === id);
// итог забега: поражение на волне wave или победа; stats — счётчики забега
const lost = (wave, stats = {}) => ({ wave, won: false, endless: false, time: null, stats: Object.assign({ kills: 0, time: 60 * wave }, stats) });
const win = (time, stats = {}) => ({ wave: RUN, won: true, endless: false, time, stats: Object.assign({ kills: 0, time }, stats) });
const freeze = (o) => { Object.freeze(o); for (const k in o) if (o[k] && typeof o[k] === 'object') freeze(o[k]); return o; };

test('новый профиль: открыты четыре старые башни и стартовые реликвии, рекордов нет', () => {
  const p = META.fresh(FULL), open = META.unlocked(p, FULL);
  assert.deepEqual(open.filter((id) => FULL.items.find((it) => it.id === id).kind === 'tower'), OLD);
  assert.deepEqual(open.filter((id) => id.startsWith('r')), RELICS.slice(0, U.startRelics));
  for (const id of NEW.concat(RELICS.slice(U.startRelics))) assert.ok(!open.includes(id), id + ' открыт в новом профиле');
  assert.equal(p.best, 0); assert.equal(p.wins, 0); assert.equal(p.fastest, null); assert.deepEqual(p.done, []);
  assert.deepEqual(p.unlocked, open, 'профиль хранит список открытого');
});

test('закрытую башню нового профиля нельзя построить, открытые — можно', () => {
  const p = META.fresh(), S = SIM.create(4, { unlocked: META.unlocked(p) }); S.souls = 1e5;
  const cells = SIM.rankCells(S, C.TYPICAL_RANGE);
  C.TOWER_ORDER.forEach((type, i) => {
    const cb = SIM.canBuild(S, cells[i], type), open = i < U.startTowers;
    assert.equal(cb.ok, open, type); if (!open) assert.equal(cb.reason, 'locked');
  });
});

test('каждое достижение открывает по одному: башни по порядку TOWER_ORDER, реликвии по порядку пула', () => {
  // у каждого закрытого — своё достижение, и одно достижение — не больше одного открытия
  const locked = FULL.items.filter((it) => !it.start);
  assert.equal(locked.length, NEW.length + RELICS.length - U.startRelics);
  for (const it of locked) assert.ok(it.by, it.id + ' нечем открыть');
  assert.equal(new Set(locked.map((it) => it.by)).size, locked.length, 'одно достижение открывает больше одного');
  assert.deepEqual(locked.filter((it) => it.kind === 'tower').map((it) => it.id), NEW);
  assert.deepEqual(locked.filter((it) => it.kind === 'relic').map((it) => it.id), RELICS.slice(U.startRelics));
});

test('дойти до волны 10, победить, первое слияние — по башне; рекорды обновляются', () => {
  let p = META.fresh(FULL), r = META.apply(freeze(p), lost(10), FULL);
  assert.ok(r.done.includes('wave10'));
  assert.deepEqual(r.opened.filter((o) => o.kind === 'tower').map((o) => o.id), [FULL.items.find((it) => it.by === 'wave10').id]);
  assert.equal(r.profile.best, 10); assert.equal(r.profile.wins, 0); assert.equal(r.profile.runs, 1);
  assert.equal(p.best, 0, 'apply не меняет входной профиль');
  // та же волна ещё раз — ничего нового
  const again = META.apply(r.profile, lost(10), FULL);
  assert.deepEqual(again.opened, []); assert.deepEqual(again.done, []);
  p = META.apply(r.profile, win(1700), FULL).profile;
  assert.equal(p.wins, 1); assert.equal(p.fastest, 1700); assert.equal(p.best, RUN);
  assert.ok(META.unlocked(p, FULL).includes(FULL.items.find((it) => it.by === 'win').id));
  p = META.apply(p, win(2100), FULL).profile; assert.equal(p.fastest, 1700, 'быстрейшая — меньшая');
  p = META.apply(p, win(1500), FULL).profile; assert.equal(p.fastest, 1500); assert.equal(p.wins, 3);
  // первое слияние: счётчик слияний в статистике забега (появится со слиянием)
  const m = META.apply(p, lost(3, { merges: 1 }), FULL);
  assert.ok(m.done.includes(ach('merge').id));
  assert.ok(m.opened.some((o) => o.id === FULL.items.find((it) => it.by === 'merge').id));
  assert.ok(NEW.every((id) => META.unlocked(m.profile, FULL).includes(id)), 'три достижения открыли три новые башни');
});

test('500 убийств суммарно: счёт копится между забегами', () => {
  let p = META.fresh(FULL);
  for (let i = 0; i < 4; i++) { const r = META.apply(p, lost(2, { kills: 120 }), FULL); p = r.profile; assert.ok(!r.done.includes('kills500')); }
  assert.equal(p.totals.kills, 480);
  const r = META.apply(p, lost(2, { kills: 20 }), FULL);
  assert.ok(r.done.includes('kills500'));
  assert.equal(r.opened.length >= 1, true);
  assert.ok(r.opened.some((o) => o.id === FULL.items.find((it) => it.by === 'kills500').id));
});

test('победа и потом бесконечный режим: победа и счётчики забега не считаются дважды', () => {
  const at = { kills: 400, time: 1800, earned: 9000 };
  let p = META.apply(META.fresh(FULL), win(1800, at), FULL).profile;
  const endless = { wave: RUN + 7, won: true, endless: true, time: 1800, stats: { kills: 650, time: 2600, earned: 15000 }, base: at };
  const r = META.apply(p, endless, FULL);
  p = r.profile;
  assert.equal(p.wins, 1); assert.equal(p.runs, 1); assert.equal(p.fastest, 1800);
  assert.equal(p.best, RUN + 7);
  assert.equal(p.totals.kills, 650); assert.equal(p.totals.earned, 15000);
  assert.ok(r.done.includes('kills500'), 'суммарные убийства дошли до 500 только с бесконечным режимом');
});

test('типов башен четыре и пул реликвий пуст: открывать нечего, достижения отмечаются', () => {
  const p = META.fresh(BARE);
  assert.deepEqual(META.unlocked(p, BARE), OLD);
  const r = META.apply(p, win(1600, { kills: 900, merges: 2 }), BARE);
  assert.deepEqual(r.opened, []);
  assert.ok(['wave10', 'win', 'merge', 'kills500'].every((id) => r.done.includes(id)));
  // достижение уже есть, а предмет появился позже (влили новые башни) — он открыт сразу, без нового забега
  const later = META.catalog(fullCfg());
  for (const id of ['wave10', 'win', 'merge']) assert.ok(META.unlocked(r.profile, later).includes(later.items.find((it) => it.by === id).id));
});

test('«Открыть всё»: открыто всё, и то, что появится в конфиге позже; рекорды и достижения копятся дальше', () => {
  const p = META.unlockAll(META.fresh(BARE), BARE);
  assert.equal(META.unlocked(p, BARE), null, 'null — открыто всё (SIM.create)');
  assert.equal(META.unlocked(p, FULL), null);
  assert.deepEqual(p.unlocked.slice().sort(), BARE.items.map((it) => it.id).sort());
  const r = META.apply(p, lost(12), FULL);
  assert.deepEqual(r.opened, [], 'всё уже открыто'); assert.ok(r.done.includes('wave10')); assert.equal(r.profile.best, 12);
  const S = SIM.create(4, { unlocked: META.unlocked(p) }); S.souls = 1e5;
  const cells = SIM.rankCells(S, C.TYPICAL_RANGE);
  C.TOWER_ORDER.forEach((type, i) => assert.equal(SIM.canBuild(S, cells[i], type).ok, true, type));
});

test('профиль из хранилища: годный читается как есть, испорченный — новый профиль', () => {
  let p = META.fresh(FULL); p = META.apply(p, win(1650, { kills: 700 }), FULL).profile;
  assert.deepEqual(META.load(JSON.parse(JSON.stringify(p)), FULL), p);
  const fresh = META.fresh(FULL);
  const bad = [null, undefined, 5, 'x', [], {}, Object.assign({}, p, { v: 99 }), Object.assign({}, p, { best: -1 }), Object.assign({}, p, { wins: 1.5 }),
    Object.assign({}, p, { fastest: 'быстро' }), Object.assign({}, p, { done: 'win' }), Object.assign({}, p, { unlocked: [1, 2] }),
    Object.assign({}, p, { totals: { kills: 'много' } }), Object.assign({}, p, { totals: null }), Object.assign({}, p, { all: 1 }),
    Object.assign({}, p, { runs: Infinity }), Object.assign({}, p, { best: NaN })];
  for (const b of bad) assert.deepEqual(META.load(b, FULL), fresh, JSON.stringify(b));
});

test('итог забега из состояния сима: поражение, победа, бесконечный режим', () => {
  const S = SIM.create(5, { dt: 1 / 30 });
  S.phase = 'wave'; S.wave = 7; S.stats.kills = 33; S.hp = 0; SIM.step(S, null);
  assert.equal(S.phase, 'lost');
  assert.deepEqual(META.result(S), { wave: 7, won: false, endless: false, time: null, stats: S.stats, base: null });
  // победа: время победы запоминается в состоянии (S.wonStats), оно же — быстрейшая победа и после бесконечного режима
  const W = SIM.create(5, { dt: 1 / 30 }); W.wave = RUN - 1; SIM.step(W, { cmds: [{ k: 'call' }] });
  W.qi = W.queue.length; W.enemies = []; W.stats.time = 1777; SIM.step(W, null);
  assert.equal(W.phase, 'won'); assert.deepEqual(W.wonStats, W.stats); assert.notEqual(W.wonStats, W.stats);
  assert.equal(SIM.loadable(JSON.parse(JSON.stringify(W))), true);
  const rw = META.result(W); assert.equal(rw.won, true); assert.equal(rw.endless, false); assert.equal(rw.time, W.stats.time);
  SIM.step(W, { cmds: [{ k: 'endless' }] }); SIM.step(W, { cmds: [{ k: 'call' }] }); W.stats.time += 300; W.stats.kills += 50; W.hp = 0; SIM.step(W, null);
  const re = META.result(W);
  assert.equal(re.won, true); assert.equal(re.endless, true); assert.equal(re.wave, RUN + 1); assert.equal(re.time, W.wonStats.time); assert.equal(re.base, W.wonStats);
  assert.equal(SIM.loadable(JSON.parse(JSON.stringify(Object.assign(SIM.create(5), { wonStats: W.wonStats })))), true, 'сейв с запомненной победой годен');
});

test('конфиг достижений: id без повторов, награда — башня или реликвия, условия из известных', () => {
  const ids = U.achievements.map((a) => a.id); assert.equal(new Set(ids).size, ids.length);
  const KEYS = new Set(['id', 'name', 'desc', 'gives', 'wave', 'win', 'faster', 'run', 'runMax', 'total']);
  for (const a of U.achievements) {
    assert.ok(['tower', 'relic'].includes(a.gives), a.id); assert.ok(a.name && a.desc, a.id);
    for (const k in a) assert.ok(KEYS.has(k), `${a.id}: неизвестное условие ${k}`);
  }
  for (const id of ['wave10', 'win', 'merge', 'kills500']) assert.ok(ach(id), 'нет достижения ' + id);
  // на текущем конфиге: каждому закрытому предмету есть достижение
  for (const it of META.catalog().items) assert.ok(it.start || it.by, it.id + ' нечем открыть');
});
