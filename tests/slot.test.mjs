// node --test tests/*.test.mjs — очередь тяжёлых прогонов (tools/slot.mjs): место живого владельца не отбирается, сколько бы
// он ни держал его; брошенным считается место умершего владельца или с давно не обновлявшейся отметкой жизни.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// своя папка очереди и короткий срок отметки (1.2 с, отметка раз в 0.3 с): тест не ждёт минутами и не трогает общую очередь
process.env.NECRO_SLOT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'necro-slot-test-'));
process.env.NECRO_SLOT_STALE_MIN = '0.02';
delete process.env.NECRO_SLOT_HELD;                      // под командой проверки место держит родитель — здесь своя очередь
const SLOT = await import('../tools/slot.mjs');
const STALE = 0.02 * 60000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dir = (i) => path.join(process.env.NECRO_SLOT_DIR, 'slot-' + i);
const age = (d, ms) => { const t = new Date(Date.now() - ms); fs.utimesSync(d, t, t); };
const owner = (d, o) => fs.writeFileSync(path.join(d, 'owner.json'), JSON.stringify(o));
const deadPid = () => spawnSync(process.execPath, ['-e', '']).pid;
test.after(() => fs.rmSync(process.env.NECRO_SLOT_DIR, { recursive: true, force: true }));

test('живой владелец со свежей отметкой держит место, сколько бы оно ни было занято', () => {
  const d = SLOT.tryTake('gpu', 0, 'долгий'); assert.equal(d, dir(0));
  owner(d, Object.assign(JSON.parse(fs.readFileSync(path.join(d, 'owner.json'), 'utf8')), { since: new Date(Date.now() - 3 * 3600e3).toISOString() }));
  SLOT.beat(d);
  assert.equal(SLOT.stale(d), false); assert.equal(SLOT.tryTake('gpu', 0, 'сосед'), null, 'место живого владельца отдано соседу');
  fs.rmSync(d, { recursive: true });
});

test('брошено: владелец умер — сразу; живой без отметки дольше срока — после срока', () => {
  const d = SLOT.tryTake('gpu', 1, 'a');
  owner(d, { pid: deadPid(), label: 'a', since: new Date().toISOString(), beat: 1 }); SLOT.beat(d);
  assert.equal(SLOT.stale(d), true, 'место умершего владельца не брошено');
  owner(d, { pid: process.pid, label: 'a', since: new Date().toISOString(), beat: 1 });
  age(d, STALE / 2); assert.equal(SLOT.stale(d), false, 'живой владелец потерял место раньше срока');
  age(d, STALE * 2); assert.equal(SLOT.stale(d), true, 'зависший владелец держит место вечно');
  assert.equal(SLOT.tryTake('gpu', 1, 'b'), d, 'брошенное место не занято заново');
  fs.rmSync(d, { recursive: true });
});

test('владелец прежней версии (без отметок): живой держит место до 20 минут', () => {
  fs.mkdirSync(dir(2)); const d = dir(2);
  owner(d, { pid: process.pid, label: 'old', since: new Date().toISOString() });
  age(d, 10 * 60000); assert.equal(SLOT.stale(d), false);
  age(d, 25 * 60000); assert.equal(SLOT.stale(d), true);
  fs.rmSync(d, { recursive: true });
});

test('пока владелец жив, acquire сам обновляет отметку; после освобождения места нет', async () => {
  const release = await SLOT.acquire('живой', 'gpu'), d = dir(0);
  assert.ok(fs.existsSync(d));
  age(d, STALE * 0.9); await sleep(STALE * 0.5);
  assert.ok(Date.now() - fs.statSync(d).mtimeMs < STALE * 0.5, 'отметка не обновилась');
  await sleep(STALE * 1.2); assert.equal(SLOT.stale(d), false, 'место живого владельца стало брошенным');
  release(); assert.equal(fs.existsSync(d), false);
});
