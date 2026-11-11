import { SIM, play, smart, spamBones } from '../tests/bots.mjs';
const C = SIM.CONFIG;
for (const h of [0.08, 0.085, 0.09]) for (const b of [0.04, 0.05, 0.06]) {
  C.HP_MULT = (w) => 1 + h * (w - 1); C.BOUNTY_MULT = (w) => 1 + b * (w - 1);
  const r = play(smart, 1), q = play(spamBones, 1);
  const max = r.waveLog.findIndex((x) => x.souls > 1500);
  console.log(`hp ${h} bounty ${b}: smart ${r.phase} w${r.wave} hp${r.hp} t${r.t} (souls>1500 at wave ${max < 0 ? '-' : r.waveLog[max].wave}) | bones ${q.phase} w${q.wave}`);
}
