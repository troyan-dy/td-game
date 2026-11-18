import test from 'node:test';
import assert from 'node:assert/strict';
import { SIM } from './bots.mjs';

const call = (s) => SIM.doCmd(s, { k: 'call' });
const stake = (s, wave = s.wave + 1) => SIM.doCmd(s, { k: 'hunt', wave });
const clear = (s) => { s.qi = s.queue.length; s.enemies = []; SIM.step(s); };
const before = (n = 11) => {
  const s = SIM.create(4);
  for (let w = 1; w < n; w++) {
    call(s); clear(s);
    if (s.phase === 'relic') SIM.doCmd(s, { k: 'relic', i: 0 });
  }
  return s;
};
// Реальный выход врага на дорогу и проход через порог склепа на следующем шаге.
const pass = (s, type) => {
  const index = s.queue.findIndex((entry, i) => i >= s.qi && entry.e === type);
  assert.ok(index >= 0);
  s.qi = index; s.waveT = s.queue[index].at;
  SIM.step(s); const e = s.enemies.findLast((e) => e.type === type);
  e.d = SIM.pathLen(s); SIM.step(s);
};

test('ставка принимается один раз только на ближайший обоз; вызов волны остаётся отдельным', () => {
  const s = before(), funds = s.souls;
  stake(s, 12); assert.equal(s.souls, funds);
  s.souls = 49; stake(s); assert.equal(s.hunt, null);
  s.souls = funds; stake(s); stake(s);
  assert.equal(s.souls, funds - 50); assert.equal(s.phase, 'prep'); assert.equal(s.hunt.wave, 11);
  assert.ok(SIM.loadable(structuredClone(s)));
  const plain = SIM.create(4); stake(plain); assert.equal(plain.hunt, null);
  SIM.doCmd(s, { k: 'auto', on: true }); s.autoT = s.dt; SIM.step(s);
  assert.equal(s.phase, 'wave'); assert.equal(s.hunt.wave, 11);
  const skipped = before(); SIM.doCmd(skipped, { k: 'auto', on: true });
  skipped.autoT = skipped.dt; SIM.step(skipped); stake(skipped, 11);
  assert.equal(skipped.hunt, null);
});

test('одна прошедшая повозка допускается, остальные враги не учитываются; выплата переживает загрузку ровно один раз', () => {
  const s = before(); stake(s); call(s); pass(s, 'knight'); pass(s, 'cart');
  assert.equal(s.hunt.passed, 1); assert.ok(SIM.loadable(structuredClone(s)));
  const control = structuredClone(s); delete control.hunt; assert.ok(SIM.loadable(control));
  clear(control); clear(s);
  assert.equal(s.souls - control.souls, 125);
  assert.equal(s.stats.earned - control.stats.earned, 125);
  const loaded = structuredClone(s); assert.ok(SIM.loadable(loaded));
  SIM.step(loaded); assert.equal(loaded.souls, s.souls);
  call(loaded); assert.equal(loaded.hunt, null);
});

test('при двух прорвавшихся повозках или гибели склепа ставка сгорает', () => {
  for (const loseCrypt of [false, true]) {
    const s = before(); stake(s); call(s); if (loseCrypt) s.hp = 1;
    const control = structuredClone(s); delete control.hunt;
    for (const side of [s, control]) {
      pass(side, 'cart');
      if (!loseCrypt) { pass(side, 'cart'); clear(side); }
    }
    assert.equal(s.phase, loseCrypt ? 'lost' : 'prep');
    assert.equal(s.souls, control.souls);
    assert.equal(s.ev.find(e => e.k === 'huntEnd')?.won, false);
  }
});

test('ставку можно принять в бесконечном режиме, повреждённый сейв охоты отклоняется', () => {
  const s = before(); stake(s);
  for (const hunt of [{ wave: 10, passed: 0 }, { wave: 11, passed: 1 }, { wave: 11, passed: -1 }, {}, 'охота']) {
    assert.equal(SIM.loadable({ ...s, hunt }), false);
  }
  const e = SIM.create(4); e.endless = true;
  for (let w = 21; w <= 30; w++) {
    e.wave = w - 1; stake(e);
    if (e.hunt) { assert.equal(e.hunt.wave, w); return; }
  }
  assert.fail('не нашлось обоза на волнах 21–30 сида 4');
});
