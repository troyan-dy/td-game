// live/grimoire.js — окно Гримуара «Некрополиса» (DOM): общая прокачка за души, доступна в любой фазе забега.
// Только показывает ответы логики: SIM.grimLines (линии без закрытых типов, ступени, цены, доли бонуса) и SIM.canGrim
// (можно ли купить и почему нет). Покупка — команда { k: 'grim', line } через APP.cmd; бонусы видны в панели башни (ui.js).
// Кнопка — в верхней полосе HUD, рядом с настройками; клавиша G. Окно поверх поля, игра не встаёт; закрывается по Esc,
// по G, по ✕ и по клику мимо окна.
(function () {
  const C = SIM.CONFIG, T = C.TOWERS;
  const $ = (s, r = document) => r.querySelector(s);
  const SOUL = '<span class="soul-ico"></span>';
  const GRIM = (window.GRIM = {});
  const pct = (v) => '+' + Math.round(v * 100) + '%';
  const trackName = (type, k) => (type && T[type].names && T[type].names[k]) || C.TRACK_NAMES[k];
  const ALL_NAME = { dmg: 'Урон всех башен', range: 'Дальность всех башен', rate: 'Скорость всех башен' };
  const WHY = { souls: (cg, S) => `Не хватает ${cg.cost - S.souls} душ`, max: () => 'Линия прокачана до конца', locked: () => 'Тип башни закрыт', ended: () => 'Забег окончен' };
  const NOTE = 'Покупка сразу усиливает все подходящие башни, и построенные позже. G или Esc — закрыть.';
  let APP, wrap, win, btn, open = false, key = '', lastS = null;

  const cls = (cg) => (cg.ok ? 'green' : cg.reason === 'souls' ? 'poor' : 'off');
  const row = (S, l) => {
    const cg = SIM.canGrim(S, l.id), pips = Array.from({ length: l.max }, (_, i) => `<i class="${i < l.step ? 'on' : ''}"></i>`).join('');
    const name = l.group === 'all' ? ALL_NAME[l.track] || C.TRACK_NAMES[l.track]
      : `<span class="sw" style="background:${SIM.art(l.type).ui}"></span>${T[l.type].name} · ${trackName(l.type, l.track)}`;
    const label = cg.reason === 'max' ? 'МАКСИМУМ' : `→ ${pct(l.next)} · <span class="pr">${SOUL}${l.cost}</span>`;
    return `<div class="gl ${l.track}"><span class="ln">${name}</span><span class="pips">${pips}</span><span class="cur">${l.step ? pct(l.bonus) : '—'}</span>
      <button class="btn gb ${cls(cg)}" data-l="${l.id}">${label}</button></div>`;
  };
  const render = (S) => {
    const lines = SIM.grimLines(S), all = lines.filter((l) => l.group === 'all'), types = lines.filter((l) => l.group === 'type');
    win.innerHTML = `<button class="btn x" title="Закрыть (Esc)">✕</button><div class="hd"><span class="tt">ГРИМУАР</span><span class="sl">${SOUL}<b>${S.souls}</b></span></div>
      <div class="sec">ВСЕ БАШНИ</div>${all.map((l) => row(S, l)).join('')}
      ${types.length ? `<div class="sec">ТИПЫ БАШЕН</div>${types.map((l) => row(S, l)).join('')}` : ''}
      <div class="note">${NOTE}</div>`;
    win.querySelector('.x').onclick = () => toggle(false);
    win.querySelectorAll('.gb').forEach((b) => {
      b.onclick = () => { const cg = SIM.canGrim(APP.play, b.dataset.l);
        if (cg.ok) { APP.cmd({ k: 'grim', line: b.dataset.l }); AUDIO.ui('click'); } else AUDIO.ui('deny'); };
      b.onmouseenter = () => { const S2 = APP.play, cg = SIM.canGrim(S2, b.dataset.l);
        win.querySelector('.note').textContent = cg.ok ? `Ступень ${cg.step + 1} из ${cg.max} за ${cg.cost} душ` : WHY[cg.reason] ? WHY[cg.reason](cg, S2) : NOTE; };
      b.onmouseleave = () => { win.querySelector('.note').textContent = NOTE; };
    });
  };
  // души меняются постоянно: доступность кнопок и счётчик обновляются на месте, окно пересобирается только после покупки
  const refresh = (S) => {
    win.querySelectorAll('.gb').forEach((b) => { const c = cls(SIM.canGrim(S, b.dataset.l)); for (const k of ['green', 'poor', 'off']) b.classList.toggle(k, k === c); });
    const sl = win.querySelector('.sl b'); if (sl && sl.textContent !== String(S.souls)) sl.textContent = S.souls;
  };
  const toggle = (v) => { if (!APP.play) return; open = v === undefined ? !open : !!v; key = ''; AUDIO.ui('click'); };
  GRIM.toggle = toggle;
  GRIM.isOpen = () => open;

  GRIM.init = (A) => {
    APP = A;
    const root = $('#ui'), before = root.querySelector('.overlay');      // под оверлеями меню, паузы, итога и нового врага
    wrap = document.createElement('div'); wrap.id = 'grim'; win = document.createElement('div'); win.className = 'frame gwin'; wrap.append(win);
    root.insertBefore(wrap, before);
    wrap.addEventListener('pointerdown', (e) => { if (e.target === wrap) toggle(false); });   // клик мимо окна
    btn = document.createElement('button'); btn.className = 'btn ibtn'; btn.id = 'b-grim'; btn.title = 'Гримуар (G)'; btn.textContent = '✦';
    $('#stats').insertBefore(btn, $('#b-menu'));
    btn.addEventListener('click', () => toggle());
    // раньше игровых клавиш (захват): открытое окно забирает себе Esc, клавиша G открывает и закрывает
    addEventListener('keydown', (e) => {
      if (!APP.play || e.repeat || $('.overlay.show')) return;
      if ((e.code === 'Escape' && open) || (e.code === 'KeyG' && !APP.paused)) { toggle(e.code === 'KeyG' ? undefined : false); e.preventDefault(); e.stopPropagation(); }
    }, true);
  };

  GRIM.frame = (A) => {
    const S = A.play;
    if (!S) open = false;
    wrap.classList.toggle('show', open); btn.classList.toggle('on', open);
    if (!open) { key = ''; return; }
    const k = JSON.stringify([S.seed, S.grim, S.unlocked, S.phase === 'won' || S.phase === 'lost']);
    if (k !== key || S !== lastS) { key = k; lastS = S; render(S); } else refresh(S);
  };
})();
