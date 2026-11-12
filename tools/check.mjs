// tools/check.mjs — единая базовая проверка: тесты, боты, игра в браузере, одна короткая сводка в конце.
//
//   node tools/check.mjs [--port N] [--out DIR] [--page PATH] [--timeout SEC]     путь к playwright — в переменной PLAYWRIGHT
//   node tools/check.mjs --serve [--port N]       только статический сервер для своих сценариев; Ctrl+C — остановить
//
//   --port N       порт сервера; по умолчанию свободный порт выбирает система (параллельные worktree не мешают)
//   --out DIR      каталог внутри frames/ для скриншотов, tests.log и report.json; по умолчанию frames/check
//   --page PATH    другая страница этого же сервера вместо игровой, например /site/index.html после build_site.py
//   --timeout SEC  общий предел времени, по умолчанию 600; по истечении всё гасится, проверка провалена
//
// Код возврата: 0 — всё зелёное; 1 — упал или не нашёлся тест, бот дал неожиданный итог, упал шаг сценария,
// есть ошибка консоли или дефект вёрстки; 2 — проверку нельзя запустить (PLAYWRIGHT, порт, параметры); 130 — Ctrl+C.
//
// Это каркас, он от игры не зависит: сервер, тесты, боты, браузер, сбор ошибок, скриншоты, сводка, гашение.
// Всё, что знает про игру, — в tools/check/game.mjs и tools/check/screens/*.mjs (см. шапку game.mjs).
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Worker, isMainThread, parentPort } from 'node:worker_threads';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GAME_DIR = path.join(ROOT, 'tools', 'check');
const GAME = pathToFileURL(path.join(GAME_DIR, 'game.mjs')).href;
const SCREENS = path.join(GAME_DIR, 'screens');
const MANIFEST = '.check-files.json';         // список файлов, которые команда записала в --out; стирает только их

// Поток ботов: CPU-тяжёлые партии идут параллельно с тестами и браузером, не блокируя главный поток.
async function botsWorker() {
  let out;
  try {
    const list = await (await import(GAME)).bots();
    out = [];
    for (const b of list) {
      try { out.push({ name: b.name, ...(await b.run()) }); } catch (e) { out.push({ name: b.name, line: '', problem: 'бот упал: ' + firstLine(e) }); }
    }
  } catch (e) { out = { error: 'боты не загрузились: ' + firstLine(e) }; }
  parentPort.postMessage(out);
}

function firstLine(e) { return String((e && (e.message || e)) || e).split('\n')[0].trim(); }
function cut(s, n = 150) { s = String(s).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function die(msg) { process.stderr.write('check: ' + msg + '\n'); process.exit(2); }
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/') || '.';

async function main() {
  const t0 = Date.now();
  const opt = parseArgs(process.argv.slice(2));
  process.chdir(ROOT);
  if (opt.serve) return serveOnly(opt);

  // ---- Playwright: проверяем до любого запуска, чтобы сразу и понятно сказать, чего не хватает
  const chromium = loadChromium();

  // ---- выходной каталог: стираем только то, что записали сюда в прошлый раз
  const OUT = opt.outAbs;
  fs.mkdirSync(OUT, { recursive: true });
  try { for (const f of JSON.parse(fs.readFileSync(path.join(OUT, MANIFEST), 'utf8'))) if (/^[^\\/]+$/.test(f)) fs.rmSync(path.join(OUT, f), { force: true }); } catch (e) {}
  const written = new Set([MANIFEST]);

  // ---- гашение: один путь для успеха, провала, таймаута и Ctrl+C
  const res = { tests: null, bots: null, browser: null, fatal: [], aborted: null };
  const live = { server: null, children: new Set(), worker: null, browser: null };
  let tornDown = false;
  const teardown = async () => {
    if (tornDown) return; tornDown = true;
    for (const ch of live.children) killTree(ch);
    try { live.worker && await live.worker.terminate(); } catch (e) {}
    try { live.browser && await Promise.race([live.browser.close(), sleep(5000)]); } catch (e) {}
    try { if (live.server) { live.server.closeAllConnections(); await new Promise((r) => live.server.close(() => r())); } } catch (e) {}
  };
  let finished = false;
  const finish = (code) => {
    if (finished) return; finished = true;    // abort и обычный путь могут прийти оба: сводка печатается один раз
    clearTimeout(timer);
    const s = summary(res, { OUT: rel(OUT), secs: (Date.now() - t0) / 1000, port: opt.portUsed, code });
    try { fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(res, null, 1)); written.add('report.json'); } catch (e) {}
    try { fs.writeFileSync(path.join(OUT, MANIFEST), JSON.stringify([...written])); } catch (e) {}
    process.stdout.write(s.text + '\n');
    process.exitCode = s.code;
    setTimeout(() => process.exit(s.code), 50).unref();   // ничего не должно держать процесс: всё уже погашено
  };
  const abort = async (why, code) => { if (finished || res.aborted) return; res.aborted = { why, code }; await teardown(); finish(code); };
  process.on('SIGINT', () => abort('прервано (Ctrl+C)', 130));
  process.on('SIGTERM', () => abort('прервано (SIGTERM)', 143));
  process.on('uncaughtException', (e) => { if (res.aborted) return; res.fatal.push('сбой команды проверки: ' + (e && e.stack || e)); abort('сбой команды проверки', 1); });
  process.on('unhandledRejection', (e) => { if (res.aborted) return; res.fatal.push('сбой команды проверки: ' + (e && e.stack || e)); abort('сбой команды проверки', 1); });
  const timer = setTimeout(() => abort(`превышен общий предел времени ${opt.timeout} с`, 1), opt.timeout * 1000);

  // ---- статический сервер в этом же процессе: умирает вместе с командой, висеть нечему
  live.server = await listenOrDie(opt.port);
  opt.portUsed = live.server.address().port;
  const base = `http://127.0.0.1:${opt.portUsed}`;
  console.log(`check: сервер ${base}, скриншоты в ${rel(OUT)}/ — тесты, боты и браузер идут параллельно…`);

  let game = null;
  try { game = await import(GAME); } catch (e) { res.fatal.push('tools/check/game.mjs не загрузился: ' + firstLine(e)); }

  const parts = await Promise.allSettled([
    runTests(OUT, live, written).then((r) => { res.tests = r; }),
    runBots(live).then((r) => { res.bots = r; }),
    game ? runBrowser(chromium, game, base, OUT, live, res, written, opt.page || game.PAGE) : null,
  ]);
  if (res.aborted) return;                    // сводка уже напечатана, ошибки закрытых процессов — шум
  for (const p of parts) if (p.status === 'rejected') res.fatal.push('сбой команды проверки: ' + (p.reason && p.reason.stack || p.reason));
  await teardown();
  finish();
}

function loadChromium() {
  const pw = process.env.PLAYWRIGHT;
  const how = 'Playwright установлен вне репозитория; путь к его пакету задаётся переменной окружения PLAYWRIGHT:\n' +
    '  Git Bash:    export PLAYWRIGHT="<путь к node_modules/playwright>"\n' +
    '  PowerShell:  $env:PLAYWRIGHT="<путь к node_modules/playwright>"\n' +
    '  Claude Code: блок "env" в личном .claude/settings.local.json\n' +
    'и затем: node tools/check.mjs';
  if (!pw) die('переменная окружения PLAYWRIGHT не задана.\n' + how);
  let mod;
  try { mod = createRequire(import.meta.url)(pw); } catch (e) { die(`не удалось загрузить playwright из PLAYWRIGHT="${pw}": ${firstLine(e)}\n` + how); }
  const chromium = mod && mod.chromium;
  if (!chromium || typeof chromium.launch !== 'function' || typeof chromium.executablePath !== 'function')
    die(`PLAYWRIGHT="${pw}" загружается, но это не пакет playwright (нет chromium.launch).\n` + how);
  let exe = '';
  try { exe = chromium.executablePath(); } catch (e) {}
  if (!exe || !fs.existsSync(exe)) die(`playwright найден, но браузер Chromium для него не установлен (${exe || 'путь неизвестен'}). Установи: npx playwright install chromium`);
  return chromium;
}

function parseArgs(argv) {
  const o = { port: 0, out: 'frames/check', timeout: 600, page: null, serve: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], v = () => { if (i + 1 >= argv.length) die(`у ${a} нет значения`); return argv[++i]; };
    if (a === '--port') o.port = +v();
    else if (a === '--out') o.out = v();
    else if (a === '--timeout') o.timeout = +v();
    else if (a === '--page') o.page = v();
    else if (a === '--serve') o.serve = true;
    else if (a === '-h' || a === '--help') {
      const head = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n');
      process.stdout.write(head.slice(0, head.findIndex((l) => !l.startsWith('//'))).map((l) => l.slice(3)).join('\n') + '\n'); process.exit(0);
    }
    else die(`неизвестный параметр ${a}. Параметры: --port N, --out DIR, --page PATH, --timeout SEC, --serve, --help`);
  }
  if (!Number.isInteger(o.port) || o.port < 0 || o.port > 65535) die('--port должен быть целым 0…65535');
  if (!(o.timeout > 0)) die('--timeout должен быть положительным числом секунд');
  if (o.page !== null && !/^\/[^\s]*$/.test(o.page)) die('--page — путь на этом сервере, начинается с /, например /site/index.html');
  const frames = path.join(ROOT, 'frames');
  o.outAbs = path.resolve(ROOT, o.out);
  if (!o.outAbs.startsWith(frames + path.sep)) die(`--out должен быть подкаталогом frames/ (например frames/check2), а не ${o.out}`);
  return o;
}

// ---------------------------------------------------------------- статический сервер
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.txt': 'text/plain; charset=utf-8',
  '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg' };
function handler(root) {
  return (req, res) => {
    try {
      let p;
      try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch (e) { res.writeHead(400).end(); return; }
      if (p.includes('\0')) { res.writeHead(400).end(); return; }
      let file = path.join(root, p);
      if (file !== root && !file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
      fs.stat(file, (err, st) => {
        try {
          if (!err && st.isDirectory()) { file = path.join(file, 'index.html'); try { st = fs.statSync(file); } catch (e) { err = e; } }
          if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('not found'); return; }
          res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Content-Length': st.size,
            'Last-Modified': st.mtime.toUTCString(), 'Cache-Control': 'no-store' });
          if (req.method === 'HEAD') { res.end(); return; }
          fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
        } catch (e) { try { res.writeHead(500).end(); } catch (x) { res.destroy(); } }
      });
    } catch (e) { try { res.writeHead(500).end(); } catch (x) { res.destroy(); } }
  };
}
// Кто-то уже слушает порт? Пробуем подключиться и по IPv4, и по IPv6: python http.server слушает [::], и 127.0.0.1:N
// при этом свободен для bind — без проверки команда перехватила бы чужие запросы.
function probe(host, port) {
  return new Promise((resolve) => {
    const s = net.connect({ host, port }); const done = (v) => { s.destroy(); resolve(v); };
    s.once('connect', () => done(true)); s.once('error', () => done(false)); s.setTimeout(500, () => done(false));
  });
}
async function listenOrDie(port) {
  if (port) for (const host of ['127.0.0.1', '::1']) if (await probe(host, port))
    die(`порт ${port} уже слушает другой сервер (${host}). Укажи другой --port или опусти параметр — тогда свободный порт выберется сам.`);
  const server = http.createServer(handler(ROOT));
  try { await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); }); }
  catch (e) {
    if (e.code === 'EADDRINUSE') die(`порт ${port} занят. Укажи другой --port или опусти параметр — тогда свободный порт выберется сам.`);
    if (e.code === 'EACCES') die(`нет прав слушать порт ${port} (EACCES): порт зарезервирован системой. Возьми другой --port или опусти параметр.`);
    die(`сервер не запустился на порту ${port}: ${e.code || ''} ${firstLine(e)}`);
  }
  return server;
}
async function serveOnly(opt) {
  const server = await listenOrDie(opt.port);
  const base = `http://127.0.0.1:${server.address().port}`;
  let page = '/';
  try { page = opt.page || (await import(GAME)).PAGE; } catch (e) {}
  console.log(`check: сервер ${base}/ раздаёт корень репозитория, игра: ${base}${page}\nCtrl+C — остановить.`);
  const stop = () => { server.closeAllConnections(); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 1000).unref(); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}

// ---------------------------------------------------------------- node --test, по процессу на файл
function killTree(ch) {
  if (ch.exitCode !== null || ch.signalCode !== null) return;
  try {
    if (process.platform === 'win32') spawnSync('taskkill', ['/T', '/F', '/PID', String(ch.pid)], { stdio: 'ignore', windowsHide: true });
    else ch.kill('SIGKILL');
  } catch (e) {}
}
async function runTests(OUT, live, written) {
  const files = fs.existsSync('tests') ? fs.readdirSync('tests', { recursive: true }).map((f) => 'tests/' + String(f).split(path.sep).join('/'))
    .filter((f) => /\.test\.(mjs|cjs|js)$/.test(f)).sort() : [];
  const r = { pass: 0, fail: 0, skipped: 0, failed: [], files };
  if (!files.length) { r.fail = 1; r.failed.push('в tests/ нет файлов *.test.mjs'); return r; }
  const logs = await Promise.all(files.map((f) => runTestFile(f, live)));
  for (const x of logs) {
    r.pass += x.pass; r.fail += x.fail; r.skipped += x.skipped; r.failed.push(...x.failed);
    if (!x.pass && !x.fail && !x.skipped) { r.fail++; r.failed.push(`${x.file}: в файле нет ни одного теста`); }
    if (x.code !== 0 && !x.fail) { r.fail++; r.failed.push(`${x.file}: node --test завершился с кодом ${x.code}`); }
  }
  try { fs.writeFileSync(path.join(OUT, 'tests.log'), logs.map((x) => `==== ${x.file}\n${x.log}`).join('\n')); written.add('tests.log'); } catch (e) {}
  return r;
}
function runTestFile(file, live) {
  return new Promise((resolve) => {
    const ch = spawn(process.execPath, ['--test', '--test-reporter=tap', file], { cwd: process.cwd(), windowsHide: true });
    live.children.add(ch);
    const buf = [];
    ch.stdout.on('data', (d) => buf.push(d)); ch.stderr.on('data', (d) => buf.push(d));
    ch.on('error', (e) => resolve({ file, log: '', code: -1, pass: 0, fail: 1, skipped: 0, failed: [`${file}: node --test не запустился: ${e.message}`] }));
    ch.on('close', (code) => { live.children.delete(ch); const log = Buffer.concat(buf).toString('utf8'); resolve({ file, log, code, ...parseTap(log) }); });
  });
}
function parseTap(log) {
  const num = (k) => { const m = new RegExp('^# ' + k + ' (\\d+)', 'm').exec(log); return m ? +m[1] : 0; };
  const lines = log.split(/\r?\n/), failed = [];
  let prevDepth = -1;
  lines.forEach((l, i) => {
    const m = /^(\s*)not ok \d+ - (.*)$/.exec(l); if (!m) return;
    const depth = m[1].length, parent = prevDepth > depth; prevDepth = depth;
    if (parent) return;                         // подтесты печатаются перед родителем: показываем сам упавший подтест
    let why = '', where = '';
    for (let j = i + 1; j < Math.min(lines.length, i + 60); j++) {
      if (/^\s*(not )?ok \d+ /.test(lines[j])) break;
      const loc = /^\s*location: '.*?([^\\/]+:\d+):\d+'$/.exec(lines[j]); if (loc) where = loc[1];
      const e = /^(\s*)error: (.*)$/.exec(lines[j]); if (!e) continue;
      if (!/^\|/.test(e[2])) { why = e[2].replace(/^'|'$/g, ''); continue; }
      const body = [];
      for (let k = j + 1; k < lines.length && (lines[k].length - lines[k].trimStart().length > e[1].length || !lines[k].trim()); k++) if (lines[k].trim()) body.push(lines[k].trim());
      why = body.join(' ');
    }
    failed.push(m[2].replace(/^"(.*)"$/, '$1') + (where ? ` (${where})` : '') + (why ? ' — ' + why : ''));
  });
  return { pass: num('pass'), fail: num('fail') + num('cancelled'), skipped: num('skipped') + num('todo'), failed };
}

// ---------------------------------------------------------------- боты (в отдельном потоке)
function runBots(live) {
  return new Promise((resolve) => {
    const w = live.worker = new Worker(fileURLToPath(import.meta.url));
    let done = false; const end = (r) => { if (!done) { done = true; resolve(r); } };
    w.once('message', (m) => end(Array.isArray(m) ? { list: m } : { list: [], error: m.error }));
    w.once('error', (e) => end({ list: [], error: 'поток ботов упал: ' + firstLine(e) }));
    w.once('exit', (c) => end({ list: [], error: `поток ботов вышел с кодом ${c} без итога` }));
  });
}

// ---------------------------------------------------------------- браузер
class Skip extends Error {}
async function loadScreens() {
  const files = fs.existsSync(SCREENS) ? fs.readdirSync(SCREENS).filter((f) => /\.mjs$/.test(f)).sort() : [];
  const out = [];
  for (const f of files) {
    try { out.push({ file: f, mod: await import(pathToFileURL(path.join(SCREENS, f)).href) }); }
    catch (e) { out.push({ file: f, error: 'файл экрана не загрузился: ' + firstLine(e) }); }
  }
  return out;
}
async function runBrowser(chromium, game, base, OUT, live, res, written, pagePath) {
  const r = res.browser = { steps: [], skips: [], shots: [], console: [], layout: [], problems: [] };
  const screens = await loadScreens();
  if (!screens.length) { r.problems.push(`нет файлов экранов в ${rel(SCREENS)}/`); return; }
  const browser = live.browser = await chromium.launch({ args: ['--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const viewports = game.VIEWPORTS && game.VIEWPORTS.length ? game.VIEWPORTS : [{ width: 1280, height: 720 }];
  await Promise.all(viewports.map(async (vp) => {
    const vw = vp.width, shotNames = new Set();
    for (const sc of screens) {
      if (sc.error) { r.steps.push({ vw, name: sc.file, ok: false, error: sc.error }); continue; }
      const page = await browser.newPage({ viewport: vp });            // свежий контекст: файлы экранов друг от друга не зависят
      page.setDefaultTimeout(15000);
      const err = (s) => r.console.push(`${vw}: ${cut(s, 300)}`);
      page.on('pageerror', (e) => err('pageerror: ' + (e.message || e)));
      page.on('console', (m) => { const t = m.text(); if (m.type() === 'error' && !/favicon|^Failed to load resource/.test(t)) err(t); });
      page.on('response', (x) => { if (x.status() >= 400 && !/favicon/.test(x.url())) err(`HTTP ${x.status()} ${x.url().replace(base, '')}`); });
      page.on('requestfailed', (q) => { const f = q.failure() && q.failure().errorText; if (f && !/ERR_ABORTED/.test(f)) err(`запрос не прошёл: ${q.url().replace(base, '')} ${f}`); });
      page.on('crash', () => err('страница упала (crash)'));
      const ctx = {
        page, vw, base, pagePath, file: sc.file,
        Skip, skip: (why) => { throw new Skip(why); },
        goto: (p) => page.goto(base + p),
        wait: (ms) => page.waitForTimeout(ms),
        eval: (fn, arg) => page.evaluate(fn, arg),
        // Нужный элемент: нет за timeout мс — провал шага с понятной причиной.
        need: async (sel, timeout = 3000) => {
          const loc = page.locator(sel).first();
          try { await loc.waitFor({ state: 'attached', timeout }); } catch (e) { throw new Error(`нет элемента ${sel}`); }
          return loc;
        },
        click: async (sel) => { await (await ctx.need(sel)).evaluate((el) => el.click()); },
        shot: async (name) => {
          if (shotNames.has(name)) throw new Error(`скриншот ${name} уже снят другим шагом — дай уникальное имя`);
          await page.evaluate(() => new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok))));
          await page.waitForTimeout(150);
          if (game.inspect) for (const d of await game.inspect(page)) r.layout.push(`${vw} ${name}: ${d}`);
          const file = `${vw}_${name}.png`;
          await page.screenshot({ path: path.join(OUT, file) }); written.add(file); shotNames.add(name); r.shots.push(file);
        },
      };
      // Шаг: явный ctx.skip → пропуск со строкой в сводке; любая другая ошибка → провал шага, следующие шаги идут дальше.
      // service — служебный шаг (открыть, подготовить): в счёт пройденных не идёт, но его провал виден.
      const step = async (name, fn, service = false) => {
        try { await fn(); if (!service) r.steps.push({ vw, name, ok: true }); return true; }
        catch (e) {
          if (e instanceof Skip) { r.skips.push(`${vw} ${name}: ${e.message}`); return false; }
          r.steps.push({ vw, name, ok: false, error: cut(firstLine(e), 200) }); return false;
        }
      };
      let steps = null;
      const opened = await step(`${sc.file}: открыть страницу`, () => game.open(ctx), true);
      if (opened) await step(`${sc.file}: подготовка`, async () => {
        const s = typeof sc.mod.steps === 'function' ? await sc.mod.steps(ctx, game) : sc.mod.steps;
        if (!s || typeof s !== 'object' || !Object.keys(s).length) throw new Error('файл не экспортирует ни одного шага (export const steps = { имя: async (ctx, g) => … })');
        steps = s;
      }, true);
      if (steps) for (const [name, fn] of Object.entries(steps)) await step(name, () => fn(ctx, game));
      await page.close().catch(() => {});
    }
    if (!r.steps.some((s) => s.vw === vw && s.ok)) r.problems.push(`${vw}: не прошёл ни один шаг`);
    if (!shotNames.size) r.problems.push(`${vw}: не снято ни одного скриншота`);
  }));
}

// ---------------------------------------------------------------- сводка
function summary(res, { OUT, secs, port, code }) {
  const L = [], MAX = 8, more = (arr) => arr.length > MAX ? [`    … и ещё ${arr.length - MAX} (всё в ${OUT}/report.json)`] : [];
  const list = (arr) => [...arr.slice(0, MAX).map((x) => '    ' + cut(x, 160)), ...more(arr)];
  const ab = res.aborted, unfinished = ab ? 'не закончились — прервано' : 'не запускались';
  let failed = res.fatal.length > 0 || !!ab;
  L.push(`──── Сводка проверки: ${secs.toFixed(1)} с, порт ${port || '—'} ────`);

  const t = res.tests;
  if (!t) { L.push('Тесты:    ' + unfinished); failed = true; }
  else {
    L.push(`Тесты:    ${t.fail ? 'ПРОВАЛ' : 'ок'} — прошло ${t.pass} из ${t.pass + t.fail}${t.skipped ? `, пропущено ${t.skipped}` : ''} (${t.files.length} файл., лог ${OUT}/tests.log)`);
    if (t.fail) { failed = true; L.push(...list(t.failed)); }
  }

  const b = res.bots;
  if (!b) { L.push('Боты:     ' + unfinished); failed = true; }
  else if (b.error) { L.push('Боты:     ПРОВАЛ — ' + b.error); failed = true; }
  else if (!b.list.length) { L.push('Боты:     ПРОВАЛ — набор партий пуст (tests/runs.mjs)'); failed = true; }
  else {
    const bad = b.list.filter((x) => x.problem);
    L.push(`Боты:     ${bad.length ? 'ПРОВАЛ' : 'ок'} — как ожидалось ${b.list.length - bad.length} из ${b.list.length}`);
    for (const x of b.list) L.push(`    ${x.problem ? '✗' : '·'} ${x.name.padEnd(9)} ${x.line}${x.problem ? '  ← ' + x.problem : ''}`);
    if (bad.length) failed = true;
  }

  const w = res.browser;
  if (!w) { L.push('Браузер:  ' + unfinished); failed = true; }
  else {
    const bad = w.steps.filter((s) => !s.ok), probs = [...bad.map((s) => `${s.vw} ${s.name}: ${s.error}`), ...w.problems];
    L.push(`Браузер:  ${probs.length ? 'ПРОВАЛ' : 'ок'} — шагов пройдено ${w.steps.length - bad.length}, упало ${bad.length}, пропущено ${w.skips.length}${ab ? ' (прервано)' : ''}`);
    if (probs.length) { failed = true; L.push(...list(probs)); }
    if (w.skips.length) { L.push('  Пропущены (ctx.skip):'); L.push(...list(w.skips)); }
    const byVw = {};
    for (const f of w.shots) { const [v, ...n] = f.replace(/\.png$/, '').split('_'); (byVw[v] = byVw[v] || []).push(n.join('_')); }
    L.push(`  Скриншоты: ${w.shots.length} в ${OUT}/ (имя = ширина_экран.png)`);
    for (const [v, names] of Object.entries(byVw)) L.push(...wrap(`    ${v}: `, names, 118));
    L.push(`  Вёрстка:  ${w.layout.length ? 'ДЕФЕКТЫ ' + w.layout.length : 'дефектов нет'}`);
    if (w.layout.length) { failed = true; L.push(...list(w.layout)); }
    const uniq = dedupe(w.console);
    L.push(`  Ошибки консоли: ${uniq.length ? uniq.length : 'нет'}`);
    if (uniq.length) { failed = true; L.push(...list(uniq)); }
  }
  for (const f of res.fatal) L.push('СБОЙ: ' + cut(f, 300));
  const exit = code !== undefined ? code : (failed ? 1 : 0);
  if (ab) L.push(`ИТОГ: ${ab.code === 1 ? 'ПРОВАЛ' : 'ПРЕРВАНО'} — ${ab.why} (код ${exit})`);
  else L.push(failed ? `ИТОГ: ПРОВАЛ (код ${exit})` : `ИТОГ: ОК (код ${exit})`);
  return { text: L.join('\n'), code: exit };
}
// Одинаковые ошибки из разных окон и перезагрузок — одной строкой: «1280,1920: текст (×4)». Метки кэша ?v=… не различают.
function dedupe(arr) {
  const m = new Map();
  for (const x of arr) {
    const [, vw, msg] = /^(\d+): ([\s\S]*)$/.exec(x) || [, '?', x];
    const k = msg.replace(/\?(v|poll|p)=[\w.-]+/g, '');
    const e = m.get(k) || { vws: new Set(), n: 0 }; e.vws.add(vw); e.n++; m.set(k, e);
  }
  return [...m].map(([k, e]) => `${[...e.vws].join(',')}: ${k}${e.n > 1 ? ` (×${e.n})` : ''}`);
}
function wrap(head, words, width) {
  const out = []; let line = head;
  for (const w of words) { if (line.length + w.length + 1 > width && line.trim().length > head.trim().length) { out.push(line.trimEnd()); line = ' '.repeat(head.length); } line += w + ' '; }
  out.push(line.trimEnd()); return out;
}

if (isMainThread) await main(); else await botsWorker();
