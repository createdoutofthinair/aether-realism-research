import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three/webgpu';
import { probeAnchor, probeKey } from '../src/probePolicy.js';
import { startCityReflection } from '../src/reflections.js';

test('reflection anchors stay on bounded road intersections', () => {
  assert.deepEqual(probeAnchor(3,20), {x:0,z:0});
  assert.equal(probeKey(probeAnchor(40,-40)), '62,-62');
  assert.deepEqual(probeAnchor(999,-999), {x:124,z:-124});
});

function fakeRenderer() {
  const previous = { name: 'original render target' };
  return {
    coordinateSystem: THREE.WebGPUCoordinateSystem, xr: { enabled: true }, autoClear: true,
    reversedDepthBuffer: false, current: previous, face: 2, mip: 1, renders: [], previous,
    getRenderTarget() { return this.current; }, getActiveCubeFace() { return this.face; },
    getActiveMipmapLevel() { return this.mip; },
    setRenderTarget(target, face, mip) { this.current = target; this.face = face; this.mip = mip; },
    render(scene, camera) { this.renders.push({ face: this.face, mipmaps: this.current.texture.generateMipmaps, camera, xr: this.xr.enabled }); },
  };
}

test('reflection capture renders one face per step and restores renderer state', () => {
  const renderer = fakeRenderer();
  const job = startCityReflection(renderer, { buildings: [] }, null, new THREE.Vector3(1, 1, 0).normalize(), 0xffffff);
  for (let face = 0; face < 6; face++) {
    assert.equal(job.step(), face === 5);
    assert.equal(renderer.renders.length, face + 1);
    assert.equal(renderer.current, renderer.previous);
    assert.equal(renderer.face, 2); assert.equal(renderer.mip, 1); assert.equal(renderer.xr.enabled, true);
  }
  assert.deepEqual(renderer.renders.map(r => r.face), [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(renderer.renders.map(r => r.mipmaps), [false, false, false, false, false, true]);
  assert.ok(renderer.renders.every(r => r.xr === false));
  job.target.dispose();
});

test('cancelled reflection captures release the unused target', () => {
  const renderer = fakeRenderer();
  const job = startCityReflection(renderer, { buildings: [] }, null, new THREE.Vector3(1, 1, 0).normalize(), 0xffffff);
  let disposed = 0; job.target.addEventListener('dispose', () => disposed++);
  job.step(); job.cancel(); job.cancel();
  assert.equal(disposed, 1); assert.equal(job.step(), false); assert.equal(renderer.renders.length, 1);
});

test('reflection capture restores renderer state when a face fails', () => {
  const renderer = fakeRenderer();
  const job = startCityReflection(renderer, { buildings: [] }, null, new THREE.Vector3(1, 1, 0).normalize(), 0xffffff);
  renderer.render = () => { throw new Error('render failed'); };
  assert.throws(() => job.step(), /render failed/);
  assert.equal(renderer.current, renderer.previous);
  assert.equal(renderer.face, 2); assert.equal(renderer.mip, 1); assert.equal(renderer.xr.enabled, true);
  job.cancel();
});
