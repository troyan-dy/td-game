// tools/check.mjs — единая базовая проверка: тесты, боты, игра в браузере, одна короткая сводка в конце.
//
//   PLAYWRIGHT=<путь к пакету playwright> node tools/check.mjs [--port N] [--out DIR] [--timeout SEC]
//
//   --port N       порт статического сервера; по умолчанию свободный порт выбирает система (параллельные worktree не мешают)
//   --out DIR      куда класть скриншоты, tests.log и report.json; по умолчанию frames/check (старые файлы там стираются)
//   --timeout SEC  общий предел времени, по умолчанию 600; по истечении всё гасится и проверка считается проваленной
//
// Код возврата: 0 — всё зелёное; 1 — упал тест, бот дал неожиданный итог, шаг сценария упал, есть ошибка консоли
// или дефект вёрстки; 2 — проверку нельзя запустить (нет PLAYWRIGHT, порт занят, неверный параметр).
//
// Это каркас, он от игры не зависит: сервер, запуск тестов и ботов, браузер, сбор ошибок, скриншоты, сводка, гашение.
// Всё, что знает про игру (страница, экраны, клики, ожидаемые итоги ботов, проверка вёрстки), — в tools/check.game.mjs.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Worker, isMainThread, parentPort } from 'node:worker_threads';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GAME = pathToFileURL(path.join(ROOT, 'tools', 'check.game.mjs')).href;


// Поток ботов: CPU-тяжёлые партии идут параллельно с тестами и браузером, не блокируя главный поток.
async function botsWorker() {
  let out;
  try {
    const game = await import(GAME);
    out = [];
    for (const b of game.BOTS || []) {
      try { out.push({ name: b.name, ...(await b.run()) }); } catch (e) { out.push({ name: b.name, line: '', problem: 'бот упал: ' + firstLine(e) }); }
    }
  } catch (e) { out = { error: 'игровая часть не загрузилась: ' + firstLine(e) }; }
  parentPort.postMessage(out);
}

function firstLine(e) { return String((e && (e.message || e)) || e).split('\n')[0].trim(); }
function cut(s, n = 150) { s = String(s).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; }

async function main() {
  const t0 = Date.now();
  const opt = parseArgs(process.argv.slice(2));
  process.chdir(ROOT);

  // ---- Playwright: до любого запуска, чтобы сразу и понятно сказать, чего не хватает
  const pwPath = process.env.PLAYWRIGHT;
  if (!pwPath) {
    die('переменная окружения PLAYWRIGHT не задана.\n' +
      'Задай путь к пакету playwright и повтори:\n' +
      '  Git Bash:   PLAYWRIGHT="C:/Users/Дмитрий/.claude/skills/ref2game/scripts/node_modules/playwright" node tools/check.mjs\n' +
      '  PowerShell: $env:PLAYWRIGHT="C:/Users/Дмитрий/.claude/skills/ref2game/scripts/node_modules/playwright"; node tools/check.mjs');
  }
  let chromium;
  try { ({ chromium } = createRequire(import.meta.url)(pwPath)); } catch (e) { die(`не удалось загрузить playwright из PLAYWRIGHT="${pwPath}": ${firstLine(e)}`); }

  // ---- выходной каталог: стираем только свои прошлые файлы
  const OUT = path.resolve(opt.out);
  fs.mkdirSync(OUT, { recursive: true });
  for (const f of fs.readdirSync(OUT)) if (/\.png$|^report\.json$|^tests\.log$/.test(f)) fs.rmSync(path.join(OUT, f), { force: true });
  const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/') || '.';

  // ---- гашение: один путь для успеха, провала, таймаута и Ctrl+C
  const res = { tests: null, bots: null, browser: null, fatal: [] };
  const live = { server: null, child: null, worker: null, browser: null };
  let tornDown = false;
  const teardown = async () => {
    if (tornDown) return; tornDown = true;
    try { live.child && live.child.exitCode === null && live.child.kill(); } catch (e) {}
    try { live.worker && await live.worker.terminate(); } catch (e) {}
    try { live.browser && await Promise.race([live.browser.close(), sleep(5000)]); } catch (e) {}
    try { if (live.server) { live.server.closeAllConnections(); await new Promise((r) => live.server.close(() => r())); } } catch (e) {}
  };
  const abort = async (why, code) => { res.fatal.push(why); await teardown(); finish(code); };
  process.on('SIGINT', () => abort('прервано (Ctrl+C)', 130));
  process.on('SIGTERM', () => abort('прервано (SIGTERM)', 143));
  process.on('uncaughtException', (e) => abort('сбой команды проверки: ' + (e && e.stack || e), 1));
  process.on('unhandledRejection', (e) => abort('сбой команды проверки: ' + (e && e.stack || e), 1));
  const timer = setTimeout(() => abort(`превышен общий предел времени ${opt.timeout} с`, 1), opt.timeout * 1000);

  const finish = (forced) => {
    clearTimeout(timer);
    const { text, failed } = summary(res, { OUT: rel(OUT), secs: (Date.now() - t0) / 1000, port: opt.portUsed });
    try { fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(res, null, 1)); } catch (e) {}
    process.stdout.write(text + '\n');
    const code = forced !== undefined ? forced : (failed ? 1 : 0);
    process.exitCode = code;
    setTimeout(() => process.exit(code), 50).unref();   // ничего не должно держать процесс: всё уже погашено
  };

  // ---- статический сервер в этом же процессе: умирает вместе с командой, висеть нечему
  try { live.server = await startServer(ROOT, opt.port); }
  catch (e) { if (e.code === 'EADDRINUSE') die(`порт ${opt.port} занят. Укажи другой --port или опусти параметр — тогда свободный порт выберется сам.`); throw e; }
  opt.portUsed = live.server.address().port;
  const base = `http://127.0.0.1:${opt.portUsed}`;
  console.log(`check: сервер ${base}, скриншоты в ${rel(OUT)}/ — тесты, боты и браузер идут параллельно…`);

  let game = null;
  try { game = await import(GAME); } catch (e) { res.fatal.push('tools/check.game.mjs не загрузился: ' + firstLine(e)); }

  const parts = await Promise.allSettled([
    runTests(OUT, live).then((r) => { res.tests = r; }),
    runBots(live).then((r) => { res.bots = r; }),
    game ? runBrowser(chromium, game, base, OUT, live).then((r) => { res.browser = r; }) : null,
  ]);
  for (const p of parts) if (p.status === 'rejected') res.fatal.push('сбой команды проверки: ' + (p.reason && p.reason.stack || p.reason));
  await teardown();
  finish();
}

function die(msg) { process.stderr.write('check: ' + msg + '\n'); process.exit(2); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseArgs(argv) {
  const o = { port: 0, out: 'frames/check', timeout: 600 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], v = () => { if (i + 1 >= argv.length) die(`у ${a} нет значения`); return argv[++i]; };
    if (a === '--port') o.port = +v();
    else if (a === '--out') o.out = v();
    else if (a === '--timeout') o.timeout = +v();
    else if (a === '-h' || a === '--help') { process.stdout.write(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).slice(0, 12).map((l) => l.slice(3)).join('\n') + '\n'); process.exit(0); }
    else die(`неизвестный параметр ${a}. Параметры: --port N, --out DIR, --timeout SEC`);
  }
  if (!Number.isInteger(o.port) || o.port < 0 || o.port > 65535) die('--port должен быть целым 0…65535');
  if (!(o.timeout > 0)) die('--timeout должен быть положительным числом секунд');
  return o;
}

// ---------------------------------------------------------------- статический сервер
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.txt': 'text/plain; charset=utf-8',
  '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg' };
function startServer(root, port) {
  const server = http.createServer((req, res) => {
    let p;
    try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch (e) { res.writeHead(400).end(); return; }
    let file = path.join(root, p);
    if (file !== root && !file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    fs.stat(file, (err, st) => {
      if (!err && st.isDirectory()) { file = path.join(file, 'index.html'); try { st = fs.statSync(file); } catch (e) { err = e; } }
      if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('not found'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Content-Length': st.size,
        'Last-Modified': st.mtime.toUTCString(), 'Cache-Control': 'no-store' });
      if (req.method === 'HEAD') { res.end(); return; }
      fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
    });
  });
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', () => resolve(server)); });
}

// ---------------------------------------------------------------- node --test
function runTests(OUT, live) {
  const files = fs.existsSync('tests') ? fs.readdirSync('tests', { recursive: true }).map((f) => 'tests/' + String(f).split(path.sep).join('/'))
    .filter((f) => /\.test\.(mjs|cjs|js)$/.test(f)).sort() : [];
  if (!files.length) return Promise.resolve({ pass: 0, fail: 1, failed: ['в tests/ нет файлов *.test.mjs'], files });
  return new Promise((resolve) => {
    const ch = live.child = spawn(process.execPath, ['--test', '--test-reporter=tap', ...files], { cwd: process.cwd(), windowsHide: true });
    const buf = [];
    ch.stdout.on('data', (d) => buf.push(d)); ch.stderr.on('data', (d) => buf.push(d));
    ch.on('error', (e) => resolve({ pass: 0, fail: 1, failed: ['node --test не запустился: ' + e.message], files }));
    ch.on('close', (code) => {
      const log = Buffer.concat(buf).toString('utf8');
      try { fs.writeFileSync(path.join(OUT, 'tests.log'), log); } catch (e) {}
      const num = (k) => { const m = new RegExp('^# ' + k + ' (\\d+)', 'm').exec(log); return m ? +m[1] : 0; };
      const lines = log.split(/\r?\n/), failed = [];
      lines.forEach((l, i) => {
        const m = /^(\s*)not ok \d+ - (.*)$/.exec(l); if (!m) return;
        if (lines.slice(i + 1).some((x) => x.startsWith(m[1] + '    not ok'))) return;   // родитель упавшего подтеста: покажем сам подтест
        let why = '';
        for (let j = i + 1; j < Math.min(lines.length, i + 40); j++) {
          const e = /^\s*error: (.*)$/.exec(lines[j]); if (!e) continue;
          why = /^\|/.test(e[1]) ? (lines[j + 1] || '').trim() : e[1].replace(/^'|'$/g, ''); break;
        }
        failed.push(m[2].replace(/^"(.*)"$/, '$1') + (why ? ' — ' + why : ''));
      });
      const r = { pass: num('pass'), fail: num('fail') + num('cancelled'), skipped: num('skipped') + num('todo'), failed, files, code };
      if (code !== 0 && !r.fail) { r.fail = 1; r.failed.push(`node --test завершился с кодом ${code}`); }
      resolve(r);
    });
  });
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
async function runBrowser(chromium, game, base, OUT, live) {
  const r = { steps: [], skips: [], shots: [], console: [], layout: [] };
  const browser = live.browser = await chromium.launch({ args: ['--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist'] });
  for (const vp of game.VIEWPORTS || [{ width: 1280, height: 720 }]) {
    const vw = vp.width, page = await browser.newPage({ viewport: vp });
    page.setDefaultTimeout(15000);
    const err = (s) => r.console.push(`${vw}: ${cut(s, 300)}`);
    page.on('pageerror', (e) => err('pageerror: ' + (e.message || e)));
    page.on('console', (m) => { const t = m.text(); if (m.type() === 'error' && !/favicon|^Failed to load resource/.test(t)) err(t); });
    page.on('response', (x) => { if (x.status() >= 400 && !/favicon/.test(x.url())) err(`HTTP ${x.status()} ${x.url().replace(base, '')}`); });
    page.on('requestfailed', (q) => { const f = q.failure() && q.failure().errorText; if (f && !/ERR_ABORTED/.test(f)) err(`запрос не прошёл: ${q.url().replace(base, '')} ${f}`); });
    page.on('crash', () => err('страница упала (crash)'));
    let stop = false;
    const ctx = {
      page, vw, base,
      Skip, skip: (why) => { throw new Skip(why); },
      goto: (p) => page.goto(base + p),
      wait: (ms) => page.waitForTimeout(ms),
      eval: (fn, arg) => page.evaluate(fn, arg),
      // Элемент, без которого шаг не имеет смысла: нет за timeout мс — шаг пропускается строкой в сводке, а не валит проверку.
      need: async (sel, timeout = 2000) => {
        const loc = page.locator(sel).first();
        try { await loc.waitFor({ state: 'attached', timeout }); } catch (e) { throw new Skip(`нет элемента ${sel}`); }
        return loc;
      },
      click: async (sel) => { await (await ctx.need(sel)).evaluate((el) => el.click()); },
      shot: async (name) => {
        await page.waitForTimeout(150);
        if (game.inspect) for (const d of await game.inspect(page)) r.layout.push(`${vw} ${name}: ${d}`);
        const file = `${vw}_${name}.png`;
        await page.screenshot({ path: path.join(OUT, file) }); r.shots.push(file);
      },
      // Шаг сценария. Skip → пропуск со строкой в сводке; любая другая ошибка → провал шага; остальные шаги идут дальше.
      // fatal: true — если шаг не прошёл, остальные шаги этого экрана пропускаются (например, страница не открылась).
      step: async (name, fn, { fatal = false } = {}) => {
        if (stop) { r.skips.push(`${vw} ${name}: пропущен, страница не открылась`); return false; }
        try { await fn(); r.steps.push({ vw, name, ok: true }); return true; }
        catch (e) {
          if (e instanceof Skip) { r.skips.push(`${vw} ${name}: ${e.message}`); if (fatal) stop = true; return false; }
          r.steps.push({ vw, name, ok: false, error: cut(firstLine(e), 200) }); if (fatal) stop = true; return false;
        }
      },
    };
    try { await game.scenario(ctx); }
    catch (e) { r.steps.push({ vw, name: 'сценарий', ok: false, error: cut(firstLine(e), 200) }); }
    await page.close().catch(() => {});
  }
  return r;
}

// ---------------------------------------------------------------- сводка
function summary(res, { OUT, secs, port }) {
  const L = [], MAX = 8, more = (arr) => arr.length > MAX ? [`    … и ещё ${arr.length - MAX} (всё в ${OUT}/report.json)`] : [];
  const list = (arr) => [...arr.slice(0, MAX).map((x) => '    ' + cut(x, 160)), ...more(arr)];
  let failed = res.fatal.length > 0;
  L.push(`──── Сводка проверки: ${secs.toFixed(1)} с, порт ${port || '—'} ────`);

  const t = res.tests;
  if (!t) { L.push('Тесты:    не запускались'); failed = true; }
  else {
    L.push(`Тесты:    ${t.fail ? 'ПРОВАЛ' : 'ок'} — прошло ${t.pass} из ${t.pass + t.fail}${t.skipped ? `, пропущено ${t.skipped}` : ''} (${t.files.length} файл., лог ${OUT}/tests.log)`);
    if (t.fail) { failed = true; L.push(...list(t.failed)); }
  }

  const b = res.bots;
  if (!b) { L.push('Боты:     не запускались'); failed = true; }
  else if (b.error) { L.push('Боты:     ПРОВАЛ — ' + b.error); failed = true; }
  else {
    const bad = b.list.filter((x) => x.problem);
    if (!b.list.length) L.push('Боты:     в tools/check.game.mjs не задано ни одного');
    else L.push(`Боты:     ${bad.length ? 'ПРОВАЛ' : 'ок'} — как ожидалось ${b.list.length - bad.length} из ${b.list.length}`);
    for (const x of b.list) L.push(`    ${x.problem ? '✗' : '·'} ${x.name.padEnd(9)} ${x.line}${x.problem ? '  ← ' + x.problem : ''}`);
    if (bad.length) failed = true;
  }

  const w = res.browser;
  if (!w) { L.push('Браузер:  не запускался'); failed = true; }
  else {
    const bad = w.steps.filter((s) => !s.ok);
    L.push(`Браузер:  ${bad.length ? 'ПРОВАЛ' : 'ок'} — шагов пройдено ${w.steps.length - bad.length}, упало ${bad.length}, пропущено ${w.skips.length}`);
    if (bad.length) { failed = true; L.push(...list(bad.map((s) => `${s.vw} ${s.name}: ${s.error}`))); }
    if (w.skips.length) { L.push('  Пропуски шагов (не провал, но проверь, не устарел ли сценарий):'); L.push(...list(w.skips)); }
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
  L.push(failed ? 'ИТОГ: ПРОВАЛ (код 1)' : 'ИТОГ: ОК (код 0)');
  return { text: L.join('\n'), failed };
}
function dedupe(arr) { const m = new Map(); for (const x of arr) { const k = x.replace(/^\d+: /, ''); const e = m.get(k); if (e) e.n++; else m.set(k, { x, n: 1 }); }
  return [...m.values()].map((e) => e.n > 1 ? `${e.x} (×${e.n})` : e.x); }
function wrap(head, words, width) {
  const out = []; let line = head;
  for (const w of words) { if (line.length + w.length + 1 > width && line.trim().length > head.trim().length) { out.push(line.trimEnd()); line = ' '.repeat(head.length); } line += w + ' '; }
  out.push(line.trimEnd()); return out;
}

if (isMainThread) await main(); else await botsWorker();
