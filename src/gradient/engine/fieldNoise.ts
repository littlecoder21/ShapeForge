/* Deterministic noise toolkit shared by the mesh field and the scene builders.
 *
 * Integer hashing instead of sin()-based hashing, so a seed produces the same picture on every browser and in Node tests,
 * and exports match the preview. The GPU shaders use the identical integer hash and gradient table, so the CPU and GPU
 * renderers agree. All functions are pure and allocation-free on the hot path (they write into `out` arrays).
 */

/** 32-bit integer hash (unsigned). */
export function hashInt(ix: number, iy: number, seed: number): number {
  let h = Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iy | 0, 0x165667b1) ^ Math.imul((seed | 0) + 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  h ^= h >>> 15;
  return h >>> 0;
}
/** 32-bit integer hash → 0…1. */
export const hash2 = (ix: number, iy: number, seed: number): number => hashInt(ix, iy, seed) / 4294967296;

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

// 256 unit gradient directions: a table lookup replaces two trig calls per lattice corner (about 4× faster per noise sample)
const GX = new Float64Array(256), GY = new Float64Array(256);
for (let i = 0; i < 256; i++) { const a = (i / 256) * Math.PI * 2; GX[i] = Math.cos(a); GY[i] = Math.sin(a); }

/** Gradient (Perlin-style) noise, roughly −1…1, C2-continuous so warps and normals have no creases. */
export function gnoise(x: number, y: number, seed = 0): number {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const g = (cx: number, cy: number, dx: number, dy: number) => {
    const k = hashInt(cx, cy, seed) >>> 24;
    return GX[k] * dx + GY[k] * dy;
  };
  const u = fade(fx), v = fade(fy);
  const n00 = g(ix, iy, fx, fy), n10 = g(ix + 1, iy, fx - 1, fy), n01 = g(ix, iy + 1, fx, fy - 1), n11 = g(ix + 1, iy + 1, fx - 1, fy - 1);
  const top = n00 + (n10 - n00) * u, bottom = n01 + (n11 - n01) * u;
  return (top + (bottom - top) * v) * 1.41421356;
}

/** Smooth value noise 0…1 (softer, blobbier than gradient noise). */
export function vnoise(x: number, y: number, seed = 0): number {
  const ix = Math.floor(x), iy = Math.floor(y), u = fade(x - ix), v = fade(y - iy);
  const a = hash2(ix, iy, seed), b = hash2(ix + 1, iy, seed), c = hash2(ix, iy + 1, seed), d = hash2(ix + 1, iy + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Fractal Brownian motion of gradient noise, normalised to about −1…1. */
export function fbm(x: number, y: number, seed = 0, octaves = 4, lacunarity = 2, gain = 0.5): number {
  let sum = 0, amp = 1, norm = 0, fx = x, fy = y;
  for (let i = 0; i < octaves; i++) {
    sum += gnoise(fx, fy, seed + i * 31) * amp;
    norm += amp; amp *= gain;
    const rx = fx * 0.8 - fy * 0.6, ry = fx * 0.6 + fy * 0.8; // rotate each octave so the lattice never lines up
    fx = rx * lacunarity + 17.3; fy = ry * lacunarity + 9.1;
  }
  return sum / norm;
}

/** Ridged fractal 0…1: sharp bright creases (veins, aurora filaments, metal scratches). */
export function ridged(x: number, y: number, seed = 0, octaves = 4, lacunarity = 2, gain = 0.5): number {
  let sum = 0, amp = 0.5, fx = x, fy = y, norm = 0;
  for (let i = 0; i < octaves; i++) {
    const n = 1 - Math.abs(gnoise(fx, fy, seed + i * 17));
    sum += n * n * amp; norm += amp; amp *= gain;
    const rx = fx * 0.8 - fy * 0.6, ry = fx * 0.6 + fy * 0.8;
    fx = rx * lacunarity + 5.7; fy = ry * lacunarity + 2.3;
  }
  return sum / norm;
}

/** Divergence-free flow: the curl of a noise potential. Particles advected along it never bunch up, which is what makes
 *  fluid / smoke look like fluid instead of random noise. Writes [vx, vy] (roughly −1…1) into `out`. */
export function curl(x: number, y: number, seed: number, out: number[], eps = 0.01, octaves = 3): void {
  const a = fbm(x, y + eps, seed, octaves), b = fbm(x, y - eps, seed, octaves);
  const c = fbm(x + eps, y, seed, octaves), d = fbm(x - eps, y, seed, octaves);
  out[0] = (a - b) / (2 * eps) * 0.25; out[1] = -(c - d) / (2 * eps) * 0.25;
}

/** Two-level domain warp: returns the displaced position in `out`. `amount` in the same units as x / y. */
export function warp2(x: number, y: number, seed: number, amount: number, octaves: number, out: number[]): void {
  const qx = fbm(x, y, seed, octaves), qy = fbm(x + 5.2, y + 1.3, seed + 7, octaves);
  const rx = fbm(x + 3 * qx + 1.7, y + 3 * qy + 9.2, seed + 13, octaves), ry = fbm(x + 3 * qx + 8.3, y + 3 * qy + 2.8, seed + 19, octaves);
  out[0] = x + rx * amount; out[1] = y + ry * amount;
}

/** Seeded random stream (mulberry32) for building layouts and palettes; the same seed always yields the same sequence. */
export function rng(seed: number): () => number {
  let a = (seed | 0) + 0x6d2b79f5;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
