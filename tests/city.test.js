import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCity } from '../src/city.js';

test('the building and furniture generators assemble and dispose for representative seeds', () => {
  for (const seed of [0, 42, 1827, 4294967295]) {
    const city = buildCity(seed);
    assert.equal(city.plan.buildings.length, 64);
    assert.ok(city.group.children.length > 10);
    assert.doesNotThrow(() => city.dispose());
  }
});
