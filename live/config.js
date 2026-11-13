// live/config.js — весь баланс и данные уровня «Некрополис». Меняй числа здесь, логика их только читает.
// Координаты в логическом пространстве карты 1600×900. UNIT (48 px) — единица радиусов башен, клетка сетки — GRID.tile (64 px).
(function () {
  // цены ступеней ветки: первая цена × TRACK_COST[i], с округлением до 5 душ. Ступеней с ценой восемь: обычная башня
  // упирается в свой потолок (TRACK_MAX), гибрид качается дальше; цен 6–8 у обычной башни просто не бывает в ходу
  const TRACK_COST = [1, 1.5, 2.1, 2.9, 3.9, 5.2, 6.8, 8.8];
  // ветка: cost — цены ступеней 1..n, k — прибавка основной характеристики за ступень в долях базы, also — прибавка
  // дополнительных характеристик типа за ступень этой ветки (например, замедление Духов растёт со ступенями урона)
  const track = (first, k, also) => Object.assign({ cost: TRACK_COST.map((m) => Math.round(first * m / 5) * 5), k }, also ? { also } : null);
  const C = {
    VERSION: 3,
    UNIT: 48,
    DT: 1 / 120,                   // шаг симуляции по умолчанию; забег может задать свой (create(seed, { dt }))
    DT_MAX: 0.1,                   // самый крупный шаг, с которым сохранённый забег считается годным (SIM.loadable)
    DT_MIN: 1 / 1000,              // самый мелкий шаг, с которым сохранённый забег считается годным: проба сейва не длиннее SAVE_TRIAL / DT_MIN шагов
    SAVE_NUM_MAX: 1e10,            // любое число в сохранённом забеге по модулю не больше (сид и состояние случайности — 32 бита)
    SAVE_TRIAL: 2,                 // секунд игры, которые SIM.loadable проживает на копии сейва: годен, только если логика не споткнулась
    SEED: { max: 4294967295,       // сид забега — целое 0..max (32 бита): столько вводится на титульном экране
      random: 999999 },            // новый забег без введённого сида получает случайный сид 1..random
    START_SOULS: 250,
    CRYPT_HP: 20,
    SELL_REFUND: 0.7,
    PREP_TIME: 15,                 // секунд между волнами (кроме первой: она стартует по кнопке)
    WAVE_BONUS: (w) => 30 + 8 * w, // души за зачистку волны w (1..25)
    HP_MULT: (w) => 1 + 0.085 * (w - 1),
    BOUNTY_MULT: (w) => 1 + 0.04 * (w - 1),
    ROAD_HALF: 27,                 // полуширина нарисованной дороги, px

    // Карта: клетчатое поле, клетка адресуется индексом i = y * cols + x. Дорогу строит live/mapgen.js от сида забега.
    GRID: { cols: 25, rows: 14, tile: 64 },
    MAP: {
      roadMin: 45, roadMax: 70,      // длина дороги в клетках (от входа до склепа включительно)
      minTurns: 8,                   // поворотов не меньше
      targetMin: 50, targetMax: 64,  // к какой длине генератор стремится в попытке
      gateCryptMin: 8,               // вход и склеп не ближе, клеток по прямой
      cryptEdge: 2,                  // склеп не ближе к краю поля, клеток
      cornerR: 20,                   // радиус скругления углов маршрута врагов, px
      attempts: 400,                 // попыток с производным сидом, прежде чем сдаться
      candidates: 12,                // из скольких годных дорог выбирать лучшую по оценке
      // характер дороги выбирается от сида: веса длин прямых отрезков (в шагах между поворотами) [длина, вес]
      styles: [
        { name: 'серпантин', segs: [[2, 1], [3, 3], [4, 4], [5, 4], [6, 3], [7, 2]] },
        { name: 'тракт', segs: [[2, 0.5], [3, 1.5], [4, 2], [5, 2], [6, 1.5], [8, 2], [9, 2.5], [10, 2.5], [11, 2], [12, 1.5]] },
        { name: 'смешанный', segs: [[2, 1], [3, 3], [4, 3], [5, 3], [6, 2], [7, 2], [8, 2], [9, 1.5], [10, 1]] },
      ],
      // оценка кандидата: охват поля (клетки в пределах двух от дороги) минус штрафы
      score: { nearUi: 15, emptyFrom: 5, empty: 60 },   // клетка дороги вплотную к интерфейсу; пустой квадрат больше emptyFrom — за каждую клетку стороны
      // где дорога не проходит: под HUD (верхняя строка), под кнопкой волны (слева) и под карточками башен (низ слева). [x, y, w, h] в клетках
      // по краю поля дорога тоже не идёт (кроме клетки входа): половина радиуса башен ушла бы за экран
      keepout: [[0, 0, 25, 1], [0, 2, 4, 2], [0, 12, 8, 2]],
    },

    // Прокачка башни: три ветки, у каждой ступени 0..tw.cap (у обычной башни потолок TRACK_MAX, гибрид качается дальше —
    // потолок хранится в башне). Перк — один из трёх на тип, когда во все ветки вложено PERK_AT ступеней.
    TRACKS: ['dmg', 'range', 'rate'],
    TRACK_MAX: 5,
    PERK_AT: 6,
    LOOK_AT: [5, 10],              // с какой суммы ступеней башня выглядит на 2-й и 3-й вид (спрайт, высота, точка выстрела)
    PERK_SLOTS: 1,                 // слотов под перк у обычной башни (у гибрида больше)
    VIEW_TOP: 56,                  // выше этой линии (низ плашек HUD) башня не рисуется: высокие башни верхнего ряда ужимаются

    // Башни — данные; новый тип добавляется записью здесь (код ветвится по виду атаки, а не по имени типа).
    //   base     — значения без прокачки: cost — постройка, dmg — урон за попадание (у облака — яд в секунду),
    //              rate — секунд между выстрелами, range — радиус в единицах UNIT
    //   tracks   — ветки dmg | range | rate: track(первая цена, k, also). Урон и радиус растут на k за ступень,
    //              скорострельность тоже: интервал делится на 1 + k·ступени
    //   attack   — вид атаки, обработчик в live/sim.js (ATTACKS): 'bolt' | 'ghost' | 'blob' | 'beam'; нет поля — башня не стреляет
    //   extra    — дополнительные характеристики типа (скорость снаряда, замедление, облако…): попадают в SIM.towerStats
    //   muzzle   — высота точки выстрела над центром клетки, px (у вида 1; каждый следующий вид — на LOOK_MUZZLE выше)
    //   names    — подписи веток, если не как в TRACK_NAMES; fmt — формат значения ветки (шаблон SIM.fill), если не как в
    //              TRACK_FMT; show — строки панели для extra: [подпись, шаблон SIM.fill]
    //   art      — внешний вид (недостающее — из ART): sprite — чей набор спрайтов tw_<sprite>_<вид> брать, tint — перекраска
    //              [r, g, b, сила] на холсте, css — то же в DOM (CSS filter), color — цвет свечения и круга радиуса (линейный
    //              0..1), ui — цвет заглушки в DOM, fx — живые детали сцены (orbs | fumes | crown), sound — звук выстрела,
    //              flip — поворачивать спрайт к цели. Новый тип — перекраска существующего: { sprite: 'dark', tint: [...] }
    //   perks    — id (уникальны среди всех типов: гибрид хранит перки обоих типов) → { name, cost, desc (шаблон SIM.fill),
    //              set | add | mul — что перк делает с характеристиками башни (ставит, прибавляет, умножает) }.
    //              Правило: характеристику, которая растёт от веток (dmg, range, rate и всё, что в also), перк меняет только
    //              через add или mul — set затёр бы рост от ступеней. set — для своих параметров перка (pen, bolts, …).
    TOWERS: {
      bones: {
        name: 'КОСТИ', short: 'БАЛЛИСТА', title: 'Костяная баллиста', dmgType: 'phys', attack: 'bolt', muzzle: 58,
        art: { sprite: 'bones', color: [0.90, 0.85, 0.72], ui: '#e6d9b8', sound: 'bones', flip: true },
        base: { cost: 100, dmg: 24, rate: 1.0, range: 3.6 },
        tracks: { dmg: track(45, 0.35), range: track(35, 0.08), rate: track(40, 0.12) },
        extra: { speed: 900 },
        desc: 'Дальний одиночный выстрел. Дёшево, но броня рыцарей гасит почти половину урона.',
        perks: {
          pierce: { name: 'Пронзающий болт', cost: 180, set: { pierce: 4, pierceFalloff: 0.15 }, desc: 'Болт пробивает до {pierce} врагов по линии, −{pierceFalloff%} урона за каждого.' },
          volley: { name: 'Залп', cost: 180, set: { bolts: 3, boltMult: 0.4 }, desc: 'Болты по {bolts} разным целям за выстрел, каждый — {boltMult%} урона.' },
          crush: { name: 'Бронебой', cost: 180, set: { pen: 0.5 }, desc: 'Болт не замечает {pen%} брони цели: рыцари и паладины гасят куда меньше урона.' },
        },
      },
      spirits: {
        name: 'ДУХИ', short: 'ФОНАРЬ', title: 'Фонарь призраков', dmgType: 'magic', attack: 'ghost', muzzle: 70,
        art: { sprite: 'spirits', color: [0.30, 0.95, 0.88], ui: '#6ff2e2', fx: 'orbs', sound: 'spirits' },
        base: { cost: 110, dmg: 10, rate: 0.8, range: 3.2 },
        tracks: { dmg: track(45, 0.35, { slow: 0.03 }), range: track(35, 0.08), rate: track(40, 0.12) },
        extra: { speed: 380, slow: 0.30, slowTime: 1.5 },
        show: [['Замедление', '{slow%} · {slowTime} с']],
        desc: 'Призраки замедляют врагов. Урон небольшой, зато соседние башни успевают больше.',
        perks: {
          frost: { name: 'Ледяной ужас', cost: 180, set: { freezeChance: 0.15, freeze: 0.6 }, desc: 'Шанс {freezeChance%} сковать врага ужасом на {freeze} с.' },
          pack: { name: 'Стая', cost: 180, set: { bounces: 2, bounceMult: 0.8, bounceRange: 1.5 }, desc: 'Призрак перескакивает ещё на {bounces} цели, каждый раз с {bounceMult%} урона.' },
          chill: { name: 'Могильный холод', cost: 180, add: { slow: 0.12 }, set: { slowTime: 3 }, desc: 'Замедление сильнее на {slow п} пунктов и держится {slowTime} с вместо {base:slowTime} с.' },
        },
      },
      plague: {
        name: 'ЧУМА', short: 'КОТЁЛ', title: 'Чумной котёл', dmgType: 'poison', attack: 'blob', muzzle: 44,
        art: { sprite: 'plague', color: [0.45, 0.90, 0.25], ui: '#8be04e', fx: 'fumes', sound: 'plague' },
        base: { cost: 130, dmg: 12, rate: 2.2, range: 3.0 },
        tracks: { dmg: track(50, 0.35), range: track(35, 0.08), rate: track(45, 0.12) },
        extra: { cloudR: 0.9, cloudTime: 3, linger: 1.0, flight: 0.6 },
        names: { dmg: 'Яд' }, fmt: { dmg: '{dmg}/с' },
        show: [['Облако', '{cloudR кл} · {cloudTime} с']],
        desc: 'Ядовитое облако травит всех внутри. Яд не замечает брони.',
        perks: {
          pestilence: { name: 'Мор', cost: 180, set: { pestR: 0.7, pestTime: 2 }, desc: 'Отравленный враг при смерти оставляет облако на {pestTime} с (без цепной реакции).' },
          acid: { name: 'Кислота', cost: 180, set: { shred: 0.30, shredTime: 2 }, desc: 'Облако снижает броню врагов на {shred п} пунктов на {shredTime} с.' },
          miasma: { name: 'Миазмы', cost: 180, mul: { cloudR: 1.4 }, add: { cloudTime: 1.5 }, desc: 'Облако на {cloudR+%} шире и висит на {cloudTime} с дольше.' },
        },
      },
      dark: {
        name: 'ТЬМА', short: 'ОБЕЛИСК', title: 'Обелиск тьмы', dmgType: 'magic', ignoreMres: true, attack: 'beam', muzzle: 92,
        art: { sprite: 'dark', color: [0.80, 0.38, 1.0], ui: '#c86bff', fx: 'crown', sound: 'dark' },
        base: { cost: 150, dmg: 20, rate: 1.3, range: 3.2 },
        tracks: { dmg: track(55, 0.35), range: track(40, 0.08), rate: track(50, 0.12) },
        extra: { heavy: 2 },
        show: [['По тяжёлым', '×{heavy}']],
        desc: 'Луч бьёт самую живучую цель, пробивает защиту священников, вдвое сильнее по повозкам и боссам.',
        perks: {
          harvest: { name: 'Жатва', cost: 180, set: { harvest: 2 }, desc: '+{harvest} души за каждого врага, погибшего в радиусе.' },
          curse: { name: 'Проклятие', cost: 180, set: { curse: 0.2, curseTime: 3 }, desc: 'Цель получает +{curse%} урона от всех башен {curseTime} с.' },
          split: { name: 'Двойной луч', cost: 180, set: { split: 0.5 }, desc: 'Луч задевает и вторую по живучести цель в радиусе — {split%} урона.' },
        },
      },
    },
    TRACK_NAMES: { dmg: 'Урон', range: 'Дальность', rate: 'Скорость' },
    TRACK_FMT: { dmg: '{dmg}', range: '{range кл}', rate: '{rate /с}' },   // значение ветки в панели: шаблон SIM.fill по итоговым характеристикам
    ART: { sprite: 'bones', tint: null, css: '', color: [0.8, 0.8, 0.8], ui: '#bbbbbb', fx: null, sound: null, flip: false },   // вид башни по умолчанию
    LOOK_MUZZLE: 4,
    TOWER_ORDER: ['bones', 'spirits', 'plague', 'dark'],

    // Враги. speed — ед/с вдоль дороги, armor/mres — доли.
    ENEMIES: {
      militia: { name: 'Ополченец', hp: 50, speed: 64, armor: 0, mres: 0, bounty: 6, leak: 1, size: 1,
        desc: 'Быстрый и хрупкий. Опасен толпой.' },
      knight: { name: 'Рыцарь со щитом', hp: 160, speed: 46, armor: 0.45, mres: 0, bounty: 12, leak: 1, size: 1,
        desc: 'Щит гасит 45% физического урона. Против него — Чума и Тьма.' },
      priest: { name: 'Священник', hp: 110, speed: 46, armor: 0, mres: 0.5, bounty: 14, leak: 1, size: 1,
        heal: 12, healEvery: 4, healR: 1.5, healTargets: 3, healLock: 1.5,   // до 3 самых раненых; одного — не чаще раза в healLock с
        desc: 'Лечит союзников рядом. Магия Духов вязнет в его вере, Кости и Тьма — нет.' },
      cart: { name: 'Осадная повозка', hp: 900, speed: 30, armor: 0.30, mres: 0.20, bounty: 50, leak: 3, size: 2, heavy: true,
        spawnOnDeath: { type: 'militia', n: 2 },
        desc: 'Медленная и толстая. При поломке из неё выскакивают ополченцы.' },
      paladin: { name: 'Паладин', hp: 4000, speed: 34, armor: 0.35, mres: 0.35, bounty: 150, leak: 10, size: 2.2, heavy: true, boss: true,
        aura: 0.15, auraR: 1.5,
        desc: 'Босс. Аура укрепляет броню соседей. Пропуск стоит 10 прочности склепа.' },
    },
    // HP и награда боссов по волне (не масштабируется формулой).
    BOSSES: { 10: { hp: 4000, bounty: 150, name: 'Паладин' }, 20: { hp: 10000, bounty: 250, name: 'Паладин-командор' },
      25: { hp: 16000, bounty: 400, name: 'Великий паладин' } },

    // Волны: группы { e: тип, n: число, gap: интервал, at: задержка старта группы от начала волны }.
    WAVES: [
      /* 1 */[{ e: 'militia', n: 10, gap: 1.6, at: 0 }],
      /* 2 */[{ e: 'militia', n: 14, gap: 1.3, at: 0 }],
      /* 3 */[{ e: 'militia', n: 10, gap: 1.2, at: 0 }, { e: 'knight', n: 4, gap: 2.0, at: 8 }],
      /* 4 */[{ e: 'militia', n: 12, gap: 1.0, at: 0 }, { e: 'knight', n: 8, gap: 1.8, at: 6 }],
      /* 5 */[{ e: 'militia', n: 8, gap: 1.0, at: 0 }, { e: 'knight', n: 6, gap: 1.8, at: 4 }, { e: 'priest', n: 3, gap: 3.0, at: 8 }],
      /* 6 */[{ e: 'militia', n: 20, gap: 0.6, at: 0 }, { e: 'priest', n: 4, gap: 2.5, at: 6 }],
      /* 7 */[{ e: 'knight', n: 12, gap: 1.4, at: 0 }, { e: 'priest', n: 5, gap: 3.0, at: 3 }],
      /* 8 */[{ e: 'cart', n: 1, gap: 1, at: 4 }, { e: 'militia', n: 14, gap: 0.9, at: 0 }],
      /* 9 */[{ e: 'knight', n: 10, gap: 1.3, at: 0 }, { e: 'priest', n: 6, gap: 2.2, at: 2 }, { e: 'cart', n: 2, gap: 8, at: 6 }],
      /* 10 */[{ e: 'knight', n: 12, gap: 1.2, at: 0 }, { e: 'paladin', n: 1, gap: 1, at: 10 }],
      /* 11 */[{ e: 'militia', n: 30, gap: 0.55, at: 0 }, { e: 'priest', n: 6, gap: 2.4, at: 4 }],
      /* 12 */[{ e: 'cart', n: 3, gap: 6, at: 0 }, { e: 'knight', n: 8, gap: 1.4, at: 3 }],
      /* 13 */[{ e: 'knight', n: 16, gap: 1.1, at: 0 }, { e: 'priest', n: 6, gap: 2.2, at: 2 }],
      /* 14 */[{ e: 'militia', n: 40, gap: 0.4, at: 0 }],
      /* 15 */[{ e: 'cart', n: 4, gap: 5, at: 0 }, { e: 'priest', n: 10, gap: 1.6, at: 2 }],
      /* 16 */[{ e: 'knight', n: 24, gap: 0.9, at: 0 }, { e: 'priest', n: 10, gap: 1.8, at: 3 }],
      /* 17 */[{ e: 'cart', n: 5, gap: 4.5, at: 0 }, { e: 'militia', n: 20, gap: 0.6, at: 4 }],
      /* 18 */[{ e: 'knight', n: 20, gap: 0.9, at: 0 }, { e: 'priest', n: 12, gap: 1.5, at: 2 }, { e: 'cart', n: 2, gap: 6, at: 8 }],
      /* 19 */[{ e: 'militia', n: 50, gap: 0.35, at: 0 }, { e: 'cart', n: 6, gap: 3.5, at: 3 }],
      /* 20 */[{ e: 'priest', n: 10, gap: 1.5, at: 0 }, { e: 'cart', n: 2, gap: 6, at: 4 }, { e: 'paladin', n: 1, gap: 1, at: 12 }],
      /* 21 */[{ e: 'knight', n: 30, gap: 0.75, at: 0 }, { e: 'priest', n: 12, gap: 1.6, at: 2 }],
      /* 22 */[{ e: 'cart', n: 8, gap: 3.0, at: 0 }],
      /* 23 */[{ e: 'militia', n: 60, gap: 0.3, at: 0 }, { e: 'priest', n: 15, gap: 1.1, at: 2 }],
      /* 24 */[{ e: 'knight', n: 30, gap: 0.7, at: 0 }, { e: 'cart', n: 6, gap: 3.5, at: 3 }, { e: 'priest', n: 15, gap: 1.2, at: 4 }],
      /* 25 */[{ e: 'knight', n: 20, gap: 0.8, at: 0 }, { e: 'priest', n: 10, gap: 1.5, at: 2 }, { e: 'cart', n: 4, gap: 4, at: 5 },
        { e: 'paladin', n: 1, gap: 1, at: 14 }],
    ],
  };
  if (typeof module !== 'undefined') module.exports = C;
  if (typeof window !== 'undefined') window.CONFIG = C;
})();
