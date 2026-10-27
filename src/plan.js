// Generation data is independent of the renderer and repeatable for a seed.
export const CITY = Object.freeze({ block: 44, street: 18, span: 62, half: 124, curb: 0.19 });

export function randomFromSeed(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = (t + Math.imul(t ^ t >>> 7, 61 | t)) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

export function planCity(seed = 1827) {
  const random = randomFromSeed(seed);
  const blocks = [], buildings = [];
  const kinds = ['heritage', 'modern', 'residential', 'stepped', 'round', 'lobed'];
  for (let bx = -2; bx < 2; bx++) for (let bz = -2; bz < 2; bz++) {
    const x = (bx + 0.5) * CITY.span, z = (bz + 0.5) * CITY.span;
    const block = { x, z, width: CITY.block, depth: CITY.block, bx, bz };
    blocks.push(block);
    const centrality = 1 - Math.min(1, Math.hypot(x, z) / 175);
    for (let lx = 0; lx < 2; lx++) for (let lz = 0; lz < 2; lz++) {
      const lot = 18.2, gap = 0.7;
      const ox = (lx - .5) * (lot + gap), oz = (lz - .5) * (lot + gap);
      const width = 13.8 + random() * 3.7, depth = 13.8 + random() * 3.7;
      const kind = kinds[Math.floor(random() * kinds.length)];
      const floors = Math.round(5 + centrality * 7 + random() * (kind === 'heritage' ? 7 : 13));
      buildings.push({ id: `${bx},${bz},${lx},${lz}`, x: x + ox, z: z + oz,
        width, depth, kind, floors, floorHeight: 3.25 + random() * .42,
        palette: Math.floor(random() * 4), variant: random(), seed: Math.floor(random() * 0x7fffffff),
        // Conservative ground-level bounds. Upper setbacks do not affect walking.
        collider: { minX: x + ox - width / 2, maxX: x + ox + width / 2,
          minZ: z + oz - depth / 2, maxZ: z + oz + depth / 2 } });
    }
  }
  return { seed: seed >>> 0, blocks, buildings, bounds: CITY.half - 2 };
}

export function collides(x, z, colliders, radius = .38, bounds = CITY.half - 2) {
  if (Math.abs(x) > bounds - radius || Math.abs(z) > bounds - radius) return true;
  return colliders.some(c => {
    const px = Math.max(c.minX, Math.min(x, c.maxX));
    const pz = Math.max(c.minZ, Math.min(z, c.maxZ));
    return (px - x) ** 2 + (pz - z) ** 2 < radius ** 2;
  });
}

// Axis-separated collision lets the player slide along walls. Sub-steps prevent tunnelling.
export function moveWithCollisions(position, dx, dz, colliders, radius = .38, bounds = CITY.half - 2) {
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / (radius * .5)));
  let { x, z } = position;
  for (let i = 0; i < steps; i++) {
    const nx = x + dx / steps, nz = z + dz / steps;
    if (!collides(nx, z, colliders, radius, bounds)) x = nx;
    if (!collides(x, nz, colliders, radius, bounds)) z = nz;
  }
  return { x, z };
}
