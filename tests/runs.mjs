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
// Моно-застройка против смеси: та же стратегия, что у разумного бота, но только Кости. Ожидание — по набору сидов в
// целом: смесь типов в сумме проходит больше волн, а при равенстве теряет меньше прочности склепа. На отдельном сиде
// бывает наоборот (у разумного бота своя слабость: сначала застроить 18 клеток, на сиде 9 он проигрывает на 9-й волне).
// Что Кости одни побеждают на большинстве сидов, — вопрос баланса (тикет #17), не этого ожидания.
const BONES = 'одна башня спамом в сумме по сидам 1–6 слабее смеси типов: меньше волн или, при равных волнах, больше потерь прочности';
const total = (all, bot) => SEEDS.reduce((a, s) => { const r = all[`${bot} s${s}`]; return { wave: a.wave + r.wave, hp: a.hp + r.hp }; }, { wave: 0, hp: 0 });
const bonesOk = () => (r, all) => { const m = total(all, 'smart'), b = total(all, 'bones'); return b.wave < m.wave || (b.wave === m.wave && b.hp < m.hp); };
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
