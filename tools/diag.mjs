// node tools/diag.mjs [seed] — разумный бот по волнам: прочность, души, кто прорвался, урон каждой башни.
import { SIM, smart } from '../tests/bots.mjs';
const S = SIM.create(+process.argv[2] || 1), mem = {}; SIM.step(S, { cmds: [{ k: 'call' }, { k: 'auto', on: true }] }); let i = 0, w = 1;
const leaks = {}, every = Math.round(0.1 / S.dt);
while (S.phase === 'prep' || S.phase === 'wave') {
  const c = (i++ % every === 0) ? smart(S, mem) : null; SIM.step(S, c ? { cmds: c } : null);
  for (const e of S.enemies) if (e.d > SIM.pathLen(S) - 2) leaks[e.type] = (leaks[e.type] || 0) + 1;
  if (S.wave !== w) { const dmg = {}; for (const t of S.towers) if (t) dmg[t.type + t.cell] = Math.round(t.dmg);
    console.log('wave', w, 'hp', S.hp, 'souls', S.souls, 'leaks', JSON.stringify(leaks), 'dmg', JSON.stringify(dmg)); w = S.wave; for (const k in leaks) delete leaks[k]; }
}
console.log(S.phase, S.wave, S.hp);
