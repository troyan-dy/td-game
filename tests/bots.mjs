// Баланс-боты: играют партию headless и возвращают итог. Используются в tests/balance.test.mjs и tools/balance.mjs.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
export const SIM = require('../live/sim.js');
const C = SIM.CONFIG;

const ORDER = [[11, 'bones'], [5, 'spirits'], [6, 'plague'], [7, 'dark'], [12, 'bones'], [8, 'spirits'], [0, 'bones'], [9, 'plague'],
  [10, 'dark'], [13, 'bones'], [15, 'dark'], [4, 'bones'], [1, 'spirits'], [17, 'plague'], [14, 'dark'], [2, 'bones'], [3, 'spirits'], [16, 'plague']];
const PERK = { bones: 'volley', spirits: 'pack', plague: 'acid', dark: 'curse' };

// Разумный игрок: строит по списку узловых точек, смешивает типы, качает и берёт перки.
export const smart = (S, mem) => {
  const built = S.towers.filter(Boolean).length;
  const next = ORDER.find(([s]) => !S.towers[s]);
  const nextCost = next ? C.TOWERS[next[1]].cost[0] : Infinity;
  let up = null, upCost = Infinity;
  for (const t of S.towers) if (t) {
    const c = t.lvl < 3 ? SIM.upgradeCost(t) : (!t.perk ? C.TOWERS[t.type].perks[PERK[t.type]].cost : Infinity);
    const w = c * (t.lvl + (t.perk ? 9 : 0));                        // предпочитаем поднять самых слабых
    if (w < upCost) { upCost = w; up = { t, c }; }
  }
  const wantBuild = next && (built < 7 || nextCost <= (up ? up.c : Infinity) * 1.2 || !up);
  if (wantBuild) return S.souls >= nextCost ? [{ k: 'build', slot: next[0], type: next[1] }] : null;
  if (up && S.souls >= up.c) return [up.t.lvl < 3 ? { k: 'upgrade', slot: up.t.slot } : { k: 'perk', slot: up.t.slot, p: PERK[up.t.type] }];
  return null;
};
// Одна башня спамом: только Кости.
export const spamBones = (S) => {
  const free = ORDER.find(([s]) => !S.towers[s]);
  if (free && S.souls >= C.TOWERS.bones.cost[0]) return [{ k: 'build', slot: free[0], type: 'bones' }];
  for (const t of S.towers) if (t && t.lvl < 3 && S.souls >= SIM.upgradeCost(t)) return [{ k: 'upgrade', slot: t.slot }];
  for (const t of S.towers) if (t && !t.perk && t.lvl === 3 && S.souls >= 180) return [{ k: 'perk', slot: t.slot, p: 'volley' }];
  return null;
};
export const idle = () => null;

// Партия: первая волна по кнопке, дальше по таймеру (бот не вызывает раньше).
export const play = (bot, seed = 1, maxT = 5400) => {
  const S = SIM.create(seed), mem = {};
  SIM.step(S, { cmds: [{ k: 'call' }] });
  let i = 0;
  const waveLog = [];
  while (S.phase !== 'won' && S.phase !== 'lost' && S.t < maxT) {
    const cmds = (i++ % 12 === 0) ? bot(S, mem) : null;              // бот «кликает» 10 раз в секунду
    const w = S.wave;
    SIM.step(S, cmds ? { cmds } : null);
    if (S.wave !== w) waveLog.push({ wave: w, t: +S.t.toFixed(0), hp: S.hp, souls: S.souls });
  }
  return { phase: S.phase, wave: S.wave, hp: S.hp, t: Math.round(S.t), kills: S.stats.kills, souls: S.souls,
    towers: S.towers.filter(Boolean).map((t) => t.type[0] + t.lvl + (t.perk ? '*' : '')).join(' '), waveLog };
};
