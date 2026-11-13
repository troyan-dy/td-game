// live/relics.js — реликвии в интерфейсе «Некрополиса» (DOM). Только показывает ответы логики: SIM.relicOffer (предложение
// на экране выбора), SIM.relicsOf (взятые). Выбор уходит командой {k:'relic', i} через APP.cmd.
//
// Экран выбора #relics — оверлей поверх поля, пока забег в фазе 'relic' (логика стоит до выбора): три карточки с названием,
// видом («меняет цифры» / «новое правило») и описанием; клик или клавиши 1–3. Пробел ставит паузу (выбор ждёт), Esc открывает меню поверх.
// Строка #relicbar — значки взятых реликвий в неигровом углу под кнопкой волны; описание — в подсказке при наведении.
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const KIND = { num: 'меняет цифры', rule: 'новое правило' };
  const RELICS = (window.RELICS_UI = {});
  let APP, box, bar, tip, offerKey = '', barKey = '';

  const pick = (i) => { const S = APP.play; if (!S || S.phase !== 'relic' || !S.offer || i >= S.offer.length || UI.held()) return;
    APP.cmd({ k: 'relic', i }); AUDIO.ui('start'); };
  const offerHTML = (S, offer) => `<div class="frame box rbox"><h2>Реликвия</h2>
    <div class="rsub">Волна ${S.wave} отбита. Выбери одну реликвию — бесплатно, до конца забега.</div>
    <div class="rcards">${offer.map((r, i) => `<button class="btn rcard ${r.kind}" data-i="${i}"><span class="key">${i + 1}</span>
      <span class="ic">${esc(r.icon)}</span><span class="rn">${esc(r.name)}</span><span class="rk">${KIND[r.kind]}</span><span class="rd">${esc(r.desc)}</span></button>`).join('')}</div>
    <div class="rnote">Клавиши 1–${offer.length} · забег стоит, пока реликвия не выбрана</div></div>`;
  const barHTML = (list) => list.map((r) => `<div class="frame rl ${r.kind}" data-id="${r.id}">${esc(r.icon)}</div>`).join('');
  const showTip = (el) => { const r = SIM.relicsOf(APP.play).find((x) => x.id === el.dataset.id); if (!r) return;
    tip.innerHTML = `<h4>${esc(r.name)}</h4><div class="rk">${KIND[r.kind]}</div><div>${esc(r.desc)}</div>`; tip.classList.add('show');
    tip.style.left = Math.min(1590 - tip.offsetWidth, el.offsetLeft + bar.offsetLeft) + 'px'; tip.style.top = (bar.offsetTop + bar.offsetHeight + 8) + 'px'; };

  RELICS.init = (A) => {
    APP = A; const root = $('#ui');
    box = document.createElement('div'); box.id = 'relics'; box.className = 'overlay'; root.insertBefore(box, $('#gmenu'));   // меню — поверх выбора
    bar = document.createElement('div'); bar.id = 'relicbar'; root.append(bar);
    tip = document.createElement('div'); tip.id = 'relic-tip'; tip.className = 'frame'; root.append(tip);
    box.addEventListener('click', (e) => { const c = e.target.closest('.rcard'); if (c) pick(+c.dataset.i); });
    bar.addEventListener('pointerover', (e) => { const el = e.target.closest('.rl'); if (el) showTip(el); });
    bar.addEventListener('pointerout', (e) => { const el = e.target.closest('.rl'); if (el && !el.contains(e.relatedTarget)) tip.classList.remove('show'); });
    // цифры на экране выбора — реликвия, а не карточка башни: ловим раньше игровых клавиш ui.js
    addEventListener('keydown', (e) => { if (!box.classList.contains('show') || $('#gmenu.show')) return;
      const d = /^(?:Digit|Numpad)([1-9])$/.exec(e.code); if (!d) return;
      e.preventDefault(); e.stopImmediatePropagation(); if (!e.repeat) pick(+d[1] - 1); }, true);
  };
  RELICS.frame = (A) => {
    const S = A.play, offer = S ? SIM.relicOffer(S) : null, key = offer ? S.seed + ':' + S.wave + ':' + offer.map((r) => r.id).join() : '';
    if (key !== offerKey) { offerKey = key; if (offer) box.innerHTML = offerHTML(S, offer); box.classList.toggle('show', !!offer); }
    const list = S ? SIM.relicsOf(S) : [], bk = list.map((r) => r.id).join();
    if (bk !== barKey) { barKey = bk; bar.innerHTML = barHTML(list); tip.classList.remove('show'); }
    bar.classList.toggle('show', !!list.length);
  };
})();
