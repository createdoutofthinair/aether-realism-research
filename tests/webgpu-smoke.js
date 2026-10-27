import * as THREE from 'three/webgpu';
import { GpuVisibility } from '../src/gpuVisibility.js';
import { openChunkCache } from '../src/chunkCache.js';
import { GlazingBatch } from '../src/glazing.js';
import { packGlazingTopology } from '../src/city.js';

const output = document.querySelector('#result');
const require = (condition, message) => { if (!condition) throw new Error(message); };
const samePixels = (a, b) => a.length === b.length && a.every((value, i) => value === b[i]);

async function run() {
  let cacheResult='SKIP: browser storage unavailable';
  if(globalThis.indexedDB) {
    const name=`aether-city-smoke-${Date.now()}`, cache=await openChunkCache(indexedDB,16,name);
    if(cache) {
      require(await cache.put('first',[{array:new Float32Array([1,2])}],8),'Could not write a cached page.');
      const saved=await cache.get('first');require(saved && saved[0].array[1]===2,'Cached page did not round-trip.');
      require(await cache.put('second',[{array:new Float32Array([3,4,5])}],12),'Could not write a second page.');
      require(await cache.get('first')===null && (await cache.get('second'))[0].array[2]===5,'Page cache budget did not evict the old page.');
      cache.close();indexedDB.deleteDatabase(name);cacheResult='PASS: cached page round-trip and storage budget';
    }
  }
  require(navigator.gpu, 'WebGPU is unavailable in this browser.');
  const adapter = await navigator.gpu.requestAdapter();
  require(adapter, 'No WebGPU adapter is available.');
  const timingSupported = adapter.features.has('timestamp-query');
  const device = await adapter.requestDevice({ requiredFeatures: timingSupported ? ['timestamp-query'] : [] });
  const renderer = new THREE.WebGPURenderer({ antialias: false, device });
  renderer.setSize(200, 200);
  await renderer.init();
  const target = new THREE.RenderTarget(200, 200);
  renderer.setRenderTarget(target);
  document.body.append(renderer.domElement);

  const scene = new THREE.Scene(), group = new THREE.Group();
  scene.background = new THREE.Color(0x6699bb); scene.add(group);
  const camera = new THREE.PerspectiveCamera(60, 1, .1, 1000);
  camera.position.set(0, 5, 20); camera.lookAt(0, 5, 0); camera.updateMatrixWorld();
  const material = new THREE.MeshStandardNodeMaterial({ color: 0x42aa56 });
  const wallMaterial = new THREE.MeshStandardNodeMaterial({ color: 0xa97b53 });
  const wallGeometry = new THREE.BoxGeometry(8.75, 9, 3.75);
  const wall = new THREE.Mesh(wallGeometry, wallMaterial);
  wall.position.set(0, 4.69, 0); wall.castShadow = wall.receiveShadow = true; scene.add(wall);
  const groundGeometry = new THREE.PlaneGeometry(80, 80);
  const ground = new THREE.Mesh(groundGeometry, wallMaterial);
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);

  const bounds = new THREE.Box3(new THREE.Vector3(-.5, 4, -12.5), new THREE.Vector3(.5, 6, -11.5));
  const glazingGeometry = new THREE.BoxGeometry(1, 2, 1).toNonIndexed();
  const glazing = new THREE.Mesh(glazingGeometry, material);
  glazing.position.set(0, 5, -12); glazing.name = 'glazing:0,0';
  glazing.userData.visibilityBounds = bounds.clone(); glazing.userData.visibilityRole = 1;
  glazing.userData.visibilityBlock = '0,0'; group.add(glazing);
  const structureGeometry = new THREE.BoxGeometry(1, 1, 1);
  const structure = new THREE.InstancedMesh(structureGeometry, material, 1);
  const transform = new THREE.Object3D(); transform.position.set(0, 5, -12);
  transform.scale.set(1, 2, 1); transform.updateMatrix();
  structure.setMatrixAt(0, transform.matrix); structure.instanceMatrix.needsUpdate = true;
  structure.computeBoundingSphere(); structure.castShadow = true;
  structure.userData.visibilityBounds = bounds.clone(); structure.userData.visibilityRole = 1;
  structure.userData.visibilityBlock = '0,0'; group.add(structure);
  const farGeometry = new THREE.BoxGeometry(1, 1, 1);
  const far = new THREE.InstancedMesh(farGeometry, material, 1);
  far.setMatrixAt(0, transform.matrix); far.instanceMatrix.needsUpdate = true;
  far.computeBoundingSphere(); far.visible = false;
  far.userData.visibilityBounds = bounds.clone(); far.userData.visibilityRole = 2;
  far.userData.visibilityBlock = '0,0'; group.add(far);

  scene.add(new THREE.AmbientLight(0xffffff, .7));
  const sun = new THREE.DirectionalLight(0xffffff, 2);
  sun.position.set(5, 20, 10); sun.target.position.set(0, 0, -6); sun.castShadow = true;
  sun.shadow.mapSize.set(64, 64); sun.shadow.camera.left = -50; sun.shadow.camera.right = 50;
  sun.shadow.camera.top = 50; sun.shadow.camera.bottom = -50; sun.shadow.camera.far = 100;
  scene.add(sun, sun.target); renderer.shadowMap.enabled = true;
  const plan = { buildings: [{ id: 'wall', kind: 'modern', variant: 0, x: 0, z: 0,
    width: 10, depth: 5, floors: 3, floorHeight: 3 }] };
  const city = { group, plan };
  let visibility;
  try {
    device.pushErrorScope('validation');
    visibility = await GpuVisibility.create(renderer, city, camera);
    require(visibility, 'GPU visibility could not initialize.');
    const offsets = [], hook = structure.onBeforeRender;
    structure.onBeforeRender = (...args) => {
      hook(...args); offsets.push({ main: args[2] === camera, offset: structure.geometry.indirectOffset });
    };
    const draw = async () => {
      visibility.update(); renderer.render(scene, camera);
      await device.queue.onSubmittedWorkDone();
      return renderer.readRenderTargetPixelsAsync(target, 0, 0, 200, 200);
    };
    visibility.mode = 'full';
    const fullImage = await draw(), full = await visibility.sample();
    const colors = new Set();
    for (let i = 0; i < fullImage.length; i += 4) colors.add(`${fullImage[i]},${fullImage[i + 1]},${fullImage[i + 2]}`);
    require(colors.size > 2, 'The reference frame did not contain the rendered scene.');
    const repeatImage = await draw();
    require(samePixels(fullImage, repeatImage), 'The reference scene is not stable between frames.');
    visibility.mode = 'occlusion';
    const occludedImage = await draw(), hidden = await visibility.sample();
    require(full.hidden === 0 && hidden.hidden === 2, 'Occlusion did not hide the covered groups.');
    require(samePixels(fullImage, occludedImage), 'Occlusion changed the rendered reference frame.');
    visibility.mode = 'hierarchy';
    const hierarchyImage = await draw();
    require(samePixels(fullImage, hierarchyImage), 'The depth hierarchy changed the reference frame.');
    require(offsets.some(x => x.main && x.offset === 40), 'Scene camera did not use the filtered command.');
    require(offsets.some(x => !x.main && x.offset === 60), 'Shadow camera did not use the unfiltered command.');

    visibility.mode = 'adaptive'; camera.position.set(20, 5, 20); camera.lookAt(0, 5, -12);
    camera.updateMatrixWorld(); visibility.update();
    const moved = await visibility.sample(); require(moved.hidden === 0, 'Camera movement did not reveal the groups.');
    visibility.mode = 'distant'; visibility.update();
    const evicted = await visibility.sample();
    require(evicted.streamedOut === 1 && evicted.distant === 1 && !glazing.visible, 'Distant LOD did not evict glazing.');
    visibility.mode = 'full'; await draw();
    const restored = await visibility.sample();
    require(restored.streamedOut === 0 && restored.distant === 0 && glazing.visible, 'Glazing did not return to full detail.');

    visibility.mode = 'detail'; camera.position.set(0, 5, 250); camera.lookAt(0, 5, 0); camera.updateMatrixWorld();
    visibility.update(); const autoFar = await visibility.sample();
    camera.position.set(0, 5, 210); camera.lookAt(0, 5, 0); camera.updateMatrixWorld();
    visibility.update(); const autoHold = await visibility.sample();
    camera.position.set(0, 5, 160); camera.lookAt(0, 5, 0); camera.updateMatrixWorld();
    visibility.update(); const autoNear = await visibility.sample();
    require(autoFar.distant === 1 && autoHold.distant === 1 && autoNear.distant === 0, 'Automatic LOD hysteresis failed.');
    visibility.mode = 'stable'; camera.position.set(20000, 5, 0); camera.lookAt(0, 5, -12); camera.updateMatrixWorld();
    visibility.update(); const boundedFar = await visibility.sample();
    camera.position.set(7000, 5, 0); camera.lookAt(0, 5, -12); camera.updateMatrixWorld();
    visibility.update(); const boundedNear = await visibility.sample();
    require(boundedFar.distant === 1 && boundedNear.distant === 0 && boundedNear.streamedOut === 0,
      'Conservative screen-space bound did not restore the near representation.');
    if (timingSupported) {
      visibility.requestTiming(); visibility.update();
      for (let i = 0; i < 200 && visibility.timingPending; i++) await new Promise(resolve => setTimeout(resolve, 10));
      require(Number.isFinite(visibility.timingMs), 'Optional timestamp query did not complete.');
    }
    // Two overlapping walls cover a target jointly, while neither face alone
    // covers its projected bounds. This exercises the pyramid beyond the
    // single-face analytic test and checks its visible pixels against baseline.
    const otherScene = new THREE.Scene(), otherGroup = new THREE.Group();
    otherScene.background = scene.background; otherScene.add(otherGroup);
    for (const x of [-3, 3]) { const part = new THREE.Mesh(wallGeometry, wallMaterial); part.position.set(x, 4.69, 0); otherScene.add(part); }
    otherScene.add(new THREE.AmbientLight(0xffffff, 1));
    const otherGeometry = new THREE.BoxGeometry(3, 2, 1), candidate = new THREE.Mesh(otherGeometry, material);
    candidate.position.set(0, 5, -12);
    candidate.userData.visibilityBounds = new THREE.Box3(new THREE.Vector3(-1.5, 4, -12.5), new THREE.Vector3(1.5, 6, -11.5));
    otherGroup.add(candidate);
    const otherPlan = { buildings: [-3, 3].map((x, i) => ({ id: `wall${i}`, kind: 'modern', variant: 0, x, z: 0,
      width: 8.75, depth: 5, floors: 3, floorHeight: 3 })) };
    camera.position.set(0, 5, 20); camera.lookAt(0, 5, 0); camera.updateMatrixWorld();
    const other = await GpuVisibility.create(renderer, { group: otherGroup, plan: otherPlan }, camera);
    other.mode = 'occlusion'; other.update(); renderer.render(otherScene, camera);
    const singleFace = await other.sample(), baseline = await renderer.readRenderTargetPixelsAsync(target, 0, 0, 200, 200);
    other.mode = 'hierarchy'; other.update(); renderer.render(otherScene, camera);
    const hierarchical = await other.sample(), combined = await renderer.readRenderTargetPixelsAsync(target, 0, 0, 200, 200);
    require(singleFace.hidden === 0 && hierarchical.hidden === 1, 'The depth hierarchy did not combine occluders.');
    require(samePixels(baseline, combined), 'Combined occluders changed visible pixels.');
    other.dispose(); otherGeometry.dispose();
    // The whole glazing mesh is partly visible. Only its hidden 16-pane
    // meshlet should be removed, with no CPU visibility readback.
    const paneBatch=new GlazingBatch();
    for(let i=0;i<32;i++) paneBatch.add({x:i<16 ? -1+i*.12 : 9+(i-16)*.05,y:5,z:-12,width:.12,height:.6,axis:'z',sign:1});
    const paneMaterial=new THREE.MeshBasicNodeMaterial({color:0x4ae8ff,side:THREE.DoubleSide});
    const paneMesh=paneBatch.build(paneMaterial), paneGroup=new THREE.Group(), paneScene=new THREE.Scene();
    paneMesh.name='glazing:0,0';paneMesh.geometry.computeBoundingBox();
    paneMesh.userData.visibilityBounds=paneMesh.geometry.boundingBox.clone();paneMesh.userData.visibilityRole=1;paneMesh.userData.visibilityBlock='0,0';
    const panePage=packGlazingTopology(paneMesh.geometry.index.array,paneMesh.geometry.attributes.position.array);
    paneMesh.userData.meshletHierarchy={nodes:panePage.nodes,bounds:panePage.bounds};
    paneGroup.add(paneMesh);paneScene.add(paneGroup);paneScene.background=scene.background;
    const paneWall=new THREE.Mesh(wallGeometry,wallMaterial);paneWall.position.set(0,4.69,0);paneScene.add(paneWall);
    paneScene.add(new THREE.AmbientLight(0xffffff,1));
    const panes=await GpuVisibility.create(renderer,{group:paneGroup,plan},camera);
    panes.mode='full';panes.update();renderer.render(paneScene,camera);
    const paneBaseline=await renderer.readRenderTargetPixelsAsync(target,0,0,200,200);
    panes.mode='meshlet';panes.update();renderer.render(paneScene,camera);
    const paneOptimized=await renderer.readRenderTargetPixelsAsync(target,0,0,200,200), paneStats=await panes.sample();
    require(paneStats.meshletTotal===192 && paneStats.meshletIndices===96,'GPU meshlet compaction did not remove the hidden panes.');
    require(samePixels(paneBaseline,paneOptimized),'GPU meshlet compaction changed visible pixels.');
    panes.mode='distant';panes.update();require((await panes.sample()).streamedOut===1,'Meshlet geometry did not evict.');
    panes.mode='meshlet';panes.update();renderer.render(paneScene,camera);
    const paneRestored=await renderer.readRenderTargetPixelsAsync(target,0,0,200,200), restoredStats=await panes.sample();
    require(restoredStats.streamedOut===0 && restoredStats.meshletIndices===96 && samePixels(paneBaseline,paneRestored),
      'Meshlet buffers did not restore after eviction.');
    panes.mode='full';panes.update();renderer.render(paneScene,camera);
    require(samePixels(paneBaseline,await renderer.readRenderTargetPixelsAsync(target,0,0,200,200)), 'Full geometry did not restore after meshlet mode.');
    panes.dispose();paneBatch.dispose();paneMaterial.dispose();
    const validation = await device.popErrorScope();
    require(!validation, `WebGPU validation error: ${validation?.message}`);
    return [
      cacheResult,
      'PASS: full-detail and occlusion images match exactly in a stable offscreen scene',
      'PASS: indexed and non-indexed indirect draws, camera movement and shadow commands',
      'PASS: automatic LOD hysteresis and forced distant representation',
      'PASS: conservative projected-bounds LOD and near-detail restoration',
      'PASS: conservative depth pyramid combines multiple occluders without changing pixels',
      'PASS: GPU meshlet index compaction, eviction, restoration and reference pixels',
      'PASS: glazing buffer eviction and restoration',
      timingSupported ? 'PASS: optional GPU timestamp query' : 'SKIP: GPU timestamp query unavailable',
      `Adapter: ${adapter.info?.description || adapter.info?.device || 'description unavailable'}`,
    ];
  } finally {
    visibility?.dispose();
    for (const geometry of [wallGeometry, groundGeometry, glazingGeometry, structureGeometry, farGeometry]) geometry.dispose();
    material.dispose(); wallMaterial.dispose(); target.dispose(); renderer.dispose();
  }
}

window.__webgpuSmokeDone = run().then(lines => {
  output.textContent = lines.join('\n'); return { ok: true, lines };
}).catch(error => {
  output.classList.add('failure'); output.textContent = `FAIL: ${error.stack || error}`;
  return { ok: false, error: error.stack || String(error) };
});
