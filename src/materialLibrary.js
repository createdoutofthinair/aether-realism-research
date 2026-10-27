import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import { MATERIAL_CATALOG, materialMapPath } from './materialCatalog.js';

// Maps are downloaded once and shared by city rebuilds. The GPU samples them;
// material disposal must not dispose these shared texture objects.
export async function loadMaterialLibrary({ base = './', anisotropy = 4, onProgress = () => {} } = {}) {
  const loader = new THREE.TextureLoader(); const sets = {}; const errors = [];
  let completed = 0;
  await Promise.all(MATERIAL_CATALOG.map(async descriptor => {
    const channels = ['color', 'normal', 'arm'];
    const results = await Promise.allSettled(channels.map(channel => loader.loadAsync(materialMapPath(base, descriptor.id, channel))));
    const failure = results.find(result => result.status === 'rejected');
    if (failure) {
      results.forEach(result => { if (result.status === 'fulfilled') result.value.dispose(); });
      errors.push(descriptor.name);
    } else {
      const maps = Object.fromEntries(results.map((result, i) => [channels[i], result.value]));
      maps.color.colorSpace = THREE.SRGBColorSpace;
      for (const map of Object.values(maps)) {
        map.wrapS = map.wrapT = THREE.RepeatWrapping;
        map.anisotropy = Math.max(1, Math.min(8, anisotropy));
        map.generateMipmaps = true; map.needsUpdate = true;
      }
      sets[descriptor.key] = { ...descriptor, ...maps };
    }
    onProgress(++completed, MATERIAL_CATALOG.length);
  }));
  const weather = uniform(.8);
  return {
    sets, errors, weather,
    dispose() { for (const set of Object.values(sets)) for (const channel of ['color','normal','arm']) set[channel].dispose(); },
  };
}
