// tools/slot.mjs — общая на всю машину очередь на тяжёлые прогоны (браузер, полный прогон тестов и ботов).
// Зачем: несколько агентов в разных worktree запускают браузеры одновременно, и компьютер подвисает.
// Одновременно работает не больше NECRO_SLOTS прогонов (по умолчанию 1), остальные ждут своей очереди.
//
//   node tools/slot.mjs <команда> [аргументы…]   занять место, выполнить команду с пониженным приоритетом, освободить
//     пример: node tools/slot.mjs node frames/tester/ui.mjs      — свой сценарий Playwright
//   node tools/check.mjs занимает место сама; оборачивать её не нужно (и не вредно).
//
// Место — каталог slot-N в общем временном каталоге: создание каталога атомарно. Внутри записан pid владельца;
// если владелец умер или место держится дольше NECRO_SLOT_MAX_MIN минут (по умолчанию 20), оно считается брошенным.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const DIR = process.env.NECRO_SLOT_DIR || path.join(os.tmpdir(), 'necropolis-slots');
const SLOTS = Math.max(1, parseInt(process.env.NECRO_SLOTS || '1', 10) || 1);
const MAX_MS = (parseFloat(process.env.NECRO_SLOT_MAX_MIN || '20') || 20) * 60000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };

function tryTake(i, label) {
  const d = path.join(DIR, 'slot-' + i);
  try { fs.mkdirSync(d); } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    let own = null;
    try { own = JSON.parse(fs.readFileSync(path.join(d, 'owner.json'), 'utf8')); } catch (x) {}
    let age = 0; try { age = Date.now() - fs.statSync(d).mtimeMs; } catch (x) { return null; }
    const stale = own ? (!alive(own.pid) || age > MAX_MS) : age > 5000;   // без записи владельца — ждём 5 с: он мог ещё не успеть её сделать
    if (!stale) return null;
    try { fs.rmSync(d, { recursive: true, force: true }); fs.mkdirSync(d); } catch (x) { return null; }
  }
  try { fs.writeFileSync(path.join(d, 'owner.json'), JSON.stringify({ pid: process.pid, label, since: new Date().toISOString() })); } catch (e) {}
  return d;
}

// Занять место. Возвращает функцию освобождения; место освобождается и само при выходе процесса.
// Если место уже держит родительский процесс (NECRO_SLOT_HELD), ничего не делает.
export async function acquire(label = '') {
  if (process.env.NECRO_SLOT_HELD) return () => {};
  fs.mkdirSync(DIR, { recursive: true });
  const t0 = Date.now(); let told = 0;
  for (;;) {
    for (let i = 0; i < SLOTS; i++) {
      const d = tryTake(i, label);
      if (d) {
        let freed = false;
        const release = () => { if (freed) return; freed = true; try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) {} };
        process.once('exit', release);
        process.env.NECRO_SLOT_HELD = '1';
        if (told) process.stderr.write(`slot: место получено через ${Math.round((Date.now() - t0) / 1000)} с\n`);
        return () => { release(); delete process.env.NECRO_SLOT_HELD; };
      }
    }
    if (Date.now() - told > 30000) { told = Date.now(); process.stderr.write('slot: жду очередь на тяжёлый прогон (другой прогон уже идёт)…\n'); }
    await sleep(700 + Math.random() * 600);
  }
}

// Понизить приоритет процесса: на Windows дети наследуют класс «ниже обычного», интерфейс системы остаётся отзывчивым.
export function lowPriority(pid = process.pid) { try { os.setPriority(pid, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch (e) {} }

async function cli() {
  const args = process.argv.slice(2);
  if (!args.length || args[0] === '--help') { process.stdout.write('node tools/slot.mjs <команда> [аргументы…] — выполнить команду в общей очереди тяжёлых прогонов\n'); process.exit(args.length ? 0 : 2); }
  await acquire(args.join(' ').slice(0, 120));
  lowPriority();
  const child = spawn(args[0], args.slice(1), { stdio: 'inherit', env: process.env, shell: process.platform === 'win32' && !/\.exe$/i.test(args[0]) && args[0] !== 'node' && args[0] !== process.execPath });
  const kill = () => { if (child.exitCode !== null || child.signalCode) return;
    if (process.platform === 'win32') spawnSync('taskkill', ['/T', '/F', '/PID', String(child.pid)], { stdio: 'ignore' }); else child.kill('SIGKILL'); };
  process.on('SIGINT', () => { kill(); process.exit(130); });
  process.on('SIGTERM', () => { kill(); process.exit(143); });
  child.on('error', (e) => { process.stderr.write('slot: команда не запустилась: ' + e.message + '\n'); process.exit(2); });
  child.on('close', (code, sig) => process.exit(code === null ? (sig === 'SIGINT' ? 130 : 1) : code));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await cli();
