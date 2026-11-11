// node tools/balance.mjs — прогон баланс-ботов по нескольким seed, сводка по волнам.
import { play, smart, spamBones, idle } from '../tests/bots.mjs';
const seeds = [1, 2, 3];
for (const [n, b] of [['idle', idle], ['smart', smart], ['bones', spamBones]]) {
  for (const sd of (n === 'idle' ? [1] : seeds)) { const r = play(b, sd);
    console.log(`${n.padEnd(6)} seed${sd} ${r.phase.padEnd(4)} wave ${String(r.wave).padStart(2)} hp ${String(r.hp).padStart(2)} t ${r.t}s kills ${r.kills} | ${r.towers}`);
    if (n === 'smart' && sd === 1) console.log('   ' + r.waveLog.map((w) => w.wave + ':' + w.hp + '/' + w.souls).join(' ')); }
}
