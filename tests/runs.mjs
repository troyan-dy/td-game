// tests/runs.mjs — партии баланс-ботов и их ожидаемые итоги. Единственный источник ожиданий: его читают
// tests/game.test.mjs (тест на каждую партию) и команда проверки tools/check.mjs (через tools/check/game.mjs).
// Меняешь баланс или ботов — правь ожидания только здесь.
import { play, smart, spamBones, idle } from './bots.mjs';

const smartOk = (r) => r.phase === 'won' && r.hp >= 2 && r.hp <= 14 && r.t >= 35 * 60 && r.t <= 55 * 60;
const SMART = 'победа с запасом 2–14 HP за 35–55 минут игрового времени';

// name — короткое имя для сводки; ok(r) — итог партии r = play(bot, seed) ожидаемый; want — что ожидается, словами.
export const RUNS = [
  { name: 'idle s1', bot: idle, seed: 1, want: 'без обороны проигрыш к 4-й волне', ok: (r) => r.phase === 'lost' && r.wave <= 4 },
  { name: 'smart s1', bot: smart, seed: 1, want: SMART, ok: smartOk },
  { name: 'smart s2', bot: smart, seed: 2, want: SMART, ok: smartOk },
  { name: 'smart s3', bot: smart, seed: 3, want: SMART, ok: smartOk },
  { name: 'bones s1', bot: spamBones, seed: 1, want: 'одна башня спамом проигрывает между 12 и 23 волной', ok: (r) => r.phase === 'lost' && r.wave >= 12 && r.wave <= 23 },
];
export const playRun = (R) => play(R.bot, R.seed);
export const describe = (r) => `${r.phase.padEnd(4)} волна ${String(r.wave).padStart(2)} hp ${String(r.hp).padStart(2)} ${String(r.t).padStart(4)} с`;
