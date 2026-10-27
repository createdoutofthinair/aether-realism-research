import * as THREE from 'three/webgpu';
import { CITY } from './plan.js';

// A compact proxy lets the renderer capture one cubemap face per frame. The
// incomplete target is never exposed as the scene environment.
export function startCityReflection(renderer, plan, skyTexture, sunDirection, lightColor, anchor = { x: 0, z: 0 }) {
  const scene = new THREE.Scene(); scene.background = skyTexture;
  scene.add(new THREE.HemisphereLight(0xd4e0e5, 0x756b5f, 1.5));
  const sun = new THREE.DirectionalLight(lightColor, 2); sun.position.copy(sunDirection).multiplyScalar(200); scene.add(sun);
  const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshStandardNodeMaterial({ color: 0xffffff, roughness: .8 });
  const mesh = new THREE.InstancedMesh(boxGeometry, material, plan.buildings.length);
  const matrix = new THREE.Object3D(), tint = new THREE.Color();
  const colors = [0xb6afa3, 0x9c8f81, 0x6c7779, 0xb7a493];
  plan.buildings.forEach((b, i) => {
    const height = b.floors * b.floorHeight;
    matrix.position.set(b.x, CITY.curb + height/2, b.z); matrix.rotation.set(0,0,0);
    matrix.scale.set(b.width, height, b.depth); matrix.updateMatrix(); mesh.setMatrixAt(i, matrix.matrix);
    tint.set(colors[b.palette]); if (b.kind === 'round' || b.kind === 'lobed') tint.set(0x566e75);
    mesh.setColorAt(i, tint);
  });
  mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  scene.add(mesh);
  // Broad strips hint at glazing in the probe rather than reflecting solid boxes.
  const strips = [];
  for (const b of plan.buildings) for (let f = 1; f < b.floors; f += 2) {
    const y = CITY.curb + (f + .5) * b.floorHeight;
    for (const sign of [-1, 1]) {
      strips.push([b.x, y, b.z + sign * (b.depth / 2 + .04), b.width * .82, b.floorHeight * .62, .08]);
      strips.push([b.x + sign * (b.width / 2 + .04), y, b.z, .08, b.floorHeight * .62, b.depth * .82]);
    }
  }
  const stripMaterial = new THREE.MeshStandardNodeMaterial({ color: 0x41535a, roughness: .55, metalness: .15 });
  const stripMesh = new THREE.InstancedMesh(boxGeometry, stripMaterial, strips.length);
  strips.forEach(([x,y,z,w,h,d], i) => {
    matrix.position.set(x,y,z); matrix.scale.set(w,h,d); matrix.updateMatrix(); stripMesh.setMatrixAt(i, matrix.matrix);
  });
  stripMesh.instanceMatrix.needsUpdate = true; scene.add(stripMesh);
  const groundGeometry = new THREE.PlaneGeometry(300, 300);
  const groundMaterial = new THREE.MeshStandardNodeMaterial({ color: 0x4c4c48, roughness: .95 });
  const ground = new THREE.Mesh(groundGeometry, groundMaterial); ground.rotation.x = -Math.PI / 2; scene.add(ground);
  const target = new THREE.CubeRenderTarget(256, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
  const camera = new THREE.CubeCamera(.1, 500, target); camera.position.set(anchor.x, 8, anchor.z); scene.add(camera);
  if (camera.coordinateSystem !== renderer.coordinateSystem) {
    camera.coordinateSystem = renderer.coordinateSystem; camera.updateCoordinateSystem();
  }
  camera.updateMatrixWorld(true);
  const generateMipmaps = target.texture.generateMipmaps;
  let face = 0, cleaned = false, cancelled = false;
  function cleanup() {
    if (cleaned) return;
    cleaned = true;
    boxGeometry.dispose(); material.dispose(); mesh.dispose(); stripMaterial.dispose(); stripMesh.dispose(); groundGeometry.dispose(); groundMaterial.dispose();
  }
  return {
    target,
    step() {
      if (cancelled) return false;
      if (face === 6) return true;
      const previousTarget = renderer.getRenderTarget(), previousFace = renderer.getActiveCubeFace();
      const previousMip = renderer.getActiveMipmapLevel(), xrEnabled = renderer.xr.enabled;
      renderer.xr.enabled = false;
      try {
        // Match CubeCamera.update: mipmaps can only be generated after all faces exist.
        target.texture.generateMipmaps = face === 5 ? generateMipmaps : false;
        renderer.setRenderTarget(target, face, camera.activeMipmapLevel);
        const reversed = renderer.isWebGLRenderer ? renderer.state.buffers.depth.getReversed() : renderer.reversedDepthBuffer;
        if (reversed && renderer.autoClear === false) renderer.clearDepth();
        renderer.render(scene, camera.children[face]);
        face++;
      } finally {
        renderer.setRenderTarget(previousTarget, previousFace, previousMip);
        renderer.xr.enabled = xrEnabled;
      }
      if (face === 6) { target.texture.needsPMREMUpdate = true; cleanup(); return true; }
      return false;
    },
    cancel() { if (!cancelled) { cancelled = true; cleanup(); target.dispose(); } },
  };
}
