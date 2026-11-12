// node tools/balance.mjs [n] — прогон баланс-ботов по сидам забега 1..n (по умолчанию 5), сводка по волнам.
import { SIM, play, smart, spamBones, idle } from '../tests/bots.mjs';
const n = +process.argv[2] || 5, seeds = Array.from({ length: n }, (_, i) => i + 1);
for (const [name, b] of [['idle', idle], ['smart', smart], ['bones', spamBones]]) {
  for (const sd of (name === 'idle' ? [1] : seeds)) { const r = play(b, sd), len = Math.round(SIM.pathLen(SIM.create(sd)));
    console.log(`${name.padEnd(6)} seed${String(sd).padEnd(3)} road ${len}px ${r.phase.padEnd(4)} wave ${String(r.wave).padStart(2)} hp ${String(r.hp).padStart(2)} t ${r.t}s kills ${r.kills} | ${r.towers}`);
    if (name === 'smart' && sd === 1) console.log('   ' + r.waveLog.map((w) => w.wave + ':' + w.hp + '/' + w.souls).join(' ')); }
}
