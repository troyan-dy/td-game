// Баланс-боты: играют партию headless на сгенерированной карте и возвращают итог. Используются в tests/runs.mjs (ожидания), тестах и tools/balance.mjs.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
export const SIM = require('../live/sim.js');
const C = SIM.CONFIG;

const MIX = ['bones', 'spirits', 'plague', 'dark'];
const PERK = { bones: 'volley', spirits: 'pack', plague: 'acid', dark: 'curse' };
// лучшие клетки под оборону: по покрытию дороги (запоминаются на партию)
const plan = (S, mem, n) => mem.plan || (mem.plan = SIM.rankCells(S, 3.4).slice(0, n));

// Разумный игрок: строит на клетках с лучшим покрытием дороги, смешивает типы, качает и берёт перки.
export const smart = (S, mem) => {
  const cells = plan(S, mem, 18), built = S.towers.filter(Boolean).length;
  const k = cells.findIndex((c) => !S.towers[c]), next = k >= 0 ? [cells[k], MIX[k % MIX.length]] : null;
  const nextCost = next ? C.TOWERS[next[1]].cost[0] : Infinity;
  let up = null, upCost = Infinity;
  for (const t of S.towers) if (t) {
    const c = t.lvl < 3 ? SIM.upgradeCost(t) : (!t.perk ? C.TOWERS[t.type].perks[PERK[t.type]].cost : Infinity);
    const w = c * (t.lvl + (t.perk ? 9 : 0));                        // предпочитаем поднять самых слабых
    if (w < upCost) { upCost = w; up = { t, c }; }
  }
  const wantBuild = next && (built < 7 || nextCost <= (up ? up.c : Infinity) * 1.2 || !up);
  if (wantBuild) return S.souls >= nextCost ? [{ k: 'build', cell: next[0], type: next[1] }] : null;
  if (up && S.souls >= up.c) return [up.t.lvl < 3 ? { k: 'upgrade', cell: up.t.cell } : { k: 'perk', cell: up.t.cell, p: PERK[up.t.type] }];
  return null;
};
// Одна башня спамом: только Кости.
export const spamBones = (S, mem) => {
  const free = plan(S, mem, 18).find((c) => !S.towers[c]);
  if (free !== undefined && S.souls >= C.TOWERS.bones.cost[0]) return [{ k: 'build', cell: free, type: 'bones' }];
  for (const t of S.towers) if (t && t.lvl < 3 && S.souls >= SIM.upgradeCost(t)) return [{ k: 'upgrade', cell: t.cell }];
  for (const t of S.towers) if (t && !t.perk && t.lvl === 3 && S.souls >= 180) return [{ k: 'perk', cell: t.cell, p: 'volley' }];
  return null;
};
export const idle = () => null;

// Партия: первая волна по кнопке, дальше по таймеру (бот не вызывает раньше). dt — шаг времени забега.
export const play = (bot, seed = 1, maxT = 5400, dt) => {
  const S = SIM.create(seed, { dt }), mem = {};
  SIM.step(S, { cmds: [{ k: 'call' }] });
  let i = 0;
  const waveLog = [], every = Math.max(1, Math.round(0.1 / S.dt));
  while (S.phase !== 'won' && S.phase !== 'lost' && S.t < maxT) {
    const cmds = (i++ % every === 0) ? bot(S, mem) : null;          // бот «кликает» 10 раз в секунду
    const w = S.wave;
    SIM.step(S, cmds ? { cmds } : null);
    if (S.wave !== w) waveLog.push({ wave: w, t: +S.t.toFixed(0), hp: S.hp, souls: S.souls });
  }
  return { phase: S.phase, wave: S.wave, hp: S.hp, t: Math.round(S.t), kills: S.stats.kills, souls: S.souls,
    towers: S.towers.filter(Boolean).map((t) => t.type[0] + t.lvl + (t.perk ? '*' : '')).join(' '), waveLog };
};
