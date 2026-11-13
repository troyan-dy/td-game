// tests/runs.mjs — партии баланс-ботов и их ожидаемые итоги: быстрая проверка баланса на трёх сидах (шаг 1/30, открыто
// как у нового профиля). Единственный источник ожиданий: его читают tests/game.test.mjs (тест на каждую партию) и команда
// проверки tools/check.mjs (через tools/check/game.mjs). Полный прогон по многим сидам — вручную: node tools/balance.mjs.
// Ожидания — по набору сидов, а не по одной партии: числа баланса двигаются, и один сид может перевалить через край.
// Сиды подобраны с запасом: на них сильный бот побеждает с большой прочностью склепа, разумный — проходит далеко.
import { play, smart, grim, random, idle, NEW_PROFILE, SIM } from './bots.mjs';
const C = SIM.CONFIG;

const SEEDS = [4, 5, 12];   // по полному прогону: разумный бот побеждает на 4 и 12, на 5 падает на 19-й; сильный везде побеждает и живёт в бесконечном режиме 15 волн
// Без обороны пропускается каждый враг: склеп падает ровно на той волне, где пропуски по превью волн набирают его прочность.
// Ожидаемая волна считается по превью (оно же проверяет, что превью не врёт о числе врагов), и это должна быть первая четверть забега.
const idleLoss = (seed) => { let leak = 0; for (let n = 1; ; n++) { leak += SIM.WAVEGEN.wave(seed, n).total.leak; if (leak >= C.CRYPT_HP) return n; } };
const IDLE = 'без обороны проигрыш в первые волны: на той, где пропуски по превью добивают склеп';
const idleOk = (seed) => (r) => r.phase === 'lost' && r.wave === idleLoss(seed) && r.wave <= SIM.waveCount() / 4;
const all3 = (all, bot) => SEEDS.map((s) => all[`${bot} s${s}`]);
const wins = (all, bot) => all3(all, bot).filter((r) => r.phase === 'won').length;
// Разумный бот без Гримуара и слияний: забег проходим, но не тривиален — дальше середины забега на каждом сиде.
const SMART = 'разумная оборона без Гримуара проходит дальше середины забега на каждом из трёх сидов';
const smartOk = () => (r) => r.phase === 'won' || r.wave > SIM.waveCount() / 2;
// Сильный бот (Гримуар и слияния) побеждает хотя бы на двух сидах из трёх и не хуже разумного ни на одном.
const GRIM = 'оборона с Гримуаром и слияниями побеждает на двух сидах из трёх и проходит не меньше волн, чем без них';
const grimOk = (seed) => (r, all) => wins(all, 'grim') >= 2 && r.wave >= all[`smart s${seed}`].wave;
// Случайная игра не побеждает ни разу и проигрывает раньше разумной.
const RANDOM = 'случайная постройка и прокачка не побеждают и проходят меньше волн, чем разумная оборона';
const randomOk = (seed) => (r, all) => r.phase === 'lost' && r.wave < all[`smart s${seed}`].wave;

// name — короткое имя для сводки; ok(r, all) — итог партии r = play(bot, seed) ожидаемый; all — итоги всех партий по имени
// (считаются по требованию: обращение к all['idle s2'] сыграет эту партию, если её ещё не было); want — что ожидается, словами.
export const RUNS = [
  ...SEEDS.map((seed) => ({ name: `idle s${seed}`, bot: idle, seed, want: IDLE, ok: idleOk(seed) })),
  ...SEEDS.map((seed) => ({ name: `smart s${seed}`, bot: smart, seed, want: SMART, ok: smartOk(seed) })),
  ...SEEDS.map((seed) => ({ name: `grim s${seed}`, bot: grim, seed, want: GRIM, ok: grimOk(seed) })),
  ...SEEDS.map((seed) => ({ name: `random s${seed}`, bot: random, seed, want: RANDOM, ok: randomOk(seed) })),
];
// крупный шаг: партии ботов быстрее; открыто — как у нового профиля (первый забег человека)
export const playRun = (R) => play(R.bot, R.seed, undefined, 1 / 30, { unlocked: NEW_PROFILE });
export const describe = (r) => `${r.phase.padEnd(4)} волна ${String(r.wave).padStart(2)} hp ${String(r.hp).padStart(2)} ${String(r.t).padStart(4)} с`;

// итоги партий с запоминанием: каждая партия играется не больше одного раза за процесс
const memo = new Map();
export const resultOf = (name) => {
  if (!memo.has(name)) { const R = RUNS.find((x) => x.name === name); if (!R) throw new Error('нет партии ' + name); memo.set(name, playRun(R)); }
  return memo.get(name);
};
export const results = Object.defineProperties({}, Object.fromEntries(RUNS.map((R) => [R.name, { enumerable: true, get: () => resultOf(R.name) }])));
