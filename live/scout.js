// live/scout.js — панель разведки «Некрополиса» (DOM). Только показывает ответы логики: SIM.preview (превью волны),
// SIM.scoutRange (какие волны можно смотреть), SIM.remaining (сколько врагов волны осталось). Сама ничего не считает.
//
// Место на экране: строка #scout живёт в верхней строке HUD (клетки под ней и так неигровые) — поле она не закрывает никогда.
// В паузе между волнами под верхней полосой раскрывается #scout-panel (листается на SCOUT_AHEAD волн вперёд). Её место
// выбирается раз на паузу из положений вдоль верхней полосы: под панелью как можно меньше дороги (с запасом на самую высокую
// из листаемых волн) и никогда — вход или склеп. Раскрытая панель уступает полю и панели башни: прячется, пока открыта панель
// клетки или башни, сворачивается от клика по полю, от кнопки ▴ и клавиши I, а с началом волны остаётся только строка
// с числом оставшихся врагов. Каждая новая пауза раскрывает её снова. Способность отряда и описание свойства — в подсказке.
(function () {
  const C = SIM.CONFIG, EN = C.ENEMIES, TILE = C.GRID.tile;
  const $ = (s, r = document) => r.querySelector(s);
  const h = (tag, id, cls) => { const e = document.createElement(tag); if (id) e.id = id; if (cls) e.className = cls; return e; };
  const has = (n) => !!(window.ASSETS && window.ASSETS[n]);
  const num = (v) => Math.round(v).toLocaleString('ru-RU');
  const pct = (v) => Math.round(v * 100) + '%';
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const SCOUT = (window.SCOUT = {});
  // места панели: левый край от X0 с шагом STEP, верх — сразу под верхней полосой HUD
  const X0 = 222, STEP = 32, TOP = 58;
  let APP, bar, box, tip, open = true, page = 0, lastS = null, lastPhase = '', boxKey = '', barKey = '', placeKey = '';
  // превью по номеру волны — на партию (объект состояния и сид): кадр не пересчитывает волну
  let pvS = null, pvSeed = -1, pvMap = new Map();
  const preview = (S, n) => { if (pvS !== S || pvSeed !== S.seed) { pvS = S; pvSeed = S.seed; pvMap = new Map(); }
    if (pvMap.has(n)) return pvMap.get(n);
    const w = SIM.preview(S, n); if (w) pvMap.set(n, w); return w; };   // вне диапазона — null, не запоминается: диапазон сдвигается

  // числовые поля свойства → строка «HP −15% · скорость +35%». Прибавки (armor, mres) — в процентных пунктах, share — доля бюджета
  const MOD = { hp: 'HP', speed: 'скорость', bounty: 'награда', heal: 'лечение', gap: 'интервалы', budget: 'врагов', armor: 'броня', mres: 'защита от магии' };
  const ADD = { armor: 1, mres: 1 };
  const modText = (mods) => Object.entries(mods).map(([k, v]) => {
    if (k === 'share') return Object.entries(v).map(([t, s]) => `${EN[t] ? EN[t].name.toLowerCase() : t} — ${pct(s)} угрозы`).join(' · ');
    const name = MOD[k] || k;
    if (ADD[k]) return `${name} +${pct(v)}`;
    const d = Math.round((v - 1) * 100); return `${name} ${d >= 0 ? '+' : '−'}${Math.abs(d)}%`;
  }).join(' · ');
  const enemyWord = (n) => { const a = n % 10, b = n % 100; return a === 1 && b !== 11 ? 'враг' : a >= 2 && a <= 4 && (b < 12 || b > 14) ? 'врага' : 'врагов'; };
  // своего арта нет — картинка типа look.as в цвете look.css (как на поле), иначе рыцарь в сепии
  const pic = (type) => { const lk = EN[type] && EN[type].look, own = lk ? 'en_' + lk.as : 'en_' + type, n = has(own) ? own : 'en_knight';
    const css = n !== own ? 'sepia(1) saturate(2.2)' : lk ? lk.css : '';
    return has(n) ? `<img src="assets/${n}.png" alt=""${css ? ` style="filter:${css}"` : ''}>` : ''; };

  const squadRows = (w) => w.squads.map((q) => `<div class="sq${q.boss ? ' boss' : ''}"${q.ability ? ` data-tip="${esc(q.name + ': ' + q.ability)}"` : ''}>
      <div class="who"><span class="pic">${pic(q.type)}</span><span class="nm">${q.name}${q.ability ? '<i class="ab">✦</i>' : ''}</span><span class="n">×${q.count}</span></div>
      <span>${num(q.hp)}</span><span>${pct(q.armor)}</span><span>${pct(q.mres)}</span><span>${num(q.speed)}</span><span>${num(q.bounty)}</span></div>`).join('');
  const panelHTML = (S, w, r) => {
    const k = w.n - S.wave, when = k === 1 ? 'следующая' : `через ${k - 1} ${k === 2 ? 'волну' : 'волны'}`;
    return `<div class="hd"><button class="btn nav prev${w.n <= r.from ? ' off' : ''}" title="Раньше (←)">◂</button>
      <div class="tt">ВОЛНА ${w.n} <small>${when} · ${w.n - r.from + 1}/${r.to - r.from + 1}</small></div>
      <button class="btn nav next${w.n >= r.to ? ' off' : ''}" title="Дальше (→)">▸</button><button class="btn nav x" title="Свернуть (I)">▴</button></div>
      ${w.boss ? `<div class="bossline">☠ БОСС: ${w.bossName}</div>` : ''}
      ${w.trait ? `<div class="trait" data-tip="${esc(w.trait.name + ': ' + w.trait.desc)}"><b>⚑ ${w.trait.name}:</b> <span class="mods">${modText(w.trait.mods)}</span></div>` : ''}
      <div class="grid"><div class="sq head"><div class="who">Отряд</div><span>HP</span><span>Броня</span><span>Магия</span><span>Скор.</span><span>Души</span></div>${squadRows(w)}</div>
      ${w.extra.map((x) => `<div class="extra">+${x.count} × ${x.name} из «${EN[x.from].name}», HP ${num(x.hp)}</div>`).join('')}
      <div class="tot"><span>Всего <b>${w.total.count}</b>${w.total.extra ? `<i>+${w.total.extra}</i>` : ''}</span><span>HP <b>${num(w.total.hp)}</b></span>
      <span>Души <b>${num(w.total.bounty)}</b> +${num(w.bonus)} за волну</span></div>`;
  };

  // место панели высотой ph и шириной pw: клетки под прямоугольником (с заметным перекрытием), дорога под ним, вход и склеп
  const cellsUnder = (S, x, y, w, hh) => { const out = [], m = S.map;
    for (let i = 0; i < m.cols * m.rows; i++) { const cx = (i % m.cols) * TILE, cy = Math.floor(i / m.cols) * TILE;
      if (Math.min(cx + TILE, x + w) - Math.max(cx, x) > 8 && Math.min(cy + TILE, y + hh) - Math.max(cy, y) > 8) out.push(i); }
    return out; };
  const spotCost = (S, x, w, hh) => { const m = S.map, road = new Set(m.road), gate = m.road[0], crypt = m.road[m.road.length - 1];
    const cxy = [crypt % m.cols, Math.floor(crypt / m.cols)], under = cellsUnder(S, x, TOP, w, hh);
    const roadN = under.filter((i) => road.has(i)).length;
    const forbidden = under.some((i) => i === gate || (Math.abs(i % m.cols - cxy[0]) <= 1 && Math.abs(Math.floor(i / m.cols) - cxy[1]) <= 1));
    return { roadN, forbidden, cost: (forbidden ? 1e4 : 0) + roadN * 10 + under.length * 0.1 + (x - X0) * 0.002 }; };
  // раз на паузу (сид, номер волны, диапазон): высота — по самой высокой из листаемых волн, место — самое дешёвое
  const place = (S, r) => {
    const key = JSON.stringify([S.seed, S.wave, r.from, r.to]); if (key === placeKey) return; placeKey = key;
    box.style.visibility = 'hidden'; box.classList.add('show'); let hh = 0;
    for (let n = r.from; n <= r.to; n++) { box.innerHTML = panelHTML(S, preview(S, n), r); hh = Math.max(hh, box.offsetHeight); }
    const w = box.offsetWidth; let best = null;
    for (let x = X0; x <= SIM.VIEW.W - 12 - w; x += STEP) { const c = spotCost(S, x, w, hh); if (!best || c.cost < best.cost) best = Object.assign({ x }, c); }
    box.style.left = best.x + 'px'; box.style.visibility = ''; boxKey = '';
    Object.assign(box.dataset, { road: best.roadN, forbidden: best.forbidden ? 1 : 0, height: hh });
  };

  const ended = (S) => S.phase === 'won' || S.phase === 'lost';
  // раскрытая панель видна только в паузе между волнами, пока её не свернули и пока не открыта панель клетки или башни
  const expanded = (S) => open && S.phase === 'prep' && !ended(S) && SIM.scoutRange(S).from <= SIM.scoutRange(S).to && !$('#panel.show');
  const toggle = (v) => { const S = APP.play; if (!S || S.phase !== 'prep') return; open = v === undefined ? !open : v; boxKey = ''; };
  const turn = (d) => { const S = APP.play; if (!S) return; const r = SIM.scoutRange(S); page = Math.max(0, Math.min(r.to - r.from, page + d)); boxKey = ''; };
  const hideTip = () => tip.classList.remove('show');

  SCOUT.init = (A, cv) => {
    APP = A;
    const root = $('#ui'), before = root.querySelector('.overlay');   // под оверлеями меню, паузы и итога
    bar = h('div', 'scout', 'frame box'); box = h('div', 'scout-panel', 'frame'); tip = h('div', 'scout-tip', 'frame'); bar.title = 'Разведка (I)';
    root.insertBefore(bar, before); root.insertBefore(box, before); root.insertBefore(tip, before);
    bar.addEventListener('click', () => toggle());
    box.addEventListener('click', (e) => { const b = e.target.closest('.nav'); if (!b) return;
      if (b.classList.contains('x')) toggle(false); else turn(b.classList.contains('next') ? 1 : -1); });
    // подсказка: способность отряда или описание свойства — рядом с панелью, на высоте строки
    box.addEventListener('pointerover', (e) => { const el = e.target.closest('[data-tip]'); if (!el) { hideTip(); return; }
      tip.textContent = el.dataset.tip; tip.classList.add('show');
      const right = box.offsetLeft + box.offsetWidth + 8, x = right + tip.offsetWidth <= SIM.VIEW.W - 8 ? right : box.offsetLeft - 8 - tip.offsetWidth;
      tip.style.left = x + 'px'; tip.style.top = (box.offsetTop + el.offsetTop) + 'px'; });
    box.addEventListener('pointerleave', hideTip);
    cv.addEventListener('pointerdown', () => { if (APP.play && APP.play.phase === 'prep') open = false; });   // поле важнее разведки
    addEventListener('keydown', (e) => { const S = APP.play; if (!S || APP.paused || e.repeat || $('.overlay.show')) return;
      if (e.code === 'KeyI') toggle();
      else if (expanded(S) && (e.code === 'ArrowLeft' || e.code === 'ArrowRight')) { turn(e.code === 'ArrowRight' ? 1 : -1); e.preventDefault(); } });
  };

  SCOUT.frame = (A) => {
    const S = A.play;
    if (!S || ended(S)) { bar.classList.remove('show'); box.classList.remove('show'); hideTip(); return; }
    // новая партия или новая пауза между волнами: разведка раскрывается на следующей волне
    if (S !== lastS || S.phase !== lastPhase) { if (S.phase === 'prep') { open = true; page = 0; } lastS = S; lastPhase = S.phase; boxKey = ''; barKey = ''; }
    const r = SIM.scoutRange(S), prep = S.phase === 'prep', can = prep && r.from <= r.to, next = can ? preview(S, r.from + page) : null;
    // строка: в паузе — коротко о следующей волне, во время волны — сколько врагов осталось (с теми, кто выйдет из повозок)
    const bk = prep ? JSON.stringify([S.seed, S.wave, can, expanded(S)]) : 'w' + S.wave + ':' + SIM.remaining(S);
    if (bk !== barKey) { barKey = bk;
      if (can) { const w = preview(S, r.from), all = w.total.count + w.total.extra;
        bar.innerHTML = `<span>ВОЛНА ${w.n}</span>${w.boss ? '<span class="bad">☠ БОСС</span>' : ''}<span>${all} ${enemyWord(all)}</span>${w.trait ? `<span class="tr">⚑ ${w.trait.name}</span>` : ''}<span class="ar">${expanded(S) ? '▴' : '▾'}</span>`; }
      else if (prep) bar.innerHTML = '<span class="k">РАЗВЕДКА</span><span>волн больше нет</span>';
      else { const n = SIM.remaining(S); bar.innerHTML = `<span class="k">ВОЛНА ${S.wave}</span><span>осталось <b>${n}</b> ${enemyWord(n)}</span>`; }
      bar.classList.toggle('live', !prep); }
    bar.classList.add('show');
    const show = !!next && expanded(S);
    if (show) place(S, r);
    box.classList.toggle('show', show); if (!show) hideTip();
    if (show) { const key = JSON.stringify([S.seed, S.wave, next.n]); if (key !== boxKey) { boxKey = key; box.innerHTML = panelHTML(S, next, r); hideTip(); } }
  };
})();
