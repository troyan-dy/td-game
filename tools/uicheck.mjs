// tools/uicheck.mjs [url] — headless-проверка DOM-интерфейса на худших значениях:
// текст не вылезает из своих блоков, панели не выходят за экран, нет ошибок страницы. Exit 2 при дефектах.
// Скриншоты: frames/ui/*.png
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT);
const url = process.argv[2] || 'http://127.0.0.1:8930/live/index.html';
const PERK1 = { bones: 'pierce', spirits: 'frost', plague: 'pestilence', dark: 'harvest' };
fs.mkdirSync('frames/ui', { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist'] });
const bad = [], errors = [];
for (const vw of [1280, 1920]) {
  const p = await browser.newPage({ viewport: { width: vw, height: Math.round(vw * 9 / 16) } });
  p.on('pageerror', (e) => errors.push(String(e))); p.on('console', (m) => { if (m.type() === 'error' && !/favicon/.test(m.text())) errors.push(m.text()); });
  await p.goto(url); await p.evaluate(() => { localStorage.clear(); sessionStorage.clear(); }); await p.reload();
  await p.waitForFunction(() => window.__ready && window.UI);
  const check = async (name) => {
    await p.waitForTimeout(150);
    const r = await p.evaluate(() => {
      const out = [], ui = document.getElementById('ui').getBoundingClientRect();
      for (const el of document.querySelectorAll('#ui *')) {
        const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden' || !el.offsetParent) continue;
        const b = el.getBoundingClientRect(); if (!b.width) continue;
        if (el.scrollWidth > el.clientWidth + 2 && cs.overflow !== 'visible' && el.clientWidth) out.push('overflow-x ' + (el.id || el.className) + ' ' + el.textContent.slice(0, 30));
        if (el.children.length === 0 && el.textContent.trim()) {             // текстовый лист: внутри родительской рамки
          const par = el.closest('.frame,.btn,.card'); if (par) { const pb = par.getBoundingClientRect();
            if (b.right > pb.right + 1 || b.left < pb.left - 1 || b.bottom > pb.bottom + 1 || b.top < pb.top - 1) out.push('text-out ' + (par.id || par.className) + ': ' + el.textContent.trim().slice(0, 30)); }
        }
        if (el.matches('.frame,.btn,.card') && (b.right > ui.right + 1 || b.left < ui.left - 1 || b.bottom > ui.bottom + 1 || b.top < ui.top - 1)) out.push('offscreen ' + (el.id || el.className));
      }
      return out;
    });
    for (const x of r) bad.push(`${vw} ${name}: ${x}`);
    await p.screenshot({ path: `frames/ui/${vw}_${name}.png` });
  };
  await check('menu');
  await p.evaluate(() => { document.getElementById('m-help').click(); }); await check('menu_help');
  await p.evaluate(() => { document.getElementById('m-new').click(); APP.play.souls = 99999; APP.play.hp = 20; APP.play.wave = 24; APP.play.phase = 'prep'; APP.play.prepT = 9.4; APP.paused = false; });
  await check('hud');
  const types = SIMTYPES();
  for (const [i, t] of types.entries()) for (const lvl of [1, 3]) {
    await p.evaluate(([slot, t, lvl, perk]) => { const S = APP.play; S.towers[slot] = null; APP.cmd({ k: 'build', slot, type: t }); }, [5 + i, t, lvl]);
    await p.waitForTimeout(60);
    await p.evaluate(([slot, lvl, perk]) => { for (let l = 1; l < lvl; l++) APP.cmd({ k: 'upgrade', slot }); if (perk) APP.cmd({ k: 'perk', slot, p: perk }); SCENE.ui.sel = slot; }, [5 + i, lvl, lvl === 3 ? PERK1[t] : null]);
    await check(`panel_${t}_${lvl}`);
  }
  await p.evaluate(() => { SCENE.ui.sel = 0; }); await check('panel_empty');
  await p.evaluate(() => { SCENE.ui.sel = -1; document.querySelector('.card').dispatchEvent(new PointerEvent('pointerover', { bubbles: true })); }); await check('cardtip');
  await p.evaluate(() => { APP.play.ev.push({ k: 'newEnemy', type: 'paladin', t: APP.play.t }); }); await check('newenemy');
  await p.keyboard.press('Enter');
  await p.evaluate(() => { APP.play.ev.push({ k: 'boss', name: 'Паладин-командор', t: APP.play.t, x: 1, y: 1 }, { k: 'wave', wave: 25, boss: true, t: APP.play.t + 0.001 }); }); await check('toasts');
  await p.keyboard.press('Space'); await check('pause'); await p.keyboard.press('Space');
  await p.evaluate(() => { APP.play.stats.time = 3599; APP.play.stats.kills = 99999; APP.play.stats.earned = 999999; APP.play.phase = 'won'; }); await p.waitForTimeout(1200); await check('end_won');
  await p.close();
}
await browser.close();
function SIMTYPES() { return ['bones', 'spirits', 'plague', 'dark']; }
console.log(JSON.stringify({ errors, bad }, null, 1));
process.exit(errors.length || bad.length ? 2 : 0);
