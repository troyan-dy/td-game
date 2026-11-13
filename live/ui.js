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
  // картинка типа башни в DOM: спрайт основы вида (SIM.art: sprite, css-перекраска), без арта — заглушка цвета art.ui
  const typePic = (type, lk, ph) => { const A = SIM.art(type), n = [3, 2, 1].map((l) => 'tw_' + A.sprite + '_' + l).find((x) => has(x) && +x.slice(-1) <= lk);
    const html = img(n || 'tw_' + A.sprite + '_' + lk, `<div class="ph" style="${ph || ''}background:${A.ui}"></div>`);
    return A.css ? html.replace('<img ', `<img style="filter:${A.css}" `) : html; };
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
      <div class="frame box wave">⚔ <span id="s-wave">ВОЛНА 0 / 20</span></div><div class="frame box souls">${SOUL}<span id="s-souls">0</span></div>
      <div class="frame box hp"><span class="heart-ico">❤</span><span id="s-hp">20</span></div><button class="btn ibtn" id="b-menu" title="Настройки (Esc)">⚙</button>`;
    root.append(stats);
    const wb = h('button', 'btn green', '<div class="l1" id="w-l1">Призвать волну</div><div class="l2" id="w-l2">Enter</div>'); wb.id = 'wavebtn'; root.append(wb);
    const cards = h('div', 'frame', ''); cards.id = 'cards';
    C.TOWER_ORDER.forEach((k, i) => { const d = T[k], c = h('div', 'card', `<span class="key">${i + 1}</span><div class="pic">${typePic(k, 1)}</div><div class="nm">${d.name}</div><div class="pr">${SOUL} ${d.base.cost}</div>`);
      c.dataset.type = k; cards.append(c); });
    root.append(cards);
    const panel = h('div', 'frame', ''); panel.id = 'panel'; root.append(panel);
    panel.addEventListener('pointerdown', () => { pressed = true; });
    for (const evn of ['pointerup', 'pointercancel']) addEventListener(evn, () => { pressed = false; }, true);
    addEventListener('blur', () => { pressed = false; });
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
  const waveOf = (S) => Math.min(SIM.waveCount(), Math.max(1, S.phase === 'wave' ? S.wave : S.wave + 1));
  const menuHTML = () => { const sv = saved();
    return `<div class="box"><h1>НЕКРОПОЛИС</h1><div class="sub">Защити древний склеп от рыцарей, священников и осадных машин</div>
      <div class="col">${sv ? `<button class="btn green two" id="m-cont"><span class="l1">Продолжить</span><span class="l2">волна ${waveOf(sv.S)} · сид ${sv.S.seed}</span></button>` : ''}
      <button class="btn ${sv ? '' : 'green'}" id="m-new" title="Новая карта по случайному сиду">Новая игра</button>
      <div class="seedrow"><input id="m-seed" type="text" inputmode="numeric" maxlength="40" autocomplete="off" spellcheck="false" placeholder="сид карты" aria-label="Сид карты"><button class="btn" id="m-seedgo" disabled>По сиду</button></div>
      <div class="seednote" id="m-seednote"></div>
      <button class="btn" id="m-help">Как играть</button></div>
      <div class="frame help" id="m-helptext"><b>Цель:</b> переживи ${SIM.waveCount()} волн. Каждый прорвавшийся враг отнимает прочность склепа, босс — 10.<br>
      <b>Строительство:</b> нажми на свободную клетку у дороги, затем на карточку башни внизу слева (или клавиши 1–4). Можно и наоборот: выбери башню и нажми на клетку.<br>
      <b>Карта</b> каждый забег новая, её задаёт сид: он виден слева вверху и на экране итогов. Введи его в поле «сид карты» — сыграешь ту же карту.<br>
      <b>Души</b> дают за каждого врага и за зачищенную волну. Трать их на новые башни и улучшения.<br>
      <b>Прокачка:</b> нажми на башню и качай её ветки — урон (Q), дальность (W), скорость (E), по ${C.TRACK_MAX} ступеней. Когда в башню вложено ${C.PERK_AT} ступеней, выбери один из трёх перков.<br>
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
  // дорога и препятствие: строить нельзя, панели нет
  const isRoad = (cell) => ['road', 'obstacle'].includes(SIM.canBuild(APP.play, cell, 'bones').reason);
  const select = (i) => { ui.sel = i; ui.preview = null; ui.armed = null; ui.move = -1; renderPanel(true); };
  const tryBuild = (cell, type) => { const S = APP.play; if (!S) return false; const cb = SIM.canBuild(S, cell, type);
    if (!cb.ok) { if (cb.reason === 'souls') flashPoor(type); AUDIO.ui('deny'); return false; }
    APP.cmd({ k: 'build', cell, type }); ui.last = type; ui.armed = null; ui.preview = null; ui.sel = cell; setTimeout(() => renderPanel(true), 30); return true; };
  const flashPoor = (type) => { const c = $(`.card[data-type="${type}"]`); if (c) { c.animate([{ transform: 'translateX(-5px)' }, { transform: 'translateX(5px)' }, { transform: 'none' }], { duration: 220 }); }
    const s = $('#stats .souls'); s.classList.remove('gain'); void s.offsetWidth; s.animate([{ filter: 'brightness(1)' }, { filter: 'brightness(2) hue-rotate(140deg)' }, { filter: 'brightness(1)' }], { duration: 300 }); };
  const cardAction = (type) => { const S = APP.play; if (!S || ended()) return;
    if (ui.sel >= 0 && !S.towers[ui.sel]) { tryBuild(ui.sel, type); return; }
    ui.armed = ui.armed === type ? null : type; ui.sel = -1; ui.move = -1; renderPanel(true); };
  const upgrade = (track) => { const S = APP.play, tw = S && ui.sel >= 0 ? S.towers[ui.sel] : null; if (!tw) return;
    const cu = SIM.canUpgrade(S, ui.sel, track);
    if (cu.ok) APP.cmd({ k: 'upgrade', cell: ui.sel, track }); else { AUDIO.ui('deny'); if (cu.reason === 'souls') flashPoor(); } setTimeout(() => renderPanel(true), 30); };
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
      const tk = { KeyQ: 'dmg', KeyW: 'range', KeyE: 'rate' }[k]; if (tk) { upgrade(tk); return; }
      if (k === 'KeyX' || k === 'Delete') sell(); else if (k === 'KeyM') { if (ui.move >= 0) cancelMove(); else startMove(); } else if (k === 'KeyF') APP.speed = APP.speed === 1 ? 2 : 1;
      else if (k === 'Enter' || k === 'KeyN') APP.cmd({ k: 'call' });
    });
  };

  // ---------------------------------------------------------------- тултипы
  // Подписи веток и строки характеристик — из конфига типа (names, units, show), числа — итоговые из логики
  // (SIM.towerStats / SIM.buildStats); здесь только формат. Новый тип башни новых строк кода здесь не требует.
  const TRACK_KEY = { dmg: 'Q', range: 'W', rate: 'E' };
  const trackName = (type, k) => (T[type].names && T[type].names[k]) || C.TRACK_NAMES[k];
  const num = (v) => String(v >= 100 ? Math.round(v) : Math.round(v * 10) / 10);
  const trackValue = (type, k, st) => SIM.trackText(type, k, st);      // формат — fmt типа или C.TRACK_FMT
  // [подпись, значение] — сначала ветки C.TRACKS, затем строки show типа
  const statLines = (type, st) => C.TRACKS.map((k) => [trackName(type, k), trackValue(type, k, st)])
    .concat((T[type].show || []).map(([label, tpl]) => [label, SIM.fill(tpl, st, T[type].extra || {})]));
  // подсказка у точки (x, y — левый нижний угол), не выходит за слой интерфейса
  const tipAt = (html, x, y) => { const t = $('#tip'); t.innerHTML = html; t.classList.add('show');
    t.style.left = Math.max(10, Math.min(1590 - t.offsetWidth, x)) + 'px'; t.style.top = Math.max(58, Math.min(890 - t.offsetHeight, y - t.offsetHeight)) + 'px'; };
  const hideTip = () => $('#tip').classList.remove('show');
  const showCardTip = (c) => { const k = c.dataset.type, d = T[k], st = SIM.buildStats(APP.play, -1, k);
    tipAt(`<h4>${d.title}</h4><div>${d.desc}</div><div class="row" style="margin-top:6px">${statLines(k, st).map(([a, b]) => `${a}: <b>${b}</b>`).join(' · ')} · ${TIP_DESC[d.dmgType] || ''}</div>`, c.offsetLeft + 10, 900 - 150); };

  // ---------------------------------------------------------------- панель
  // Панель собрана из кусков, каждый — своя функция (тикеты правят свой кусок, не соседний):
  //   buildMenu(S, p)                    — свободная клетка: меню постройки (покрытие дороги, подсказка)
  //   towerHead(S, tw)                   — башня: картинка, имя, прокачка, итоговые характеристики в две колонки
  //   towerGrowth(S, tw) / wireGrowth()  — башня: три ветки со ступенями и ценой следующей, выбор перка (описание — в подсказке)
  //   towerManage(S, tw) / wireManage()  — башня: управление (перенос, продажа); в режиме переноса панель — узкая плашка с отменой
  // Перерисовка: целиком — только при смене устройства панели (другая клетка, ступень, перк, режим, конец забега);
  // души, «не хватает», доступность переноса и счётчик убийств обновляются на месте (refreshPanel), кнопки не пересоздаются.
  // pressed — кнопка мыши зажата над панелью: и полная перерисовка ждёт отпускания (или отмены нажатия, или потери фокуса).
  let panelKey = '', pressed = false;
  // подсказка перка или ветки — сбоку от панели, где хватает места
  const tipBeside = () => { const p = $('#panel'), right = p.offsetLeft + p.offsetWidth + 10;
    return [right + 300 <= 1590 ? right : p.offsetLeft - 310, p.offsetTop + p.offsetHeight]; };
  const closeBtn = '<button class="btn x">✕</button>';
  // меню свободной клетки: особая клетка (вид и бонус), покрытие дороги, итоговые цены башен на этой клетке (с наценкой)
  const buildMenu = (S, p) => {
    const b = SIM.cellBonus(S, ui.sel), cov = SIM.spotCoverage(S, ui.sel), q = cov > 520 ? 'узловая: бьёт по нескольким участкам дороги' : cov > 300 ? 'хорошее покрытие дороги' : cov > 0 ? 'короткий участок дороги' : 'дорога далеко';
    const prices = C.TOWER_ORDER.map((k) => { const cb = SIM.canBuild(S, ui.sel, k);
      return `<div><span>${T[k].name}</span><span>${cb.cost !== cb.base ? `<s class="was">${cb.base}</s>` : ''}<b class="${S.souls < cb.cost ? 'poor' : ''} ${cb.cost !== cb.base ? 'up' : ''}">${cb.cost}</b></span></div>`; }).join('');
    p.innerHTML = `${closeBtn}<div class="nm">${b ? b.name : 'Свободная клетка'}</div>
        ${b ? `<div class="bonus ${b.kind}">${b.desc}</div>` : ''}
        <div class="note" style="margin-top:6px">${q[0].toUpperCase() + q.slice(1)}.</div>
        <div class="st prices">${prices}</div>
        <div class="note" style="margin-top:6px">Выберите башню на карточках слева внизу или клавишами 1–4.</div>`;
  };
  const towerPic = (tw) => { const lk = SIM.look(tw); return typePic(tw.type, lk, `width:${22 + 5 * lk}px;height:${30 + 8 * lk}px;`); };
  const towerHead = (S, tw) => {
    const d = T[tw.type], st = SIM.towerStats(S, tw);
    return `<div class="hd"><div class="pic">${towerPic(tw)}</div>
      <div><div class="nm">${d.short}</div><div class="lv">ПРОКАЧКА ${SIM.steps(tw)} / ${C.TRACKS.length * tw.cap} · <span class="dt">${DMG_KIND[d.dmgType] || ''}</span></div></div></div>
      <div class="st">${statLines(tw.type, st).map(([a, b]) => `<div><span>${a}</span><b>${b}</b></div>`).join('')}
      <div><span>Убито</span><b data-v="kills">${tw.kills}</b></div></div>`;
  };
  // почему ступень или перк недоступны — словами (подсказка при наведении); пустая строка — доступно
  const trackWhy = (S, cu) => ({ max: 'Ветка прокачана до предела этой башни', price: 'Следующая ступень этой ветки пока недоступна', souls: `Не хватает ${cu.cost - S.souls} душ`, ended: 'Забег окончен' }[cu.reason] || '');
  const perkWhy = (S, cp) => ({ steps: `Откроется после ${C.PERK_AT} ступеней: вложи ещё ${cp.need}`, chosen: 'Выбрано навсегда', taken: 'Выбран другой перк — выбор навсегда',
    souls: `Цена ${cp.cost} душ — не хватает ${cp.cost - S.souls}`, ended: 'Забег окончен' }[cp.reason] || `Цена: <b>${cp.cost}</b> душ · выбор навсегда`);
  const trackCls = (cu) => (cu.ok ? 'green' : cu.reason === 'souls' ? 'poor' : 'off');
  const towerGrowth = (S, tw) => {
    const d = T[tw.type];
    const rows = C.TRACKS.map((k) => { const cu = SIM.canUpgrade(S, tw.cell, k), nx = trackValue(tw.type, k, SIM.towerStats(S, tw, k));
      const pips = Array.from({ length: tw.cap }, (_, i) => `<i class="${i < tw.tracks[k] ? 'on' : ''}"></i>`).join('');
      const label = cu.reason === 'max' ? 'МАКСИМУМ' : cu.reason === 'price' ? 'НЕДОСТУПНО' : `→ ${nx} · <span class="pr">${SOUL}${cu.cost}</span>`;
      return `<div class="tr ${k}"><span class="tn"><span class="key">${TRACK_KEY[k]}</span>${trackName(tw.type, k)}</span><span class="pips c${tw.cap}">${pips}</span>
        <button class="btn tb ${trackCls(cu)}" data-t="${k}">${label}</button></div>`; }).join('');
    const perks = Object.keys(d.perks), cps = perks.map((pk) => SIM.canPerk(S, tw.cell, pk)), need = cps.length ? cps[0].need : 0, free = SIM.freeSlots(tw);
    const state = !free ? '<span class="ok">выбран навсегда</span>' : need > 0 ? `<span class="why">после ${C.PERK_AT} ступеней · ещё ${need}</span>` : '<span class="ok">выбери — навсегда</span>';
    return `<div class="tracks">${rows}</div>${perks.length ? `<div class="ph">ПЕРК · ${state}</div>
      <div class="perks">${perks.map((pk, i) => { const pd = d.perks[pk], cp = cps[i], ch = cp.reason === 'chosen', lock = cp.reason === 'steps' || cp.reason === 'taken';
        return `<button class="btn perk ${ch ? 'chosen' : ''} ${lock ? 'locked' : ''} ${cp.reason === 'souls' ? 'poor' : ''}" data-p="${pk}"><span class="pn">${pd.name}</span><span class="pf"><span class="ic">${PERK_ICON[pk] || '✦'}</span>${ch || cp.reason === 'taken' ? '' : `<span class="pr">${SOUL}${pd.cost}</span>`}</span></button>`; }).join('')}</div>` : ''}`;
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
      b.onmouseenter = () => tipAt(`<h4>${pd.name}</h4><div>${SIM.perkText(pk)}</div><div class="row" style="margin-top:6px">${perkWhy(APP.play, SIM.canPerk(APP.play, tw.cell, pk))}</div>`, ...tipBeside());
      b.onmouseleave = hideTip;
      b.onclick = () => { if (SIM.canPerk(APP.play, ui.sel, pk).ok) { APP.cmd({ k: 'perk', cell: ui.sel, p: pk }); hideTip(); setTimeout(() => renderPanel(true), 30); } else AUDIO.ui('deny'); };
    });
  };
  const towerManage = (S, tw) => {
    if (ui.move === ui.sel) return `<div class="note mv">Куда перенести? Нажми на подсвеченную клетку. Esc или правый клик — отмена.</div>
      <button class="btn mvx">Отменить перенос</button>`;
    const cm = SIM.canMove(S, ui.sel);
    return `<div class="mg"><button class="btn move ${cm.ok ? '' : 'off'}">Перенести</button>
      <button class="btn red sell">Продать · +${SIM.sellValue(tw)}</button></div>`;
  };
  const wireManage = (p, S, tw) => {
    const mv = p.querySelector('.move'), mx = p.querySelector('.mvx'), sl = p.querySelector('.sell');
    if (mv) { mv.onclick = startMove;
      mv.onmouseenter = () => tipAt(`<h4>Перенос</h4><div>${SIM.canMove(APP.play, ui.sel).ok ? 'Бесплатно и мгновенно, вся прокачка и перк остаются. Бонус особой клетки — от новой клетки.' : 'Во время волны башни не переносятся. Дождись конца волны.'}</div><div class="row" style="margin-top:6px">Клавиша <b>M</b></div>`, ...tipBeside());
      mv.onmouseleave = hideTip; }
    if (mx) mx.onclick = cancelMove;
    if (sl) sl.onclick = sell;
  };
  // то, что меняется без смены устройства панели: доступность по душам и фазе, счётчик убийств
  const refreshPanel = (p, S, tw) => {
    p.querySelectorAll('.tb').forEach((b) => { const c = trackCls(SIM.canUpgrade(S, tw.cell, b.dataset.t)); for (const k of ['green', 'poor', 'off']) b.classList.toggle(k, k === c); });
    p.querySelectorAll('.perk').forEach((b) => b.classList.toggle('poor', SIM.canPerk(S, tw.cell, b.dataset.p).reason === 'souls'));
    const kills = p.querySelector('[data-v="kills"]'); if (kills && kills.textContent !== String(tw.kills)) kills.textContent = tw.kills;
    const mv = p.querySelector('.move'); if (mv) mv.classList.toggle('off', !SIM.canMove(S, tw.cell).ok);
  };

  // Место окна у точки — общее для панели и подсказок обучения. Перебор позиций по всему полю шагом 16 px.
  //  Нельзя никогда: o.keep (у панели — своя клетка с соседями, в режиме переноса — две клетки вокруг), o.avoid (у подсказки —
  //  открытая панель), плашки интерфейса (кнопка вызова волны — и тогда, когда её сейчас нет: она вернётся после волны),
  //  вход и склеп с соседними клетками, край экрана.
  //  Из допустимых — меньше всего o.soft (дорога; в режиме переноса — клетки-цели; одна клетка стоит ~400 px расстояния),
  //  затем меньше чужих башен, затем ближе к точке; o.maxDist — мягкий предел расстояния (если задан). Жёсткого предела
  //  расстояния нет: в углах поля он выталкивает панель на дорогу (сид 77, правый нижний угол: в 600 px — 5 клеток дороги).
  //  Результат кэшируется в o.cache, пока не сменились входные данные.
  const PLATES = '#stats, #seedbox, #cards, #title';
  let WAVEBTN = [14, 150, 196, 64];                                   // кнопка вызова волны: последнее место, где она была видна
  const rectsOf = (sel) => [...document.querySelectorAll(sel)].filter((e) => e.offsetParent && getComputedStyle(e).visibility !== 'hidden').map((e) => [e.offsetLeft, e.offsetTop, e.offsetWidth, e.offsetHeight]);
  const overlap = (a, b) => Math.max(0, Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]));
  const cellRect = (S, i, n = 0) => { const T = C.GRID.tile, x = (i % S.map.cols) * T, y = Math.floor(i / S.map.cols) * T; return [x - n * T, y - n * T, (2 * n + 1) * T, (2 * n + 1) * T]; };
  const spotNear = (S, o) => {
    const wb = $('#wavebtn'); if (wb && wb.offsetParent) WAVEBTN = [wb.offsetLeft, wb.offsetTop, wb.offsetWidth, wb.offsetHeight];
    const plates = rectsOf(PLATES).concat([WAVEBTN]), soft = o.soft || [], road = S.map.road;
    const key = [S.seed, o.x, o.y, o.w, o.h, o.keep, JSON.stringify(o.avoid || []), soft.length, o.maxDist, S.towers.map((t) => (t ? 1 : 0)).join(''), JSON.stringify(plates)].join('|');
    if (o.cache.key === key) return o.cache.r;
    const hard = [o.keep, around(S, road[0]), around(S, road[road.length - 1])].concat(o.avoid || [], plates.map(([x, y, w, h]) => [x - 6, y - 6, w + 12, h + 12]));
    const towers = S.towers.map((t, i) => (t ? cellRect(S, i) : null)).filter(Boolean);
    let best = null, bestCost = Infinity;
    for (let y = 58; y <= 892 - o.h; y += 16) for (let x = 8; x <= 1592 - o.w; x += 16) {
      const r = [x, y, o.w, o.h];
      if (hard.some((q) => overlap(r, q) > 0)) continue;
      const dist = Math.hypot(Math.max(x - o.x, 0, o.x - x - o.w), Math.max(y - o.y, 0, o.y - y - o.h));
      let cost = (o.maxDist && dist > o.maxDist ? 100 * (dist - o.maxDist) : 0) + 100 * dist;
      for (const q of soft) cost += 10 * overlap(r, q);
      for (const q of towers) cost += 2 * overlap(r, q);
      if (cost < bestCost) { bestCost = cost; best = r; } }
    o.cache.key = key; o.cache.r = best || [8, 58, o.w, o.h]; return o.cache.r;
  };
  const around = (S, i) => cellRect(S, i, 1);
  const PANEL_MAX = 0, COACH_MAX = 400;                                // мягкий предел расстояния (0 — нет); см. spotNear
  const panelCache = {}, coachCache = {};
  const placePanel = (S, p) => { const moving = ui.move === ui.sel, [x, y] = SIM.cellXY(S, ui.sel);
    const [l, t] = spotNear(S, { x, y, w: p.offsetWidth, h: p.offsetHeight, keep: cellRect(S, ui.sel, moving ? 2 : 1), maxDist: PANEL_MAX, cache: panelCache,
      soft: (moving ? SIM.moveCells(S, ui.sel) : S.map.road).map((i) => cellRect(S, i)) });
    p.style.left = l + 'px'; p.style.top = t + 'px'; };

  const renderPanel = (force) => {
    const S = APP.play, p = $('#panel');
    // цена на карточках — для клетки, куда пойдёт постройка: выбранной свободной, а с выбранной карточкой — под курсором
    const free = (i) => S && i >= 0 && !S.towers[i] && !isRoad(i), spot = free(ui.sel) ? ui.sel : ui.armed && free(ui.hover) ? ui.hover : -1;
    document.querySelectorAll('.card').forEach((c) => { const k = c.dataset.type, cb = S ? SIM.canBuild(S, spot >= 0 ? spot : -1, k) : null, cost = cb ? cb.cost : T[k].base.cost, poor = S && S.souls < cost;
      const pr = c.querySelector('.pr'), txt = `${SOUL} ${cost}`; if (pr.innerHTML !== txt) pr.innerHTML = txt; pr.classList.toggle('up', !!cb && cb.cost !== cb.base);
      c.classList.toggle('poor', !!poor); c.classList.toggle('armed', ui.armed === k); c.classList.toggle('target', !!(S && ui.sel >= 0 && !S.towers[ui.sel])); c.classList.toggle('can', !poor); });
    if (!S || ui.sel < 0) { if (panelKey) hideTip(); p.classList.remove('show'); panelKey = ''; return; }
    const tw = S.towers[ui.sel], moving = ui.move === ui.sel;
    // в ключе и сами итоговые характеристики: они меняются и извне (алтарь рядом, Гримуар, клетка) — панель покажет новые
    const key = JSON.stringify([ui.sel, tw && [tw.id, tw.type, tw.tracks, tw.cap, SIM.perksOf(tw), SIM.freeSlots(tw), tw.invested, SIM.towerStats(S, tw)], moving, ended()]);
    if (key === panelKey || (pressed && !force)) { if (tw && !moving) refreshPanel(p, S, tw); return; }
    panelKey = key; hideTip();                                         // подсказка висела над кнопкой, которой больше нет
    p.classList.add('show'); p.classList.toggle('moving', moving);
    if (!tw) buildMenu(S, p);
    else if (moving) { p.innerHTML = towerManage(S, tw); wireManage(p, S, tw); }
    else { p.innerHTML = closeBtn + towerHead(S, tw) + towerGrowth(S, tw) + towerManage(S, tw); wireGrowth(p, S, tw); wireManage(p, S, tw); }
    const x = p.querySelector('.x'); if (x) x.onclick = () => select(-1);
    placePanel(S, p);
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
  // непрокачанная башня, которой хватает душ на ступень; башня, которой открыт выбор перка
  const raw = (S) => S.towers.find((t) => t && !SIM.steps(t) && C.TRACKS.some((k) => SIM.canUpgrade(S, t.cell, k).ok));
  const perkReady = (S) => S.towers.find((t) => t && SIM.freeSlots(t) && Object.keys(T[t.type].perks).length && SIM.canPerk(S, t.cell, Object.keys(T[t.type].perks)[0]).need === 0);
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
  // подсказка обучения — тем же размещением, что и панель: не закрывает цель, панель, разведку, плашки, вход и склеп, мимо дороги
  const placeNear = (S, x, y, w, h) => {
    const avoid = rectsOf('#panel.show, #scout.show, #scout-panel.show').map(([l, t, pw, ph]) => [l - 6, t - 6, pw + 12, ph + 12]);
    return spotNear(S, { x, y, w, h, keep: [x - 40, y - 40, 80, 80], avoid, maxDist: COACH_MAX, cache: coachCache, soft: S.map.road.map((i) => cellRect(S, i)) }); };
  let best = { key: '', cell: -1 };                                 // лучшая клетка карты для подсказки (считается раз на карту)
  const bestCell = (S) => { const key = S.seed + ':' + S.map.road.length; if (best.key !== key) best = { key, cell: SIM.rankCells(S, C.TYPICAL_RANGE)[0] }; return best.cell; };
  const coach = (S) => { const el = $('#coach'), c = COACH.find((q) => !prefs.tips[q.id] && q.when(S));
    for (const q of COACH) if (!prefs.tips[q.id] && done(q, S)) { prefs.tips[q.id] = 1; store.set(PREF_KEY, prefs); }
    if (!c || APP.paused) { el.classList.remove('show'); return; }
    if (el.textContent !== c.text) el.textContent = c.text;
    el.classList.add('show');
    const [x, y] = c.at(S), [l, t] = placeNear(S, x, y, el.offsetWidth, el.offsetHeight); el.style.left = l + 'px'; el.style.top = t + 'px'; };
  const done = (q, S) => (q.id === 'build' && S.towers.some(Boolean)) || (q.id === 'call' && S.wave > 0) || (q.id === 'upgrade' && S.towers.some((t) => t && SIM.steps(t) > 0)) || (q.id === 'perk' && S.towers.some((t) => t && SIM.perksOf(t).length));

  // ---------------------------------------------------------------- оверлеи
  const showOverlay = (id, on) => { if (on) hideTip(); $('#' + id).classList.toggle('show', !!on); if (id === 'menu') document.body.classList.toggle('inmenu', !!on); };
  // меню перерисовывается и когда сейв поменяла другая вкладка (onStorage): введённый сид и фокус поля сохраняются
  const showMenu = () => { const m = $('#menu'), old = $('#m-seed'), typed = old ? old.value : '', focused = !!old && document.activeElement === old;
    m.innerHTML = menuHTML(); showOverlay('menu', true);
    if (typed) $('#m-seed').value = typed; if (focused) $('#m-seed').focus();
    // сейв уже проверен в saved() — APP.load не повторяет проверку; вкладка сразу записывает забег своей меткой
    const c = $('#m-cont'); if (c) c.onclick = () => { const sv = saved(); if (sv && APP.load(sv.S, true)) { resetRun(); showOverlay('menu', false); AUDIO.ui('start'); persist(); } else showMenu(); };
    const start = (seed) => { APP.newGame(seed); resetRun(); showOverlay('menu', false); AUDIO.ui('start'); persist(); };
    $('#m-new').onclick = () => start();
    const inp = $('#m-seed'); inp.oninput = seedInput; seedInput();
    $('#m-seedgo').onclick = () => { const r = seedInput(); if (r.ok) { inp.blur(); start(r.seed); } else AUDIO.ui('deny'); };
    // клавиши поля не доходят до игровых: Enter здесь — только «По сиду», а не «призвать волну» в только что начатом забеге
    inp.onkeydown = (e) => { e.stopPropagation(); if (e.code === 'Enter' || e.code === 'NumpadEnter') { e.preventDefault(); $('#m-seedgo').click(); } else if (e.code === 'Escape') inp.blur(); };
    $('#m-help').onclick = () => $('#m-helptext').classList.toggle('show'); };
  const showEnd = (S) => { const won = S.phase === 'won', m = Math.floor(S.stats.time / 60), s = Math.floor(S.stats.time % 60);
    $('#end').innerHTML = `<div class="frame box"><h2 style="color:${won ? 'var(--soul)' : 'var(--bad)'}">${won ? 'Склеп устоял' : 'Склеп пал'}</h2>
      <p>${won ? 'Последний паладин рассыпался в прах. Некрополис спит спокойно.' : `Враги прорвались на ${S.wave}-й волне. Попробуй другое сочетание башен.`}</p>
      <div class="stats"><span>Сид</span><b>${S.seed}</b><span>Волна</span><b>${S.wave} / ${SIM.waveCount()}</b><span>Прочность склепа</span><b>${S.hp} / ${C.CRYPT_HP}</b><span>Врагов повержено</span><b>${S.stats.kills}</b>
      <span>Собрано душ</span><b>${S.stats.earned}</b><span>Время</span><b>${m}:${String(s).padStart(2, '0')}</b></div>
      <div class="col"><button class="btn green" id="e-again">Играть снова</button><button class="btn" id="e-menu">В главное меню</button></div></div>`;
    showOverlay('end', true);
    $('#e-again').onclick = () => { APP.newGame(); resetRun(); showOverlay('end', false); };
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
    $('#s-wave').textContent = `ВОЛНА ${Math.max(1, S.wave)} / ${SIM.waveCount()}`; $('#s-seed').textContent = S.seed;
    if (S.souls !== lastSouls) { $('#s-souls').textContent = S.souls; if (S.souls > lastSouls && lastSouls >= 0) { const b = $('#stats .souls'); b.classList.remove('gain'); void b.offsetWidth; b.classList.add('gain'); } lastSouls = S.souls; }
    if (S.hp !== lastHp) { $('#s-hp').textContent = S.hp; if (S.hp < lastHp) { const b = $('#stats .hp'); b.classList.remove('hurt'); void b.offsetWidth; b.classList.add('hurt'); } lastHp = S.hp; }
    $('#b-pause').classList.toggle('on', A.paused); $('#b-speed').textContent = A.speed === 2 ? '▶▶' : '▶'; $('#b-speed').classList.toggle('on', A.speed === 2);
    const wb = $('#wavebtn'), canCall = S.phase === 'prep' && S.wave < SIM.waveCount();
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
