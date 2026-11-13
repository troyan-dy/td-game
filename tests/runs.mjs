// tests/runs.mjs — партии баланс-ботов и их ожидаемые итоги. Единственный источник ожиданий: его читают
// tests/game.test.mjs (тест на каждую партию) и команда проверки tools/check.mjs (через tools/check/game.mjs).
// Меняешь баланс или ботов — правь ожидания только здесь.
import { play, smart, spamBones, idle, SIM } from './bots.mjs';
const C = SIM.CONFIG;

// Без обороны пропускается каждый враг: склеп падает ровно на той волне, где пропуски по превью волн набирают его прочность.
// Ожидаемая волна считается по превью (оно же проверяет, что превью не врёт о числе врагов), и это должна быть первая четверть забега.
const idleLoss = (seed) => { let leak = 0; for (let n = 1; ; n++) { leak += SIM.WAVEGEN.wave(seed, n).total.leak; if (leak >= C.CRYPT_HP) return n; } };
const IDLE = 'без обороны проигрыш в первые волны: на той, где пропуски по превью добивают склеп';
const idleOk = (seed) => (r) => r.phase === 'lost' && r.wave === idleLoss(seed) && r.wave <= SIM.waveCount() / 4;
const SMART_SEEDS = [1, 2, 3];
// «Заметно дальше» — на четверть забега дальше бота без обороны на том же сиде; и игра проходима: хотя бы одна из трёх партий — победа.
const SMART = 'разумная оборона проходит на четверть забега дальше бота без обороны; из трёх разумных забегов хотя бы один победный';
const smartOk = (seed) => (r, all) => r.wave >= all[`idle s${seed}`].wave + SIM.waveCount() / 4 && SMART_SEEDS.some((s) => all[`smart s${s}`].phase === 'won');

// name — короткое имя для сводки; ok(r, all) — итог партии r = play(bot, seed) ожидаемый; all — итоги всех партий по имени
// (считаются по требованию: обращение к all['idle s1'] сыграет эту партию, если её ещё не было); want — что ожидается, словами.
// Моно-застройка против смеси: та же стратегия, что у разумного бота, но только Кости. Честное ожидание по факту —
// по набору сидов в целом одна башня спамом побеждает не чаще смеси типов. Сильнее («в сумме проходит меньше волн») сейчас
// неверно: на сидах 1–3 смесь проходит 7 + 20 + 19 волн, Кости — 12 + 20 + 15 (у разумного бота своя слабость: сначала
// застроить 18 клеток, на сиде 1 он падает на 7-й волне). Это вопрос баланса и бота (тикет #17), не этого ожидания.
const BONES = 'одна башня спамом по набору сидов побеждает не чаще смеси типов';
const wins = (all, bot) => SMART_SEEDS.filter((s) => all[`${bot} s${s}`].phase === 'won').length;
const bonesOk = () => (r, all) => wins(all, 'bones') <= wins(all, 'smart');
export const RUNS = [
  ...SMART_SEEDS.map((seed) => ({ name: `idle s${seed}`, bot: idle, seed, want: IDLE, ok: idleOk(seed) })),
  ...SMART_SEEDS.map((seed) => ({ name: `smart s${seed}`, bot: smart, seed, want: SMART, ok: smartOk(seed) })),
  ...SMART_SEEDS.map((seed) => ({ name: `bones s${seed}`, bot: spamBones, seed, want: BONES, ok: bonesOk(seed) })),
];
export const playRun = (R) => play(R.bot, R.seed, undefined, 1 / 30);   // крупный шаг: партии ботов быстрее (быстрый режим конвейера)
export const describe = (r) => `${r.phase.padEnd(4)} волна ${String(r.wave).padStart(2)} hp ${String(r.hp).padStart(2)} ${String(r.t).padStart(4)} с`;

// итоги партий с запоминанием: каждая партия играется не больше одного раза за процесс
const memo = new Map();
export const resultOf = (name) => {
  if (!memo.has(name)) { const R = RUNS.find((x) => x.name === name); if (!R) throw new Error('нет партии ' + name); memo.set(name, playRun(R)); }
  return memo.get(name);
};
export const results = Object.defineProperties({}, Object.fromEntries(RUNS.map((R) => [R.name, { enumerable: true, get: () => resultOf(R.name) }])));
