// live/ui.js — DOM-интерфейс «Некрополиса»: HUD, карточки, панель башни, выбор клеток, тосты, обучение, меню, сейв.
// Состояние партии живёт в симе (APP.play); здесь только выбор игрока (SCENE.ui) и показ. Команды уходят через APP.cmd().
(function () {
  const C = SIM.CONFIG, T = C.TOWERS, EN = C.ENEMIES;
  // сейв лежит под одним ключом без номера версии: версию несёт само состояние (S.v), чужую версию отбрасывает SIM.loadable
  const SAVE_KEY = 'necropolis.save', PREF_KEY = 'necropolis.prefs.v1', SAVE_EVERY = 1000;   // мс между автосохранениями забега
  const $ = (s, r = document) => r.querySelector(s);
  const h = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };
  const store = { get(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }, del(k) { try { localStorage.removeItem(k); } catch (e) {} } };
  // Сейв — { S, at, tab }: tab — метка страницы, которая его пишет, новая при каждой загрузке (дубликат вкладки получает свою:
  // sessionStorage копируется вместе с вкладкой, поэтому метку там не храним). Страница стирает сейв только свой, а чужая
  // запись в него отключает её автосохранение. Что остаётся неразрешённым:
  //  - две вкладки стартуют забег одновременно: каждая видит запись другой, и отключаются обе — до следующего старта;
  //  - отключённая вкладка молчит и после закрытия «владельца», пока сама не начнёт или не продолжит забег.
  const TAB = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  // Сейв продолжаем, только если это незаконченный забег и логика признала состояние годным (SIM.loadable).
  // Негодный (битый JSON, старая версия, порча) молча выбрасываем. Ключи сейвов прежних сборок (necropolis.save.v1…) убираем.
  // Вердикт помним по строке сейва: проверка с пробой не повторяется, пока сейв тот же (показ меню, затем «Продолжить»).
  let checked = { raw: null, ok: false };
  const saved = () => {
    let raw = null, sv = null; try { raw = localStorage.getItem(SAVE_KEY); } catch (e) {}
    if (raw === null) return null;
    try { sv = JSON.parse(raw); } catch (e) {}
    let ok = false;
    if (raw === checked.raw) ok = checked.ok;
    else try { ok = !!(sv && typeof sv === 'object' && sv.S && sv.S.phase !== 'won' && sv.S.phase !== 'lost' && SIM.loadable(sv.S)); }
    catch (e) { console.error(e); return null; }     // сбой самой проверки (не создался образец) — ошибка разработки: меню без «Продолжить», сейв не трогаем
    checked = { raw, ok };
    if (ok) return sv;
    store.del(SAVE_KEY); return null; };
  const dropOldSaves = () => { try { for (const k of Object.keys(localStorage)) if (k.startsWith(SAVE_KEY + '.')) localStorage.removeItem(k); } catch (e) {} };
  const has = (n) => !!(window.ASSETS && window.ASSETS[n]);
  const img = (n, fb) => has(n) ? `<img src="assets/${n}.png" alt="">` : (fb || '');
  const SOUL = '<span class="soul-ico"></span>';
  const PH = { bones: '#e6d9b8', spirits: '#6ff2e2', plague: '#8be04e', dark: '#c86bff' };
  const TIP_DESC = { phys: 'физический', magic: 'магический', poison: 'яд' };
  const PERK_ICON = { pierce: '➶', volley: '⋔', frost: '❄', pack: '👻', pestilence: '☣', acid: '⚗', harvest: '☠', curse: '✶' };
  const UI = (window.UI = {});
  let APP, cv, prefs = Object.assign({ vol: 0.7, tips: {} }, store.get(PREF_KEY) || {});
  const seenEv = new Set();
  const ui = SCENE.ui;

  // ---------------------------------------------------------------- разметка
  const build = () => {
    const root = $('#ui'); root.innerHTML = '';
    root.append(h('div', 'pass', '<div id="title">НЕКРОПОЛИС</div>'));
    const seed = h('div', 'frame box', 'СИД <span id="s-seed"></span>'); seed.id = 'seedbox'; seed.title = 'Сид забега: та же карта при том же сиде'; root.append(seed);
    const stats = h('div', '', ''); stats.id = 'stats';
    stats.innerHTML = `<button class="btn ibtn" id="b-speed" title="Скорость (F)">▶</button><button class="btn ibtn" id="b-pause" title="Пауза (Пробел)">❚❚</button>
      <div class="frame box wave">⚔ <span id="s-wave">ВОЛНА 0 / 20</span></div><div class="frame box souls">${SOUL}<span id="s-souls">0</span></div>
      <div class="frame box hp"><span class="heart-ico">❤</span><span id="s-hp">20</span></div><button class="btn ibtn" id="b-menu" title="Настройки (Esc)">⚙</button>`;
    root.append(stats);
    const wb = h('button', 'btn green', '<div class="l1" id="w-l1">Призвать волну</div><div class="l2" id="w-l2">Enter</div>'); wb.id = 'wavebtn'; root.append(wb);
    const cards = h('div', 'frame', ''); cards.id = 'cards';
    C.TOWER_ORDER.forEach((k, i) => { const d = T[k], c = h('div', 'card', `<span class="key">${i + 1}</span><div class="pic">${img('tw_' + k + '_1', `<div class="ph" style="background:${PH[k]}"></div>`)}</div><div class="nm">${d.name}</div><div class="pr">${SOUL} ${d.cost[0]}</div>`);
      c.dataset.type = k; cards.append(c); });
    root.append(cards);
    const panel = h('div', 'frame', ''); panel.id = 'panel'; root.append(panel);
    const tip = h('div', 'frame', ''); tip.id = 'tip'; root.append(tip);
    const toasts = h('div', '', ''); toasts.id = 'toasts'; root.append(toasts);
    const coach = h('div', 'frame', ''); coach.id = 'coach'; root.append(coach);
    root.append(h('div', 'overlay', ''), h('div', 'overlay', ''), h('div', 'overlay', ''), h('div', 'overlay', ''));
    const [menu, pause, end, ne] = root.querySelectorAll('.overlay'); menu.id = 'menu'; pause.id = 'pause'; end.id = 'end'; ne.id = 'newenemy';
    pause.innerHTML = `<div class="frame box"><h2>Пауза</h2>
      <div class="set"><span>Громкость</span><input type="range" min="0" max="1" step="0.05" id="vol"></div>
      <div class="col"><button class="btn green" id="p-resume">Продолжить</button><button class="btn" id="p-restart">Начать заново</button><button class="btn" id="p-menu">В главное меню</button></div></div>`;
    wire();
  };
  // волна, на которой игрок продолжит: идущая, а в паузе — следующая
  const waveOf = (S) => Math.min(SIM.lastWave(S), Math.max(1, S.phase === 'wave' ? S.wave : S.wave + 1));
  const menuHTML = () => { const sv = saved();
    return `<div class="box"><h1>НЕКРОПОЛИС</h1><div class="sub">Защити древний склеп от рыцарей, священников и осадных машин</div>
      <div class="col">${sv ? `<button class="btn green two" id="m-cont"><span class="l1">Продолжить</span><span class="l2">волна ${waveOf(sv.S)} · сид ${sv.S.seed}</span></button>` : ''}
      <button class="btn ${sv ? '' : 'green'}" id="m-new" title="Новая карта по случайному сиду">Новая игра</button>
      <div class="seedrow"><input id="m-seed" type="text" inputmode="numeric" maxlength="40" autocomplete="off" spellcheck="false" placeholder="сид карты" aria-label="Сид карты"><button class="btn" id="m-seedgo" disabled>По сиду</button></div>
      <div class="seednote" id="m-seednote"></div>
      <button class="btn" id="m-help">Как играть</button></div>
      <div class="frame help" id="m-helptext"><b>Цель:</b> переживи ${SIM.waveCount()} волн. Каждый прорвавшийся враг отнимает прочность склепа, босс — 10.<br>
      <b>Строительство:</b> нажми на свободную клетку у дороги, затем на карточку башни внизу слева (или клавиши 1–4). Можно и наоборот: выбери башню и нажми на клетку.<br>
      <b>Бесконечный режим:</b> после победы на ${SIM.waveCount()}-й волне можно держать оборону дальше — волны растут без предела, босс каждые 10 волн; итог — достигнутая волна.<br>
      <b>Карта</b> каждый забег новая, её задаёт сид: он виден слева вверху и на экране итогов. Введи его в поле «сид карты» — сыграешь ту же карту.<br>
      <b>Души</b> дают за каждого врага и за зачищенную волну. Трать их на новые башни и улучшения.<br>
      <b>Улучшение:</b> нажми на башню, затем «Улучшить» (U). На 3-м уровне открывается выбор одного из двух перков.<br>
      <b>Сочетай башни:</b> Кости — дешёвый урон, Духи замедляют, Чума травит толпу сквозь броню, Тьма жжёт повозки, боссов и священников.<br>
      <b>Управление:</b> Пробел — пауза, F — скорость ×2, Enter — призвать волну раньше, Esc — меню. Забег сохраняется сам, даже посреди волны: после перезагрузки страницы нажми «Продолжить».</div></div>`; };
  // поле сида: что получится из введённого — подпись под полем и доступность кнопки «По сиду»
  const SEED_NOTE = { empty: 'Сид из игры или с экрана итогов — та же карта', negative: 'Сид не может быть отрицательным',
    big: `Сид не больше ${C.SEED.max}`, format: `Только цифры: целое от 0 до ${C.SEED.max}` };
  const seedInput = () => { const r = SIM.parseSeed($('#m-seed').value), note = $('#m-seednote');
    note.textContent = r.ok ? `Карта по сиду ${r.seed}` : SEED_NOTE[r.reason];
    note.classList.toggle('bad', !r.ok && r.reason !== 'empty'); $('#m-seedgo').disabled = !r.ok; return r; };

  // ---------------------------------------------------------------- события ввода
  const toView = (e) => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) / r.width * SIM.VIEW.W, (e.clientY - r.top) / r.height * SIM.VIEW.H]; };
  // клетка под курсором; клетки под интерфейсом не игровые — для них -1 (без подсветки и выбора)
  const hitCell = (x, y) => { const S = APP.play; if (!S) return -1; const i = SIM.MAPGEN.cellAt(S.map, x, y); return i >= 0 && !SIM.MAPGEN.hud(S.map, i) ? i : -1; };
  const isRoad = (cell) => SIM.canBuild(APP.play, cell, 'bones').reason === 'road';
  const select = (i) => { ui.sel = i; ui.preview = null; ui.armed = null; ui.move = -1; renderPanel(true); };
  const tryBuild = (cell, type) => { const S = APP.play; if (!S) return false; const cb = SIM.canBuild(S, cell, type);
    if (!cb.ok) { if (cb.reason === 'souls') flashPoor(type); AUDIO.ui('deny'); return false; }
    APP.cmd({ k: 'build', cell, type }); ui.last = type; ui.armed = null; ui.preview = null; ui.sel = cell; setTimeout(() => renderPanel(true), 30); return true; };
  const flashPoor = (type) => { const c = $(`.card[data-type="${type}"]`); if (c) { c.animate([{ transform: 'translateX(-5px)' }, { transform: 'translateX(5px)' }, { transform: 'none' }], { duration: 220 }); }
    const s = $('#stats .souls'); s.classList.remove('gain'); void s.offsetWidth; s.animate([{ filter: 'brightness(1)' }, { filter: 'brightness(2) hue-rotate(140deg)' }, { filter: 'brightness(1)' }], { duration: 300 }); };
  const cardAction = (type) => { const S = APP.play; if (!S || ended()) return;
    if (ui.sel >= 0 && !S.towers[ui.sel]) { tryBuild(ui.sel, type); return; }
    ui.armed = ui.armed === type ? null : type; ui.sel = -1; ui.move = -1; renderPanel(true); };
  const upgrade = () => { const S = APP.play, tw = S && ui.sel >= 0 ? S.towers[ui.sel] : null; if (!tw) return;
    if (tw.lvl < 3) { if (S.souls >= SIM.upgradeCost(tw)) APP.cmd({ k: 'upgrade', cell: ui.sel }); else { AUDIO.ui('deny'); flashPoor(); } } setTimeout(() => renderPanel(true), 30); };
  const sell = () => { const S = APP.play; if (S && ui.sel >= 0 && S.towers[ui.sel]) { APP.cmd({ k: 'sell', cell: ui.sel }); setTimeout(() => renderPanel(true), 30); } };
  // перенос: кнопка или M включает режим выбора клетки (ui.move — клетка башни), клик по подсвеченной клетке переносит,
  // Esc, правый клик или клик по самой башне — отмена. Можно ли и куда — отвечает логика (SIM.canMove, SIM.moveCells)
  const startMove = () => { const S = APP.play; if (!S || ui.sel < 0 || !S.towers[ui.sel]) return;
    if (!SIM.canMove(S, ui.sel).ok) { AUDIO.ui('deny'); return; }
    ui.move = ui.sel; hideTip(); AUDIO.ui('click'); renderPanel(true); };
  const cancelMove = () => { if (ui.move < 0) return; ui.move = -1; renderPanel(true); };
  const tryMove = (to) => { const S = APP.play;
    if (!SIM.canMove(S, ui.move, to).ok) { AUDIO.ui('deny'); return; }
    APP.cmd({ k: 'move', cell: ui.move, to }); ui.move = -1; ui.sel = to; AUDIO.ui('click'); };
  const ended = () => APP.play && (APP.play.phase === 'won' || APP.play.phase === 'lost');
  const togglePause = (v) => { if (!APP.play || ended()) return; APP.paused = v === undefined ? !APP.paused : v; showOverlay('pause', APP.paused); };
  UI.autoPause = () => togglePause(true);

  const wire = () => {
    cv.addEventListener('pointermove', (e) => { const [x, y] = toView(e); ui.hover = hitCell(x, y);
      cv.style.cursor = ui.move >= 0 ? (SIM.canMove(APP.play, ui.move, ui.hover).ok ? 'pointer' : 'not-allowed') : ui.hover >= 0 && !isRoad(ui.hover) ? 'pointer' : 'default'; });
    cv.addEventListener('pointerleave', () => { ui.hover = -1; });
    cv.addEventListener('pointerdown', (e) => { AUDIO.unlock(); if (!APP.play || ended()) return; const [x, y] = toView(e), i = hitCell(x, y);
      if (ui.move >= 0) { if (e.button === 0) { if (i === ui.move) cancelMove(); else tryMove(i); } return; }   // правый — в contextmenu
      if (i >= 0 && ui.armed && !APP.play.towers[i]) { tryBuild(i, ui.armed); return; }
      if (i >= 0 && isRoad(i)) { AUDIO.ui('deny'); select(-1); return; }
      if (i >= 0) { select(ui.sel === i ? -1 : i); AUDIO.ui('click'); } else { select(-1); } });
    addEventListener('pointerdown', () => AUDIO.unlock(), { once: true });
    addEventListener('contextmenu', (e) => { if (ui.move >= 0) { e.preventDefault(); cancelMove(); } });
    $('#cards').addEventListener('click', (e) => { const c = e.target.closest('.card'); if (c) { AUDIO.ui('click'); cardAction(c.dataset.type); } });
    $('#cards').addEventListener('pointerover', (e) => { const c = e.target.closest('.card'); if (!c) return; showCardTip(c); if (ui.sel >= 0 && APP.play && !APP.play.towers[ui.sel]) ui.preview = c.dataset.type; });
    $('#cards').addEventListener('pointerout', (e) => { const c = e.target.closest('.card'); if (c && !c.contains(e.relatedTarget)) { hideTip(); ui.preview = null; } });
    $('#wavebtn').addEventListener('click', () => { AUDIO.unlock(); APP.cmd({ k: 'call' }); });
    $('#b-pause').addEventListener('click', () => togglePause());
    $('#b-speed').addEventListener('click', () => { APP.speed = APP.speed === 1 ? 2 : 1; });
    $('#b-menu').addEventListener('click', () => togglePause(true));
    $('#vol').addEventListener('input', (e) => { prefs.vol = +e.target.value; AUDIO.setVolume(prefs.vol); store.set(PREF_KEY, prefs); });
    $('#p-resume').addEventListener('click', () => togglePause(false));
    $('#p-restart').addEventListener('click', () => { APP.newGame(); resetRun(); showOverlay('pause', false); persist(); });
    $('#p-menu').addEventListener('click', () => { persist(); showOverlay('pause', false); APP.toMenu(); showMenu(); });
    addEventListener('keydown', (e) => {
      if (e.repeat) return; const k = e.code;
      // Enter в меню — «Продолжить» или «Новая игра», если фокус не на кнопке или поле: там Enter делает своё
      if (!APP.play) { if (k === 'Enter' && !(e.target && e.target.closest && e.target.closest('button, input, textarea, select'))) { const c = $('#m-cont') || $('#m-new'); if (c) c.click(); } return; }
      if ($('#newenemy').classList.contains('show')) { if (k === 'Enter' || k === 'Space' || k === 'Escape') { closeNewEnemy(); e.preventDefault(); } return; }
      if (k === 'Escape') { if (ui.move >= 0) cancelMove(); else if (ui.sel >= 0 || ui.armed) select(-1); else togglePause(); e.preventDefault(); return; }
      if (k === 'Space') { togglePause(); e.preventDefault(); return; }
      if (APP.paused || ended()) return;
      const dg = /^Digit([1-4])$/.exec(k) || /^Numpad([1-4])$/.exec(k); if (dg) { cardAction(C.TOWER_ORDER[+dg[1] - 1]); return; }
      if (k === 'KeyU') upgrade(); else if (k === 'KeyX' || k === 'Delete') sell(); else if (k === 'KeyM') { if (ui.move >= 0) cancelMove(); else startMove(); } else if (k === 'KeyF') APP.speed = APP.speed === 1 ? 2 : 1;
      else if (k === 'Enter' || k === 'KeyN') APP.cmd({ k: 'call' });
    });
  };

  // ---------------------------------------------------------------- тултипы
  const towerLines = (k, lvl) => { const d = T[k], i = lvl - 1, L = [];
    if (k === 'plague') L.push(['Яд', `${d.dps[i]}/с · ${d.cloudTime} с`]); else L.push(['Атака', `${d.dmg[i]} · ${TIP_DESC[d.dmgType]}`]);
    L.push(['Скорость', `${d.rate[i]} с`]); L.push(['Радиус', `${SIM.rangeTiles(d.range[i]).toFixed(1)} кл.`]);
    if (k === 'spirits') L.push(['Замедление', `${Math.round(d.slow[i] * 100)}%`]);
    if (k === 'dark') L.push(['По тяжёлым', `×${d.heavyMult}`]);
    return L; };
  const tipAt = (html, x, y) => { const t = $('#tip'); t.innerHTML = html; t.classList.add('show'); t.style.left = x + 'px'; t.style.top = (y - t.offsetHeight) + 'px'; };
  const hideTip = () => $('#tip').classList.remove('show');
  const showCardTip = (c) => { const k = c.dataset.type, d = T[k];
    tipAt(`<h4>${d.title}</h4><div>${d.desc}</div><div class="row" style="margin-top:6px">${towerLines(k, 1).map(([a, b]) => `${a}: <b>${b}</b>`).join(' · ')}</div>`, c.offsetLeft + 10, 900 - 150); };

  // ---------------------------------------------------------------- панель
  let panelKey = '';
  // панель открывается на стороне поля, противоположной выбранной клетке, и никогда не закрывает её
  const panelLeft = (S) => SIM.cellXY(S, ui.sel)[0] >= SIM.VIEW.W / 2;
  const tipBeside = () => { const p = $('#panel'), left = p.classList.contains('left'); return [left ? p.offsetLeft + p.offsetWidth + 10 : p.offsetLeft - 310, 900 - 220]; };
  // Панель собрана из кусков, каждый — своя функция (тикеты правят свой кусок, не соседний):
  //   buildMenu(S, p)                    — свободная клетка: меню постройки (покрытие дороги, подсказка)
  //   towerHead(S, tw)                   — башня: картинка, имя, уровень, характеристики
  //   towerGrowth(S, tw) / wireGrowth()  — башня: перки и улучшение
  //   towerManage(S, tw) / wireManage()  — башня: управление (перенос, продажа)
  const closeBtn = '<button class="btn x">✕</button>';
  const buildMenu = (S, p) => {
    const cov = SIM.coverage(S, ui.sel, 3.4), q = cov > 520 ? 'узловая: бьёт по нескольким участкам дороги' : cov > 300 ? 'хорошее покрытие дороги' : cov > 0 ? 'короткий участок дороги' : 'дорога далеко';
    p.innerHTML = `${closeBtn}<div class="nm">Свободная клетка</div><div class="note" style="margin-top:6px">${q[0].toUpperCase() + q.slice(1)}.</div>
        <div class="note" style="margin-top:8px">Выберите башню на карточках слева внизу или клавишами 1–4.</div>`;
  };
  const towerHead = (S, tw) => {
    const d = T[tw.type], lines = towerLines(tw.type, tw.lvl), next = tw.lvl < 3 ? towerLines(tw.type, tw.lvl + 1) : null;
    return `<div class="hd"><div class="pic">${img([3, 2, 1].map((l) => 'tw_' + tw.type + '_' + l).find((n) => has(n) && +n.slice(-1) <= tw.lvl) || 'tw_' + tw.type + '_' + tw.lvl, `<div class="ph" style="width:40px;height:60px;background:${PH[tw.type]}"></div>`)}</div>
      <div><div class="nm">${d.short}</div><div class="lv">УРОВЕНЬ ${tw.lvl}</div></div></div>
      <div class="st">${lines.map(([a, b], i) => `<div><span>${a}</span><span><b>${b}</b>${next && next[i][1] !== b ? `<span class="nx">→ ${next[i][1].split(' ·')[0]}</span>` : ''}</span></div>`).join('')}
      <div><span>Убито</span><span><b>${tw.kills}</b></span></div></div>`;
  };
  const towerGrowth = (S, tw) => {
    const d = T[tw.type], upc = SIM.upgradeCost(tw);
    return `<div class="perks">${Object.entries(d.perks).map(([pk, pd]) => { const ch = tw.perk === pk, lock = tw.lvl < 3 || (tw.perk && !ch);
        return `<button class="btn perk ${ch ? 'chosen' : ''} ${lock ? 'locked' : ''}" data-p="${pk}"><span class="ic">${PERK_ICON[pk]}</span>${pd.name}${!tw.perk && tw.lvl === 3 ? `<span style="color:var(--soul)">${SOUL}${pd.cost}</span>` : ''}</button>`; }).join('')}</div>
      ${tw.lvl < 3 ? `<button class="btn green up ${S.souls < upc ? 'off' : ''}">УЛУЧШИТЬ · ${SOUL} ${upc}</button>` : `<button class="btn up off">${tw.perk ? 'МАКСИМУМ' : 'ВЫБЕРИ ПЕРК'}</button>`}`;
  };
  const wireGrowth = (p, S, tw) => {
    const d = T[tw.type];
    p.querySelector('.up').onclick = upgrade;
    p.querySelectorAll('.perk').forEach((b) => {
      const pk = b.dataset.p, pd = d.perks[pk];
      b.onmouseenter = () => tipAt(`<h4>${pd.name}</h4><div>${pd.desc}</div><div class="row" style="margin-top:6px">${tw.lvl < 3 ? 'Откроется на 3-м уровне' : tw.perk ? (tw.perk === pk ? 'Выбрано' : 'Выбран другой перк') : `Цена: <b>${pd.cost}</b> душ · выбор навсегда`}</div>`, ...tipBeside());
      b.onmouseleave = hideTip;
      b.onclick = () => { if (tw.lvl === 3 && !tw.perk) { if (S.souls >= pd.cost) { APP.cmd({ k: 'perk', cell: ui.sel, p: pk }); hideTip(); setTimeout(() => renderPanel(true), 30); } else AUDIO.ui('deny'); } };
    });
  };
  const towerManage = (S, tw) => {
    if (ui.move === ui.sel) return `<div class="note mv">Куда перенести? Нажми на подсвеченную клетку. Esc или правый клик — отмена.</div>
      <button class="btn mvx">Отменить перенос</button>`;
    const cm = SIM.canMove(S, ui.sel);
    return `<button class="btn move ${cm.ok ? '' : 'off'}">${cm.ok ? 'Перенести · бесплатно' : 'Перенос — между волнами'}</button>
      <button class="btn red sell">Продать · +${SIM.sellValue(tw)}</button>`;
  };
  const wireManage = (p, S, tw) => {
    const mv = p.querySelector('.move'), mx = p.querySelector('.mvx'), sl = p.querySelector('.sell');
    if (mv) { mv.onclick = startMove;
      mv.onmouseenter = () => tipAt(`<h4>Перенос</h4><div>${SIM.canMove(S, ui.sel).ok ? 'Бесплатно и мгновенно, вся прокачка и перк остаются. Бонус особой клетки — от новой клетки.' : 'Во время волны башни не переносятся. Дождись конца волны.'}</div><div class="row" style="margin-top:6px">Клавиша <b>M</b></div>`, ...tipBeside());
      mv.onmouseleave = hideTip; }
    if (mx) mx.onclick = cancelMove;
    if (sl) sl.onclick = sell;
  };

  const renderPanel = (force) => {
    const S = APP.play, p = $('#panel');
    document.querySelectorAll('.card').forEach((c) => { const k = c.dataset.type, poor = S && S.souls < T[k].cost[0];
      c.classList.toggle('poor', !!poor); c.classList.toggle('armed', ui.armed === k); c.classList.toggle('target', !!(S && ui.sel >= 0 && !S.towers[ui.sel])); c.classList.toggle('can', !poor); });
    if (!S || ui.sel < 0) { p.classList.remove('show'); panelKey = ''; return; }
    const tw = S.towers[ui.sel], key = JSON.stringify([ui.sel, tw && [tw.type, tw.lvl, tw.perk, tw.invested], Math.floor(S.souls / 1), S.phase, ui.move]);
    if (!force && key === panelKey) return; panelKey = key;
    p.classList.add('show'); p.classList.toggle('left', panelLeft(S));
    if (!tw) buildMenu(S, p);
    else { p.innerHTML = closeBtn + towerHead(S, tw) + towerGrowth(S, tw) + towerManage(S, tw); wireGrowth(p, S, tw); wireManage(p, S, tw); }
    p.querySelector('.x').onclick = () => select(-1);
  };

  // ---------------------------------------------------------------- тосты, новый враг, обучение
  const toast = (html, cls = '', ms = 2600) => { const t = h('div', 'frame toast ' + cls, html); $('#toasts').append(t);
    setTimeout(() => t.classList.add('out'), ms); setTimeout(() => t.remove(), ms + 600); };
  let neQueue = [];
  const showNewEnemy = (type) => { const d = EN[type], o = $('#newenemy'), st = SIM.enemyStats(APP.play, type);   // цифры этой волны, со свойством
    const tags = [`HP ${st.hp}`, st.armor ? `броня ${Math.round(st.armor * 100)}%` : '', st.mres ? `защита от магии ${Math.round(st.mres * 100)}%` : '', st.heal ? `лечит ${st.heal} HP` : '', d.boss ? 'босс' : '', `скорость ${st.speed}`].filter(Boolean).join(' · ');
    o.innerHTML = `<div class="frame box"><h2>Новый враг</h2><div class="pic" style="${has('en_' + type) ? '' : 'filter:sepia(1) saturate(2.2) brightness(1.1)'}">${img(has('en_' + type) ? 'en_' + type : 'en_knight', '')}</div><div style="font:700 28px var(--title)">${d.name}</div>
      <div class="tags">${tags}</div><p>${d.desc}</p><div class="col"><button class="btn green" id="ne-ok">К бою (Enter)</button></div></div>`;
    showOverlay('newenemy', true); APP.paused = true; $('#ne-ok').onclick = closeNewEnemy; };
  const closeNewEnemy = () => { showOverlay('newenemy', false); APP.paused = false; if (neQueue.length) showNewEnemy(neQueue.shift()); };
  const COACH = [
    { id: 'build', when: (S) => S.wave === 0 && !S.towers.some(Boolean), at: (S) => SIM.cellXY(S, bestCell(S)),
      text: 'Нажми на свободную клетку у дороги, затем выбери башню внизу слева. Клетки внутри петель бьют сразу по нескольким участкам дороги.' },
    { id: 'call', when: (S) => S.wave === 0 && S.towers.some(Boolean), at: () => { const b = $('#wavebtn'); return [b.offsetLeft + b.offsetWidth / 2, b.offsetTop + b.offsetHeight / 2]; },
      text: 'Когда оборона готова — призови первую волну. Дальше волны идут сами, но можно звать и раньше.' },
    { id: 'upgrade', when: (S) => S.wave >= 2 && S.phase === 'prep' && S.towers.some((t) => t && t.lvl === 1) && S.souls >= 110, at: (S) => SIM.cellXY(S, S.towers.find((t) => t && t.lvl === 1).cell),
      text: 'Нажми на башню, чтобы улучшить её. Прокачка часто выгоднее новой башни в стороне от дороги.' },
    { id: 'perk', when: (S) => S.towers.some((t) => t && t.lvl === 3 && !t.perk), at: (S) => SIM.cellXY(S, S.towers.find((t) => t && t.lvl === 3 && !t.perk).cell),
      text: 'Башня 3-го уровня может взять один из двух перков. Выбор навсегда — читай подсказки.' },
  ];
  // где поставить подсказку w×h рядом с точкой (x, y): перебираем места вокруг цели (сеткой до ~400 px) и берём то, что
  // не закрывает дорогу, интерфейс и саму цель, а из таких — ближайшее. Результат кэшируется, пока не сменились цель и раскладка.
  const rectsOf = (sel) => [...document.querySelectorAll(sel)].filter((e) => e.offsetParent && getComputedStyle(e).visibility !== 'hidden').map((e) => [e.offsetLeft, e.offsetTop, e.offsetWidth, e.offsetHeight]);
  const overlap = (a, b) => Math.max(0, Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]));
  let placed = { key: '', r: null };
  const placeNear = (S, x, y, w, h) => {
    const busy = rectsOf('#stats, #seedbox, #wavebtn, #cards, #panel.show, #title, #scout.show, #scout-panel.show'), key = [S.seed, x, y, w, h, JSON.stringify(busy)].join('|');
    if (placed.key === key) return placed.r;
    const tile = C.GRID.tile, road = S.map.road.map((i) => [(i % S.map.cols) * tile, Math.floor(i / S.map.cols) * tile, tile, tile]), target = [x - 40, y - 40, 80, 80];
    let best = null, bestCost = Infinity;
    for (let oy = -400; oy <= 400; oy += 24) for (let ox = -480; ox <= 480; ox += 24) {
      const r = [Math.max(10, Math.min(1590 - w, x + ox - w / 2)), Math.max(58, Math.min(890 - h, y + oy - h / 2)), w, h];
      let cost = 0; for (const q of road) cost += overlap(r, q); for (const q of busy) cost += 4 * overlap(r, q); cost += 8 * overlap(r, target);
      cost += 3 * Math.hypot(r[0] + w / 2 - x, r[1] + h / 2 - y);
      if (cost < bestCost) { bestCost = cost; best = r; } }
    placed = { key, r: best }; return best; };
  let best = { key: '', cell: -1 };                                 // лучшая клетка карты для подсказки (считается раз на карту)
  const bestCell = (S) => { const key = S.seed + ':' + S.map.road.length; if (best.key !== key) best = { key, cell: SIM.rankCells(S, 3.4)[0] }; return best.cell; };
  const coach = (S) => { const el = $('#coach'), c = COACH.find((q) => !prefs.tips[q.id] && q.when(S));
    for (const q of COACH) if (!prefs.tips[q.id] && done(q, S)) { prefs.tips[q.id] = 1; store.set(PREF_KEY, prefs); }
    if (!c || APP.paused) { el.classList.remove('show'); return; }
    if (el.textContent !== c.text) el.textContent = c.text;
    el.classList.add('show');
    const [x, y] = c.at(S), [l, t] = placeNear(S, x, y, el.offsetWidth, el.offsetHeight); el.style.left = l + 'px'; el.style.top = t + 'px'; };
  const done = (q, S) => (q.id === 'build' && S.towers.some(Boolean)) || (q.id === 'call' && S.wave > 0) || (q.id === 'upgrade' && S.towers.some((t) => t && t.lvl > 1)) || (q.id === 'perk' && S.towers.some((t) => t && t.perk));

  // ---------------------------------------------------------------- оверлеи
  const showOverlay = (id, on) => { if (on) hideTip(); $('#' + id).classList.toggle('show', !!on); if (id === 'menu') document.body.classList.toggle('inmenu', !!on); };
  // меню перерисовывается и когда сейв поменяла другая вкладка (onStorage): введённый сид и фокус поля сохраняются
  const showMenu = () => { const m = $('#menu'), old = $('#m-seed'), typed = old ? old.value : '', focused = !!old && document.activeElement === old;
    m.innerHTML = menuHTML(); showOverlay('menu', true);
    if (typed) $('#m-seed').value = typed; if (focused) $('#m-seed').focus();
    // сейв уже проверен в saved() — APP.load не повторяет проверку; вкладка сразу записывает забег своей меткой
    const c = $('#m-cont'); if (c) c.onclick = () => { const sv = saved(); if (sv && APP.load(sv.S, true)) { resetRun(); showOverlay('menu', false); AUDIO.ui('start'); persist(); } else showMenu(); };
    $('#m-new').onclick = () => startRun();
    const inp = $('#m-seed'); inp.oninput = seedInput; seedInput();
    $('#m-seedgo').onclick = () => { const r = seedInput(); if (r.ok) { inp.blur(); startRun(r.seed); } else AUDIO.ui('deny'); };
    // клавиши поля не доходят до игровых: Enter здесь — только «По сиду», а не «призвать волну» в только что начатом забеге
    inp.onkeydown = (e) => { e.stopPropagation(); if (e.code === 'Enter' || e.code === 'NumpadEnter') { e.preventDefault(); $('#m-seedgo').click(); } else if (e.code === 'Escape') inp.blur(); };
    $('#m-help').onclick = () => $('#m-helptext').classList.toggle('show'); };
  // новый забег — по сиду (ввод на титульном экране, «Переиграть сид») или по случайному
  const startRun = (seed) => { APP.newGame(seed); resetRun(); showOverlay('menu', false); AUDIO.ui('start'); persist(); };
  const clock = (sec) => { const t = Math.floor(sec), hh = Math.floor(t / 3600), mm = Math.floor(t / 60) % 60, ss = String(t % 60).padStart(2, '0');
    return hh ? `${hh}:${String(mm).padStart(2, '0')}:${ss}` : `${mm}:${ss}`; };
  // Экран конца забега. Победа на последней волне — сначала выбор: продолжить в бесконечном режиме или закончить;
  // итоги (после «Закончить» и после поражения) — сид, волна, время, убийства; новый забег или переигровка того же сида.
  const showEnd = (S, final) => { const won = S.phase === 'won', choice = won && !final && SIM.canEndless(S), R = SIM.waveCount();
    const text = won ? (choice ? `Последний паладин рассыпался в прах. Можно закончить забег — или держать оборону дальше: волны будут расти без предела, босс — каждые 10 волн.`
      : 'Последний паладин рассыпался в прах. Некрополис спит спокойно.')
      : S.endless ? `Бесконечный режим: враги прорвались на ${S.wave}-й волне. Отбито волн: ${S.wave - 1}, из них после победы — ${S.wave - 1 - R}.`
      : `Враги прорвались на ${S.wave}-й волне. Попробуй другое сочетание башен.`;
    const btns = choice ? `<button class="btn green two" id="e-endless"><span class="l1">Продолжить</span><span class="l2">бесконечный режим</span></button><button class="btn" id="e-finish">Закончить забег</button>`
      : `<button class="btn green" id="e-again">Новый забег</button><button class="btn" id="e-replay">Переиграть сид ${S.seed}</button><button class="btn" id="e-menu">В главное меню</button>`;
    $('#end').innerHTML = `<div class="frame box"><h2 style="color:${won ? 'var(--soul)' : 'var(--bad)'}">${won ? 'Склеп устоял' : 'Склеп пал'}</h2>
      <p>${text}</p>
      <div class="stats"><span>Сид</span><b>${S.seed}</b><span>Волна</span><b>${S.endless ? `${S.wave} · ∞` : `${S.wave} / ${R}`}</b><span>Время</span><b>${clock(S.stats.time)}</b><span>Врагов повержено</span><b>${S.stats.kills}</b>
      <span>Прочность склепа</span><b>${S.hp} / ${C.CRYPT_HP}</b><span>Собрано душ</span><b>${S.stats.earned}</b></div>
      <div class="col">${btns}</div></div>`;
    showOverlay('end', true);
    if (choice) {
      $('#e-endless').onclick = () => { APP.cmd({ k: 'endless' }); showOverlay('end', false); AUDIO.ui('start'); };
      $('#e-finish').onclick = () => showEnd(S, true);
      return; }
    $('#e-again').onclick = () => startRun();
    $('#e-replay').onclick = () => { const r = SIM.parseSeed(String(S.seed)); if (r.ok) startRun(r.seed); else AUDIO.ui('deny'); };
    $('#e-menu').onclick = () => { showOverlay('end', false); APP.toMenu(); showMenu(); }; };
  // события, уже лежащие в загруженном забеге, отыграны до сохранения: не повторяем их тосты, звуки и окно «новый враг»
  const evKey = (e) => e.k + '|' + e.t.toFixed(4) + '|' + (e.x || 0).toFixed(1);
  const markSeen = () => { seenEv.clear(); if (APP.play) for (const e of APP.play.ev) seenEv.add(evKey(e)); };
  const resetRun = () => { detached = false; ui.sel = -1; ui.armed = null; ui.move = -1; ui.preview = null; neQueue = []; markSeen(); $('#toasts').innerHTML = ''; panelKey = ''; showOverlay('end', false); showOverlay('newenemy', false); };

  // ---------------------------------------------------------------- сейв
  // Незаконченный забег пишется целиком, в любой фазе (и посреди волны): раз в SAVE_EVERY мс, сразу после команд и начала
  // и конца волны, при уходе в меню и при закрытии или скрытии страницы. Законченный забег стирает сейв один раз (dropOwn).
  // Вкладка, чей сейв перезаписала другая вкладка (detached), больше не пишет, пока не начнёт или не продолжит забег сама.
  let savedAt = 0, detached = false, writeFailed = false;
  const persist = () => { const S = APP.play; savedAt = performance.now();
    if (!S || S.demo || detached || S.phase === 'won' || S.phase === 'lost') return;
    try { localStorage.setItem(SAVE_KEY, JSON.stringify({ S, at: Date.now(), tab: TAB })); }
    catch (e) {                                       // не записалось: старый сейв вернул бы игрока далеко назад — убираем его
      store.del(SAVE_KEY);
      if (!writeFailed) { writeFailed = true; toast('Забег не сохраняется<small>Хранилище браузера недоступно или переполнено</small>', '', 5000); } } };
  // свой забег закончился: стираем сейв, только если в хранилище лежит именно он
  const dropOwn = () => { try { const sv = JSON.parse(localStorage.getItem(SAVE_KEY)); if (sv && sv.tab === TAB) localStorage.removeItem(SAVE_KEY); } catch (e) {} };
  const onStorage = (e) => { if (e.key !== SAVE_KEY) return;
    if (!APP.play) { if ($('#menu').classList.contains('show')) showMenu(); return; }   // подпись «Продолжить» — по свежему сейву
    if (e.newValue === null || detached) return;
    let tab = null; try { tab = JSON.parse(e.newValue).tab; } catch (x) {}
    if (tab !== TAB) { detached = true; toast('Забег сохраняет другая вкладка<small>Здесь прогресс больше не сохраняется</small>', '', 5000); } };

  // ---------------------------------------------------------------- кадр
  let lastSouls = -1, lastHp = -1, wasEnded = false;
  UI.frame = (A, t) => {
    const S = A.play;
    $('#stats').style.visibility = S ? 'visible' : 'hidden'; $('#cards').style.visibility = S ? 'visible' : 'hidden'; $('#seedbox').style.visibility = S ? 'visible' : 'hidden';
    if (!S) { $('#wavebtn').classList.add('hidden'); $('#panel').classList.remove('show'); $('#coach').classList.remove('show'); return; }
    $('#s-wave').textContent = S.endless ? `ВОЛНА ${Math.max(1, S.wave)} · ∞` : `ВОЛНА ${Math.max(1, S.wave)} / ${SIM.waveCount()}`; $('#s-seed').textContent = S.seed;
    if (S.souls !== lastSouls) { $('#s-souls').textContent = S.souls; if (S.souls > lastSouls && lastSouls >= 0) { const b = $('#stats .souls'); b.classList.remove('gain'); void b.offsetWidth; b.classList.add('gain'); } lastSouls = S.souls; }
    if (S.hp !== lastHp) { $('#s-hp').textContent = S.hp; if (S.hp < lastHp) { const b = $('#stats .hp'); b.classList.remove('hurt'); void b.offsetWidth; b.classList.add('hurt'); } lastHp = S.hp; }
    $('#b-pause').classList.toggle('on', A.paused); $('#b-speed').textContent = A.speed === 2 ? '▶▶' : '▶'; $('#b-speed').classList.toggle('on', A.speed === 2);
    const wb = $('#wavebtn'), canCall = S.phase === 'prep' && S.wave < SIM.lastWave(S);
    wb.classList.toggle('hidden', !canCall);
    if (canCall) { const nx = S.wave + 1, boss = SIM.isBoss(nx);
      $('#w-l1').textContent = S.wave === 0 ? 'Начать волну 1' : `Призвать волну ${nx}`;
      $('#w-l2').textContent = (boss ? 'БОСС · ' : '') + (S.prepT > 0 ? `сама через ${Math.ceil(S.prepT)} с · Enter` : 'Enter');
      wb.classList.toggle('pulse', S.wave === 0 && S.towers.some(Boolean)); }
    // события → звук, тосты, новые враги, сейв
    for (const e of S.ev) { const key = evKey(e); if (seenEv.has(key)) continue; seenEv.add(key);
      AUDIO.event(e);
      if (e.k === 'wave') toast(`ВОЛНА ${e.wave}${e.boss ? '<small>Приближается босс</small>' : ''}`, 'big' + (e.boss ? ' boss' : ''), 2200);
      if (e.k === 'boss') toast(`☠ ${e.name} ☠<small>Пропуск стоит ${EN.paladin.leak} прочности склепа</small>`, 'boss', 3600);
      if (e.k === 'waveClear') { toast(`Волна ${e.wave} отбита<small>+${e.bonus} душ</small>`, '', 2400); savedAt = 0; }
      if (e.k === 'endless') { toast('Бесконечный режим<small>Волны растут без предела · босс каждые 10 волн</small>', 'big', 3000); savedAt = 0; }
      if (e.k === 'newEnemy' && e.type !== 'militia') { if ($('#newenemy').classList.contains('show')) neQueue.push(e.type); else showNewEnemy(e.type); }
      if (e.k === 'build' || e.k === 'upgrade' || e.k === 'perk' || e.k === 'sell' || e.k === 'move' || e.k === 'wave') savedAt = 0;
    }
    if (seenEv.size > 3000) markSeen();
    if (performance.now() - savedAt >= SAVE_EVERY) persist();
    const isEnded = S.phase === 'won' || S.phase === 'lost';
    if (isEnded && !wasEnded) { select(-1); dropOwn(); setTimeout(() => showEnd(APP.play), 900); }
    wasEnded = isEnded;
    if (ui.move >= 0 && !SIM.canMove(S, ui.move).ok) { cancelMove(); if (S.phase === 'wave') toast('Волна началась — перенос отменён', '', 2000); }
    renderPanel(false); coach(S);
  };

  UI.init = (A, canvas) => {
    APP = A; cv = canvas; build(); $('#vol').value = prefs.vol; AUDIO.setVolume(prefs.vol); dropOldSaves(); markSeen();
    addEventListener('pagehide', persist); addEventListener('beforeunload', persist); addEventListener('storage', onStorage);
    document.addEventListener('visibilitychange', () => { if (document.hidden) persist(); });
    if (!A.play) showMenu(); else if (A.paused) showOverlay('pause', true);
  };
})();
