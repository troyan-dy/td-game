// live/scout.js — панель разведки «Некрополиса» (DOM). Только показывает ответы логики: SIM.preview (превью волны),
// SIM.scoutRange (какие волны можно смотреть), SIM.remaining (сколько врагов волны осталось). Сама ничего не считает.
//
// Место на экране: строка #scout живёт в верхней строке HUD (клетки под ней и так неигровые) — поле она не закрывает никогда.
// В паузе между волнами под строкой раскрывается #scout-panel (листается на SCOUT_AHEAD волн вперёд). Раскрытая панель
// уступает полю и панели башни: прячется, пока открыта панель клетки или башни, сворачивается от клика по полю,
// от кнопки ▴ и клавиши I, а с началом волны остаётся только строка с числом оставшихся врагов. Каждая новая пауза раскрывает её снова.
(function () {
  const C = SIM.CONFIG, EN = C.ENEMIES;
  const $ = (s, r = document) => r.querySelector(s);
  const h = (tag, id, cls) => { const e = document.createElement(tag); if (id) e.id = id; if (cls) e.className = cls; return e; };
  const has = (n) => !!(window.ASSETS && window.ASSETS[n]);
  const num = (v) => Math.round(v).toLocaleString('ru-RU');
  const pct = (v) => Math.round(v * 100) + '%';
  const SCOUT = (window.SCOUT = {});
  let APP, bar, box, open = true, page = 0, lastS = null, lastPhase = '', boxKey = '', barKey = '';

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
  const pic = (type) => { const n = has('en_' + type) ? 'en_' + type : 'en_knight';
    return has(n) ? `<img src="assets/${n}.png" alt=""${n === 'en_' + type ? '' : ' style="filter:sepia(1) saturate(2.2)"'}>` : ''; };

  const squadRows = (w) => w.squads.map((q) => `<div class="sq${q.boss ? ' boss' : ''}">
      <div class="who"><span class="pic">${pic(q.type)}</span><span class="nm">${q.name}</span><span class="n">×${q.count}</span></div>
      <span>${num(q.hp)}</span><span>${pct(q.armor)}</span><span>${pct(q.mres)}</span><span>${num(q.speed)}</span><span>${num(q.bounty)}</span>
      ${q.ability ? `<div class="ab">${q.ability}</div>` : ''}</div>`).join('');
  const panelHTML = (S, w, r) => {
    const k = w.n - S.wave, when = k === 1 ? 'следующая' : `через ${k - 1} ${k === 2 ? 'волну' : 'волны'}`;
    return `<div class="hd"><button class="btn nav prev${w.n <= r.from ? ' off' : ''}" title="Раньше (←)">◂</button>
      <div class="tt">ВОЛНА ${w.n}<small>${when} · ${w.n - r.from + 1} из ${r.to - r.from + 1}</small></div>
      <button class="btn nav next${w.n >= r.to ? ' off' : ''}" title="Дальше (→)">▸</button><button class="btn nav x" title="Свернуть (I)">▴</button></div>
      ${w.boss ? `<div class="bossline">☠ БОСС: ${w.bossName}</div>` : ''}
      ${w.trait ? `<div class="trait"><b>⚑ ${w.trait.name}.</b> ${w.trait.desc}<div class="mods">${modText(w.trait.mods)}</div></div>` : ''}
      <div class="grid"><div class="sq head"><div class="who">Отряд</div><span>HP</span><span>Броня</span><span>Магия</span><span>Скор.</span><span>Души</span></div>${squadRows(w)}</div>
      ${w.extra.map((x) => `<div class="extra">Из «${EN[x.from].name}» выйдут ещё ${x.count} × ${x.name} (HP ${num(x.hp)})</div>`).join('')}
      <div class="tot"><span>Всего <b>${w.total.count}</b>${w.total.extra ? ` <i>+${w.total.extra}</i>` : ''}</span><span>HP <b>${num(w.total.hp)}</b></span>
      <span>Души <b>${num(w.total.bounty)}</b> + ${num(w.bonus)} за волну</span></div>`;
  };

  const ended = (S) => S.phase === 'won' || S.phase === 'lost';
  // раскрытая панель видна только в паузе между волнами, пока её не свернули и пока не открыта панель клетки или башни
  const expanded = (S) => open && S.phase === 'prep' && !ended(S) && SIM.scoutRange(S).from <= SIM.scoutRange(S).to && !$('#panel.show');
  const toggle = (v) => { const S = APP.play; if (!S || S.phase !== 'prep') return; open = v === undefined ? !open : v; boxKey = ''; };
  const turn = (d) => { const S = APP.play; if (!S) return; const r = SIM.scoutRange(S); page = Math.max(0, Math.min(r.to - r.from, page + d)); boxKey = ''; };

  SCOUT.init = (A, cv) => {
    APP = A;
    const root = $('#ui'), before = root.querySelector('.overlay');   // под оверлеями меню, паузы и итога
    bar = h('div', 'scout', 'frame box'); box = h('div', 'scout-panel', 'frame'); bar.title = 'Разведка (I)';
    root.insertBefore(bar, before); root.insertBefore(box, before);
    bar.addEventListener('click', () => toggle());
    box.addEventListener('click', (e) => { const b = e.target.closest('.nav'); if (!b) return;
      if (b.classList.contains('x')) toggle(false); else turn(b.classList.contains('next') ? 1 : -1); });
    cv.addEventListener('pointerdown', () => { if (APP.play && APP.play.phase === 'prep') open = false; });   // поле важнее разведки
    addEventListener('keydown', (e) => { const S = APP.play; if (!S || APP.paused || e.repeat || $('.overlay.show')) return;
      if (e.code === 'KeyI') toggle();
      else if (expanded(S) && (e.code === 'ArrowLeft' || e.code === 'ArrowRight')) { turn(e.code === 'ArrowRight' ? 1 : -1); e.preventDefault(); } });
  };

  SCOUT.frame = (A) => {
    const S = A.play;
    if (!S || ended(S)) { bar.classList.remove('show'); box.classList.remove('show'); return; }
    // новая партия или новая пауза между волнами: разведка раскрывается на следующей волне
    if (S !== lastS || S.phase !== lastPhase) { if (S.phase === 'prep') { open = true; page = 0; } lastS = S; lastPhase = S.phase; boxKey = ''; barKey = ''; }
    const r = SIM.scoutRange(S), next = r.from <= r.to ? SIM.preview(S, r.from + page) : null, prep = S.phase === 'prep';
    // строка: в паузе — коротко о следующей волне, во время волны — сколько врагов осталось
    const bk = prep ? JSON.stringify([S.wave, page, next && next.n, expanded(S)]) : 'w' + S.wave + ':' + SIM.remaining(S);
    if (bk !== barKey) { barKey = bk;
      if (prep && next) { const w = SIM.preview(S, r.from);
        bar.innerHTML = `<span>ВОЛНА ${w.n}</span>${w.boss ? '<span class="bad">☠ БОСС</span>' : ''}<span>${w.total.count} ${enemyWord(w.total.count)}</span>${w.trait ? `<span class="tr">⚑ ${w.trait.name}</span>` : ''}<span class="ar">${expanded(S) ? '▴' : '▾'}</span>`; }
      else if (prep) bar.innerHTML = '<span class="k">РАЗВЕДКА</span><span>волн больше нет</span>';
      else { const n = SIM.remaining(S); bar.innerHTML = `<span class="k">ВОЛНА ${S.wave}</span><span>осталось <b>${n}</b> ${enemyWord(n)}</span>`; }
      bar.classList.toggle('live', !prep); }
    bar.classList.add('show');
    const show = !!next && expanded(S);
    box.classList.toggle('show', show);
    if (show) { const key = JSON.stringify([S.seed, S.wave, next.n]); if (key !== boxKey) { boxKey = key; box.innerHTML = panelHTML(S, next, r); } }
  };
})();
