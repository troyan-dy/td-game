// Баланс-боты: играют партию headless на сгенерированной карте и возвращают итог. Используются в tests/runs.mjs (ожидания), тестах и tools/balance.mjs.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
export const SIM = require('../live/sim.js');
const C = SIM.CONFIG;

const MIX = ['bones', 'spirits', 'plague', 'dark'];
const PERK = { bones: 'volley', spirits: 'pack', plague: 'acid', dark: 'curse', bell: 'drone', altar: 'offering',
  barracks: 'grip' };
// лучшие клетки под оборону: по покрытию дороги (запоминаются на партию)
const plan = (S, mem, n) => mem.plan || (mem.plan = SIM.rankCells(S, C.TYPICAL_RANGE).slice(0, n));

// Следующая покупка в башне t: перк, когда он открыт (ступеней хватает), иначе ступень ветки — урон и скорость охотнее,
// чем дальность. { cmd, cost } или null, если качать некуда. Цены и запреты — из ответов логики (canPerk, canUpgrade).
const WEIGHT = { dmg: 1, rate: 1.2, range: 1.8 };
const nextUp = (S, t, perk) => {
  if (SIM.freeSlots(t)) { const cp = SIM.canPerk(S, t.cell, perk); if (cp.ok || cp.reason === 'souls') return { cmd: { k: 'perk', cell: t.cell, p: perk }, cost: cp.cost }; }
  let best = null;
  for (const track of C.TRACKS) { const cu = SIM.canUpgrade(S, t.cell, track); if (cu.cost === null) continue;
    const w = (t.tracks[track] + 1) * WEIGHT[track]; if (!best || w < best.w) best = { w, cmd: { k: 'upgrade', cell: t.cell, track }, cost: cu.cost }; }
  return best;
};

// Игрок по плану: строит на клетках с лучшим покрытием дороги типы из mix по кругу, качает ветки и берёт перки.
// Новую башню ставит, пока их меньше 7 или пока она дороже ступени не больше чем в BUILD_VS_STEP раз.
const BUILD_VS_STEP = 3;
// perks — какой перк берёт каждый тип (по умолчанию PERK)
// на экране выбора реликвии любой бот берёт первую предложенную (иначе забег стоит)
const RELIC = [{ k: 'relic', i: 0 }];
export const planned = (mix, perks = PERK) => (S, mem) => {
  if (S.phase === 'relic') return RELIC;
  const cells = plan(S, mem, 18), built = S.towers.filter(Boolean).length;
  const k = cells.findIndex((c) => !S.towers[c]), next = k >= 0 ? [cells[k], mix[k % mix.length]] : null;
  const nextCost = next ? SIM.canBuild(S, next[0], next[1]).cost : Infinity;
  let up = null, upW = Infinity;
  for (const t of S.towers) if (t) {
    const u = nextUp(S, t, perks[t.type]); if (!u) continue;
    const w = u.cost * (1 + SIM.steps(t) / 4);                       // предпочитаем поднять самых слабых
    if (w < upW) { upW = w; up = u; }
  }
  const wantBuild = next && (built < 7 || nextCost <= (up ? up.cost : Infinity) * BUILD_VS_STEP || !up);
  if (wantBuild) return S.souls >= nextCost ? [{ k: 'build', cell: next[0], type: next[1] }] : null;
  if (up && S.souls >= up.cost) return [up.cmd];
  return null;
};
// Разумный игрок: смешивает все четыре типа.
export const smart = planned(MIX);
// Одна башня спамом: та же стратегия, но только Кости.
export const spamBones = planned(['bones']);
export const idle = (S) => (S.phase === 'relic' ? RELIC : null);

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
    towers: S.towers.filter(Boolean).map((t) => t.type[0] + SIM.steps(t) + '*'.repeat(SIM.perksOf(t).length)).join(' '), waveLog };
};
