// tools/slot.mjs — общая на всю машину очередь на тяжёлые прогоны (браузер, полный прогон тестов и ботов).
// Зачем: несколько агентов в разных worktree запускают браузеры одновременно, и компьютер подвисает.
// Одновременно работает не больше NECRO_SLOTS прогонов (по умолчанию 1), остальные ждут своей очереди.
//
//   node tools/slot.mjs <команда> [аргументы…]   занять место, выполнить команду с пониженным приоритетом, освободить
//     пример: node tools/slot.mjs node frames/tester/ui.mjs      — свой сценарий Playwright
//   node tools/check.mjs занимает место сама; оборачивать её не нужно (и не вредно).
//
// Место — каталог slot-N в общем временном каталоге: создание каталога атомарно. Внутри — owner.json с pid владельца;
// пока владелец жив, он раз в BEAT_MS обновляет время изменения каталога (отметку жизни). Место брошено, если владелец
// умер или отметка не обновлялась дольше NECRO_SLOT_STALE_MIN минут (по умолчанию 3: процесс завис или pid занят чужим).
// Долгий живой прогон место не теряет, сколько бы он ни шёл. Владелец прежней версии (без отметок, в owner.json нет beat)
// считается брошенным, только если умер или держит место дольше LEGACY_MS.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const DIR = process.env.NECRO_SLOT_DIR || path.join(os.tmpdir(), 'necropolis-slots');
// Две независимые очереди: браузерная (подвисания даёт графика нескольких браузеров) и счётная (только процессор).
const POOLS = {
  gpu: { prefix: 'slot-', n: Math.max(1, parseInt(process.env.NECRO_SLOTS || '1', 10) || 1) },
  cpu: { prefix: 'cpu-', n: Math.max(1, parseInt(process.env.NECRO_CPU_SLOTS || '3', 10) || 3) },
};
const STALE_MS = (parseFloat(process.env.NECRO_SLOT_STALE_MIN || '3') || 3) * 60000;
const BEAT_MS = Math.min(30000, STALE_MS / 4), LEGACY_MS = 20 * 60000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };

// брошено ли занятое место d: владелец умер или давно не отмечался; без записи владельца — ждём 5 с (он мог ещё не успеть её сделать)
export function stale(d, now = Date.now()) {
  let own = null, age = 0;
  try { age = now - fs.statSync(d).mtimeMs; } catch (x) { return false; }   // каталог уже убран — займём на следующем круге
  try { own = JSON.parse(fs.readFileSync(path.join(d, 'owner.json'), 'utf8')); } catch (x) {}
  if (!own) return age > 5000;
  return !alive(own.pid) || age > (own.beat ? STALE_MS : LEGACY_MS);
}
export function tryTake(pool, i, label) {
  const d = path.join(DIR, POOLS[pool].prefix + i);
  try { fs.mkdirSync(d); } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    if (!stale(d)) return null;
    try { fs.rmSync(d, { recursive: true, force: true }); fs.mkdirSync(d); } catch (x) { return null; }
  }
  try { fs.writeFileSync(path.join(d, 'owner.json'), JSON.stringify({ pid: process.pid, label, since: new Date().toISOString(), beat: BEAT_MS })); } catch (e) {}
  beat(d);
  return d;
}
// отметка жизни владельца места: время изменения каталога места — сейчас
export const beat = (d) => { const t = new Date(); try { fs.utimesSync(d, t, t); } catch (e) {} };

// Занять место. Возвращает функцию освобождения; место освобождается и само при выходе процесса.
// Если место уже держит родительский процесс (NECRO_SLOT_HELD), ничего не делает.
export async function acquire(label = '', pool = 'gpu') {
  const held = process.env.NECRO_SLOT_HELD;   // место держит родитель: браузерное покрывает всё, счётное — только счёт
  if (held === 'gpu' || held === '1' || (held && held === pool)) return () => {};
  fs.mkdirSync(DIR, { recursive: true });
  const t0 = Date.now(); let told = 0;
  for (;;) {
    for (let i = 0; i < POOLS[pool].n; i++) {
      const d = tryTake(pool, i, label);
      if (d) {
        let freed = false;
        const timer = setInterval(() => beat(d), BEAT_MS); timer.unref();   // пока процесс жив, место за ним
        const release = () => { if (freed) return; freed = true; clearInterval(timer); try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) {} };
        process.once('exit', release);
        process.env.NECRO_SLOT_HELD = pool;
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
  const pool = args[0] === '--cpu' ? (args.shift(), 'cpu') : 'gpu';   // --cpu: счётная очередь (без браузера), до трёх сразу
  if (!args.length || args[0] === '--help') { process.stdout.write('node tools/slot.mjs <команда> [аргументы…] — выполнить команду в общей очереди тяжёлых прогонов\n'); process.exit(args.length ? 0 : 2); }
  await acquire(args.join(' ').slice(0, 120), pool);
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
