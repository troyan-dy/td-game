import { SIM, smart } from '../tests/bots.mjs';
const S = SIM.create(1); SIM.step(S, { cmds: [{ k: 'call' }] }); let i = 0, w = 1;
const leaks = {}, seenEv = new Set();
while (S.phase === 'prep' || S.phase === 'wave') {
  const c = (i++ % 12 === 0) ? smart(S, {}) : null; SIM.step(S, c ? { cmds: c } : null);
  for (const e of S.ev) if (e.k === 'leak' && !seenEv.has(e)) { seenEv.add(e); }
  for (const e of S.enemies) if (e.d > SIM.PATH_LEN - 2) leaks[e.type] = (leaks[e.type] || 0) + 1;
  if (S.wave !== w) { const dmg = {}; for (const t of S.towers) if (t) dmg[t.type + t.slot] = Math.round(t.dmg);
    console.log('wave', w, 'hp', S.hp, 'souls', S.souls, 'leaks', JSON.stringify(leaks), 'dmg', JSON.stringify(dmg)); w = S.wave; for (const k in leaks) delete leaks[k]; }
}
console.log(S.phase, S.wave, S.hp);
