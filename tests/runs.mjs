// tests/runs.mjs — партии баланс-ботов и их ожидаемые итоги. Единственный источник ожиданий: его читают
// tests/game.test.mjs (тест на каждую партию) и команда проверки tools/check.mjs (через tools/check/game.mjs).
// Меняешь баланс или ботов — правь ожидания только здесь.
import { play, smart, spamBones, idle } from './bots.mjs';

const IDLE = 'без обороны проигрыш к 4-й волне';
const idleOk = (r) => r.phase === 'lost' && r.wave <= 4;
const SMART = 'разумная оборона проходит минимум на 8 волн дальше бота без обороны на том же сиде';
const smartOk = (seed) => (r, all) => r.wave >= all[`idle s${seed}`].wave + 8;

// name — короткое имя для сводки; ok(r, all) — итог партии r = play(bot, seed) ожидаемый; all — итоги всех партий по имени
// (считаются по требованию: обращение к all['idle s1'] сыграет эту партию, если её ещё не было); want — что ожидается, словами.
// Моно-застройка против смеси: та же стратегия, что у разумного бота, но только Кости. Честное ожидание по факту — она
// слабее смеси на каждом сиде (дальше не проходит, а при той же волне теряет больше прочности склепа). Что Кости одни
// побеждают на большинстве сидов (теряя прочность на финальном боссе) — вопрос баланса (тикет #17), не этого ожидания.
const BONES = 'одна башня спамом слабее смеси типов на том же сиде: проходит меньше волн или теряет больше прочности склепа';
const bonesOk = (seed) => (r, all) => { const m = all[`smart s${seed}`]; return r.wave < m.wave || (r.wave === m.wave && r.hp < m.hp); };
const SEEDS = [1, 2, 3, 4, 5, 6];
export const RUNS = [
  ...SEEDS.map((seed) => ({ name: `idle s${seed}`, bot: idle, seed, want: IDLE, ok: idleOk })),
  ...SEEDS.map((seed) => ({ name: `smart s${seed}`, bot: smart, seed, want: SMART, ok: smartOk(seed) })),
  ...SEEDS.map((seed) => ({ name: `bones s${seed}`, bot: spamBones, seed, want: BONES, ok: bonesOk(seed) })),
];
export const playRun = (R) => play(R.bot, R.seed);
export const describe = (r) => `${r.phase.padEnd(4)} волна ${String(r.wave).padStart(2)} hp ${String(r.hp).padStart(2)} ${String(r.t).padStart(4)} с`;

// итоги партий с запоминанием: каждая партия играется не больше одного раза за процесс
const memo = new Map();
export const resultOf = (name) => {
  if (!memo.has(name)) { const R = RUNS.find((x) => x.name === name); if (!R) throw new Error('нет партии ' + name); memo.set(name, playRun(R)); }
  return memo.get(name);
};
export const results = Object.defineProperties({}, Object.fromEntries(RUNS.map((R) => [R.name, { enumerable: true, get: () => resultOf(R.name) }])));
