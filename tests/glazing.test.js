import test from 'node:test';
import assert from 'node:assert/strict';
import { GlazingBatch } from '../src/glazing.js';

test('all four facade orientations have outward-facing glazing and valid room data', () => {
  const batch = new GlazingBatch();
  for (const axis of ['x', 'z']) for (const sign of [-1, 1]) {
    batch.add({ x: 2, y: 3, z: 4, width: 1.5, height: 2.1, axis, sign });
  }
  const mesh = batch.build(), g = mesh.geometry;
  assert.equal(g.attributes.position.count, 16);
  assert.equal(g.index.count, 24);
  for (let pane = 0; pane < 4; pane++) {
    const ia = g.index.getX(pane * 6), ib = g.index.getX(pane * 6 + 1), ic = g.index.getX(pane * 6 + 2);
    const pos = g.attributes.position, norm = g.attributes.normal;
    const a = [pos.getX(ia),pos.getY(ia),pos.getZ(ia)];
    const b = [pos.getX(ib)-a[0],pos.getY(ib)-a[1],pos.getZ(ib)-a[2]];
    const c = [pos.getX(ic)-a[0],pos.getY(ic)-a[1],pos.getZ(ic)-a[2]];
    const cross = [b[1]*c[2]-b[2]*c[1], b[2]*c[0]-b[0]*c[2], b[0]*c[1]-b[1]*c[0]];
    assert.ok(cross[0]*norm.getX(ia)+cross[1]*norm.getY(ia)+cross[2]*norm.getZ(ia) > 0);
    assert.equal(g.attributes.partId.getX(ia), 4);
    assert.ok(g.attributes.roomSize.getX(ia) > 0 && g.attributes.roomSize.getY(ia) > 0);
  }
  batch.dispose();
});
