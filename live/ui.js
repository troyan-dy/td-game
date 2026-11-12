// live/ui.js — DOM-интерфейс «Некрополиса»: HUD, карточки, панель башни, выбор клеток, тосты, обучение, меню, сейв.
// Состояние партии живёт в симе (APP.play); здесь только выбор игрока (SCENE.ui) и показ. Команды уходят через APP.cmd().
(function () {
  const C = SIM.CONFIG, T = C.TOWERS, EN = C.ENEMIES;
  const SAVE_KEY = 'necropolis.save.v2', PREF_KEY = 'necropolis.prefs.v1';
  const $ = (s, r = document) => r.querySelector(s);
  const h = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };
  const store = { get(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }, del(k) { try { localStorage.removeItem(k); } catch (e) {} } };
  // сейв продолжаем, только если логика признала состояние годным (версия, карта, поля); негодный выбрасываем
  const saved = () => { const sv = store.get(SAVE_KEY); if (sv && sv.S && SIM.loadable(sv.S)) return sv; if (sv) store.del(SAVE_KEY); return null; };
  const has = (n) => !!(window.ASSETS && window.ASSETS[n]);
  const img = (n, fb) => has(n) ? `<img src="assets/${n}.png" alt="">` : (fb || '');
  const SOUL = '<span class="soul-ico"></span>';
  const PH = { bones: '#e6d9b8', spirits: '#6ff2e2', plague: '#8be04e', dark: '#c86bff' };
  const TIP_DESC = { phys: 'физический', magic: 'магический', poison: 'яд' };
  const DMG_KIND = { phys: 'физический урон', magic: 'магический урон', poison: 'урон ядом' };
  const PERK_ICON = { pierce: '➶', volley: '⋔', frost: '❄', pack: '👻', pestilence: '☣', acid: '⚗', harvest: '☠', curse: '✶', crush: '⚒', chill: '☾', miasma: '♨', split: '⟡' };
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
      <div class="frame box wave">⚔ <span id="s-wave">ВОЛНА 0 / 25</span></div><div class="frame box souls">${SOUL}<span id="s-souls">0</span></div>
      <div class="frame box hp"><span class="heart-ico">❤</span><span id="s-hp">20</span></div><button class="btn ibtn" id="b-menu" title="Настройки (Esc)">⚙</button>`;
    root.append(stats);
    const wb = h('button', 'btn green', '<div class="l1" id="w-l1">Призвать волну</div><div class="l2" id="w-l2">Enter</div>'); wb.id = 'wavebtn'; root.append(wb);
    const cards = h('div', 'frame', ''); cards.id = 'cards';
    C.TOWER_ORDER.forEach((k, i) => { const d = T[k], c = h('div', 'card', `<span class="key">${i + 1}</span><div class="pic">${img('tw_' + k + '_1', `<div class="ph" style="background:${PH[k]}"></div>`)}</div><div class="nm">${d.name}</div><div class="pr">${SOUL} ${d.base.cost}</div>`);
      c.dataset.type = k; cards.append(c); });
    root.append(cards);
    const panel = h('div', 'frame', ''); panel.id = 'panel'; root.append(panel);
    panel.addEventListener('pointerdown', () => { pressed = true; }); addEventListener('pointerup', () => { pressed = false; }, true);
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
  const menuHTML = () => { const sv = saved();
    return `<div class="box"><h1>НЕКРОПОЛИС</h1><div class="sub">Защити древний склеп от рыцарей, священников и осадных машин</div>
      <div class="col">${sv ? `<button class="btn green" id="m-cont">Продолжить · волна ${sv.S.wave + 1}</button>` : ''}
      <button class="btn ${sv ? '' : 'green'}" id="m-new">Новая игра</button><button class="btn" id="m-help">Как играть</button></div>
      <div class="frame help" id="m-helptext"><b>Цель:</b> переживи 25 волн. Каждый прорвавшийся враг отнимает прочность склепа, босс — 10.<br>
      <b>Строительство:</b> нажми на свободную клетку у дороги, затем на карточку башни внизу слева (или клавиши 1–4). Можно и наоборот: выбери башню и нажми на клетку.<br>
      <b>Карта</b> каждый забег новая, её задаёт сид (он виден слева вверху).<br>
      <b>Души</b> дают за каждого врага и за зачищенную волну. Трать их на новые башни и улучшения.<br>
      <b>Прокачка:</b> нажми на башню и качай её ветки — урон (Q), дальность (W), скорость (E), по ${C.TRACK_MAX} ступеней. Когда в башню вложено ${C.PERK_AT} ступеней, выбери один из трёх перков.<br>
      <b>Сочетай башни:</b> Кости — дешёвый урон, Духи замедляют, Чума травит толпу сквозь броню, Тьма жжёт повозки, боссов и священников.<br>
      <b>Управление:</b> Пробел — пауза, F — скорость ×2, Enter — призвать волну раньше, Esc — меню. Прогресс сохраняется между волнами.</div></div>`; };

  // ---------------------------------------------------------------- события ввода
  const toView = (e) => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) / r.width * SIM.VIEW.W, (e.clientY - r.top) / r.height * SIM.VIEW.H]; };
  // клетка под курсором; клетки под интерфейсом не игровые — для них -1 (без подсветки и выбора)
  const hitCell = (x, y) => { const S = APP.play; if (!S) return -1; const i = SIM.MAPGEN.cellAt(S.map, x, y); return i >= 0 && !SIM.MAPGEN.hud(S.map, i) ? i : -1; };
  const isRoad = (cell) => SIM.canBuild(APP.play, cell, 'bones').reason === 'road';
  const select = (i) => { ui.sel = i; ui.preview = null; ui.armed = null; renderPanel(true); };
  const tryBuild = (cell, type) => { const S = APP.play; if (!S) return false; const cb = SIM.canBuild(S, cell, type);
    if (!cb.ok) { if (cb.reason === 'souls') flashPoor(type); AUDIO.ui('deny'); return false; }
    APP.cmd({ k: 'build', cell, type }); ui.last = type; ui.armed = null; ui.preview = null; ui.sel = cell; setTimeout(() => renderPanel(true), 30); return true; };
  const flashPoor = (type) => { const c = $(`.card[data-type="${type}"]`); if (c) { c.animate([{ transform: 'translateX(-5px)' }, { transform: 'translateX(5px)' }, { transform: 'none' }], { duration: 220 }); }
    const s = $('#stats .souls'); s.classList.remove('gain'); void s.offsetWidth; s.animate([{ filter: 'brightness(1)' }, { filter: 'brightness(2) hue-rotate(140deg)' }, { filter: 'brightness(1)' }], { duration: 300 }); };
  const cardAction = (type) => { const S = APP.play; if (!S || ended()) return;
    if (ui.sel >= 0 && !S.towers[ui.sel]) { tryBuild(ui.sel, type); return; }
    ui.armed = ui.armed === type ? null : type; ui.sel = -1; renderPanel(true); };
  const upgrade = (track) => { const S = APP.play, tw = S && ui.sel >= 0 ? S.towers[ui.sel] : null; if (!tw) return;
    const cu = SIM.canUpgrade(S, ui.sel, track);
    if (cu.ok) APP.cmd({ k: 'upgrade', cell: ui.sel, track }); else { AUDIO.ui('deny'); if (cu.reason === 'souls') flashPoor(); } setTimeout(() => renderPanel(true), 30); };
  const sell = () => { const S = APP.play; if (S && ui.sel >= 0 && S.towers[ui.sel]) { APP.cmd({ k: 'sell', cell: ui.sel }); setTimeout(() => renderPanel(true), 30); } };
  const ended = () => APP.play && (APP.play.phase === 'won' || APP.play.phase === 'lost');
  const togglePause = (v) => { if (!APP.play || ended()) return; APP.paused = v === undefined ? !APP.paused : v; showOverlay('pause', APP.paused); };
  UI.autoPause = () => togglePause(true);

  const wire = () => {
    cv.addEventListener('pointermove', (e) => { const [x, y] = toView(e); ui.hover = hitCell(x, y); cv.style.cursor = ui.hover >= 0 && !isRoad(ui.hover) ? 'pointer' : 'default'; });
    cv.addEventListener('pointerleave', () => { ui.hover = -1; });
    cv.addEventListener('pointerdown', (e) => { AUDIO.unlock(); if (!APP.play || ended()) return; const [x, y] = toView(e), i = hitCell(x, y);
      if (i >= 0 && ui.armed && !APP.play.towers[i]) { tryBuild(i, ui.armed); return; }
      if (i >= 0 && isRoad(i)) { AUDIO.ui('deny'); select(-1); return; }
      if (i >= 0) { select(ui.sel === i ? -1 : i); AUDIO.ui('click'); } else { select(-1); } });
    addEventListener('pointerdown', () => AUDIO.unlock(), { once: true });
    $('#cards').addEventListener('click', (e) => { const c = e.target.closest('.card'); if (c) { AUDIO.ui('click'); cardAction(c.dataset.type); } });
    $('#cards').addEventListener('pointerover', (e) => { const c = e.target.closest('.card'); if (!c) return; showCardTip(c); if (ui.sel >= 0 && APP.play && !APP.play.towers[ui.sel]) ui.preview = c.dataset.type; });
    $('#cards').addEventListener('pointerout', (e) => { const c = e.target.closest('.card'); if (c && !c.contains(e.relatedTarget)) { hideTip(); ui.preview = null; } });
    $('#wavebtn').addEventListener('click', () => { AUDIO.unlock(); APP.cmd({ k: 'call' }); });
    $('#b-pause').addEventListener('click', () => togglePause());
    $('#b-speed').addEventListener('click', () => { APP.speed = APP.speed === 1 ? 2 : 1; });
    $('#b-menu').addEventListener('click', () => togglePause(true));
    $('#vol').addEventListener('input', (e) => { prefs.vol = +e.target.value; AUDIO.setVolume(prefs.vol); store.set(PREF_KEY, prefs); });
    $('#p-resume').addEventListener('click', () => togglePause(false));
    $('#p-restart').addEventListener('click', () => { store.del(SAVE_KEY); APP.newGame(); resetRun(); showOverlay('pause', false); });
    $('#p-menu').addEventListener('click', () => { showOverlay('pause', false); APP.toMenu(); showMenu(); });
    addEventListener('keydown', (e) => {
      if (e.repeat) return; const k = e.code;
      if (!APP.play) { if (k === 'Enter') { const c = $('#m-cont') || $('#m-new'); if (c) c.click(); } return; }
      if ($('#newenemy').classList.contains('show')) { if (k === 'Enter' || k === 'Space' || k === 'Escape') { closeNewEnemy(); e.preventDefault(); } return; }
      if (k === 'Escape') { if (ui.sel >= 0 || ui.armed) select(-1); else togglePause(); e.preventDefault(); return; }
      if (k === 'Space') { togglePause(); e.preventDefault(); return; }
      if (APP.paused || ended()) return;
      const dg = /^Digit([1-4])$/.exec(k) || /^Numpad([1-4])$/.exec(k); if (dg) { cardAction(C.TOWER_ORDER[+dg[1] - 1]); return; }
      const tk = { KeyQ: 'dmg', KeyW: 'range', KeyE: 'rate' }[k]; if (tk) { upgrade(tk); return; }
      if (k === 'KeyX' || k === 'Delete') sell(); else if (k === 'KeyF') APP.speed = APP.speed === 1 ? 2 : 1;
      else if (k === 'Enter' || k === 'KeyN') APP.cmd({ k: 'call' });
    });
  };

  // ---------------------------------------------------------------- тултипы
  // подписи веток и строки характеристик. Числа — итоговые из логики (SIM.towerStats / SIM.buildStats), здесь только формат
  const TRACK_NAME = { dmg: 'Урон', range: 'Дальность', rate: 'Скорость' }, TRACK_KEY = { dmg: 'Q', range: 'W', rate: 'E' };
  const trackName = (type, k) => (type === 'plague' && k === 'dmg' ? 'Яд' : TRACK_NAME[k]);
  const num = (v) => String(v >= 100 ? Math.round(v) : Math.round(v * 10) / 10);
  // [подпись, значение, ветка] — первые три строки по веткам C.TRACKS, дальше свои поля типа
  const statLines = (type, st) => {
    const L = [[trackName(type, 'dmg'), type === 'plague' ? `${num(st.dmg)}/с` : num(st.dmg), 'dmg'],
      ['Дальность', `${SIM.rangeTiles(st.range).toFixed(1)} кл.`, 'range'], ['Скорость', `${(1 / st.rate).toFixed(2)}/с`, 'rate']];
    if (st.slow !== undefined) L.push(['Замедление', `${Math.round(st.slow * 100)}% · ${st.slowTime} с`]);
    if (st.cloudR !== undefined) L.push(['Облако', `${SIM.rangeTiles(st.cloudR).toFixed(1)} кл. · ${st.cloudTime} с`]);
    if (st.heavy !== undefined) L.push(['По тяжёлым', `×${st.heavy}`]);
    return L; };
  // подсказка у точки (x, y — левый нижний угол), не выходит за слой интерфейса
  const tipAt = (html, x, y) => { const t = $('#tip'); t.innerHTML = html; t.classList.add('show');
    t.style.left = Math.max(10, Math.min(1590 - t.offsetWidth, x)) + 'px'; t.style.top = Math.max(58, Math.min(890 - t.offsetHeight, y - t.offsetHeight)) + 'px'; };
  const hideTip = () => $('#tip').classList.remove('show');
  const showCardTip = (c) => { const k = c.dataset.type, d = T[k], st = SIM.buildStats(APP.play, -1, k);
    tipAt(`<h4>${d.title}</h4><div>${d.desc}</div><div class="row" style="margin-top:6px">${statLines(k, st).map(([a, b]) => `${a}: <b>${b}</b>`).join(' · ')} · ${TIP_DESC[d.dmgType]}</div>`, c.offsetLeft + 10, 900 - 150); };

  // ---------------------------------------------------------------- панель
  // Панель встаёт рядом с выбранной клеткой там, где меньше всего закрывает: дорогу, саму клетку с башней и плашки интерфейса
  // (тот же подбор места, что у подсказок обучения). Клетки под панелью — не поле: клик по ним попадает в панель.
  // pressed — кнопка мыши зажата над панелью: перерисовка ждёт отпускания, иначе клик, попавший между нажатием и
  // отпусканием на перерисовку (во время волны души меняются с каждым убийством), теряется
  let panelKey = '', pressed = false;
  const placePanel = (S, p) => { const [x, y] = SIM.cellXY(S, ui.sel);
    const [l, t] = panelPlace(S, x, y, p.offsetWidth, p.offsetHeight, { target: [x - 44, y - 140, 88, 180], busy: '#stats, #seedbox, #wavebtn, #cards, #title' });
    p.style.left = l + 'px'; p.style.top = t + 'px'; };
  // подсказка перка или ветки — сбоку от панели, где хватает места
  const tipBeside = () => { const p = $('#panel'), right = p.offsetLeft + p.offsetWidth + 10;
    return [right + 300 <= 1590 ? right : p.offsetLeft - 310, p.offsetTop + p.offsetHeight]; };
  // Панель собрана из кусков, каждый — своя функция (тикеты правят свой кусок, не соседний):
  //   buildMenu(S, p)                    — свободная клетка: меню постройки (покрытие дороги, подсказка)
  //   towerHead(S, tw)                   — башня: картинка, имя, прокачка, итоговые характеристики
  //   towerGrowth(S, tw) / wireGrowth()  — башня: три ветки со ступенями и ценой следующей, выбор перка
  //   towerManage(S, tw) / wireManage()  — башня: управление (продажа)
  const closeBtn = '<button class="btn x">✕</button>';
  const buildMenu = (S, p) => {
    const cov = SIM.coverage(S, ui.sel, 3.4), q = cov > 520 ? 'узловая: бьёт по нескольким участкам дороги' : cov > 300 ? 'хорошее покрытие дороги' : cov > 0 ? 'короткий участок дороги' : 'дорога далеко';
    p.innerHTML = `${closeBtn}<div class="nm">Свободная клетка</div><div class="note" style="margin-top:6px">${q[0].toUpperCase() + q.slice(1)}.</div>
        <div class="note" style="margin-top:8px">Выберите башню на карточках слева внизу или клавишами 1–4.</div>`;
  };
  const towerPic = (tw) => { const lk = SIM.look(tw), n = [3, 2, 1].map((l) => 'tw_' + tw.type + '_' + l).find((x) => has(x) && +x.slice(-1) <= lk);
    return img(n || 'tw_' + tw.type + '_' + lk, `<div class="ph" style="width:${30 + 6 * lk}px;height:${44 + 12 * lk}px;background:${PH[tw.type]}"></div>`); };
  const towerHead = (S, tw) => {
    const d = T[tw.type], st = SIM.towerStats(S, tw);
    return `<div class="hd"><div class="pic">${towerPic(tw)}</div>
      <div><div class="nm">${d.short}</div><div class="lv">ПРОКАЧКА ${SIM.steps(tw)} / ${C.TRACKS.length * tw.cap}</div><div class="dt">${DMG_KIND[d.dmgType]}</div></div></div>
      <div class="st">${statLines(tw.type, st).map(([a, b]) => `<div><span>${a}</span><b>${b}</b></div>`).join('')}
      <div><span>Убито</span><b>${tw.kills}</b></div></div>`;
  };
  // почему ступень или перк недоступны — словами (подсказка при наведении и строка в панели)
  const trackWhy = (S, cu) => ({ max: 'Ветка прокачана до предела', souls: `Не хватает ${cu.cost - S.souls} душ`, ended: 'Забег окончен' }[cu.reason] || '');
  const perkWhy = (S, cp) => ({ steps: `Откроется после ${C.PERK_AT} ступеней: вложи ещё ${cp.need}`, chosen: 'Выбрано навсегда', taken: 'Выбран другой перк — выбор навсегда',
    souls: `Цена ${cp.cost} душ — не хватает ${cp.cost - S.souls}`, ended: 'Забег окончен' }[cp.reason] || `Цена: <b>${cp.cost}</b> душ · выбор навсегда`);
  const towerGrowth = (S, tw) => {
    const d = T[tw.type];
    const rows = C.TRACKS.map((k) => { const cu = SIM.canUpgrade(S, tw.cell, k), nx = statLines(tw.type, SIM.towerStats(S, tw, k)).find((l) => l[2] === k)[1];
      const pips = Array.from({ length: tw.cap }, (_, i) => `<i class="${i < tw.tracks[k] ? 'on' : ''}"></i>`).join('');
      const label = cu.reason === 'max' ? 'МАКСИМУМ' : `→ ${nx} · <span class="pr">${SOUL}${cu.cost}</span>`;
      return `<div class="tr ${k}"><span class="tn"><span class="key">${TRACK_KEY[k]}</span>${trackName(tw.type, k)}</span><span class="pips">${pips}</span>
        <button class="btn tb ${cu.ok ? 'green' : cu.reason === 'souls' ? 'poor' : 'off'}" data-t="${k}">${label}</button></div>`; }).join('');
    const perks = Object.keys(d.perks), cps = perks.map((pk) => SIM.canPerk(S, tw.cell, pk)), need = cps[0].need;
    const state = tw.perk ? '<span class="ok">выбран навсегда</span>' : need > 0 ? `<span class="why">после ${C.PERK_AT} ступеней · ещё ${need}</span>` : '<span class="ok">выбери один — навсегда</span>';
    return `<div class="tracks">${rows}</div><div class="ph">ПЕРК · ${state}</div>
      <div class="perks">${perks.map((pk, i) => { const pd = d.perks[pk], cp = cps[i], ch = cp.reason === 'chosen', lock = cp.reason === 'steps' || cp.reason === 'taken';
        return `<button class="btn perk ${ch ? 'chosen' : ''} ${lock ? 'locked' : ''} ${cp.reason === 'souls' ? 'poor' : ''}" data-p="${pk}"><span class="ic">${PERK_ICON[pk]}</span>${pd.name}${cp.ok || cp.reason === 'souls' ? `<span class="pr">${SOUL}${pd.cost}</span>` : ''}</button>`; }).join('')}</div>
      ${tw.perk ? `<div class="pdesc">${d.perks[tw.perk].desc}</div>` : ''}`;
  };
  const wireGrowth = (p, S, tw) => {
    const d = T[tw.type];
    p.querySelectorAll('.tb').forEach((b) => { const k = b.dataset.t;
      b.onclick = () => upgrade(k);
      b.onmouseenter = () => { const cu = SIM.canUpgrade(APP.play, tw.cell, k), why = trackWhy(APP.play, cu);
        tipAt(`<h4>${trackName(tw.type, k)} · ступень ${tw.tracks[k]} / ${tw.cap}</h4><div class="row">${why || `Следующая ступень: <b>${cu.cost}</b> душ · клавиша ${TRACK_KEY[k]}`}</div>`, ...tipBeside()); };
      b.onmouseleave = hideTip; });
    p.querySelectorAll('.perk').forEach((b) => {
      const pk = b.dataset.p, pd = d.perks[pk];
      b.onmouseenter = () => tipAt(`<h4>${pd.name}</h4><div>${pd.desc}</div><div class="row" style="margin-top:6px">${perkWhy(APP.play, SIM.canPerk(APP.play, tw.cell, pk))}</div>`, ...tipBeside());
      b.onmouseleave = hideTip;
      b.onclick = () => { if (SIM.canPerk(APP.play, ui.sel, pk).ok) { APP.cmd({ k: 'perk', cell: ui.sel, p: pk }); hideTip(); setTimeout(() => renderPanel(true), 30); } else AUDIO.ui('deny'); };
    });
  };
  const towerManage = (S, tw) => `<button class="btn red sell">Продать · +${SIM.sellValue(tw)}</button>`;
  const wireManage = (p, S, tw) => { p.querySelector('.sell').onclick = sell; };

  const renderPanel = (force) => {
    const S = APP.play, p = $('#panel');
    document.querySelectorAll('.card').forEach((c) => { const k = c.dataset.type, poor = S && S.souls < T[k].base.cost;
      c.classList.toggle('poor', !!poor); c.classList.toggle('armed', ui.armed === k); c.classList.toggle('target', !!(S && ui.sel >= 0 && !S.towers[ui.sel])); c.classList.toggle('can', !poor); });
    if (!S || ui.sel < 0) { p.classList.remove('show'); panelKey = ''; return; }
    const tw = S.towers[ui.sel], key = JSON.stringify([ui.sel, tw && [tw.type, tw.tracks, tw.cap, tw.perk, tw.invested, tw.kills], S.souls, S.phase]);
    if (!force && (key === panelKey || pressed)) return; panelKey = key;
    p.classList.add('show');
    if (!tw) buildMenu(S, p);
    else { p.innerHTML = closeBtn + towerHead(S, tw) + towerGrowth(S, tw) + towerManage(S, tw); wireGrowth(p, S, tw); wireManage(p, S, tw); }
    p.querySelector('.x').onclick = () => select(-1);
    placePanel(S, p);
  };

  // ---------------------------------------------------------------- тосты, новый враг, обучение
  const toast = (html, cls = '', ms = 2600) => { const t = h('div', 'frame toast ' + cls, html); $('#toasts').append(t);
    setTimeout(() => t.classList.add('out'), ms); setTimeout(() => t.remove(), ms + 600); };
  let neQueue = [];
  const showNewEnemy = (type) => { const d = EN[type], o = $('#newenemy');
    const tags = [d.armor ? `броня ${Math.round(d.armor * 100)}%` : '', d.mres ? `защита от магии ${Math.round(d.mres * 100)}%` : '', d.heal ? 'лечит' : '', d.boss ? 'босс' : '', `скорость ${d.speed}`].filter(Boolean).join(' · ');
    o.innerHTML = `<div class="frame box"><h2>Новый враг</h2><div class="pic" style="${has('en_' + type) ? '' : 'filter:sepia(1) saturate(2.2) brightness(1.1)'}">${img(has('en_' + type) ? 'en_' + type : 'en_knight', '')}</div><div style="font:700 28px var(--title)">${d.name}</div>
      <div class="tags">${tags}</div><p>${d.desc}</p><div class="col"><button class="btn green" id="ne-ok">К бою (Enter)</button></div></div>`;
    showOverlay('newenemy', true); APP.paused = true; $('#ne-ok').onclick = closeNewEnemy; };
  const closeNewEnemy = () => { showOverlay('newenemy', false); APP.paused = false; if (neQueue.length) showNewEnemy(neQueue.shift()); };
  // непрокачанная башня, которой хватает душ на ступень; башня, которой открыт выбор перка
  const raw = (S) => S.towers.find((t) => t && !SIM.steps(t) && C.TRACKS.some((k) => SIM.canUpgrade(S, t.cell, k).ok));
  const perkReady = (S) => S.towers.find((t) => t && !t.perk && SIM.canPerk(S, t.cell, Object.keys(T[t.type].perks)[0]).need === 0);
  const COACH = [
    { id: 'build', when: (S) => S.wave === 0 && !S.towers.some(Boolean), at: (S) => SIM.cellXY(S, bestCell(S)),
      text: 'Нажми на свободную клетку у дороги, затем выбери башню внизу слева. Клетки внутри петель бьют сразу по нескольким участкам дороги.' },
    { id: 'call', when: (S) => S.wave === 0 && S.towers.some(Boolean), at: () => { const b = $('#wavebtn'); return [b.offsetLeft + b.offsetWidth / 2, b.offsetTop + b.offsetHeight / 2]; },
      text: 'Когда оборона готова — призови первую волну. Дальше волны идут сами, но можно звать и раньше.' },
    { id: 'upgrade', when: (S) => S.wave >= 2 && S.phase === 'prep' && !!raw(S), at: (S) => SIM.cellXY(S, raw(S).cell),
      text: 'Нажми на башню и прокачай её ветки: урон, дальность, скорость. Прокачка часто выгоднее новой башни в стороне от дороги.' },
    { id: 'perk', when: (S) => !!perkReady(S), at: (S) => SIM.cellXY(S, perkReady(S).cell),
      text: `В башню вложено ${C.PERK_AT} ступеней — выбери один из трёх перков. Выбор навсегда, читай подсказки.` },
  ];
  // где поставить окно w×h рядом с точкой (x, y): перебираем места вокруг цели (сеткой до ~400 px) и берём то, что
  // не закрывает дорогу, интерфейс (o.busy) и саму цель (o.target), а из таких — ближайшее. У каждого окна свой подборщик
  // (placer()): результат кэшируется, пока не сменились цель и раскладка. Им ставятся подсказки обучения и панель клетки.
  const rectsOf = (sel) => [...document.querySelectorAll(sel)].filter((e) => e.offsetParent && getComputedStyle(e).visibility !== 'hidden').map((e) => [e.offsetLeft, e.offsetTop, e.offsetWidth, e.offsetHeight]);
  const overlap = (a, b) => Math.max(0, Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]));
  const placer = () => { let placed = { key: '', r: null };
    return (S, x, y, w, h, o = {}) => {
      const busy = rectsOf(o.busy || '#stats, #seedbox, #wavebtn, #cards, #panel.show, #title'), target = o.target || [x - 40, y - 40, 80, 80];
      const key = [S.seed, x, y, w, h, target, JSON.stringify(busy)].join('|');
      if (placed.key === key) return placed.r;
      const tile = C.GRID.tile, road = S.map.road.map((i) => [(i % S.map.cols) * tile, Math.floor(i / S.map.cols) * tile, tile, tile]);
      let best = null, bestCost = Infinity;
      for (let oy = -400; oy <= 400; oy += 24) for (let ox = -480; ox <= 480; ox += 24) {
        const r = [Math.max(10, Math.min(1590 - w, x + ox - w / 2)), Math.max(58, Math.min(890 - h, y + oy - h / 2)), w, h];
        let cost = 0; for (const q of road) cost += overlap(r, q); for (const q of busy) cost += 4 * overlap(r, q); cost += 8 * overlap(r, target);
        cost += 3 * Math.hypot(r[0] + w / 2 - x, r[1] + h / 2 - y);
        if (cost < bestCost) { bestCost = cost; best = r; } }
      placed = { key, r: best }; return best; };
  };
  const placeNear = placer(), panelPlace = placer();
  let best = { key: '', cell: -1 };                                 // лучшая клетка карты для подсказки (считается раз на карту)
  const bestCell = (S) => { const key = S.seed + ':' + S.map.road.length; if (best.key !== key) best = { key, cell: SIM.rankCells(S, 3.4)[0] }; return best.cell; };
  const coach = (S) => { const el = $('#coach'), c = COACH.find((q) => !prefs.tips[q.id] && q.when(S));
    for (const q of COACH) if (!prefs.tips[q.id] && done(q, S)) { prefs.tips[q.id] = 1; store.set(PREF_KEY, prefs); }
    if (!c || APP.paused) { el.classList.remove('show'); return; }
    if (el.textContent !== c.text) el.textContent = c.text;
    el.classList.add('show');
    const [x, y] = c.at(S), [l, t] = placeNear(S, x, y, el.offsetWidth, el.offsetHeight); el.style.left = l + 'px'; el.style.top = t + 'px'; };
  const done = (q, S) => (q.id === 'build' && S.towers.some(Boolean)) || (q.id === 'call' && S.wave > 0) || (q.id === 'upgrade' && S.towers.some((t) => t && SIM.steps(t) > 0)) || (q.id === 'perk' && S.towers.some((t) => t && t.perk));

  // ---------------------------------------------------------------- оверлеи
  const showOverlay = (id, on) => { if (on) hideTip(); $('#' + id).classList.toggle('show', !!on); if (id === 'menu') document.body.classList.toggle('inmenu', !!on); };
  const showMenu = () => { const m = $('#menu'); m.innerHTML = menuHTML(); showOverlay('menu', true);
    const c = $('#m-cont'); if (c) c.onclick = () => { const sv = saved(); if (sv && APP.load(sv.S)) { resetRun(); showOverlay('menu', false); } };
    $('#m-new').onclick = () => { store.del(SAVE_KEY); APP.newGame(); resetRun(); showOverlay('menu', false); AUDIO.ui('start'); };
    $('#m-help').onclick = () => $('#m-helptext').classList.toggle('show'); };
  const showEnd = (S) => { const won = S.phase === 'won', m = Math.floor(S.stats.time / 60), s = Math.floor(S.stats.time % 60);
    $('#end').innerHTML = `<div class="frame box"><h2 style="color:${won ? 'var(--soul)' : 'var(--bad)'}">${won ? 'Склеп устоял' : 'Склеп пал'}</h2>
      <p>${won ? 'Последний паладин рассыпался в прах. Некрополис спит спокойно.' : `Враги прорвались на ${S.wave}-й волне. Попробуй другое сочетание башен.`}</p>
      <div class="stats"><span>Сид</span><b>${S.seed}</b><span>Волна</span><b>${S.wave} / ${C.WAVES.length}</b><span>Прочность склепа</span><b>${S.hp} / ${C.CRYPT_HP}</b><span>Врагов повержено</span><b>${S.stats.kills}</b>
      <span>Собрано душ</span><b>${S.stats.earned}</b><span>Время</span><b>${m}:${String(s).padStart(2, '0')}</b></div>
      <div class="col"><button class="btn green" id="e-again">Играть снова</button><button class="btn" id="e-menu">В главное меню</button></div></div>`;
    showOverlay('end', true); store.del(SAVE_KEY);
    $('#e-again').onclick = () => { APP.newGame(); resetRun(); showOverlay('end', false); };
    $('#e-menu').onclick = () => { showOverlay('end', false); APP.toMenu(); showMenu(); }; };
  const resetRun = () => { ui.sel = -1; ui.armed = null; ui.preview = null; neQueue = []; seenEv.clear(); $('#toasts').innerHTML = ''; panelKey = ''; showOverlay('end', false); showOverlay('newenemy', false); };

  // ---------------------------------------------------------------- сейв
  const save = (S) => { if (S.phase === 'prep' && !S.demo) store.set(SAVE_KEY, { S, at: Date.now() }); };

  // ---------------------------------------------------------------- кадр
  let lastSouls = -1, lastHp = -1, wasEnded = false;
  UI.frame = (A, t) => {
    const S = A.play;
    $('#stats').style.visibility = S ? 'visible' : 'hidden'; $('#cards').style.visibility = S ? 'visible' : 'hidden'; $('#seedbox').style.visibility = S ? 'visible' : 'hidden';
    if (!S) { $('#wavebtn').classList.add('hidden'); $('#panel').classList.remove('show'); $('#coach').classList.remove('show'); return; }
    $('#s-wave').textContent = `ВОЛНА ${Math.max(1, S.wave)} / ${C.WAVES.length}`; $('#s-seed').textContent = S.seed;
    if (S.souls !== lastSouls) { $('#s-souls').textContent = S.souls; if (S.souls > lastSouls && lastSouls >= 0) { const b = $('#stats .souls'); b.classList.remove('gain'); void b.offsetWidth; b.classList.add('gain'); } lastSouls = S.souls; }
    if (S.hp !== lastHp) { $('#s-hp').textContent = S.hp; if (S.hp < lastHp) { const b = $('#stats .hp'); b.classList.remove('hurt'); void b.offsetWidth; b.classList.add('hurt'); } lastHp = S.hp; }
    $('#b-pause').classList.toggle('on', A.paused); $('#b-speed').textContent = A.speed === 2 ? '▶▶' : '▶'; $('#b-speed').classList.toggle('on', A.speed === 2);
    const wb = $('#wavebtn'), canCall = S.phase === 'prep' && S.wave < C.WAVES.length;
    wb.classList.toggle('hidden', !canCall);
    if (canCall) { const nx = S.wave + 1, boss = C.BOSSES[nx];
      $('#w-l1').textContent = S.wave === 0 ? 'Начать волну 1' : `Призвать волну ${nx}`;
      $('#w-l2').textContent = (boss ? 'БОСС · ' : '') + (S.prepT > 0 ? `сама через ${Math.ceil(S.prepT)} с · Enter` : 'Enter');
      wb.classList.toggle('pulse', S.wave === 0 && S.towers.some(Boolean)); }
    // события → звук, тосты, новые враги, сейв
    for (const e of S.ev) { const key = e.k + '|' + e.t.toFixed(4) + '|' + (e.x || 0).toFixed(1); if (seenEv.has(key)) continue; seenEv.add(key);
      AUDIO.event(e);
      if (e.k === 'wave') toast(`ВОЛНА ${e.wave}${e.boss ? '<small>Приближается босс</small>' : ''}`, 'big' + (e.boss ? ' boss' : ''), 2200);
      if (e.k === 'boss') toast(`☠ ${e.name} ☠<small>Пропуск стоит ${EN.paladin.leak} прочности склепа</small>`, 'boss', 3600);
      if (e.k === 'waveClear') { toast(`Волна ${e.wave} отбита<small>+${e.bonus} душ</small>`, '', 2400); save(S); }
      if (e.k === 'newEnemy' && e.type !== 'militia') { if ($('#newenemy').classList.contains('show')) neQueue.push(e.type); else showNewEnemy(e.type); }
      if ((e.k === 'build' || e.k === 'upgrade' || e.k === 'perk' || e.k === 'sell') && S.phase === 'prep') save(S);
    }
    if (seenEv.size > 3000) { seenEv.clear(); for (const e of S.ev) seenEv.add(e.k + '|' + e.t.toFixed(4) + '|' + (e.x || 0).toFixed(1)); }
    const isEnded = S.phase === 'won' || S.phase === 'lost';
    if (isEnded && !wasEnded) { select(-1); setTimeout(() => showEnd(APP.play), 900); }
    wasEnded = isEnded;
    renderPanel(false); coach(S);
  };

  UI.init = (A, canvas) => {
    APP = A; cv = canvas; build(); $('#vol').value = prefs.vol; AUDIO.setVolume(prefs.vol);
    if (!A.play) showMenu(); else if (A.paused) showOverlay('pause', true);
  };
})();
