// Deterministic RNG utilities. The sim must never touch Math.random —
// every client (and the validating server) has to produce identical tracks
// from (seed, chunkIndex) alone.

/** FNV-1a 32-bit hash of a string -> uint32. */
export function hashString(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Mix a base seed with an integer (e.g. chunk index) -> uint32. */
export function mixSeed(seed, n) {
  let h = (seed ^ Math.imul(n + 0x9e3779b9, 0x85ebca6b)) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return h >>> 0;
}

/** mulberry32: small, fast, good enough, and identical on every JS engine. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.int = (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)); // inclusive
  next.pick = (arr) => arr[Math.floor(next() * arr.length)];
  next.chance = (p) => next() < p;
  return next;
}

/** Normalise any user-supplied seed (string or number) to a uint32. */
export function normalizeSeed(seed) {
  if (typeof seed === 'number') return seed >>> 0;
  const s = String(seed ?? '').trim();
  if (/^\d+$/.test(s)) return Number(s) >>> 0;
  return hashString(s || 'vitreous');
}
