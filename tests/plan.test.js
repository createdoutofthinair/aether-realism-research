import test from 'node:test';
import assert from 'node:assert/strict';
import { CITY, planCity, collides, moveWithCollisions } from '../src/plan.js';

test('city generation is reproducible and changes with seed', () => {
  assert.deepEqual(planCity(42), planCity(42));
  assert.notDeepEqual(planCity(42), planCity(43));
});

test('lots are non-overlapping, inside sidewalks, and spawn is clear across many seeds', () => {
  for (let seed = 0; seed < 100; seed++) {
    const city = planCity(seed);
    assert.equal(city.blocks.length, 16);
    assert.equal(city.buildings.length, 64);
    const colliders = city.buildings.map(b => b.collider);
    assert.equal(collides(3, 20, colliders), false);
    for (let i = 0; i < colliders.length; i++) {
      const a = colliders[i];
      assert.ok(Math.max(Math.abs(a.minX), Math.abs(a.maxX), Math.abs(a.minZ), Math.abs(a.maxZ)) < CITY.half);
      for (let j = i + 1; j < colliders.length; j++) {
        const b = colliders[j];
        assert.ok(a.maxX <= b.minX || b.maxX <= a.minX || a.maxZ <= b.minZ || b.maxZ <= a.minZ);
      }
    }
    assert.ok(new Set(city.buildings.map(b => b.kind)).size >= 4);
  }
});

test('movement cannot tunnel through buildings and slides along a wall', () => {
  const wall = [{ minX: 1, maxX: 3, minZ: -2, maxZ: 2 }];
  const p = moveWithCollisions({ x: 0, z: 0 }, 5, 1, wall);
  assert.ok(p.x < 1 && p.z > .5);
  assert.equal(collides(p.x, p.z, wall), false);
});
