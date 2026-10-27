import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three/webgpu';
import { MATERIAL_CATALOG, materialMapPath } from '../src/materialCatalog.js';
import { loadMaterialLibrary } from '../src/materialLibrary.js';

// Read dimensions directly from the JPEG frame header; no browser is required.
function jpegDimensions(bytes) {
  assert.equal(bytes.readUInt16BE(0), 0xffd8, 'JPEG start marker');
  let i = 2;
  while (i < bytes.length) {
    assert.equal(bytes[i++], 0xff, 'JPEG marker');
    while (bytes[i] === 0xff) i++;
    const marker = bytes[i++];
    if (marker === 0xda || marker === 0xd9) break;
    const length = bytes.readUInt16BE(i);
    if ([0xc0, 0xc1, 0xc2, 0xc3].includes(marker)) {
      return [bytes.readUInt16BE(i + 5), bytes.readUInt16BE(i + 3)];
    }
    i += length;
  }
  throw new Error('JPEG frame header not found');
}

test('every packaged PBR set has its original 1K maps and auditable provenance', async () => {
  const provenance = JSON.parse(await readFile(new URL('../public/materials/provenance.json', import.meta.url)));
  assert.equal(MATERIAL_CATALOG.length, 6);
  assert.equal(new Set(MATERIAL_CATALOG.map(set => set.key)).size, MATERIAL_CATALOG.length);
  for (const set of MATERIAL_CATALOG) {
    const source = provenance[set.id];
    assert.ok(source, `${set.id} has provenance`);
    assert.equal(source.license, 'CC0-1.0');
    assert.ok(Math.abs(source.width_m - set.metres) < .01, `${set.id} uses the source physical scale`);
    for (const channel of ['color', 'normal', 'arm']) {
      const entry = source.maps[channel];
      assert.equal(entry.path, `/materials/${set.id}/${channel}.jpg`);
      const bytes = await readFile(new URL(`../public${entry.path}`, import.meta.url));
      assert.equal(bytes.length, entry.bytes);
      assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256);
      assert.deepEqual(jpegDimensions(bytes), [1024, 1024]);
    }
  }
});

test('material URLs work under local and relative production bases', () => {
  assert.equal(materialMapPath('./', 'red_brick', 'color'), './materials/red_brick/color.jpg');
  assert.equal(materialMapPath('/city/', 'red_brick', 'normal'), '/city/materials/red_brick/normal.jpg');
});

test('a missing map falls back for its whole set and preserves the other sets', async () => {
  const original = THREE.TextureLoader.prototype.loadAsync;
  const disposed = [];
  THREE.TextureLoader.prototype.loadAsync = async function (url) {
    if (url.endsWith('/red_brick/normal.jpg')) throw new Error('simulated missing map');
    const texture = new THREE.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1);
    texture.addEventListener('dispose', () => disposed.push(url));
    return texture;
  };
  try {
    const progress = [];
    const library = await loadMaterialLibrary({ base: '/city/', anisotropy: 16, onProgress: done => progress.push(done) });
    assert.deepEqual(library.errors, ['Weathered red brick']);
    assert.equal(Object.keys(library.sets).length, 5);
    assert.equal(library.sets.brick, undefined);
    assert.equal(library.sets.road.color.colorSpace, THREE.SRGBColorSpace);
    assert.equal(library.sets.road.normal.colorSpace, THREE.NoColorSpace);
    assert.equal(library.sets.road.arm.anisotropy, 8);
    assert.deepEqual(progress, [1, 2, 3, 4, 5, 6]);
    assert.equal(disposed.length, 2, 'partial failed set releases its textures');
    library.dispose();
    assert.equal(disposed.length, 17, 'loaded sets release their shared textures');
  } finally {
    THREE.TextureLoader.prototype.loadAsync = original;
  }
});
