import test from 'node:test';
import assert from 'node:assert/strict';
import SIM from '../live/sim.js';

const C = SIM.CONFIG, towers = C.TOWERS;
const freeCells = (S) => S.towers.map((_, i) => i).filter((i) => SIM.canBuild(S, i, 'bones').ok);

test('позиция на дороге зажимается по концам, а совпадающие точки дают конечные координаты', (t) => {
  const map = { cols: 2, road: [0, 1] };
  t.mock.method(SIM.MAPGEN, 'route', () => [[8, 16], [24, 16]]);
  assert.deepEqual(SIM.posAt({ map }, -1), { x: 8, y: 16, tx: 1, ty: 0 });
  assert.deepEqual(SIM.posAt({ map }, 4), { x: 12, y: 16, tx: 1, ty: 0 });
  assert.deepEqual(SIM.posAt({ map }, 50), { x: 24, y: 16, tx: 1, ty: 0 });
  SIM.MAPGEN.route.mock.mockImplementation(() => [[8, 16], [8, 16]]);
  const point = { map: { ...map } };
  assert.equal(SIM.pathLen(point), 0);
  assert.deepEqual(SIM.posAt(point, 4), { x: 8, y: 16, tx: 0, ty: 0 });
});

test('аура и слияние отклоняют отсутствующие клетки, башни и неизвестный тип', () => {
  const S = SIM.create(), [cell, empty] = freeCells(S);
  SIM.doCmd(S, { k: 'build', cell, type: 'bones' });
  assert.deepEqual(SIM.auraCells(S, -1, 'altar'), []);
  assert.deepEqual(SIM.auraTargets(S, cell, empty), []);
  assert.deepEqual(SIM.auraCells(S, cell, 'unknown'), []);
  assert.equal(SIM.canMerge(S, String(cell), empty).reason, 'none');
  assert.equal(SIM.mergeInfo(S, String(cell), empty), null);
  assert.equal(SIM.mergeInfo(S, cell, String(empty)), null);
  assert.equal(SIM.perkOn(S.towers[cell], 'unknown'), false);
});

test('после победы и поражения постройка, ветка и доступный перк сохраняют цену и причину отказа', () => {
  const S = SIM.create(1), [cell, empty] = freeCells(S);
  S.souls = 10000;
  SIM.doCmd(S, { k: 'build', cell, type: 'bones' });
  const levels = { dmg: 3, range: 3, rate: 0 };
  SIM.doCmd(S, { k: 'upgradeSet', cell, towerId: S.towers[cell].id, levels });
  const build = SIM.canBuild(S, empty, 'bones');
  const upgrade = SIM.canUpgrade(S, cell, 'rate');
  const perk = SIM.canPerk(S, cell, 'crush');
  for (const quote of [build, upgrade, perk]) assert.equal(quote.ok, true);
  assert.equal(perk.need, 0);
  for (const phase of ['won', 'lost']) {
    S.phase = phase;
    assert.deepEqual(SIM.canBuild(S, empty, 'bones'), { ...build, ok: false, reason: 'ended' });
    assert.deepEqual(SIM.canUpgrade(S, cell, 'rate'), { ...upgrade, ok: false, reason: 'ended' });
    assert.deepEqual(SIM.canPerk(S, cell, 'crush'), { ...perk, ok: false, reason: 'ended' });
    assert.deepEqual(SIM.upgradeQuote(S, cell, levels), { ok: false, reason: 'phase', cost: null });
  }
});

test('набор улучшений требует башню и цену каждой ступени, включая последнюю', (t) => {
  const S = SIM.create(1), [cell] = freeCells(S);
  const levels = { dmg: 2, range: 0, rate: 0 };
  assert.deepEqual(SIM.upgradeQuote(S, cell, levels), { ok: false, reason: 'none', cost: null });
  S.souls = 10000;
  SIM.doCmd(S, { k: 'build', cell, type: 'bones' });
  const track = towers.bones.tracks.dmg, costs = track.cost;
  t.after(() => { track.cost = costs; });
  track.cost = costs.slice(0, 1);
  const tw = S.towers[cell], before = structuredClone(tw), souls = S.souls;
  assert.deepEqual(SIM.upgradeQuote(S, cell, levels), { ok: false, reason: 'price', cost: null });
  SIM.doCmd(S, { k: 'upgradeSet', cell, towerId: tw.id, levels });
  assert.deepEqual(tw, before);
  assert.equal(S.souls, souls);
});

test('расцветка гибрида берёт модель первой башни и цвет примеси, исходные типы сохраняются', (t) => {
  const first = SIM.art('bones'), mix = SIM.art('dark');
  assert.deepEqual(SIM.towerArt({ type: 'bones', mix: null }), first);
  const hybrid = { type: 'bones', mix: 'dark' }, art = SIM.towerArt(hybrid);
  assert.equal(art.hybrid, true);
  assert.equal(art.sprite, first.sprite);
  assert.equal(art.icon, towers.dark.mix.icon);
  assert.deepEqual(art.color, mix.color);
  assert.deepEqual(art.own, first.color);
  const [gain, alpha] = C.MERGE.tint;
  assert.deepEqual(art.tint, [...mix.color.map((component) => component * gain), alpha]);
  assert.deepEqual(SIM.art('bones'), first);
  assert.deepEqual(SIM.art('dark'), mix);

  const original = towers.dark.art;
  t.after(() => { towers.dark.art = original; });
  const tint = [1, 0.5, 0.1, 0.25];
  towers.dark.art = { ...original, tint };
  assert.deepEqual(SIM.towerArt(hybrid).tint, tint);
});

test('описания берут числа из данных, даже у типа без дополнительных характеристик', (t) => {
  const bones = towers.bones, perk = bones.perks.crush, action = perk.act;
  t.after(() => { towers.bones = bones; perk.act = action; });
  towers.bones = { ...bones, extra: undefined };
  assert.equal(SIM.trackText('bones', 'dmg', { dmg: 5.125 }), '5.13');
  assert.equal(SIM.perkAct('crush'), '−50% брони цели');
  assert.equal(SIM.mixText('bones'), SIM.fill(bones.mix.desc, bones.mix.add));
  delete perk.act;
  assert.equal(SIM.perkAct('crush'), '');
  assert.throws(() => SIM.fill('{missing}', { other: 2 }), /нет числа missing/);
  assert.throws(() => SIM.fill('{base:dmg}', { dmg: 2 }), /нет числа dmg/);
});
