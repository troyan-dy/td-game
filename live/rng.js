// live/rng.js — вся случайность «Некрополиса»: независимые именованные потоки от сида забега.
// RNG.seed(seed, name, k) → uint32 начальное состояние потока (имя: 'map', 'battle', 'waves', 'relics'…; k — номер попытки/волны).
// RNG.stream(seed, name, k) → функция () → [0, 1) для чистых генераторов (карта, волны).
// RNG.next(obj, key) → [0, 1) и сдвигает состояние obj[key] (uint32 в JSON состояния забега — сейв продолжает ту же последовательность).
(function () {
  // mulberry32: шаг от состояния s → [новое состояние, число]
  const mix = (s) => { let t = Math.imul(s ^ (s >>> 15), s | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const STEP = 0x6D2B79F5;
  // смешивание сида, имени потока и номера (FNV-1a по имени + финализатор murmur3)
  const seed = (sd, name, k) => {
    let h = (sd >>> 0) ^ 0x811C9DC5;
    for (const ch of String(name || '')) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193);
    h ^= Math.imul((k || 0) + 1, 0x9E3779B1);
    h = Math.imul(h ^ (h >>> 16), 0x85EBCA6B); h = Math.imul(h ^ (h >>> 13), 0xC2B2AE35);
    return (h ^ (h >>> 16)) >>> 0;
  };
  const next = (o, key) => { o[key] = (o[key] + STEP) >>> 0; return mix(o[key]); };
  const stream = (sd, name, k) => { const o = { s: seed(sd, name, k) }; return () => next(o, 's'); };
  const RNG = { seed, next, stream };
  if (typeof module !== 'undefined') module.exports = RNG;
  if (typeof window !== 'undefined') window.RNG = RNG;
})();
