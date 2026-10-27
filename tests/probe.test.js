import test from 'node:test';
import assert from 'node:assert/strict';
import { probeAnchor, probeKey } from '../src/probePolicy.js';

test('reflection anchors stay on bounded road intersections', () => {
  assert.deepEqual(probeAnchor(3,20), {x:0,z:0});
  assert.equal(probeKey(probeAnchor(40,-40)), '62,-62');
  assert.deepEqual(probeAnchor(999,-999), {x:124,z:-124});
});
