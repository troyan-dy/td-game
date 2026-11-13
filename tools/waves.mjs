// node tools/waves.mjs [сидов] [волны через запятую] — сводка генератора волн без симуляции (для подгонки чисел, тикет баланса):
// по каждой волне — число врагов (с теми, кто выйдет из убитых), длительность выхода, суммарные HP: среднее, разброс между
// сидами (макс/мин), доля волн, упёршихся в предел числа врагов; по забегу — доля пар «следующая волна слабее предыдущей»
// (по суммарным HP), доля волн из одного отряда и состав из одного типа. Цены угрозы и предел — в live/config.js.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const C = require('../live/config.js'), W = require('../live/wavegen.js');
const N = +process.argv[2] || 200;
const LIST = (process.argv[3] || '1,5,10,15,20,30,50,100,500').split(',').map(Number);
const seeds = Array.from({ length: N }, (_, i) => i + 1);
const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const fmt = (v) => Math.round(v).toLocaleString('ru-RU');

console.log(`сидов ${N}; предел: ${C.WAVEGEN.maxEnemies} врагов, ${C.WAVEGEN.maxDuration} с`);
console.log('волна | врагов: ср (мин–макс) | длит., с: ср (макс) | HP: ср | HP макс/мин | в пределе');
for (const n of LIST) {
  const ws = seeds.map((s) => W.wave(s, n)), cnt = ws.map((w) => w.total.count + w.total.extra), hp = ws.map((w) => w.total.hp), d = ws.map((w) => w.duration);
  console.log(`${String(n).padStart(5)} | ${fmt(avg(cnt))} (${Math.min(...cnt)}–${Math.max(...cnt)}) | ${avg(d).toFixed(0)} (${Math.max(...d).toFixed(0)}) | ${fmt(avg(hp))} | ` +
    `${(Math.max(...hp) / Math.min(...hp)).toFixed(2)} | ${Math.round(100 * ws.filter((w) => w.power > 1).length / N)}%`);
}
let weaker = 0, pairs = 0, single = 0, mono = 0, all = 0;
for (const s of seeds) {
  let prev = null;
  for (let n = 1; n <= C.RUN_WAVES; n++) {
    const w = W.wave(s, n), nb = w.squads.filter((q) => !q.boss), avail = Object.keys(C.ENEMIES).filter((k) => !C.ENEMIES[k].boss && C.ENEMIES[k].minWave <= n).length;
    if (prev && !w.boss && !prev.boss) { pairs++; if (w.total.hp < prev.total.hp) weaker++; }
    if (avail >= 2) { all++; if (nb.length === 1) single++; }
    prev = w;
  }
}
console.log(`забег из ${C.RUN_WAVES} волн: следующая слабее предыдущей (по суммарным HP, без боссов) в ${(100 * weaker / pairs).toFixed(1)}% пар; ` +
  `волн из одного отряда ${(100 * single / all).toFixed(1)}% (где доступно больше одного типа)`);
