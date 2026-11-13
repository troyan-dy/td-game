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
  // Профиль открытий и рекордов (live/meta.js) — свой ключ. Испорченный или чужой версии читается как новый профиль
  // (META.load), меню от него не падает. Пишется после каждого итога забега и по «Открыть всё».
  const PROFILE_KEY = 'necropolis.profile';
  let profileFailed = false;
  const profile = () => META.load(store.get(PROFILE_KEY));
  const saveProfile = (p) => { try { localStorage.setItem(PROFILE_KEY, JSON.stringify(p)); }
    catch (e) { if (!profileFailed) { profileFailed = true; toast('Открытия не сохраняются<small>Хранилище браузера недоступно или переполнено</small>', '', 5000); } } };
  // закрыт ли тип башни в этом забеге (список открытого забег получил при создании) и чем он открывается
  const locked = (S, type) => !!(S && S.unlocked && !S.unlocked.includes(type));
  const howOpen = (id) => { const it = META.view(profile()).items.find((x) => x.id === id);
    return it && it.ach ? `${it.ach.name}: ${it.ach.desc.toLowerCase()}` : 'Кнопка «Открыть всё» на экране «Открытия»'; };
  const dropOldSaves = () => { try { for (const k of Object.keys(localStorage)) if (k.startsWith(SAVE_KEY + '.')) localStorage.removeItem(k); } catch (e) {} };
  const has = (n) => !!(window.ASSETS && window.ASSETS[n]);
  const img = (n, fb) => has(n) ? `<img src="assets/${n}.png" alt="">` : (fb || '');
  const SOUL = '<span class="soul-ico"></span>';
  // картинка типа башни в DOM: спрайт основы вида (SIM.art: sprite, css-перекраска), без арта — заглушка цвета art.ui
  // A — вид (SIM.art типа или SIM.towerArt стоящей башни: у гибрида — спрайт первой в цвете второй)
  const artPic = (A, lk, ph) => { const n = [3, 2, 1].map((l) => 'tw_' + A.sprite + '_' + l).find((x) => has(x) && +x.slice(-1) <= lk);
    const html = img(n || 'tw_' + A.sprite + '_' + lk, `<div class="ph" style="${ph || ''}background:${A.hybrid ? A.mixUi : A.ui}"></div>`);
    return A.css ? html.replace('<img ', `<img style="filter:${A.css}" `) : html; };
  const typePic = (type, lk, ph) => artPic(SIM.art(type), lk, ph);
  const TIP_DESC = { phys: 'физический', magic: 'магический', poison: 'яд', aura: 'аура соседям' };
  const DMG_KIND = { phys: 'физический урон', magic: 'магический урон', poison: 'урон ядом', aura: 'аура соседям' };
  const PERK_ICON = { pierce: '➶', volley: '⋔', frost: '❄', pack: '👻', pestilence: '☣', acid: '⚗', harvest: '☠', curse: '✶', crush: '⚒', chill: '☾', miasma: '♨', split: '⟡', toll: '🔔', knell: '✝', drone: '〰', offering: '♥', frenzy: '↯', circle: '◎',
    legion: '⚔', grip: '✊', burst: '✸' };
  const UI = (window.UI = {});
  const SPEEDS = [1, 2, 4];                                           // скорости игры: кнопки в верхней полосе и клавиша F
  let APP, cv, prefs = Object.assign({ vol: 0.7, tips: {} }, store.get(PREF_KEY) || {});
  const seenEv = new Set();
  const ui = SCENE.ui;

  // ---------------------------------------------------------------- разметка
  const build = () => {
    const root = $('#ui'); root.innerHTML = '';
    // заголовок; в паузе на его месте — метка «Пауза» (видна над полем, ничего не закрывает)
    root.append(h('div', 'pass', '<div id="title"><span class="nm">НЕКРОПОЛИС</span><span class="pz">ПАУЗА</span></div>'));
    const seed = h('div', 'frame box', 'СИД <span id="s-seed"></span>'); seed.id = 'seedbox'; seed.title = 'Сид забега: та же карта при том же сиде'; root.append(seed);
    const stats = h('div', '', ''); stats.id = 'stats';
    stats.innerHTML = `<button class="btn ibtn" id="b-pause" title="Пауза (Пробел)">❚❚</button>
      <div id="speeds" title="Скорость игры (F — по кругу)">${SPEEDS.map((v) => `<button class="btn sp" data-s="${v}">×${v}</button>`).join('')}</div>
      <div class="frame box wave">⚔ <span id="s-wave">ВОЛНА 0 / 20</span></div><div class="frame box souls">${SOUL}<span id="s-souls">0</span></div>
      <div class="frame box hp"><span class="heart-ico">❤</span><span id="s-hp">20</span></div><button class="btn ibtn" id="b-menu" title="Меню (Esc)">☰</button>`;
    root.append(stats);
    const wb = h('button', 'btn green', '<div class="l1" id="w-l1">Призвать волну</div><div class="l2" id="w-l2">Enter</div>'); wb.id = 'wavebtn'; root.append(wb);
    // автоплей — рядом с кнопкой волны, виден всю партию (и во время волны, когда кнопки нет)
    const ab = h('button', 'btn', '<span class="ic">⟳</span><span class="tx">АВТО</span><span class="st" id="a-st">ВЫКЛ</span>'); ab.id = 'autobtn';
    ab.title = `Автоплей (A): следующая волна начинается сама через ${C.RUN_CONTROL.autoDelay} с после зачистки. Первую волну, выбор реликвии и победу не пропускает.`; root.append(ab);
    const cards = h('div', 'frame', ''); cards.id = 'cards';
    cards.style.setProperty('--n', C.TOWER_ORDER.length);            // ширина карточки считается в CSS от числа типов: полоса не шире своей зоны
    if (C.TOWER_ORDER.length > 5) cards.classList.add('many');
    C.TOWER_ORDER.forEach((k, i) => { const d = T[k], c = h('div', 'card', `<span class="key">${i + 1}</span><div class="pic">${typePic(k, 1)}</div><div class="nm">${d.name}</div><div class="pr">${SOUL} ${d.base.cost}</div><div class="lock">🔒</div>`);
      c.dataset.type = k; cards.append(c); });
    root.append(cards);
    const panel = h('div', 'frame', ''); panel.id = 'panel'; root.append(panel);
    panel.addEventListener('pointerdown', () => { pressed = true; });
    for (const evn of ['pointerup', 'pointercancel']) addEventListener(evn, () => { pressed = false; }, true);
    addEventListener('blur', () => { pressed = false; });
    const tip = h('div', 'frame', ''); tip.id = 'tip'; root.append(tip);
    const toasts = h('div', '', ''); toasts.id = 'toasts'; root.append(toasts);
    const coach = h('div', 'frame', ''); coach.id = 'coach'; root.append(coach);
    root.append(h('div', 'overlay', ''), h('div', 'overlay', ''), h('div', 'overlay', ''), h('div', 'overlay', ''), h('div', 'overlay', ''));
    const [menu, gmenu, end, ne, meta] = root.querySelectorAll('.overlay'); menu.id = 'menu'; gmenu.id = 'gmenu'; end.id = 'end'; ne.id = 'newenemy'; meta.id = 'meta';
    gmenu.innerHTML = `<div class="frame box"><h2>Меню</h2>
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
      <button class="btn" id="m-meta">Открытия</button>
      <button class="btn" id="m-help">Как играть</button></div>
      <div class="frame help" id="m-helptext"><b>Цель:</b> переживи ${SIM.waveCount()} волн. Каждый прорвавшийся враг отнимает прочность склепа, босс — 10.<br>
      <b>Строительство:</b> нажми на свободную клетку у дороги, затем на карточку башни внизу слева (или клавиши 1–${C.TOWER_ORDER.length}). Можно и наоборот: выбери башню и нажми на клетку.<br>
      <b>Бесконечный режим:</b> после победы на ${SIM.waveCount()}-й волне можно держать оборону дальше — волны растут без предела, босс каждые 10 волн; итог — достигнутая волна.<br>
      <b>Карта</b> каждый забег новая, её задаёт сид: он виден слева вверху и на экране итогов. Введи его в поле «сид карты» — сыграешь ту же карту.<br>
      <b>Души</b> дают за каждого врага и за зачищенную волну. Трать их на новые башни и улучшения.<br>
      <b>Прокачка:</b> нажми на башню и качай её ветки — урон (Q), дальность (W), скорость (E), по ${C.TRACK_MAX} ступеней. Когда в башню вложено ${C.PERK_AT} ступеней, выбери один из трёх перков.<br>
      <b>Гримуар</b> (кнопка ✦ вверху справа или G) — в любой момент за души усиливает сразу все башни, и построенные позже: урон, дальность, скорость и отдельно каждый тип.<br>
      <b>Сочетай башни:</b> Кости — дешёвый урон, Духи замедляют, Чума травит толпу сквозь броню, Тьма жжёт повозки, боссов и священников, Колокол оглушает всех вокруг себя, Алтарь крови усиливает башни на соседних клетках, скелеты Казармы держат врагов под огнём.<br>
      <b>Волны</b> сами не начинаются: готовься сколько нужно и зови следующую кнопкой слева вверху или Enter. Автоплей (кнопка ⟳ рядом или A) начинает следующую волну сам через ${C.RUN_CONTROL.autoDelay} с после зачистки.<br>
      <b>Управление:</b> Пробел — пауза (поле и панели видны, действия ждут), F — скорость ×1 / ×2 / ×4, Enter — призвать волну, A — автоплей, Esc — меню. Забег сохраняется сам, даже посреди волны: после перезагрузки страницы нажми «Продолжить».</div></div>`; };
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
  const select = (i) => { ui.sel = i; ui.preview = null; ui.armed = null; ui.move = -1; ui.merge = -1; ui.mergeTo = -1; renderPanel(true); };
  const tryBuild = (cell, type) => { const S = APP.play; if (!S || held()) return false; const cb = SIM.canBuild(S, cell, type);
    if (!cb.ok) { if (cb.reason === 'souls') flashPoor(type); AUDIO.ui('deny'); return false; }
    APP.cmd({ k: 'build', cell, type }); ui.last = type; ui.armed = null; ui.preview = null; ui.sel = cell; setTimeout(() => renderPanel(true), 30); return true; };
  const flashPoor = (type) => { const c = $(`.card[data-type="${type}"]`); if (c) { c.animate([{ transform: 'translateX(-5px)' }, { transform: 'translateX(5px)' }, { transform: 'none' }], { duration: 220 }); }
    const s = $('#stats .souls'); s.classList.remove('gain'); void s.offsetWidth; s.animate([{ filter: 'brightness(1)' }, { filter: 'brightness(2) hue-rotate(140deg)' }, { filter: 'brightness(1)' }], { duration: 300 }); };
  const cardAction = (type) => { const S = APP.play; if (!S || ended() || held()) return;
    if (locked(S, type)) { AUDIO.ui('deny'); toast(`${T[type].title} закрыта<small>${howOpen(type)}</small>`, '', 2600); return; }
    if (ui.sel >= 0 && !S.towers[ui.sel]) { tryBuild(ui.sel, type); return; }
    ui.armed = ui.armed === type ? null : type; ui.sel = -1; ui.move = -1; renderPanel(true); };
  const upgrade = (track) => { const S = APP.play, tw = S && ui.sel >= 0 ? S.towers[ui.sel] : null; if (!tw || held()) return;
    const cu = SIM.canUpgrade(S, ui.sel, track);
    if (cu.ok) APP.cmd({ k: 'upgrade', cell: ui.sel, track }); else { AUDIO.ui('deny'); if (cu.reason === 'souls') flashPoor(); } setTimeout(() => renderPanel(true), 30); };
  const sell = () => { const S = APP.play; if (S && ui.sel >= 0 && S.towers[ui.sel] && !held()) { APP.cmd({ k: 'sell', cell: ui.sel }); setTimeout(() => renderPanel(true), 30); } };
  // перенос: кнопка или M включает режим выбора клетки (ui.move — клетка башни), клик по подсвеченной клетке переносит,
  // Esc, правый клик или клик по самой башне — отмена. Можно ли и куда — отвечает логика (SIM.canMove, SIM.moveCells)
  const startMove = () => { const S = APP.play; if (!S || ui.sel < 0 || !S.towers[ui.sel] || held()) return;
    if (!SIM.canMove(S, ui.sel).ok) { AUDIO.ui('deny'); return; }
    ui.move = ui.sel; hideTip(); AUDIO.ui('click'); renderPanel(true); };
  const cancelMove = () => { if (ui.move < 0) return; ui.move = -1; renderPanel(true); };
  const tryMove = (to) => { const S = APP.play; if (held()) return;
    if (!SIM.canMove(S, ui.move, to).ok) { AUDIO.ui('deny'); return; }
    APP.cmd({ k: 'move', cell: ui.move, to }); ui.move = -1; ui.sel = to; AUDIO.ui('click'); };
  // слияние: кнопка включает режим выбора соседа (ui.merge — клетка первой башни), клик по подсвеченному соседу показывает
  // в панели, что получится (ui.mergeTo), кнопка «Слить» отправляет команду; Esc, правый клик или клик по самой башне — отмена.
  // Можно ли, с кем и что выйдет — отвечает логика (SIM.canMerge, SIM.mergeTargets, SIM.mergeInfo)
  const startMerge = () => { const S = APP.play; if (!S || ui.sel < 0 || !S.towers[ui.sel] || held()) return;
    if (!SIM.mergeTargets(S, ui.sel).length) { AUDIO.ui('deny'); return; }
    ui.merge = ui.sel; ui.mergeTo = -1; ui.move = -1; hideTip(); AUDIO.ui('click'); renderPanel(true); };
  const cancelMerge = () => { if (ui.merge < 0) return; ui.merge = -1; ui.mergeTo = -1; renderPanel(true); };
  const pickMerge = (i) => { if (!SIM.mergeTargets(APP.play, ui.merge).includes(i)) { AUDIO.ui('deny'); return; }
    ui.mergeTo = i; AUDIO.ui('click'); renderPanel(true); };
  const doMerge = () => { if (held()) return; const S = APP.play, cm = SIM.canMerge(S, ui.merge, ui.mergeTo);
    if (!cm.ok) { AUDIO.ui('deny'); if (cm.reason === 'souls') flashPoor(); return; }
    APP.cmd({ k: 'merge', cell: ui.merge, other: ui.mergeTo }); ui.sel = ui.merge; ui.merge = -1; ui.mergeTo = -1; setTimeout(() => renderPanel(true), 30); };
  const ended = () => APP.play && (APP.play.phase === 'won' || APP.play.phase === 'lost');
  // Пауза — только остановка времени: поле, панели, разведка и Гримуар видны и открываются, действия ждут (held), вверху метка.
  // Меню — отдельно: ставит паузу и при закрытии возвращает ту, что была до него (menuWas).
  const menuOpen = () => $('#gmenu').classList.contains('show');
  const togglePause = (v) => { if (!APP.play || ended() || menuOpen()) return; APP.paused = v === undefined ? !APP.paused : !!v; AUDIO.ui('click'); };
  let menuWas = false;
  const openMenu = () => { if (!APP.play || ended() || menuOpen()) return; menuWas = APP.paused; APP.paused = true; showOverlay('gmenu', true); };
  const closeMenu = () => { if (!menuOpen()) return; showOverlay('gmenu', false); APP.paused = menuWas; };
  UI.autoPause = () => togglePause(true);
  // в паузе действие не выполняется: отказ звуком и (не чаще раза в 1.5 с) подсказка, как продолжить; true — действие отменено
  let heldAt = -1e9;
  const held = () => { if (!APP.paused) return false; AUDIO.ui('deny');
    if (performance.now() - heldAt > 1500) { heldAt = performance.now(); toast('Пауза<small>Действия недоступны — Пробел продолжает игру</small>', '', 1600); }
    return true; };
  UI.held = held;
  // скорость ×1 / ×2 / ×4 — выбор игрока, запоминается в настройках браузера; F перебирает по кругу
  const setSpeed = (v) => { if (!SPEEDS.includes(v)) return; APP.speed = v; prefs.speed = v; store.set(PREF_KEY, prefs); };
  const cycleSpeed = () => setSpeed(SPEEDS[(SPEEDS.indexOf(APP.speed) + 1) % SPEEDS.length]);
  const toggleAuto = () => { const S = APP.play; if (!S || ended()) return; APP.cmd({ k: 'auto', on: !S.auto }); AUDIO.ui('click'); };
  const callWave = () => { AUDIO.unlock(); if (!held()) APP.cmd({ k: 'call' }); };

  const wire = () => {
    cv.addEventListener('pointermove', (e) => { const [x, y] = toView(e); ui.hover = hitCell(x, y);
      cv.style.cursor = ui.merge >= 0 ? (SIM.mergeTargets(APP.play, ui.merge).includes(ui.hover) || ui.hover === ui.merge ? 'pointer' : 'not-allowed') : ui.move >= 0 ? (SIM.canMove(APP.play, ui.move, ui.hover).ok ? 'pointer' : 'not-allowed') : ui.hover >= 0 && !isRoad(ui.hover) ? 'pointer' : 'default'; });
    cv.addEventListener('pointerleave', () => { ui.hover = -1; });
    cv.addEventListener('pointerdown', (e) => { AUDIO.unlock(); if (!APP.play || ended()) return; const [x, y] = toView(e), i = hitCell(x, y);
      if (ui.move >= 0) { if (e.button === 0) { if (i === ui.move) cancelMove(); else tryMove(i); } return; }   // правый — в contextmenu
      if (ui.merge >= 0) { if (e.button === 0) { if (i === ui.merge) cancelMerge(); else pickMerge(i); } return; }
      if (i >= 0 && ui.armed && !APP.play.towers[i]) { tryBuild(i, ui.armed); return; }
      if (i >= 0 && isRoad(i)) { AUDIO.ui('deny'); select(-1); return; }
      if (i >= 0) { select(ui.sel === i ? -1 : i); AUDIO.ui('click'); } else { select(-1); } });
    addEventListener('pointerdown', () => AUDIO.unlock(), { once: true });
    addEventListener('contextmenu', (e) => { if (ui.move >= 0) { e.preventDefault(); cancelMove(); } else if (ui.merge >= 0) { e.preventDefault(); cancelMerge(); } });
    $('#cards').addEventListener('click', (e) => { const c = e.target.closest('.card'); if (c) { AUDIO.ui('click'); cardAction(c.dataset.type); } });
    $('#cards').addEventListener('pointerover', (e) => { const c = e.target.closest('.card'); if (!c) return; showCardTip(c); if (ui.sel >= 0 && APP.play && !APP.play.towers[ui.sel]) ui.preview = c.dataset.type; });
    $('#cards').addEventListener('pointerout', (e) => { const c = e.target.closest('.card'); if (c && !c.contains(e.relatedTarget)) { hideTip(); ui.preview = null; } });
    $('#wavebtn').addEventListener('click', callWave);
    $('#autobtn').addEventListener('click', toggleAuto);
    $('#b-pause').addEventListener('click', () => togglePause());
    $('#speeds').addEventListener('click', (e) => { const b = e.target.closest('.sp'); if (b) { setSpeed(+b.dataset.s); AUDIO.ui('click'); } });
    $('#b-menu').addEventListener('click', openMenu);
    $('#vol').addEventListener('input', (e) => { prefs.vol = +e.target.value; AUDIO.setVolume(prefs.vol); store.set(PREF_KEY, prefs); });
    $('#p-resume').addEventListener('click', closeMenu);
    $('#p-restart').addEventListener('click', () => { APP.newGame(undefined, { unlocked: META.unlocked(profile()) }); resetRun(); showOverlay('gmenu', false); persist(); });
    $('#p-menu').addEventListener('click', () => { persist(); showOverlay('gmenu', false); APP.toMenu(); showMenu(); });
    addEventListener('keydown', (e) => {
      if (e.repeat) return; const k = e.code;
      if ($('#meta').classList.contains('show')) { if (k === 'Escape') { showOverlay('meta', false); e.preventDefault(); } return; }   // экран открытий поверх меню
      // Enter в меню — «Продолжить» или «Новая игра», если фокус не на кнопке или поле: там Enter делает своё
      if (!APP.play) { if (k === 'Enter' && !(e.target && e.target.closest && e.target.closest('button, input, textarea, select'))) { const c = $('#m-cont') || $('#m-new'); if (c) c.click(); } return; }
      if ($('#newenemy').classList.contains('show')) { if (k === 'Enter' || k === 'Space' || k === 'Escape') { closeNewEnemy(); e.preventDefault(); } return; }
      // Esc: сначала закрывает меню и отменяет открытый режим (перенос, слияние, выбор; окно Гримуара ловит Esc раньше), потом — меню
      if (k === 'Escape') { if (menuOpen()) closeMenu(); else if (ui.move >= 0) cancelMove(); else if (ui.merge >= 0) cancelMerge(); else if (ui.sel >= 0 || ui.armed) select(-1); else openMenu(); e.preventDefault(); return; }
      if (menuOpen()) { if (k === 'Space') e.preventDefault(); return; }   // под меню игра молчит
      if (k === 'Space') { togglePause(); e.preventDefault(); return; }
      if (k === 'KeyF') { cycleSpeed(); return; }
      if (k === 'KeyA') { toggleAuto(); return; }
      if (ended()) return;
      const dg = /^(?:Digit|Numpad)([1-9])$/.exec(k); if (dg && C.TOWER_ORDER[+dg[1] - 1]) { cardAction(C.TOWER_ORDER[+dg[1] - 1]); return; }
      const tk = { KeyQ: 'dmg', KeyW: 'range', KeyE: 'rate' }[k]; if (tk) { upgrade(tk); return; }
      if (k === 'KeyX' || k === 'Delete') sell(); else if (k === 'KeyM') { if (ui.move >= 0) cancelMove(); else startMove(); }
      else if ((k === 'Enter' || k === 'KeyN') && APP.play.phase === 'prep') callWave();
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
    if (locked(APP.play, k)) { tipAt(`<h4>${d.title} · закрыта</h4><div>${d.desc}</div><div class="row" style="margin-top:6px">Откроется: <b>${howOpen(k)}</b></div>`, c.offsetLeft + 10, 900 - 150); return; }
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
  const PAUSE_NOTE = '<div class="pnote">❚❚ Пауза: действия недоступны. Пробел — продолжить</div>';
  // подсказка перка или ветки — сбоку от панели, где хватает места
  const tipBeside = () => { const p = $('#panel'), right = p.offsetLeft + p.offsetWidth + 10;
    return [right + 300 <= 1590 ? right : p.offsetLeft - 310, p.offsetTop + p.offsetHeight]; };
  const closeBtn = '<button class="btn x">✕</button>';
  // меню свободной клетки: особая клетка (вид и бонус), покрытие дороги, итоговые цены башен на этой клетке (с наценкой)
  const buildMenu = (S, p) => {
    const b = SIM.cellBonus(S, ui.sel), cov = SIM.spotCoverage(S, ui.sel), q = cov > 520 ? 'узловая: бьёт по нескольким участкам дороги' : cov > 300 ? 'хорошее покрытие дороги' : cov > 0 ? 'короткий участок дороги' : 'дорога далеко';
    const prices = C.TOWER_ORDER.map((k) => { const cb = SIM.canBuild(S, ui.sel, k);
      if (cb.reason === 'locked') return `<div class="lk"><span>${T[k].name}</span><span>🔒 закрыта</span></div>`;
      return `<div><span>${T[k].name}</span><span>${cb.cost !== cb.base ? `<s class="was">${cb.base}</s>` : ''}<b class="${S.souls < cb.cost ? 'poor' : ''} ${cb.cost !== cb.base ? 'up' : ''}">${cb.cost}</b></span></div>`; }).join('');
    // превью Алтаря: каких соседей он усилит на этой клетке (ответ логики; на карте те же клетки подсвечены)
    const aura = C.TOWER_ORDER.filter((k) => SIM.hasAura(k)).map((k) => { const n = SIM.auraTargets(S, ui.sel, k).length;
      return n ? `<div class="note aura">${T[k].title} здесь усилит башен: <b>${n}</b></div>` : ''; }).join('');
    p.innerHTML = `${closeBtn}<div class="nm">${b ? b.name : 'Свободная клетка'}</div>
        ${b ? `<div class="bonus ${b.kind}">${b.desc}</div>` : ''}
        <div class="note" style="margin-top:6px">${q[0].toUpperCase() + q.slice(1)}.</div>
        <div class="st prices">${prices}</div>
        ${aura}<div class="note" style="margin-top:6px">Выберите башню на карточках слева внизу или клавишами 1–${C.TOWER_ORDER.length}.</div>`;
  };
  const towerPic = (tw) => { const lk = SIM.look(tw); return artPic(SIM.towerArt(tw), lk, `width:${22 + 5 * lk}px;height:${30 + 8 * lk}px;`); };
  // строка примеси гибрида (описание из логики); на атаке, где ей нечего делать, — честная пометка
  const mixLine = (info) => `<div class="mixl" style="color:${SIM.art(info.mix).ui}"><span class="ic">${info.icon}</span> <b>${info.mixName}</b> · ${info.mixText}${info.mixOn ? '' : ' <i>На этой атаке не действует.</i>'}</div>`;
  const towerHead = (S, tw) => {
    const d = T[tw.type], st = SIM.towerStats(S, tw), hy = SIM.hybridInfo(S, tw);
    return `<div class="hd"><div class="pic">${towerPic(tw)}</div>
      <div><div class="nm ${hy ? 'hy' : ''}">${hy ? hy.name : d.short}</div><div class="lv">ПРОКАЧКА ${SIM.steps(tw)} / ${C.TRACKS.length * tw.cap} · <span class="dt">${DMG_KIND[d.dmgType] || ''}</span></div></div></div>
      ${hy ? mixLine(hy) : ''}
      <div class="st">${statLines(tw.type, st).map(([a, b]) => `<div><span>${a}</span><b>${b}</b></div>`).join('')}
      ${SIM.hasAura(tw.type) ? `<div><span>Усиливает</span><b>${SIM.auraTargets(S, tw.cell).length} баш.</b></div>` : `<div><span>Убито</span><b data-v="kills">${tw.kills}</b></div>`}
      ${hy && SIM.auraOf(tw) ? `<div><span>Усиливает</span><b>${SIM.auraTargets(S, tw.cell).length} баш.</b></div>` : ''}</div>${grimLine(S, tw)}
      ${boostLine(st)}`;
  };
  // бонус Алтаря крови в итоговых характеристиках башни (st.altar от логики) — одной строкой под характеристиками
  const boostLine = (st) => { const a = st.altar; if (!a) return '';
    const parts = [`+${Math.round(a.dmg * 100)}% урона`, `+${Math.round(a.rate * 100)}% скорости`].concat(a.range ? [`+${SIM.rangeTiles(a.range).toFixed(1)} кл.`] : []);
    return `<div class="boost">♥ Алтарь крови: ${parts.join(' · ')}</div>`; };
  // что дают башне покупки Гримуара (уже вошли в характеристики выше); пусто, пока ничего не куплено
  const grimLine = (S, tw) => { const g = SIM.grimBonus(S, tw.type), parts = C.TRACKS.filter((k) => g[k] > 0).map((k) => `${trackName(tw.type, k).toLowerCase()} <b>+${Math.round(g[k] * 100)}%</b>`);
    return parts.length ? `<div class="grim">✦ Гримуар: ${parts.join(' · ')}</div>` : ''; };
  // почему ступень или перк недоступны — словами (подсказка при наведении); пустая строка — доступно
  const trackWhy = (S, cu) => ({ max: 'Ветка прокачана до предела этой башни', price: 'Следующая ступень этой ветки пока недоступна', souls: `Не хватает ${cu.cost - S.souls} душ`, ended: 'Забег окончен' }[cu.reason] || '');
  const perkWhy = (S, cp) => ({ steps: `Откроется после ${SIM.perkAt(S)} ступеней: вложи ещё ${cp.need}`, chosen: 'Выбрано навсегда', taken: 'Выбран другой перк — выбор навсегда',
    souls: `Цена ${cp.cost} душ — не хватает ${cp.cost - S.souls}`, ended: 'Забег окончен', dead: 'Не действует на атаке этого гибрида — не продаётся' }[cp.reason] || `Цена: <b>${cp.cost}</b> душ · выбор навсегда`);
  const trackCls = (cu) => (cu.ok ? 'green' : cu.reason === 'souls' ? 'poor' : 'off');
  const towerGrowth = (S, tw) => {
    const rows = C.TRACKS.map((k) => { const cu = SIM.canUpgrade(S, tw.cell, k), nx = trackValue(tw.type, k, SIM.towerStats(S, tw, k));
      const pips = Array.from({ length: tw.cap }, (_, i) => `<i class="${i < tw.tracks[k] ? 'on' : ''}"></i>`).join('');
      const label = cu.reason === 'max' ? 'МАКСИМУМ' : cu.reason === 'price' ? 'НЕДОСТУПНО' : `→ ${nx} · <span class="pr">${SOUL}${cu.cost}</span>`;
      return `<div class="tr ${k}"><span class="tn"><span class="key">${TRACK_KEY[k]}</span>${trackName(tw.type, k)}</span><span class="pips c${tw.cap}">${pips}</span>
        <button class="btn tb ${trackCls(cu)}" data-t="${k}">${label}</button></div>`; }).join('');
    // перки группами по типу (SIM.perkGroups): у обычной башни одна группа, у гибрида разных типов — по группе на тип;
    // перк, не действующий на атаке гибрида (SIM.perkOn), зачёркнут
    const hy = SIM.isHybrid(tw), two = hy && tw.mix !== tw.type;
    const group = (g) => { const perks = g.ids, cps = perks.map((pk) => SIM.canPerk(S, tw.cell, pk)), need = cps.length ? cps[0].need : 0, free = SIM.freeSlots(tw);
      const full = !free || (two && perks.some((pk) => SIM.hasPerk(tw, pk)));
      const state = full ? '<span class="ok">выбран навсегда</span>' : need > 0 ? `<span class="why">после ${SIM.perkAt(S)} ступеней · ещё ${need}</span>` : '<span class="ok">выбери — навсегда</span>';
      return perks.length ? `<div class="ph">${two ? 'ПЕРК ' + T[g.type].name : hy ? 'ПЕРКИ · 2 СЛОТА' : 'ПЕРК'} · ${state}</div>
      <div class="perks">${perks.map((pk, i) => { const pd = T[g.type].perks[pk], cp = cps[i], ch = cp.reason === 'chosen', lock = ['steps', 'taken', 'dead'].includes(cp.reason), dead = !SIM.perkOn(tw, pk);
        return `<button class="btn perk ${ch ? 'chosen' : ''} ${lock ? 'locked' : ''} ${dead ? 'dead' : ''} ${cp.reason === 'souls' ? 'poor' : ''}" data-p="${pk}" data-ty="${g.type}"><span class="pn">${pd.name}</span><span class="pf"><span class="ic">${PERK_ICON[pk] || '✦'}</span>${ch || cp.reason === 'taken' || dead ? '' : `<span class="pr">${SOUL}${pd.cost}</span>`}</span></button>`; }).join('')}</div>` : ''; };
    return `<div class="tracks">${rows}</div>${SIM.perkGroups(tw).map(group).join('')}`;
  };
  const wireGrowth = (p, S, tw) => {
    p.querySelectorAll('.tb').forEach((b) => { const k = b.dataset.t;
      b.onclick = () => upgrade(k);
      b.onmouseenter = () => { const cu = SIM.canUpgrade(APP.play, tw.cell, k), why = trackWhy(APP.play, cu);
        tipAt(`<h4>${trackName(tw.type, k)} · ступень ${tw.tracks[k]} / ${tw.cap}</h4><div class="row">${why || `Следующая ступень: <b>${cu.cost}</b> душ · клавиша ${TRACK_KEY[k]}`}</div>`, ...tipBeside()); };
      b.onmouseleave = hideTip; });
    p.querySelectorAll('.perk').forEach((b) => {
      const pk = b.dataset.p, pd = T[b.dataset.ty].perks[pk], dead = !SIM.perkOn(tw, pk);
      b.onmouseenter = () => tipAt(`<h4>${pd.name}</h4><div>${SIM.perkText(pk)}</div>${dead ? `<div class="row bad" style="margin-top:6px">Не действует: гибрид атакует как ${T[tw.type].title.toLowerCase()}.</div>` : ''}<div class="row" style="margin-top:6px">${perkWhy(APP.play, SIM.canPerk(APP.play, tw.cell, pk))}</div>`, ...tipBeside());
      b.onmouseleave = hideTip;
      b.onclick = () => { if (held()) return; if (SIM.canPerk(APP.play, ui.sel, pk).ok) { APP.cmd({ k: 'perk', cell: ui.sel, p: pk }); hideTip(); setTimeout(() => renderPanel(true), 30); } else AUDIO.ui('deny'); };
    });
  };
  // почему башню нельзя слить — словами; пустая строка — можно (есть подходящий сосед)
  const mergeWhy = (S, cell) => { const cm = SIM.canMerge(S, cell);
    if (cm.ok) return SIM.mergeTargets(S, cell).length ? '' : `Рядом (и по диагонали) нет башни со всеми ветками на ${C.TRACK_MAX}-й ступени.`;
    return { first: 'Алтарь крови не стреляет и сливается только второй башней: выбери соседнюю башню и слей её с алтарём.',
      tracks: `Сливаются башни, у которых все три ветки на ${C.TRACK_MAX}-й ступени.`, phase: 'Сливать можно только в паузе между волнами.',
      ended: 'Забег окончен' }[cm.reason] || ''; };
  // режим слияния: выбор соседа, затем превью гибрида из логики (SIM.mergeInfo) и подтверждение
  const mergeBlock = (S, tw) => {
    const info = ui.mergeTo >= 0 ? SIM.mergeInfo(S, ui.merge, ui.mergeTo) : null;
    if (!info) return `<div class="note mv">С кем слить? Нажми на подсвеченную соседнюю башню — она станет примесью, гибрид встанет на эту клетку. Esc или правый клик — отмена.</div>
      <button class="btn mvx">Отменить слияние</button>`;
    const pic = artPic(SIM.towerArt({ type: info.type, mix: info.mix }), 3, 'width:37px;height:54px;');
    const perks = info.perks.length ? `<div class="pls">${info.perks.map((q) => `<div class="${q.on ? '' : 'dead'}">${PERK_ICON[q.id] || '✦'} ${q.name} — ${q.on ? 'действует' : 'не действует на этой атаке'}</div>`).join('')}</div>` : '';
    return `<div class="hd"><div class="pic">${pic}</div><div><div class="nm hy">${info.name}</div><div class="lv">ГИБРИД · ВЕТКИ ДО ${info.cap} СТУПЕНИ</div></div></div>
      <div class="note mgn">Стреляет как ${info.title.toLowerCase()}, плюс примесь второй башни:</div>${mixLine(info)}
      <div class="st">${statLines(info.type, info.stats).map(([a, b]) => `<div><span>${a}</span><b>${b}</b></div>`).join('')}</div>${perks}
      <div class="note mgn">Перков — до ${info.slots}. Клетка второй башни освободится.</div>
      <div class="mg"><button class="btn green mgo ${info.ok ? '' : info.reason === 'souls' ? 'poor' : 'off'}">Слить · <span class="pr">${SOUL}${info.cost}</span></button><button class="btn mvx2">Отмена</button></div>`;
  };
  const towerManage = (S, tw) => {
    if (ui.move === ui.sel) return `<div class="note mv">Куда перенести? Нажми на подсвеченную клетку. Esc или правый клик — отмена.</div>
      <button class="btn mvx">Отменить перенос</button>`;
    if (ui.merge === ui.sel) return mergeBlock(S, tw);
    const cm = SIM.canMove(S, ui.sel), n = SIM.isHybrid(tw) ? 0 : SIM.mergeTargets(S, ui.sel).length;
    return `${SIM.isHybrid(tw) ? '' : `<button class="btn merge ${n ? 'green' : 'off'}">⚭ Слить с соседом${n > 1 ? ` · ${n} на выбор` : ''}</button>`}
      <div class="mg"><button class="btn move ${cm.ok ? '' : 'off'}">Перенести</button>
      <button class="btn red sell">Продать · +${SIM.sellValue(tw, S)}</button></div>`;
  };
  const wireManage = (p, S, tw) => {
    const mv = p.querySelector('.move'), mx = p.querySelector('.mvx'), sl = p.querySelector('.sell');
    if (mv) { mv.onclick = startMove;
      mv.onmouseenter = () => tipAt(`<h4>Перенос</h4><div>${SIM.canMove(APP.play, ui.sel).ok ? 'Бесплатно и мгновенно, вся прокачка и перк остаются. Бонус особой клетки — от новой клетки.' : (SIM.hasRelic(APP.play, 'restless') ? 'В этой волне башня уже переносилась. Дождись конца волны.' : 'Во время волны башни не переносятся. Дождись конца волны.')}</div><div class="row" style="margin-top:6px">Клавиша <b>M</b></div>`, ...tipBeside());
      mv.onmouseleave = hideTip; }
    if (mx) mx.onclick = ui.merge >= 0 ? cancelMerge : cancelMove;
    if (sl) sl.onclick = sell;
    const mg = p.querySelector('.merge'), go = p.querySelector('.mgo'), mx2 = p.querySelector('.mvx2');
    if (mg) { mg.onclick = startMerge;
      mg.onmouseenter = () => { const why = mergeWhy(APP.play, ui.sel);
        tipAt(`<h4>Слияние</h4><div>${why || `Сливает эту башню с соседней в гибрид: стреляет как эта, плюс примесь соседа. Оба перка остаются, ветки — до ${C.MERGE.cap} ступени. Цена ${C.MERGE.cost} душ.`}</div>`, ...tipBeside()); };
      mg.onmouseleave = hideTip; }
    if (go) go.onclick = doMerge;
    if (mx2) mx2.onclick = cancelMerge;
  };
  // то, что меняется без смены устройства панели: доступность по душам и фазе, счётчик убийств
  const refreshPanel = (p, S, tw) => {
    p.querySelectorAll('.tb').forEach((b) => { const c = trackCls(SIM.canUpgrade(S, tw.cell, b.dataset.t)); for (const k of ['green', 'poor', 'off']) b.classList.toggle(k, k === c); });
    p.querySelectorAll('.perk').forEach((b) => b.classList.toggle('poor', SIM.canPerk(S, tw.cell, b.dataset.p).reason === 'souls'));
    const kills = p.querySelector('[data-v="kills"]'); if (kills && kills.textContent !== String(tw.kills)) kills.textContent = tw.kills;
    const mv = p.querySelector('.move'); if (mv) mv.classList.toggle('off', !SIM.canMove(S, tw.cell).ok);
    const mg = p.querySelector('.merge'); if (mg) { const n = SIM.mergeTargets(S, tw.cell).length; mg.classList.toggle('off', !n); mg.classList.toggle('green', !!n); }
    const go = p.querySelector('.mgo'); if (go && ui.mergeTo >= 0) { const r = SIM.canMerge(S, ui.merge, ui.mergeTo).reason; go.classList.toggle('poor', r === 'souls'); go.classList.toggle('off', !!r && r !== 'souls'); }
  };

  // Место окна у точки — общее для панели и подсказок обучения. Перебор позиций по всему полю шагом 16 px.
  //  Нельзя никогда: o.keep (у панели — своя клетка с соседями, в режиме переноса — две клетки вокруг), o.avoid (у подсказки —
  //  открытая панель), плашки интерфейса (кнопка вызова волны — и тогда, когда её сейчас нет: она вернётся после волны),
  //  вход и склеп с соседними клетками, край экрана.
  //  Из допустимых — меньше всего o.soft (дорога; в режиме переноса — клетки-цели; одна клетка стоит ~400 px расстояния),
  //  затем меньше чужих башен, затем ближе к точке; o.maxDist — мягкий предел расстояния (если задан). Жёсткого предела
  //  расстояния нет: в углах поля он выталкивает панель на дорогу (сид 77, правый нижний угол: в 600 px — 5 клеток дороги).
  //  Результат кэшируется в o.cache, пока не сменились входные данные.
  const PLATES = '#stats, #seedbox, #cards, #title, #relicbar, #autobtn';
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
  const placePanel = (S, p) => { const moving = ui.move === ui.sel, merging = ui.merge === ui.sel, [x, y] = SIM.cellXY(S, ui.sel);
    const [l, t] = spotNear(S, { x, y, w: p.offsetWidth, h: p.offsetHeight, keep: cellRect(S, ui.sel, moving || merging ? 2 : 1), maxDist: PANEL_MAX, cache: panelCache,
      soft: (moving ? SIM.moveCells(S, ui.sel) : S.map.road).map((i) => cellRect(S, i)) });
    p.style.left = l + 'px'; p.style.top = t + 'px'; };

  const renderPanel = (force) => {
    const S = APP.play, p = $('#panel');
    // цена на карточках — для клетки, куда пойдёт постройка: выбранной свободной, а с выбранной карточкой — под курсором
    const free = (i) => S && i >= 0 && !S.towers[i] && !isRoad(i), spot = free(ui.sel) ? ui.sel : ui.armed && free(ui.hover) ? ui.hover : -1;
    document.querySelectorAll('.card').forEach((c) => { const k = c.dataset.type, cb = S ? SIM.canBuild(S, spot >= 0 ? spot : -1, k) : null, cost = cb ? cb.cost : T[k].base.cost, poor = S && S.souls < cost;
      const pr = c.querySelector('.pr'), txt = `${SOUL} ${cost}`; if (pr.innerHTML !== txt) pr.innerHTML = txt; pr.classList.toggle('up', !!cb && cb.cost !== cb.base);
      c.classList.toggle('poor', !!poor); c.classList.toggle('armed', ui.armed === k); c.classList.toggle('target', !!(S && ui.sel >= 0 && !S.towers[ui.sel])); c.classList.toggle('can', !poor); c.classList.toggle('locked', locked(S, k)); });
    if (!S || ui.sel < 0) { if (panelKey) hideTip(); p.classList.remove('show'); panelKey = ''; return; }
    const tw = S.towers[ui.sel], moving = ui.move === ui.sel, merging = !!tw && ui.merge === ui.sel;
    // в ключе и сами итоговые характеристики: они меняются и извне (алтарь рядом, Гримуар, клетка) — панель покажет новые
    const key = JSON.stringify([ui.sel, tw && [tw.id, tw.type, tw.tracks, tw.cap, SIM.perksOf(tw), SIM.freeSlots(tw), tw.invested, SIM.towerStats(S, tw), tw.mix], moving, merging && ui.mergeTo, merging && SIM.mergeTargets(S, ui.sel), ended(), APP.paused]);
    if (key === panelKey || (pressed && !force)) { if (tw && !moving) refreshPanel(p, S, tw); return; }
    panelKey = key; hideTip();                                         // подсказка висела над кнопкой, которой больше нет
    p.classList.add('show'); p.classList.toggle('moving', moving || (merging && ui.mergeTo < 0));
    if (!tw) buildMenu(S, p);
    else if (moving || merging) { p.innerHTML = towerManage(S, tw); wireManage(p, S, tw); }
    else { p.innerHTML = closeBtn + towerHead(S, tw) + towerGrowth(S, tw) + towerManage(S, tw); wireGrowth(p, S, tw); wireManage(p, S, tw); }
    if (APP.paused && !ended()) p.insertAdjacentHTML('beforeend', PAUSE_NOTE);   // почему кнопки серые — словами
    const x = p.querySelector('.x'); if (x) x.onclick = () => select(-1);
    placePanel(S, p);
  };

  // ---------------------------------------------------------------- тосты, новый враг, обучение
  const toast = (html, cls = '', ms = 2600) => { const t = h('div', 'frame toast ' + cls, html); $('#toasts').append(t);
    setTimeout(() => t.classList.add('out'), ms); setTimeout(() => t.remove(), ms + 600); };
  let neQueue = [];
  const showNewEnemy = (type) => { const d = EN[type], o = $('#newenemy'), st = SIM.enemyStats(APP.play, type);   // цифры этой волны, со свойством
    const tags = [`HP ${st.hp}`, st.armor ? `броня ${Math.round(st.armor * 100)}%` : '', st.mres ? `защита от магии ${Math.round(st.mres * 100)}%` : '', st.heal ? `лечит ${st.heal} HP` : '', d.boss ? 'босс' : '', `скорость ${st.speed}`].filter(Boolean).join(' · ');
    const own = 'en_' + (d.look ? d.look.as : type), css = has(own) ? (d.look ? d.look.css : '') : 'sepia(1) saturate(2.2) brightness(1.1)';   // без своего арта — как на поле
    o.innerHTML = `<div class="frame box"><h2>Новый враг</h2><div class="pic" style="${css ? 'filter:' + css : ''}">${img(has(own) ? own : 'en_knight', '')}</div><div style="font:700 28px var(--title)">${d.name}</div>
      <div class="tags">${tags}</div><p>${d.desc}</p><div class="col"><button class="btn green" id="ne-ok">К бою (Enter)</button></div></div>`;
    if (!o.classList.contains('show')) neWas = APP.paused;            // после окна — та пауза, что была до него
    showOverlay('newenemy', true); APP.paused = true; $('#ne-ok').onclick = closeNewEnemy; };
  const closeNewEnemy = () => { if (neQueue.length) { showNewEnemy(neQueue.shift()); return; } showOverlay('newenemy', false); APP.paused = neWas; };
  let neWas = false;
  // непрокачанная башня, которой хватает душ на ступень; башня, которой открыт выбор перка
  const raw = (S) => S.towers.find((t) => t && !SIM.steps(t) && C.TRACKS.some((k) => SIM.canUpgrade(S, t.cell, k).ok));
  const mergeReady = (S) => S.phase === 'prep' && S.towers.find((t) => t && SIM.mergeTargets(S, t.cell).length);
  const perkReady = (S) => S.towers.find((t) => t && SIM.freeSlots(t) && Object.keys(T[t.type].perks).length && SIM.canPerk(S, t.cell, Object.keys(T[t.type].perks)[0]).need === 0);
  const COACH = [
    { id: 'build', when: (S) => S.wave === 0 && !S.towers.some(Boolean), at: (S) => SIM.cellXY(S, bestCell(S)),
      text: 'Нажми на свободную клетку у дороги, затем выбери башню внизу слева. Клетки внутри петель бьют сразу по нескольким участкам дороги.' },
    { id: 'call', when: (S) => S.wave === 0 && S.towers.some(Boolean), at: () => { const b = $('#wavebtn'); return [b.offsetLeft + b.offsetWidth / 2, b.offsetTop + b.offsetHeight / 2]; },
      text: 'Когда оборона готова — призови первую волну. Следующие тоже зовёшь сам, когда готов, — или включи автоплей ⟳ рядом с кнопкой.' },
    { id: 'upgrade', when: (S) => S.wave >= 2 && S.phase === 'prep' && !!raw(S), at: (S) => SIM.cellXY(S, raw(S).cell),
      text: 'Нажми на башню и прокачай её ветки: урон, дальность, скорость. Прокачка часто выгоднее новой башни в стороне от дороги.' },
    { id: 'perk', when: (S) => !!perkReady(S), at: (S) => SIM.cellXY(S, perkReady(S).cell),
      text: `В башню вложено ${C.PERK_AT} ступеней — выбери один из трёх перков. Выбор навсегда, читай подсказки.` },
    { id: 'merge', when: (S) => !!mergeReady(S), at: (S) => SIM.cellXY(S, mergeReady(S).cell),
      text: 'Две соседние башни прокачаны до предела — их можно слить в гибрид: нажми на башню и «Слить с соседом». Порядок важен: гибрид стреляет как первая.' },
  ];
  // подсказка обучения — тем же размещением, что и панель: не закрывает цель, панель, разведку, плашки, вход и склеп, мимо дороги
  const placeNear = (S, x, y, w, h) => {
    const avoid = rectsOf('#panel.show, #scout.show, #scout-panel.show').map(([l, t, pw, ph]) => [l - 6, t - 6, pw + 12, ph + 12]);
    return spotNear(S, { x, y, w, h, keep: [x - 40, y - 40, 80, 80], avoid, maxDist: COACH_MAX, cache: coachCache, soft: S.map.road.map((i) => cellRect(S, i)) }); };
  // лучшая клетка карты для подсказки — по радиусу выбранной карточки, без выбора — по самому короткому радиусу открытых
  // стреляющих башен: подсказанная клетка достаёт до дороги любой из них (считается раз на карту и радиус)
  let best = { key: '', cell: -1 };
  const bestCell = (S) => { const open = C.TOWER_ORDER.filter((k) => T[k].attack && T[k].attack !== 'summon' && !locked(S, k));
    const r = ui.armed && T[ui.armed] ? T[ui.armed].base.range : Math.min(...open.map((k) => T[k].base.range), C.TYPICAL_RANGE);
    const key = S.seed + ':' + S.map.road.length + ':' + r; if (best.key !== key) best = { key, cell: SIM.rankCells(S, r)[0] }; return best.cell; };
  const coach = (S) => { const el = $('#coach'), c = COACH.find((q) => !prefs.tips[q.id] && q.when(S));
    for (const q of COACH) if (!prefs.tips[q.id] && done(q, S)) { prefs.tips[q.id] = 1; store.set(PREF_KEY, prefs); }
    if (!c || APP.paused || S.phase === 'relic') { el.classList.remove('show'); return; }
    if (el.textContent !== c.text) el.textContent = c.text;
    el.classList.add('show');
    const [x, y] = c.at(S), [l, t] = placeNear(S, x, y, el.offsetWidth, el.offsetHeight); el.style.left = l + 'px'; el.style.top = t + 'px'; };
  const done = (q, S) => (q.id === 'build' && S.towers.some(Boolean)) || (q.id === 'call' && S.wave > 0) || (q.id === 'upgrade' && S.towers.some((t) => t && SIM.steps(t) > 0)) || (q.id === 'perk' && S.towers.some((t) => t && SIM.perksOf(t).length)) || (q.id === 'merge' && S.stats.merges > 0);

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
    $('#m-meta').onclick = () => { AUDIO.ui('click'); showMeta(); };
    $('#m-help').onclick = () => $('#m-helptext').classList.toggle('show'); };
  // новый забег — по сиду (ввод на титульном экране, «Переиграть сид») или по случайному
  const startRun = (seed) => { APP.newGame(seed, { unlocked: META.unlocked(profile()) }); resetRun(); showOverlay('menu', false); AUDIO.ui('start'); persist(); };
  const clock = (sec) => { const t = Math.floor(sec), hh = Math.floor(t / 3600), mm = Math.floor(t / 60) % 60, ss = String(t % 60).padStart(2, '0');
    return hh ? `${hh}:${String(mm).padStart(2, '0')}:${ss}` : `${mm}:${ss}`; };
  // Итог забега идёт в профиль один раз, когда забег кончился (победа — сразу, ещё до выбора; поражение в бесконечном режиме —
  // продолжение уже засчитанной победы, META.apply не считает её второй раз). runGot — что открылось, его показывает экран итогов.
  let runGot = null;
  const credit = (S) => { if (S.demo) return null; const r = META.apply(profile(), META.result(S)); saveProfile(r.profile); return r; };
  const KIND = { tower: 'Башня', relic: 'Реликвия' };
  const gotHTML = (got) => { if (!got || (!got.opened.length && !got.done.length)) return '';
    const by = new Set(got.opened.map((o) => o.by)), names = (id) => (C.UNLOCKS.achievements.find((a) => a.id === id) || {}).name || id;
    const items = got.opened.map((o) => `<div class="got new"><b>${KIND[o.kind]}: ${o.name}</b><small>за «${o.byName}»</small></div>`)
      .concat(got.done.filter((id) => !by.has(id)).map((id) => `<div class="got"><b>Достижение: ${names(id)}</b></div>`));
    return `<div class="unlocks"><div class="uh">${got.opened.length ? 'Открыто в этом забеге' : 'Достижения забега'}</div><div class="gl">${items.join('')}</div></div>`; };
  // Экран открытий (из меню): рекорды, башни и реликвии — открытые и закрытые с условием, достижения; «Открыть всё»
  const showMeta = () => { const p = profile(), V = META.view(p), m = $('#meta');
    const chip = (it) => `<div class="chip ${it.open ? 'on' : 'off'}" data-id="${it.id}"><b>${it.open ? '' : '🔒 '}${it.name}</b>${it.open ? '' : `<small>${it.ach ? it.ach.desc : 'только «Открыть всё»'}</small>`}</div>`;
    const sect = (kind, title) => { const list = V.items.filter((it) => it.kind === kind); if (!list.length) return '';
      return `<div class="sh">${title} <i>${list.filter((it) => it.open).length} / ${list.length}</i></div><div class="chips ${kind}">${list.map(chip).join('')}</div>`; };
    const all = META.unlocked(p) === null || V.items.every((it) => it.open);
    m.innerHTML = `<div class="frame box"><h2>Открытия</h2>
      <div class="recs"><div><span>Лучшая волна</span><b>${p.best > SIM.waveCount() ? p.best + ' · ∞' : p.best || '—'}</b></div><div><span>Побед</span><b>${p.wins}</b></div>
        <div><span>Быстрейшая победа</span><b>${p.fastest === null ? '—' : clock(p.fastest)}</b></div><div><span>Забегов</span><b>${p.runs}</b></div><div><span>Врагов повержено</span><b>${Math.round(p.totals.kills || 0)}</b></div></div>
      ${sect('tower', 'Башни')}${sect('relic', 'Реликвии')}
      <div class="sh">Достижения <i>${V.achievements.filter((a) => a.done).length} / ${V.achievements.length}</i></div>
      <div class="achs">${V.achievements.map((a) => `<div class="ach ${a.done ? 'on' : ''}" title="${a.desc}"><b>${a.done ? '✔' : '○'} ${a.name}</b><small>${a.desc}</small></div>`).join('')}</div>
      <div class="row2"><button class="btn ${all ? 'off' : 'green'}" id="mt-all" ${all ? 'disabled' : ''}>${all ? 'Всё открыто' : 'Открыть всё'}</button><button class="btn" id="mt-back">Назад</button></div></div>`;
    showOverlay('meta', true);
    $('#mt-all').onclick = () => { saveProfile(META.unlockAll(profile())); AUDIO.ui('start'); showMeta(); };
    $('#mt-back').onclick = () => { showOverlay('meta', false); AUDIO.ui('click'); }; };
  UI.showMeta = showMeta;
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
      ${gotHTML(runGot)}
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
  const resetRun = () => { neWas = false; detached = false; runGot = null; ui.sel = -1; ui.armed = null; ui.move = -1; ui.merge = -1; ui.mergeTo = -1; ui.preview = null; neQueue = []; markSeen(); $('#toasts').innerHTML = ''; panelKey = ''; showOverlay('end', false); showOverlay('newenemy', false); };

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
    // пауза, скорость, автоплей: состояние кнопок и метка «Пауза» (класс paused на слое интерфейса)
    const paused = !!A.paused, pb = $('#b-pause'); $('#ui').classList.toggle('paused', paused); pb.classList.toggle('on', paused);
    if (pb.dataset.p !== String(paused)) { pb.dataset.p = paused; pb.textContent = paused ? '▶' : '❚❚'; pb.title = paused ? 'Продолжить (Пробел)' : 'Пауза (Пробел)'; }
    document.querySelectorAll('#speeds .sp').forEach((b) => b.classList.toggle('on', +b.dataset.s === A.speed));
    $('#autobtn').classList.toggle('on', S.auto); $('#a-st').textContent = S.auto ? 'ВКЛ' : 'ВЫКЛ';
    const wb = $('#wavebtn'), canCall = S.phase === 'prep' && S.wave < SIM.lastWave(S);
    wb.classList.toggle('hidden', !canCall);
    if (canCall) { const nx = S.wave + 1, boss = SIM.isBoss(nx), auto = SIM.autoIn(S), haste = SIM.hasteSouls(S);
      $('#w-l1').textContent = S.wave === 0 ? 'Начать волну 1' : `Призвать волну ${nx}`;
      // вторая строка: без автоплея — без отсчёта; с автоплеем — через сколько начнётся сама; окно «Нетерпения» — только с реликвией
      const l2 = paused ? 'пауза · Пробел' : auto !== null ? `сама через ${Math.ceil(auto)} с` : haste ? `⌛ +${haste} душ сейчас` : 'Enter';
      $('#w-l2').textContent = (boss ? 'БОСС · ' : '') + l2;
      wb.classList.toggle('pulse', S.wave === 0 && S.towers.some(Boolean) && !paused); }
    // события → звук, тосты, новые враги, сейв
    for (const e of S.ev) { const key = evKey(e); if (seenEv.has(key)) continue; seenEv.add(key);
      AUDIO.event(e);
      if (e.k === 'wave') toast(`ВОЛНА ${e.wave}${e.boss ? '<small>Приближается босс</small>' : ''}`, 'big' + (e.boss ? ' boss' : ''), 2200);
      if (e.k === 'boss') toast(`☠ ${e.name} ☠<small>Пропуск стоит ${EN.paladin.leak} прочности склепа</small>`, 'boss', 3600);
      if (e.k === 'waveClear') { toast(`Волна ${e.wave} отбита<small>+${e.bonus} душ</small>`, '', 2400); savedAt = 0; }
      if (e.k === 'relic') { const r = SIM.relicsOf(S).find((x) => x.id === e.id); if (r) toast(`${r.icon} ${r.name}<small>${r.desc}</small>`, '', 3600); savedAt = 0; }
      if (e.k === 'relicOffer' || e.k === 'haste') savedAt = 0;
      if (e.k === 'haste') toast(`Нетерпение<small>+${e.souls} душ за раннюю волну</small>`, '', 2200);
      if (e.k === 'endless') { toast('Бесконечный режим<small>Волны растут без предела · босс каждые 10 волн</small>', 'big', 3000); savedAt = 0; }
      if (e.k === 'newEnemy' && e.type !== 'militia') { if ($('#newenemy').classList.contains('show')) neQueue.push(e.type); else showNewEnemy(e.type); }
      if (e.k === 'merge') { const hi = S.towers[e.cell] && SIM.hybridInfo(S, S.towers[e.cell]); if (hi) toast(`${hi.icon} Гибрид ${hi.name}<small>Примесь «${hi.mixName}» · ветки до ${hi.cap} ступени</small>`, 'big', 3200); savedAt = 0; }
      if (e.k === 'build' || e.k === 'upgrade' || e.k === 'perk' || e.k === 'sell' || e.k === 'move' || e.k === 'grim' || e.k === 'wave') savedAt = 0;
    }
    if (seenEv.size > 3000) markSeen();
    if (performance.now() - savedAt >= SAVE_EVERY) persist();
    const isEnded = S.phase === 'won' || S.phase === 'lost';
    if (isEnded && !wasEnded) { select(-1); dropOwn(); runGot = credit(S); setTimeout(() => showEnd(APP.play), 900); }
    wasEnded = isEnded;
    if (ui.move >= 0 && !SIM.canMove(S, ui.move).ok) { cancelMove(); if (S.phase === 'wave') toast('Волна началась — перенос отменён', '', 2000); }
    if (ui.merge >= 0 && !SIM.mergeTargets(S, ui.merge).length) { cancelMerge(); if (S.phase === 'wave') toast('Волна началась — слияние отменено', '', 2000); }
    renderPanel(false); coach(S);
  };

  UI.init = (A, canvas) => {
    APP = A; cv = canvas; build(); $('#vol').value = prefs.vol; AUDIO.setVolume(prefs.vol); dropOldSaves(); markSeen();
    addEventListener('pagehide', persist); addEventListener('beforeunload', persist); addEventListener('storage', onStorage);
    document.addEventListener('visibilitychange', () => { if (document.hidden) persist(); });
    if (SPEEDS.includes(prefs.speed)) A.speed = prefs.speed;
    if (!A.play) showMenu();
  };
})();
