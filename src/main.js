import * as THREE from 'three/webgpu';
import { pass, mrt, normalView, builtinAOContext, screenUV, renderOutput } from 'three/tsl';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';
import { SkyMesh } from 'three/addons/objects/SkyMesh.js';
import { CSMShadowNode } from 'three/addons/csm/CSMShadowNode.js';
import { makeCityReflection } from './reflections.js';
import { buildCity } from './city.js';
import { moveWithCollisions } from './plan.js';
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
    <p class="hint">Procedural geometry · PBR shading · screen-space AO</p>
  </main>
  <div class="walk-ui" id="walk-ui"><span class="crosshair">+</span><span>W A S D &nbsp; MOVE &nbsp; · &nbsp; MOUSE &nbsp; LOOK &nbsp; · &nbsp; SHIFT &nbsp; RUN &nbsp; · &nbsp; ESC &nbsp; RELEASE</span></div>
  <footer class="footer">
    <div class="footer-copy"><span class="footer-line"></span><div><strong>STREET LEVEL</strong><small>Made to be explored</small></div></div>
    <div class="footer-actions"><button id="overview" class="outline-button">OVERVIEW</button><button id="walk" class="primary-button">ENTER THE CITY <span>↗</span></button></div>
  </footer>
  <div class="loader" id="loader"><div class="loader-inner"><div class="spinner"></div><strong id="loader-title">BUILDING THE CITY</strong><span id="loader-detail">Preparing WebGPU and architectural modules…</span></div></div>
  <div class="failure" id="failure" hidden><div><span class="eyebrow">DEVICE NOT READY</span><h2 id="failure-title">WebGPU is unavailable</h2><p id="failure-detail"></p><button id="retry" class="outline-button">TRY AGAIN</button></div></div>
`;

const $ = id => document.getElementById(id);
let renderer, scene, camera, sky, sun, hemi, pipeline, city, shadowSize = 0, aoNode, csm, reflectionTarget;
let environmentTexture;
let mode = 'walk';
let previousTime = 0, elapsed = 0, frames = 0;
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
  const oldSky = environmentTexture, oldReflection = reflectionTarget;
  environmentTexture = environment(p);
  reflectionTarget = makeCityReflection(renderer, city.plan, environmentTexture, direction, p.sunColor);
  scene.environment = reflectionTarget.texture;
  oldReflection?.dispose(); oldSky?.dispose();
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
async function rebuild() {
  const raw = Number($('seed').value);
  const seed = Number.isFinite(raw) ? Math.max(0, Math.min(4294967295, Math.floor(raw))) : 1827;
  $('seed').value = seed;
  setLoading('BUILDING THE CITY', 'Assembling streets, façades and architectural forms…');
  if (document.pointerLockElement) document.exitPointerLock();
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  try {
    const next = buildCity(seed);
    city?.dispose(); city = next; scene.add(city.group);
    $('building-count').textContent = String(city.plan.buildings.length).padStart(2, '0');
    resetWalk(); applyMood();
    $('loader').hidden = true;
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
    renderer = new THREE.WebGPURenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
    try {
      await renderer.init();
    } catch (cause) {
      const detail = cause instanceof Error ? ` Details: ${cause.message}` : '';
      throw new Error(`A WebGPU graphics device could not be started. Try a recent desktop browser with hardware acceleration enabled.${detail}`);
    }
    if (!renderer.backend.isWebGPUBackend) throw new Error('The browser could not initialise a WebGPU adapter. A WebGL fallback is not used by this research prototype.');
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
    const prePass = pass(scene, camera); prePass.setMRT(mrt({ output: normalView }));
    aoNode = ao(prePass.getTextureNode('depth'), prePass.getTextureNode(), camera);
    aoNode.radius.value = 1.25; aoNode.thickness.value = 1.0;
    const scenePass = pass(scene, camera);
    scenePass.contextNode = builtinAOContext(aoNode.getTextureNode().sample(screenUV).r);
    const sceneColor = scenePass.getTextureNode('output');
    const glow = bloom(sceneColor, .13, .35, 1.05);
    pipeline = new THREE.RenderPipeline(renderer); pipeline.outputColorTransform = false;
    pipeline.outputNode = fxaa(renderOutput(sceneColor.add(glow)));
    applyQuality();
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
  pipeline.render();
  elapsed += frameTime; frames++;
  if (elapsed >= .8) { $('fps').textContent = Math.round(frames / elapsed); frames = 0; elapsed = 0; }
}

$('generate').addEventListener('click', rebuild);
$('seed').addEventListener('keydown', event => { if (event.key === 'Enter') rebuild(); });
$('mood').addEventListener('change', applyMood); $('quality').addEventListener('change', applyQuality);
$('overview').addEventListener('click', setOverview); $('walk').addEventListener('click', enterWalk);
$('retry').addEventListener('click', () => location.reload());
window.addEventListener('resize', () => { if (!renderer || !camera) return; camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); if (csm?.camera) csm.updateFrustums(); renderer.setSize(innerWidth, innerHeight); });
window.addEventListener('keydown', e => { if (document.pointerLockElement) { keys.add(e.code); if (e.code === 'KeyR') resetWalk(); e.preventDefault(); } });
window.addEventListener('keyup', e => keys.delete(e.code)); window.addEventListener('blur', () => keys.clear());
document.addEventListener('mousemove', e => { if (document.pointerLockElement !== renderer?.domElement || mode !== 'walk') return; yaw -= e.movementX * .002; pitch = Math.max(-1.4, Math.min(1.4, pitch - e.movementY * .002)); updateCameraRotation(); });
document.addEventListener('pointerlockchange', () => { const locked = document.pointerLockElement === renderer?.domElement; document.body.classList.toggle('walking', locked); if (!locked) keys.clear(); });
init();
