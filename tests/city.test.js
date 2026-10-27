import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three/webgpu';
import { buildCity } from '../src/city.js';

test('the building and furniture generators assemble and dispose for representative seeds', () => {
  for (const seed of [0, 42, 1827, 4294967295]) {
    const city = buildCity(seed);
    assert.equal(city.plan.buildings.length, 64);
    assert.ok(city.group.children.length > 10);
    const frameBatches = city.group.children.filter(child => child.name.startsWith('box:windowFrame:'));
    assert.ok(frameBatches.length > 4, 'facade instances are divided into cullable spatial batches');
    assert.ok(frameBatches.every(child => child.boundingSphere && child.boundingSphere.radius < 120));
    const glazing = city.group.children.filter(child => child.name.startsWith('glazing:'));
    assert.ok(glazing.length > 4, 'recessed glazing is divided into cullable spatial batches');
    assert.equal(new Set(glazing.map(child => child.material)).size, 1, 'glazing chunks reuse one material');
    const foliage = city.group.children.find(child => child.name === 'Street trees with branches and leaf clusters');
    const leaves = foliage.children.filter(child => child.name.startsWith('tree-leaves:'));
    assert.ok(leaves.length > 4, 'tree leaves are culled by block');
    assert.equal(new Set(leaves.map(child => child.material)).size, 1);
    assert.doesNotThrow(() => city.dispose());
  }
});

test('spatial batch bounds conservatively contain rotated box and cylinder instances', () => {
  const city = buildCity(1827), matrix = new THREE.Matrix4(), point = new THREE.Vector3();
  for (const mesh of city.group.children.filter(child => child.isInstancedMesh && /^(box|cylinder):/.test(child.name))) {
    mesh.geometry.computeBoundingBox();
    const bounds = mesh.geometry.boundingBox;
    for (let i = 0; i < mesh.count; i += Math.max(1, Math.floor(mesh.count / 20))) {
      mesh.getMatrixAt(i, matrix);
      for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
        point.set(x, y, z).applyMatrix4(matrix);
        assert.ok(mesh.boundingSphere.containsPoint(point), `${mesh.name} contains transformed geometry`);
      }
    }
  }
  city.dispose();
});

test('heritage buildings with the same palette share one material', () => {
  const city = buildCity(1827);
  const heritage = city.plan.buildings.filter(b => b.kind === 'heritage');
  const meshes = city.group.children.slice(0, heritage.length);
  const palettes = new Map();
  heritage.forEach((building, i) => {
    if (palettes.has(building.palette)) assert.equal(meshes[i].material, palettes.get(building.palette));
    else palettes.set(building.palette, meshes[i].material);
  });
  assert.ok(heritage.length > palettes.size);
  city.dispose();
});
