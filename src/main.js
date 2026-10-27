import * as THREE from 'three/webgpu';
import { pass, mrt, normalView, builtinAOContext, screenUV, renderOutput } from 'three/tsl';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';
import { SkyMesh } from 'three/addons/objects/SkyMesh.js';
import { CSMShadowNode } from 'three/addons/csm/CSMShadowNode.js';
import { startCityReflection } from './reflections.js';
import { buildCity, buildCityShell } from './city.js';
import { moveWithCollisions } from './plan.js';
import { loadMaterialLibrary } from './materialLibrary.js';
import { MATERIAL_CATALOG, materialMapPath } from './materialCatalog.js';
import { probeAnchor, probeKey } from './probePolicy.js';
import { GpuVisibility } from './gpuVisibility.js';
import './style.css';

const root = document.querySelector('#app');
root.innerHTML = `
  <div id="viewport" aria-label="Procedural city viewport"></div>
  <div class="screen-wash"></div>
  <header class="header">
    <div class="brand"><span class="brand-mark">A</span><div><strong>AETHER</strong><small>REALISM RESEARCH</small></div></div>
    <div class="header-right"><span class="live-dot"></span><span id="gpu-status">INITIALISING</span><span class="header-divider"></span><span>EXPERIMENT 01</span></div>
  </header>
  <main class="hud" id="hud">
    <div class="eyebrow"><span></span> THE CITY LAB <b> / </b> 01</div>
    <h1>Architecture<br><em>in motion.</em></h1>
    <p class="intro">A procedural urban district, built from modular forms and explored at street level.</p>
    <div class="rule"></div>
    <div class="metric-row"><div><strong id="building-count">—</strong><small>BUILDINGS</small></div><div><strong>06</strong><small>FORM FAMILIES</small></div><div><strong id="fps">—</strong><small>FPS</small></div></div>
    <div class="rule"></div>
    <div class="field-head"><label for="seed">CITY SEED</label><span>DETERMINISTIC</span></div>
    <div class="seed-row"><input id="seed" type="number" min="0" max="4294967295" value="1827" aria-label="City seed"><button id="generate" class="small-button">GENERATE <span>↗</span></button></div>
    <div class="field-head field-space"><label for="mood">LIGHTING</label><span>ATMOSPHERE</span></div>
    <select id="mood" aria-label="Lighting atmosphere"><option value="golden">Golden hour</option><option value="blue">Blue hour</option><option value="overcast">Soft overcast</option></select>
    <div class="field-head field-space"><label for="quality">RENDER QUALITY</label><span>GPU BUDGET</span></div>
    <select id="quality" aria-label="Render quality"><option value="balanced">Balanced</option><option value="high">High resolution</option><option value="low">Performance</option></select>
    <div class="field-head field-space"><label for="geometry-mode">GEOMETRY</label><span>VISIBILITY / DETAIL</span></div>
    <select id="geometry-mode" aria-label="Geometry detail mode"><option value="stable">Conservative quality</option><option value="adaptive">GPU adaptive</option><option value="hierarchy">Depth hierarchy experiment</option><option value="meshlet">Glazing meshlet experiment</option><option value="full">Full geometry</option><option value="detail">Adaptive detail only</option><option value="occlusion">Occlusion only</option><option value="distant">Inspect distant geometry</option></select>
    <p class="hint" id="visibility-status">Preparing GPU visibility…</p>
    <div class="field-head field-space"><label for="weather">SURFACE WEATHERING</label><span id="weather-value">80%</span></div>
    <input id="weather" class="weather-range" type="range" min="0" max="150" value="80" aria-label="Surface weathering">
    <button id="open-materials" class="library-button"><span>EXPLORE MATERIAL SETS</span><span>↗</span></button>
    <button id="open-performance" class="library-button"><span>PERFORMANCE DETAILS</span><span>↗</span></button>
    <p class="hint" id="maps-status">Loading material sets…</p>
  </main>
  <div class="walk-ui" id="walk-ui"><span class="crosshair">+</span><span>W A S D &nbsp; MOVE &nbsp; · &nbsp; MOUSE &nbsp; LOOK &nbsp; · &nbsp; SHIFT &nbsp; RUN &nbsp; · &nbsp; ESC &nbsp; RELEASE</span></div>
  <footer class="footer">
    <div class="footer-copy"><span class="footer-line"></span><div><strong>STREET LEVEL</strong><small>Made to be explored</small></div></div>
    <div class="footer-actions"><button id="overview" class="outline-button">OVERVIEW</button><button id="walk" class="primary-button">ENTER THE CITY <span>↗</span></button></div>
  </footer>
  <dialog class="material-dialog" id="material-dialog" aria-labelledby="material-title">
    <div class="material-heading"><div><div class="eyebrow">SURFACE LIBRARY / 01</div><h2 id="material-title">Materials built for the city</h2><p>Photographed PBR surfaces with world-scale procedural wear.</p></div><button id="close-materials" class="close-dialog" aria-label="Close material library">×</button></div>
    <div class="material-grid" id="material-grid"></div>
    <p class="material-footer">Colour, normal and packed AO/roughness/metalness maps are included at 1024 × 1024. All six scans are CC0 from Poly Haven.</p>
  </dialog>
  <dialog class="material-dialog performance-dialog" id="performance-dialog" aria-labelledby="performance-title">
    <div class="material-heading"><div><div class="eyebrow">CITY LAB / DIAGNOSTICS</div><h2 id="performance-title">Performance details</h2><p>Measurements from this browser and device.</p></div><button id="close-performance" class="close-dialog" aria-label="Close performance details">×</button></div>
    <div class="performance-grid" id="performance-grid"></div>
    <p class="material-footer">Frame time includes browser scheduling. Optional GPU timing adds measurement overhead; render and visibility timings are separate.</p>
    <button id="toggle-gpu-timing" class="library-button"><span>ENABLE GPU TIMING</span><span>↗</span></button>
    <button id="copy-performance" class="library-button"><span>COPY DIAGNOSTICS</span><span>↗</span></button>
  </dialog>
  <div class="loader" id="loader"><div class="loader-inner"><div class="spinner"></div><strong id="loader-title">BUILDING THE CITY</strong><span id="loader-detail">Preparing WebGPU and architectural modules…</span></div></div>
  <div class="failure" id="failure" hidden><div><span class="eyebrow">DEVICE NOT READY</span><h2 id="failure-title">WebGPU is unavailable</h2><p id="failure-detail"></p><button id="retry" class="outline-button">TRY AGAIN</button></div></div>
`;

const $ = id => document.getElementById(id);
let renderer, scene, camera, sky, sun, hemi, pipeline, city, shadowSize = 0, aoNode, csm;
let environmentTexture, materialLibrary, gpuVisibility, visibilitySamplePending = false, rebuildGeneration = 0, gpuTimingEnabled = false, gpuTimingPending = false;
let cityBuild = null;
const reflectionCache = new Map();
let currentProbeKey = null, nextProbeCheck = 0, pendingProbe = null;
let mode = 'walk';
let previousTime = 0, elapsed = 0, frames = 0;
const performanceInfo = { started: performance.now(), deviceMs: null, materialsMs: null, cityMs: null,
  firstFrameMs: null, cityTotalMs: null, pageHits: 0, pageMisses: 0, probeMs: null, frameMs: null, frame95Ms: null, submitMs: null, draws: null, triangles: null, visibility: null, gpuRenderMs: null };
const frameSamples = [];
let yaw = 0, pitch = 0;
const keys = new Set();
const QUALITY = {
  low: { scale: .75, cap: 1, shadows: 1024, aoScale: .35 },
  balanced: { scale: 1, cap: 1.5, shadows: 2048, aoScale: .5 },
  high: { scale: 1.5, cap: 2, shadows: 4096, aoScale: .75 },
};
const MOODS = {
  golden: { sun: [110, 95, 55], sunColor: 0xffe1b5, intensity: 2.7, sky: 0xb8c6c9, ground: 0x715e51, hemi: 1.2, exposure: 1.0, fog: 0xb7b4ac, density: .0017, turbidity: 7, rayleigh: 1.35, warm: .06, zenith: '#7297b4', horizon: '#f5d3aa' },
  blue: { sun: [-110, 30, 70], sunColor: 0x9bb9e7, intensity: 1.1, sky: 0x6d8aad, ground: 0x4a4a61, hemi: .8, exposure: .95, fog: 0x899cac, density: .0025, turbidity: 8, rayleigh: .7, warm: 1.2, zenith: '#384f79', horizon: '#c0a5aa' },
  overcast: { sun: [50, 150, 50], sunColor: 0xdbe5f2, intensity: 1.15, sky: 0xcbd8e6, ground: 0x767b7c, hemi: 1.3, exposure: 1.0, fog: 0xc3cdd1, density: .0025, turbidity: 10, rayleigh: .85, warm: .08, zenith: '#869bab', horizon: '#dce0dd' },
};

function environment(mood) {
  const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, 0, 256);
  gradient.addColorStop(0, mood.zenith); gradient.addColorStop(.47, mood.horizon);
  gradient.addColorStop(.53, mood.horizon); gradient.addColorStop(1, '#303637');
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, 512, 256);
  const texture = new THREE.CanvasTexture(canvas); texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.colorSpace = THREE.SRGBColorSpace; texture.needsUpdate = true;
  return texture;
}

function clearReflectionCache() {
  pendingProbe?.capture.cancel(); pendingProbe = null;
  for (const target of reflectionCache.values()) target.dispose();
  reflectionCache.clear(); currentProbeKey = null;
}

function updateReflectionProbe() {
  if (!scene || !city || !environmentTexture) return;
  const anchor = probeAnchor(camera.position.x, camera.position.z), key = probeKey(anchor);
  if (key === currentProbeKey) {
    if (pendingProbe && pendingProbe.key !== key) { pendingProbe.capture.cancel(); pendingProbe = null; }
    return;
  }
  let target = reflectionCache.get(key);
  if (target) {
    pendingProbe?.capture.cancel(); pendingProbe = null;
    reflectionCache.delete(key); reflectionCache.set(key, target);
    scene.environment = target.texture; currentProbeKey = key;
  } else if (pendingProbe?.key !== key) {
    pendingProbe?.capture.cancel();
    const p = MOODS[$('mood').value];
    pendingProbe = { key, capture: startCityReflection(renderer, city.plan, environmentTexture, new THREE.Vector3(...p.sun).normalize(), p.sunColor, anchor) };
  }
}

function advanceReflectionProbe() {
  if (!pendingProbe) return;
  const { key, capture } = pendingProbe, started = performance.now();
  try {
    if (capture.step()) {
      reflectionCache.set(key, capture.target);
      if (reflectionCache.size > 4) {
        const oldestKey = reflectionCache.keys().next().value;
        reflectionCache.get(oldestKey).dispose(); reflectionCache.delete(oldestKey);
      }
      scene.environment = capture.target.texture; currentProbeKey = key; pendingProbe = null;
    }
  } catch (error) {
    capture.cancel(); pendingProbe = null; console.warn('Reflection probe could not be updated:', error);
  }
  performanceInfo.probeMs = performance.now() - started;
}

function applyMood() {
  if (!scene || !city) return;
  const p = MOODS[$('mood').value];
  const direction = new THREE.Vector3(...p.sun).normalize();
  sun.position.copy(direction.clone().multiplyScalar(200)); sun.color.set(p.sunColor); sun.intensity = p.intensity;
  hemi.color.set(p.sky); hemi.groundColor.set(p.ground); hemi.intensity = p.hemi;
  sky.sunPosition.value.copy(direction); sky.turbidity.value = p.turbidity; sky.rayleigh.value = p.rayleigh;
  sky.cloudCoverage.value = $('mood').value === 'overcast' ? .7 : .25;
  scene.fog.color.set(p.fog); scene.fog.density = p.density;
  renderer.toneMappingExposure = p.exposure;
  city.materials.glassWarm.emissiveIntensity = p.warm;
  const oldSky = environmentTexture;
  scene.environment = null; clearReflectionCache(); environmentTexture = environment(p);
  scene.environment = environmentTexture; // usable sky lighting while the first probe is captured
  updateReflectionProbe(); oldSky?.dispose();
}

function applyQuality() {
  if (!renderer || !sun) return;
  const quality = QUALITY[$('quality').value];
  renderer.setPixelRatio(Math.min((window.devicePixelRatio || 1) * quality.scale, quality.cap));
  renderer.setSize(innerWidth, innerHeight);
  if (shadowSize !== quality.shadows) {
    shadowSize = quality.shadows;
    sun.shadow.map?.dispose(); sun.shadow.map = null;
    sun.shadow.mapSize.set(shadowSize, shadowSize); sun.shadow.needsUpdate = true;
    if (csm) for (const light of csm.lights) {
      light.shadow.mapSize.set(shadowSize, shadowSize); light.shadow.needsUpdate = true;
    }
  }
  if (aoNode) aoNode.resolutionScale = quality.aoScale;
}

function updateCameraRotation() {
  camera.rotation.order = 'YXZ'; camera.rotation.y = yaw; camera.rotation.x = pitch; camera.rotation.z = 0;
}
function resetWalk() {
  mode = 'walk'; camera.position.set(3, 1.85, 20); yaw = .05; pitch = .07; updateCameraRotation();
  $('overview').textContent = 'OVERVIEW'; $('walk').innerHTML = 'ENTER THE CITY <span>↗</span>';
}
function setOverview() {
  if (document.pointerLockElement) document.exitPointerLock();
  if (mode === 'overview') { resetWalk(); return; }
  mode = 'overview'; camera.position.set(133, 111, 154); camera.lookAt(0, 16, 0);
  $('overview').textContent = 'STREET VIEW'; $('walk').innerHTML = 'ENTER THE CITY <span>↗</span>';
}
function enterWalk() {
  if (!renderer) return;
  if (mode !== 'walk') resetWalk();
  renderer.domElement.requestPointerLock();
}
function setLoading(title, detail) { $('loader-title').textContent = title; $('loader-detail').textContent = detail; $('loader').hidden = false; }
function stopCityBuild() {
  if (!cityBuild) return;
  cityBuild.worker.terminate(); cityBuild.release(); cityBuild=null;
}
function prepareVisibility(next, generation) {
  $('visibility-status').textContent = 'Preparing GPU visibility…';
  GpuVisibility.create(renderer, next, camera).then(controller => {
    if (city !== next || generation !== rebuildGeneration) { controller?.dispose(); return; }
    gpuVisibility = controller;
    if (controller) {
      controller.mode = $('geometry-mode').value;
      $('visibility-status').textContent = `${controller.entries.length} GPU visibility groups · ${controller.occluderCount} opaque occluders`;
    } else $('visibility-status').textContent = 'Full geometry · GPU visibility unavailable';
  }).catch(error => {
    if (city === next && generation === rebuildGeneration) $('visibility-status').textContent = 'Full geometry · GPU visibility unavailable';
    console.warn('GPU visibility unavailable; using full geometry:', error);
  });
}
async function rebuild() {
  const generation = ++rebuildGeneration;
  stopCityBuild();
  const raw = Number($('seed').value);
  const seed = Number.isFinite(raw) ? Math.max(0, Math.min(4294967295, Math.floor(raw))) : 1827;
  $('seed').value = seed;
  setLoading('BUILDING THE CITY', 'Assembling streets, façades and architectural forms…');
  if (document.pointerLockElement) document.exitPointerLock();
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  if (generation !== rebuildGeneration) return;
  try {
    const buildStarted = performance.now();
    const next = buildCityShell(seed, materialLibrary);
    performanceInfo.cityMs = null; performanceInfo.cityTotalMs = null; performanceInfo.pageHits=0; performanceInfo.pageMisses=0;
    gpuVisibility?.dispose(); gpuVisibility = null; performanceInfo.visibility = null;
    city?.dispose(); city = next; scene.add(city.group);
    $('building-count').textContent = String(city.plan.buildings.length).padStart(2, '0');
    resetWalk(); applyMood();
    let release;
    const ready=new Promise(resolve => { let settled=false; release=()=>{if(!settled){settled=true;resolve();}}; });
    const finishNear=()=>{
      if(generation!==rebuildGeneration || city!==next) { release(); return; }
      if(performanceInfo.cityMs===null) performanceInfo.cityMs=performance.now()-buildStarted;
      $('loader').hidden=true; release();
    };
    const fallback=error=>{
      if(generation!==rebuildGeneration || city!==next) { release(); return; }
      console.warn('City worker unavailable; generating on the main thread:', error);
      cityBuild?.worker.terminate(); cityBuild=null;
      try {
        const replacement=buildCity(seed,materialLibrary);
        next.dispose(); city=replacement; scene.add(replacement.group);
        performanceInfo.cityMs=performance.now()-buildStarted; performanceInfo.cityTotalMs=performanceInfo.cityMs;
        $('loader').hidden=true; release(); prepareVisibility(replacement,generation);
      } catch(cause) { release(); showFailure('City generation failed',cause); }
    };
    try {
      const worker=new Worker(new URL('./cityWorker.js',import.meta.url),{type:'module'});
      cityBuild={worker,release};
      worker.onmessage=event=>{
        if(generation!==rebuildGeneration || city!==next) return;
        const message=event.data;
        if(message.type==='error') { fallback(new Error(message.message)); return; }
        if(message.type==='chunk') {
          try { next.append(message.meshes); } catch(error) { fallback(error); return; }
          if(message.cached) performanceInfo.pageHits++; else performanceInfo.pageMisses++;
          $('loader-detail').textContent=`Preparing nearby architecture ${message.completed} / ${message.total}…`;
          $('visibility-status').textContent=`Building district ${message.completed} / ${message.total}…`;
          if(message.completed>=Math.min(4,message.total)) finishNear();
        } else if(message.type==='done') {
          performanceInfo.cityTotalMs=performance.now()-buildStarted;
          worker.terminate(); cityBuild=null; finishNear(); prepareVisibility(next,generation);
        }
      };
      worker.onerror=event=>{event.preventDefault();fallback(new Error(event.message || 'Worker failed'));};
      worker.postMessage({plan:next.plan,origin:{x:camera.position.x,z:camera.position.z}});
    } catch(error) { fallback(error); }
    await ready;
  } catch (error) { showFailure('City generation failed', error); }
}

function showFailure(title, error) {
  console.error(error);
  $('loader').hidden = true; $('failure').hidden = false;
  $('failure-title').textContent = title;
  $('failure-detail').textContent = error instanceof Error ? error.message : String(error);
  $('gpu-status').textContent = 'UNAVAILABLE';
}

async function init() {
  try {
    if (!navigator.gpu) throw new Error('This browser or device does not expose WebGPU. Open this page in a recent WebGPU-enabled desktop browser on HTTPS, and make sure hardware acceleration is enabled.');
    // Image requests and device initialization are independent; start them together.
    const materialStarted = performance.now();
    const materialPromise = loadMaterialLibrary({ base: import.meta.env.BASE_URL, anisotropy: 8,
      onProgress: (done, total) => { $('loader-detail').textContent = `Preparing material sets ${done} / ${total}…`; } })
      .then(library => { performanceInfo.materialsMs = performance.now() - materialStarted; return library; });
    const deviceStarted = performance.now();
    renderer = new THREE.WebGPURenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
    try {
      await renderer.init();
      performanceInfo.deviceMs = performance.now() - deviceStarted;
    } catch (cause) {
      const detail = cause instanceof Error ? ` Details: ${cause.message}` : '';
      throw new Error(`A WebGPU graphics device could not be started. Try a recent desktop browser with hardware acceleration enabled.${detail}`);
    }
    if (!renderer.backend.isWebGPUBackend) throw new Error('The browser could not initialise a WebGPU adapter. A WebGL fallback is not used by this research prototype.');
    // Accumulate every pass of a frame, rather than only the final post-process draw.
    renderer.info.autoReset = false;
    renderer.backend.device.lost.then(info => {
      renderer.setAnimationLoop(null);
      showFailure('WebGPU device was lost', new Error(info.message || 'The graphics device stopped responding. Reload the page to try again.'));
    });
    $('viewport').append(renderer.domElement);
    $('gpu-status').textContent = 'WEBGPU ACTIVE';
    scene = new THREE.Scene(); scene.fog = new THREE.FogExp2(0xc0b4a4, .0028);
    camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, .1, 1200);
    sky = new SkyMesh(); sky.scale.setScalar(4000); sky.material.depthWrite = false; scene.add(sky);
    hemi = new THREE.HemisphereLight(0xb8c6c9, 0x715e51, 1.5); scene.add(hemi);
    sun = new THREE.DirectionalLight(0xffe1b5, 3.1); sun.castShadow = true;
    sun.shadow.camera.left = -180; sun.shadow.camera.right = 180;
    sun.shadow.camera.top = 180; sun.shadow.camera.bottom = -180;
    sun.shadow.camera.near = .5; sun.shadow.camera.far = 500;
    sun.shadow.bias = -.0001; sun.shadow.normalBias = .025;
    csm = new CSMShadowNode(sun, { cascades: 3, maxFar: 260, lightMargin: 120 });
    csm.fade = true; sun.shadow.shadowNode = csm;
    scene.add(sun); scene.add(sun.target);
    // AO needs geometric normals/depth, not a second fully lit and textured scene.
    // Avoid a 4× MSAA pre-pass; the beauty pass keeps its MSAA and final FXAA.
    const prePass = pass(scene, camera, { samples: 0 });
    prePass.overrideMaterial = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
    prePass.setMRT(mrt({ output: normalView }));
    aoNode = ao(prePass.getTextureNode('depth'), prePass.getTextureNode(), camera);
    aoNode.radius.value = 1.25; aoNode.thickness.value = 1.0;
    const scenePass = pass(scene, camera);
    scenePass.contextNode = builtinAOContext(aoNode.getTextureNode().sample(screenUV).r);
    const sceneColor = scenePass.getTextureNode('output');
    const glow = bloom(sceneColor, .13, .35, 1.05);
    pipeline = new THREE.RenderPipeline(renderer); pipeline.outputColorTransform = false;
    pipeline.outputNode = fxaa(renderOutput(sceneColor.add(glow)));
    applyQuality();
    setLoading('LOADING MATERIALS', 'Preparing photographed colour, normal and surface maps…');
    materialLibrary = await materialPromise;
    $('maps-status').textContent = materialLibrary.errors.length
      ? `${6 - materialLibrary.errors.length} / 6 material sets loaded; the rest use procedural fallback.`
      : '6 material sets · 1K PBR maps · GPU weathering';
    await rebuild();
    renderer.setAnimationLoop(frame);
    renderer.domElement.addEventListener('click', () => { if (mode === 'walk' && document.pointerLockElement !== renderer.domElement) enterWalk(); });
  } catch (error) { showFailure('WebGPU could not start', error); }
}

function frame(now) {
  if (!city) return;
  const frameTime = previousTime ? Math.max(0, (now - previousTime) / 1000) : 0;
  const dt = Math.min(.05, frameTime); previousTime = now;
  if (document.pointerLockElement === renderer.domElement && mode === 'walk') {
    let f = Number(keys.has('KeyW') || keys.has('ArrowUp')) - Number(keys.has('KeyS') || keys.has('ArrowDown'));
    let s = Number(keys.has('KeyD') || keys.has('ArrowRight')) - Number(keys.has('KeyA') || keys.has('ArrowLeft'));
    const len = Math.hypot(f, s) || 1; f /= len; s /= len;
    const speed = (keys.has('ShiftLeft') || keys.has('ShiftRight') ? 8 : 4.4) * dt;
    const dx = (-Math.sin(yaw) * f + Math.cos(yaw) * s) * speed;
    const dz = (-Math.cos(yaw) * f - Math.sin(yaw) * s) * speed;
    const p = moveWithCollisions(camera.position, dx, dz, city.colliders, .38, city.plan.bounds);
    camera.position.x = p.x; camera.position.z = p.z;
  }
  renderer.info.reset();
  const submitStarted = performance.now();
  if (gpuVisibility) {
    try { gpuVisibility.update(); }
    catch (error) {
      console.warn('GPU visibility failed; restoring full geometry:', error);
      gpuVisibility.dispose(); gpuVisibility = null;
      $('visibility-status').textContent = 'Full geometry · GPU visibility unavailable';
    }
  }
  pipeline.render();
  performanceInfo.submitMs = performance.now() - submitStarted;
  performanceInfo.draws = renderer.info.render.drawCalls;
  performanceInfo.triangles = renderer.info.render.triangles;
  if (performanceInfo.firstFrameMs === null) performanceInfo.firstFrameMs = performance.now() - performanceInfo.started;
  // Probe updates are bounded and spread across frames to avoid six renders at once.
  if (mode === 'walk' && now >= nextProbeCheck) {
    nextProbeCheck = now + 1800;
    updateReflectionProbe();
  }
  advanceReflectionProbe();
  if (frameTime > 0 && frameTime < 5) { frameSamples.push(frameTime * 1000); if (frameSamples.length > 120) frameSamples.shift(); }
  elapsed += frameTime; frames++;
  if (elapsed >= .8) {
    $('fps').textContent = Math.round(frames / elapsed);
    const sorted = [...frameSamples].sort((a,b) => a-b);
    if (sorted.length) {
      performanceInfo.frameMs = frameSamples.reduce((sum, value) => sum + value, 0) / frameSamples.length;
      performanceInfo.frame95Ms = sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * .95) - 1)];
    }
    if ($('performance-dialog').open) { sampleVisibility(); sampleGpuTiming(); refreshPerformance(); }
    frames = 0; elapsed = 0;
  }
}

function performanceRows() {
  const ms = value => Number.isFinite(value) ? `${value.toFixed(1)} ms` : '—';
  const integer = value => Number.isFinite(value) ? value.toLocaleString() : '—';
  return [
    ['WebGPU device setup', ms(performanceInfo.deviceMs)],
    ['Material image loading', ms(performanceInfo.materialsMs)],
    ['Nearby district ready', ms(performanceInfo.cityMs)],
    ['All district blocks ready', ms(performanceInfo.cityTotalMs)],
    ['Cached district blocks', `${integer(performanceInfo.pageHits)} / ${integer(performanceInfo.pageHits+performanceInfo.pageMisses)}`],
    ['First frame from app start', ms(performanceInfo.firstFrameMs)],
    ['Average frame interval', ms(performanceInfo.frameMs)],
    ['95th percentile frame interval', ms(performanceInfo.frame95Ms)],
    ['CPU render submission', ms(performanceInfo.submitMs)],
    ['Last probe face on CPU', ms(performanceInfo.probeMs)],
    ['Draw calls across passes', integer(performanceInfo.draws)],
    ['Submitted triangles (upper bound)', integer(performanceInfo.triangles)],
    ['GPU-hidden near groups', performanceInfo.visibility ? `${integer(performanceInfo.visibility.hidden)} / ${integer(performanceInfo.visibility.clusters)}` : '—'],
    ['Hidden fine-detail groups', integer(performanceInfo.visibility?.detail)],
    ['GPU-visible distant groups', integer(performanceInfo.visibility?.distant)],
    ['Glazing groups evicted', performanceInfo.visibility ? `${integer(performanceInfo.visibility.streamedOut)} / ${integer(performanceInfo.visibility.streamable)}` : '—'],
    ['Meshlet indices submitted', performanceInfo.visibility?.meshletTotal ? `${integer(performanceInfo.visibility.meshletIndices)} / ${integer(performanceInfo.visibility.meshletTotal)}` : '—'],
    ['GPU render passes', gpuTimingEnabled ? ms(performanceInfo.gpuRenderMs) : 'Timing disabled'],
    ['GPU visibility compute', gpuTimingEnabled ? ms(gpuVisibility?.timingMs) : 'Timing disabled'],
  ];
}
function refreshPerformance() {
  $('performance-grid').innerHTML = performanceRows().map(([label, value]) => `<div><span>${label}</span><strong>${value}</strong></div>`).join('');
}
function sampleVisibility() {
  if (!gpuVisibility || visibilitySamplePending) return;
  const current = gpuVisibility; visibilitySamplePending = true;
  current.sample().then(sample => { if (current === gpuVisibility) { performanceInfo.visibility = sample; refreshPerformance(); } })
    .catch(() => {}).finally(() => { visibilitySamplePending = false; });
}
function sampleGpuTiming() {
  if (!gpuTimingEnabled || gpuTimingPending || !renderer?.backend?.trackTimestamp) return;
  gpuVisibility?.requestTiming(); gpuTimingPending = true;
  renderer.resolveTimestampsAsync('render').then(value => {
    if (Number.isFinite(value)) performanceInfo.gpuRenderMs = value;
  }).catch(() => {}).finally(() => { gpuTimingPending = false; });
}

$('generate').addEventListener('click', rebuild);
$('seed').addEventListener('keydown', event => { if (event.key === 'Enter') rebuild(); });
$('mood').addEventListener('change', applyMood); $('quality').addEventListener('change', applyQuality);
$('geometry-mode').addEventListener('change', event => { if (gpuVisibility) gpuVisibility.mode = event.target.value; });
$('overview').addEventListener('click', setOverview); $('walk').addEventListener('click', enterWalk);
$('weather').addEventListener('input', event => {
  const amount = Number(event.target.value); $('weather-value').textContent = `${amount}%`;
  if (materialLibrary) materialLibrary.weather.value = amount / 100;
});
$('material-grid').innerHTML = MATERIAL_CATALOG.map(item => `<a class="material-card" href="https://polyhaven.com/a/${item.id}" target="_blank" rel="noopener noreferrer"><img src="${materialMapPath(import.meta.env.BASE_URL, item.id, 'color')}" alt="" loading="lazy"><div><strong>${item.name}</strong><small>1K PBR · ${item.metres.toFixed(1)} m tile</small><span>${item.pattern === 'stochastic' ? 'ANTI-REPETITION' : 'ALIGNED STRUCTURE'} ↗</span></div></a>`).join('');
$('open-materials').addEventListener('click', () => $('material-dialog').showModal());
$('close-materials').addEventListener('click', () => $('material-dialog').close());
$('open-performance').addEventListener('click', () => { refreshPerformance(); $('performance-dialog').showModal(); sampleVisibility(); });
$('close-performance').addEventListener('click', () => $('performance-dialog').close());
$('toggle-gpu-timing').addEventListener('click', () => {
  const label=$('toggle-gpu-timing').firstElementChild;
  if (!renderer?.backend?.device?.features.has('timestamp-query')) { label.textContent='GPU TIMING UNAVAILABLE'; return; }
  gpuTimingEnabled=!gpuTimingEnabled;renderer.backend.trackTimestamp=gpuTimingEnabled;
  label.textContent=gpuTimingEnabled ? 'DISABLE GPU TIMING' : 'ENABLE GPU TIMING';
  performanceInfo.gpuRenderMs=null;refreshPerformance();
});
$('copy-performance').addEventListener('click', async () => {
  const button = $('copy-performance');
  try {
    await navigator.clipboard.writeText(performanceRows().map(([label, value]) => `${label}: ${value}`).join('\n'));
    button.firstElementChild.textContent = 'COPIED';
  } catch {
    button.firstElementChild.textContent = 'COPY UNAVAILABLE';
  }
  setTimeout(() => { button.firstElementChild.textContent = 'COPY DIAGNOSTICS'; }, 1800);
});
$('retry').addEventListener('click', () => location.reload());
window.addEventListener('resize', () => { if (!renderer || !camera) return; camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); if (csm?.camera) csm.updateFrustums(); renderer.setSize(innerWidth, innerHeight); });
window.addEventListener('keydown', e => { if (document.pointerLockElement) { keys.add(e.code); if (e.code === 'KeyR') resetWalk(); e.preventDefault(); } });
window.addEventListener('keyup', e => keys.delete(e.code)); window.addEventListener('blur', () => keys.clear());
document.addEventListener('mousemove', e => { if (document.pointerLockElement !== renderer?.domElement || mode !== 'walk') return; yaw -= e.movementX * .002; pitch = Math.max(-1.4, Math.min(1.4, pitch - e.movementY * .002)); updateCameraRotation(); });
document.addEventListener('pointerlockchange', () => { const locked = document.pointerLockElement === renderer?.domElement; document.body.classList.toggle('walking', locked); if (!locked) keys.clear(); });
init();
