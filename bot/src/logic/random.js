// Random helpers. Every function takes an `rng` (a function returning 0 <= x < 1, like Math.random)
// so tests can pass a seeded one and get the same results every run.

// A small seeded random generator (mulberry32). seeded(42)() always gives the same sequence.
export function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pickOne(list, rng = Math.random) {
  if (!list.length) return undefined;
  return list[Math.floor(rng() * list.length)];
}

// A shuffled copy (Fisher-Yates). The original list is left alone.
export function shuffle(list, rng = Math.random) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
