import * as THREE from 'three/webgpu';
import { color } from 'three/tsl';
import { SkyscraperGenerator, createSkyscraperMaterial } from 'three/addons/generators/city/SkyscraperGenerator.js';
import { GlazingBatch } from './glazing.js';
import { buildTrees } from './foliage.js';
import { StreetlightGenerator } from 'three/addons/generators/city/StreetlightGenerator.js';
import { CarGenerator } from 'three/addons/generators/city/CarGenerator.js';
import { BenchGenerator } from 'three/addons/generators/city/BenchGenerator.js';
import { CITY, planCity, randomFromSeed } from './plan.js';
import { makeMaterials, applyHeritageMaterial } from './materials.js';

// Keep recessed rooms in the same spatial cells as the surrounding facades.
// A single city-wide glazing mesh could not be culled when looking away.
class GlazingChunks {
  constructor() { this.chunks = new Map(); this.material = createSkyscraperMaterial(color(0xc6c0b2)); }
  add(pane) {
    const key = `${Math.floor(pane.x / CITY.span)},${Math.floor(pane.z / CITY.span)}`;
    if (!this.chunks.has(key)) this.chunks.set(key, new GlazingBatch());
    this.chunks.get(key).add(pane);
  }
  build(group) {
    for (const [key, chunk] of this.chunks) {
      const mesh = chunk.build(this.material); mesh.name = `glazing:${key}`;
      mesh.geometry.computeBoundingBox();
      mesh.userData.visibilityBounds = mesh.geometry.boundingBox.clone();
      mesh.userData.visibilityFeature = 0;
      mesh.userData.visibilityBlock = key; mesh.userData.visibilityRole = 1;
      group.add(mesh);
    }
  }
  dispose() { for (const chunk of this.chunks.values()) chunk.dispose(); this.chunks.clear(); this.material.dispose(); }
}

// Instances share materials, but are also grouped by block. Three.js can then
// frustum-cull whole groups instead of drawing every facade across the city.
class Batches {
  constructor(materials) {
    this.materials = materials;
    this.glazing = new GlazingChunks();
    this.boxes = new Map();
    this.cylinders = new Map();
    this.context = 'street'; this.featureSize = 0;
    this.temp = new THREE.Object3D();
    this.geometries = [new THREE.BoxGeometry(1, 1, 1), new THREE.CylinderGeometry(1, 1, 1, 24, 1)];
  }
  add(map, key, x, y, z, w, h, d, yaw = 0) {
    if (w <= 0 || h <= 0 || d <= 0) return;
    if (!this.materials[key]) throw new Error(`Unknown city material: ${key}`);
    this.temp.position.set(x, y, z); this.temp.rotation.set(0, yaw, 0); this.temp.scale.set(w, h, d); this.temp.updateMatrix();
    const cellX = Math.floor(x / CITY.span), cellZ = Math.floor(z / CITY.span);
    const batchKey = `${key}:${cellX},${cellZ}:${this.context}:${this.featureSize}`;
    if (!map.has(batchKey)) map.set(batchKey, {
      material: key, context: this.context, cell: `${cellX},${cellZ}`, featureSize: this.featureSize, count: 0, matrices: new Float32Array(16 * 64),
      minX: Infinity, minY: Infinity, minZ: Infinity, maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity,
    });
    const batch = map.get(batchKey), offset = batch.count * 16;
    if (offset + 16 > batch.matrices.length) {
      const larger = new Float32Array(batch.matrices.length * 2);
      larger.set(batch.matrices); batch.matrices = larger;
    }
    batch.matrices.set(this.temp.matrix.elements, offset); batch.count++;
    // Boxes have half-unit extents; cylinders have unit radius and half-unit height.
    // Bounds include every rotated instance, so frustum culling stays conservative.
    const scale = map === this.cylinders ? 1 : .5;
    const hx = w * scale, hz = d * scale, c = Math.abs(Math.cos(yaw)), s = Math.abs(Math.sin(yaw));
    const ex = c * hx + s * hz, ez = s * hx + c * hz, ey = h * .5;
    batch.minX = Math.min(batch.minX, x - ex); batch.maxX = Math.max(batch.maxX, x + ex);
    batch.minY = Math.min(batch.minY, y - ey); batch.maxY = Math.max(batch.maxY, y + ey);
    batch.minZ = Math.min(batch.minZ, z - ez); batch.maxZ = Math.max(batch.maxZ, z + ez);
  }
  box(key, x, y, z, w, h, d, yaw = 0) { this.add(this.boxes, key, x, y, z, w, h, d, yaw); }
  cylinder(key, x, y, z, r, h, yaw = 0) { this.add(this.cylinders, key, x, y, z, r, h, r, yaw); }
  build(group) {
    for (const [kind, map] of [[0, this.boxes], [1, this.cylinders]]) for (const [batchKey, batch] of map) {
      const { material, matrices, count, minX, minY, minZ, maxX, maxY, maxZ } = batch;
      const mesh = new THREE.InstancedMesh(this.geometries[kind], this.materials[material], count);
      mesh.name = `${kind ? 'cylinder' : 'box'}:${batchKey}`;
      mesh.instanceMatrix.array.set(matrices.subarray(0, count * 16));
      mesh.instanceMatrix.needsUpdate = true;
      mesh.receiveShadow = true;
      // Glazing and painted markings should not create offset self shadows.
      mesh.castShadow = batch.context !== 'far' && !['glass', 'glassMid', 'glassDark', 'glassWarm', 'marking'].includes(material);
      const center = new THREE.Vector3((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);
      // A small epsilon accounts for conversion of instance transforms to Float32.
      mesh.boundingSphere = new THREE.Sphere(center, Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) / 2 + .001);
      if (batch.context === 'building' || batch.context === 'far') {
        mesh.userData.visibilityBounds = new THREE.Box3(new THREE.Vector3(minX, minY, minZ), new THREE.Vector3(maxX, maxY, maxZ));
        mesh.userData.visibilityFeature = batch.featureSize;
        mesh.userData.visibilityBlock = batch.cell;
        mesh.userData.visibilityRole = batch.context === 'far' ? 2 : 1;
        if (batch.context === 'far') mesh.visible = false; // full-detail fallback until GPU selection is ready
      }
      group.add(mesh);
    }
    this.boxes.clear(); this.cylinders.clear();
    this.glazing.build(group);
  }
  dispose() { this.geometries.forEach(g => g.dispose()); this.glazing.dispose(); }
}

// Position a facade component in a consistent face-local frame. Offset is measured
// outward from the face, so a negative window offset produces a genuine reveal.
function faceBox(batch, key, r, axis, sign, along, y, offset, width, height, depth) {
  const x = axis === 'x' ? r.x + sign * (r.w / 2 + offset) : r.x + along;
  const z = axis === 'z' ? r.z + sign * (r.d / 2 + offset) : r.z + along;
  batch.box(key, x, y, z, axis === 'x' ? depth : width, height, axis === 'z' ? depth : width);
}

function facade(batch, r, bottom, floors, fh, skin, type, random) {
  for (let floor = 0; floor < floors; floor++) {
    const yy = bottom + floor * fh;
    const ground = floor === 0 && bottom < 1;
    const modern = type === 'modern';
    for (const axis of ['x', 'z']) for (const sign of [-1, 1]) {
      const len = axis === 'x' ? r.d : r.w;
      const count = Math.max(2, Math.floor(len / (modern ? 2.5 : 3.35)));
      const spacing = len / count;
      const winHeight = ground ? fh * .68 : fh * (modern ? .72 : .58);
      const winBottom = ground ? .34 : fh * (modern ? .19 : .22);
      const winTop = winBottom + winHeight;
      const paneWidth = spacing * (ground ? .83 : modern ? .84 : .67);
      const wallDepth = .40, faceOffset = -.09;
      // Solid piers and spandrels frame an actual opening. The room plane sits
      // behind the front wall rather than being pasted onto a solid box.
      faceBox(batch, skin, r, axis, sign, 0, yy + winBottom / 2, faceOffset, len, winBottom, wallDepth);
      faceBox(batch, skin, r, axis, sign, 0, yy + (winTop + fh) / 2, faceOffset, len, fh - winTop, wallDepth);
      for (let p = 0; p <= count; p++) {
        const along = -len/2 + p * spacing;
        const pierWidth = spacing - paneWidth;
        // Half-piers at corners keep neighbouring faces flush with the footprint.
        const width = (p === 0 || p === count) ? pierWidth * .5 : pierWidth;
        const shift = p === 0 ? width*.5 : p === count ? -width*.5 : 0;
        faceBox(batch, skin, r, axis, sign, along + shift, yy + winBottom + winHeight / 2, faceOffset, width, winHeight, wallDepth);
      }
      for (let bay = 0; bay < count; bay++) {
        const along = -len/2 + (bay + .5) * spacing;
        const wy = yy + winBottom + winHeight / 2;
        const x = axis === 'x' ? r.x + sign * (r.w/2 - .25) : r.x + along;
        const z = axis === 'z' ? r.z + sign * (r.d/2 - .25) : r.z + along;
        batch.glazing.add({ x, y: wy, z, width: paneWidth, height: winHeight, axis, sign });
        // This layer can be culled when its width projects to less than a pixel.
        batch.featureSize = .09;
        for (const side of [-1, 1]) {
          faceBox(batch, 'windowFrame', r, axis, sign, along + side * (paneWidth/2 - .045), wy, -.13, .09, winHeight, .26);
        }
        faceBox(batch, 'windowFrame', r, axis, sign, along, yy + winBottom + .045, -.13, paneWidth, .09, .26);
        faceBox(batch, 'windowFrame', r, axis, sign, along, yy + winTop - .045, -.13, paneWidth, .09, .26);
        if (!ground && (modern || paneWidth > 1.65)) {
          faceBox(batch, 'windowFrame', r, axis, sign, along, wy, -.20, .055, winHeight, .12);
        }
        faceBox(batch, modern ? 'metal' : skin, r, axis, sign, along, yy + winBottom - .055, .035, paneWidth + .18, .11, .36);
        batch.featureSize = 0;
        // A few partially lowered blinds, with slats, create occupied windows.
        const blind = random();
        if (!ground && blind < .23) {
          const shadeH = winHeight * (.22 + random() * .42), shadeY = yy + winTop - shadeH/2;
          faceBox(batch, blind < .11 ? 'blindWarm' : 'blindCool', r, axis, sign, along, shadeY, -.235, paneWidth - .10, shadeH, .012);
          batch.featureSize = .022;
          for (let i = 1; i <= 3; i++) {
            faceBox(batch, 'windowFrame', r, axis, sign, along, shadeY + shadeH/2 - shadeH * i/4, -.225, paneWidth - .12, .022, .025);
          }
          batch.featureSize = 0;
        }
        if (type === 'residential' && !ground && floor % 2 === 1 && bay % 2 === 0 && random() < .45) {
          const projection = .95;
          faceBox(batch, skin, r, axis, sign, along, yy + .14, projection/2, paneWidth + .25, .16, projection);
          batch.featureSize = .045;
          faceBox(batch, 'windowFrame', r, axis, sign, along, yy + 1.10, projection, paneWidth + .25, .065, .065);
          for (let k = -2; k <= 2; k++) faceBox(batch, 'windowFrame', r, axis, sign, along + k * paneWidth/4, yy + .62, projection, .045, .95, .045);
          batch.featureSize = 0;
        }
        if (!ground && !modern && random() < .035) {
          faceBox(batch, 'metal', r, axis, sign, along, yy + winBottom + .18, .16, paneWidth * .48, .30, .36);
        }
      }
      // A different rhythm at the street base and on the upper shaft.
      const bandKey = modern ? 'metal' : skin;
      faceBox(batch, bandKey, r, axis, sign, 0, yy + fh - .08, .04, len + .05, ground ? .25 : .15, ground ? .30 : .20);
      if (ground) {
        faceBox(batch, 'dark', r, axis, sign, 0, yy + fh - .48, .07, len * .93, .46, .20);
        if (!modern) for (let bay = 1; bay < count; bay += 3) {
          const along = -len/2 + (bay + .5) * spacing;
          faceBox(batch, 'awning', r, axis, sign, along, yy + fh - .72, .45, paneWidth + .15, .12, .95);
        }
      }
    }
  }
}

function volume(batch, r, bottom, floors, fh, skin, type, random) {
  const height = floors * fh;
  // Core set back from the facade supplies shadowed backing; the exterior is
  // assembled from piers, spandrels, recessed glazing and window frames.
  batch.box(skin, r.x, bottom + height / 2, r.z, Math.max(.5, r.w - 1.25), height, Math.max(.5, r.d - 1.25));
  facade(batch, r, bottom, floors, fh, skin, type, random);
  batch.box('dark', r.x, bottom + height + .13, r.z, r.w + .20, .26, r.d + .20);
  // A shallow cornice gives the building a readable roofline.
  batch.box(skin, r.x, bottom + height + .32, r.z, r.w + .45, .16, r.d + .45);
}

function roofEquipment(batch, b, roof) {
  const r = randomFromSeed(b.seed ^ 0x19ce);
  const n = 1 + Math.floor(r() * 3);
  for (let i = 0; i < n; i++) {
    const x = b.x + (r() - .5) * b.width * .45, z = b.z + (r() - .5) * b.depth * .45;
    batch.box('metal', x, roof + .45, z, 1.5 + r(), .9, 1.1 + r());
    batch.box('dark', x, roof + .94, z, 1.0, .08, .8);
  }
}

// A compact geometric representation is only selected once a whole storey is
// a few screen pixels high. It preserves the mass, roofline and window rhythm.
function farVolume(batch, r, bottom, floors, fh, skin, type) {
  const height=floors*fh, modern=type==='modern';
  batch.box(skin,r.x,bottom+height/2,r.z,r.w,height,r.d);
  for (const axis of ['x','z']) for (const sign of [-1,1]) {
    const len=axis==='x' ? r.d : r.w, count=Math.max(2,Math.floor(len/(modern ? 2.5 : 3.35))), spacing=len/count;
    faceBox(batch,'glassDark',r,axis,sign,0,bottom+height/2,.022,len-.16,Math.max(.1,height-.3),.035);
    for(let p=0;p<=count;p++) {
      const along=-len/2+p*spacing, width=(spacing-spacing*(modern ? .84 : .67))*(p===0||p===count ? .5 : 1);
      const shift=p===0 ? width/2 : p===count ? -width/2 : 0;
      faceBox(batch,skin,r,axis,sign,along+shift,bottom+height/2,.055,width,height,.12);
    }
    for(let floor=0;floor<floors;floor++) {
      const ground=floor===0 && bottom<1, yy=bottom+floor*fh;
      const winBottom=ground ? .34 : fh*(modern ? .19 : .22), winHeight=ground ? fh*.68 : fh*(modern ? .72 : .58);
      faceBox(batch,skin,r,axis,sign,0,yy+winBottom/2,.055,len,winBottom,.12);
      faceBox(batch,skin,r,axis,sign,0,yy+(winBottom+winHeight+fh)/2,.055,len,fh-winBottom-winHeight,.12);
    }
  }
  batch.box('dark',r.x,bottom+height+.13,r.z,r.w+.2,.26,r.d+.2);
  batch.box(skin,r.x,bottom+height+.32,r.z,r.w+.45,.16,r.d+.45);
}
function farBuilding(batch,b) {
  const base=CITY.curb,fh=b.floorHeight,skin=['concrete','limestone','brick','pale'][b.palette];
  if (b.kind==='round' || b.kind==='lobed') {
    const r=Math.min(b.width,b.depth)*(b.kind==='lobed' ? .24 : .47);
    const lobes=b.kind==='lobed' ? [[-.60,0],[.52,-.38],[.52,.38]] : [[0,0]];
    for(const [ox,oz] of lobes) {
      const x=b.x+ox*r,z=b.z+oz*r,levels=b.floors-(b.kind==='lobed'&&ox>0 ? 2 : 0),height=levels*fh;
      batch.cylinder('glassDark',x,base+height/2,z,r-.04,height);
      batch.cylinder(b.palette%2 ? 'limestone' : 'concrete',x,base+.55,z,r+.12,1.1);
      for(let f=0;f<levels;f++) batch.cylinder('metal',x,base+(f+1)*fh,z,r+.075,.14);
      batch.cylinder('dark',x,base+height+.18,z,r+.1,.36);
    }
    return;
  }
  const r={x:b.x,z:b.z,w:b.width,d:b.depth};
  if(b.kind==='stepped'||(b.kind==='modern'&&b.variant>.28)) {
    const lower=Math.max(3,Math.floor(b.floors*(.28+b.variant*.17)));
    farVolume(batch,r,base,lower,fh,skin,'modern');
    const ix=r.w*(.12+b.variant*.06),iz=r.d*(.12+b.variant*.06);
    farVolume(batch,{...r,x:r.x+ix*.28,z:r.z-iz*.24,w:r.w-ix*2,d:r.d-iz*2},base+lower*fh,b.floors-lower,fh,skin,'modern');
  } else if(b.kind==='residential'&&b.variant>.53) {
    farVolume(batch,{...r,x:r.x-r.w*.15,w:r.w*.70},base,b.floors,fh,skin,'residential');
    farVolume(batch,{...r,x:r.x+r.w*.35,z:r.z-r.d*.24,w:r.w*.30,d:r.d*.52},base,Math.max(3,b.floors-2),fh,skin,'residential');
  } else farVolume(batch,r,base,b.floors,fh,skin,b.kind);
  roofEquipment(batch,b,base+b.floors*fh);
}

function angularBuilding(batch, b) {
  const random = randomFromSeed(b.seed);
  const skins = ['concrete', 'limestone', 'brick', 'pale'];
  const skin = skins[b.palette], fh = b.floorHeight, base = CITY.curb;
  const r = { x: b.x, z: b.z, w: b.width, d: b.depth };
  if (b.kind === 'stepped' || (b.kind === 'modern' && b.variant > .28)) {
    // Podium and displaced upper mass: this changes the silhouette as well as
    // the facade. Keep both inside the ground-floor footprint for collision.
    const lower = Math.max(3, Math.floor(b.floors * (.28 + b.variant * .17)));
    volume(batch, r, base, lower, fh, skin, 'modern', random);
    const insetX = r.w * (.12 + b.variant * .06), insetZ = r.d * (.12 + b.variant * .06);
    const upper = { ...r, x: r.x + insetX * .28, z: r.z - insetZ * .24, w: r.w - insetX * 2, d: r.d - insetZ * 2 };
    volume(batch, upper, base + lower * fh, b.floors - lower, fh, skin, 'modern', random);
    // A parapet at the terrace edge reads as a real level transition.
    batch.box('metal', r.x, base + lower * fh + .7, r.z - r.d/2 + .12, r.w, .065, .065);
    batch.box('metal', r.x - r.w/2 + .12, base + lower * fh + .7, r.z, .065, .065, r.d);
  } else if (b.kind === 'residential' && b.variant > .53) {
    // Interlocking wings make an L-shaped footprint and break the street wall.
    const a = { x: r.x - r.w * .15, z: r.z, w: r.w * .70, d: r.d };
    const c = { x: r.x + r.w * .35, z: r.z - r.d * .24, w: r.w * .30, d: r.d * .52 };
    volume(batch, a, base, b.floors, fh, skin, 'residential', random);
    volume(batch, c, base, Math.max(3, b.floors - 2), fh, skin, 'residential', random);
  } else {
    volume(batch, r, base, b.floors, fh, skin, b.kind, random);
  }
  roofEquipment(batch, b, base + b.floors * fh);
}

function roundedBuilding(batch, b) {
  const random = randomFromSeed(b.seed), base = CITY.curb, fh = b.floorHeight;
  const r = Math.min(b.width, b.depth) * (b.kind === 'lobed' ? .24 : .47);
  const lobes = b.kind === 'lobed' ? [[-.60, 0], [.52, -.38], [.52, .38]] : [[0, 0]];
  for (const [ox, oz] of lobes) {
    const x = b.x + ox * r, z = b.z + oz * r;
    const levels = b.floors - (b.kind === 'lobed' && ox > 0 ? 2 : 0);
    const height = levels * fh;
    batch.cylinder('glassDark', x, base + height / 2, z, r - .04, height);
    batch.cylinder(b.palette % 2 ? 'limestone' : 'concrete', x, base + .55, z, r + .12, 1.1);
    const panels = Math.max(16, Math.round(r * 4));
    const panelWidth = 2 * Math.PI * r / panels * .91;
    for (let f = 0; f < levels; f++) {
      batch.cylinder('metal', x, base + (f+1) * fh, z, r + .075, .14);
      for (let n = 0; n < panels; n++) {
        const a = (n + .5) * Math.PI * 2 / panels;
        const chance = random();
        const key = chance < .055 ? 'glassWarm' : chance < .43 ? 'glassMid' : 'glass';
        batch.box(key, x + Math.sin(a) * r, base + (f + .51) * fh, z + Math.cos(a) * r,
          panelWidth, fh * .88, .055, a);
      }
    }
    batch.featureSize = .075;
    for (let n = 0; n < panels; n++) {
      const a = n * Math.PI * 2 / panels;
      batch.box('metal', x + Math.sin(a) * r, base + height/2, z + Math.cos(a) * r, .075, height, .22, a);
    }
    batch.featureSize = 0;
    batch.cylinder('dark', x, base + height + .18, z, r + .1, .36);
    if (random() > .4) batch.cylinder('metal', x, base + height + .7, z, r * .25, 1.0);
  }
}

function placeMatrix(x, z, yaw = 0, scale = 1) {
  return new THREE.Matrix4().compose(new THREE.Vector3(x, CITY.curb, z),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(scale, scale, scale));
}

function streets(batch, plan, library) {
  const half = CITY.half, street = CITY.street, trees = [], lights = [], benches = [], cars = [];
  batch.box('road', 0, -.22, 0, half * 2, .4, half * 2);
  for (const block of plan.blocks) {
    batch.box('sidewalk', block.x, CITY.curb / 2, block.z, CITY.block, CITY.curb, CITY.block);
    // Fine pavement score lines, kept in geometry rather than a repeated image.
    if (!library?.sets.sidewalk) for (let i = -5; i <= 5; i++) {
      const off = i * 4;
      batch.box('concrete', block.x + off, CITY.curb + .002, block.z, .025, .006, CITY.block);
      batch.box('concrete', block.x, CITY.curb + .003, block.z + off, CITY.block, .006, .025);
    }
    for (const sign of [-1, 1]) for (const axis of ['x', 'z']) {
      const edge = CITY.block / 2 - 1.1;
      for (const pos of [-11, 8]) {
        const x = block.x + (axis === 'x' ? sign * edge : pos);
        const z = block.z + (axis === 'z' ? sign * edge : pos);
        trees.push(placeMatrix(x, z, (pos + sign) * .6, .8 + ((pos + 11) / 19) * .18));
      }
      const lx = block.x + (axis === 'x' ? sign * edge : -16);
      const lz = block.z + (axis === 'z' ? sign * edge : -16);
      lights.push(placeMatrix(lx, lz, axis === 'x' ? sign * Math.PI / 2 : (sign > 0 ? 0 : Math.PI)));
      if ((block.bx + block.bz + sign + (axis === 'x' ? 1 : 0)) % 3 === 0) {
        benches.push(placeMatrix(block.x + (axis === 'x' ? sign * (edge - 1) : 2), block.z + (axis === 'z' ? sign * (edge - 1) : 2), axis === 'x' ? Math.PI / 2 : 0));
      }
    }
  }
  for (let i = -2; i <= 2; i++) {
    const road = i * CITY.span;
    for (let s = -105; s <= 105; s += 8) {
      // Stop markings near intersections so crosswalks have room.
      if (Math.abs(((s + CITY.span / 2) % CITY.span + CITY.span) % CITY.span - CITY.span / 2) < 12) continue;
      batch.box('marking', road, .012, s, .12, .02, 3.5);
      batch.box('marking', s, .012, road, 3.5, .02, .12);
    }
    for (let j = -2; j <= 2; j++) {
      const cross = j * CITY.span;
      for (const sign of [-1, 1]) for (let k = -3; k <= 3; k++) {
        batch.box('marking', road + k * 1.6, .016, cross + sign * 11.3, .8, .025, 2.5);
        batch.box('marking', cross + sign * 11.3, .016, road + k * 1.6, 2.5, .025, .8);
      }
      if (Math.abs(i) < 2 && Math.abs(j) < 2) {
        const colors = [0x303b3f, 0xb7b6ae, 0x424b4e, 0x6d3434];
        cars.push({ matrix: placeMatrix(road + 6.5, cross + 22, Math.PI), color: colors[(i + j + 8) % colors.length] });
      }
    }
  }
  return { trees, lights, benches, cars };
}

function addBuildings(batch, buildings, group, resources, getHeritageMaterial) {
  for (const b of buildings) {
    if (b.kind === 'heritage') {
      const generator = new SkyscraperGenerator({
        seed: b.seed, totalHeight: b.floors * b.floorHeight,
        footprint: { width: b.width, depth: b.depth }, floorHeight: b.floorHeight,
        bayWidth: 2.4 + b.variant, pierWidth: .65, pierDepth: .4,
        chamferWidth: b.variant > .55 ? 2 : 0, chamferCornerX: 1, chamferCornerZ: 1,
        setbackDepth: b.variant > .6 ? .45 : 0, stringCourseEvery: 4,
      }, getHeritageMaterial(b.palette));
      const mesh = generator.build(); mesh.position.set(b.x, CITY.curb, b.z);
      mesh.geometry.computeBoundingBox(); mesh.updateMatrix();
      mesh.userData.visibilityBounds = mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrix);
      mesh.userData.visibilityFeature = 0;
      mesh.userData.visibilityRole = 0;
      mesh.userData.heritagePalette = b.palette;
      mesh.castShadow = mesh.receiveShadow = true; group.add(mesh); resources.push(generator);
    } else if (b.kind === 'round' || b.kind === 'lobed') roundedBuilding(batch, b);
    else angularBuilding(batch, b);
  }
}
function heritageMaterialCache(library) {
  const cache = new Map();
  return { cache, get(palette) {
    if (!cache.has(palette)) cache.set(palette,
      applyHeritageMaterial(createSkyscraperMaterial(color([0xb79a82, 0xd0bda0, 0x8b7164, 0xc2b8a7][palette])), library));
    return cache.get(palette);
  } };
}

export function buildCity(seed, library = null) {
  const plan = planCity(seed), group = new THREE.Group(), materials = makeMaterials(library);
  const batch = new Batches(materials), furniture = streets(batch, plan, library), resources = [];
  batch.context = 'building';
  const heritageMaterials = heritageMaterialCache(library);
  addBuildings(batch, plan.buildings, group, resources, palette => heritageMaterials.get(palette));
  batch.build(group);
  const distant = new Batches(materials); distant.context = 'far';
  for (const b of plan.buildings) if (b.kind !== 'heritage') farBuilding(distant,b);
  distant.build(group); resources.push(distant);
  const trees = buildTrees(furniture.trees, seed); group.add(trees.group); resources.push(trees);
  for (const [Generator, placements] of [[StreetlightGenerator, furniture.lights], [BenchGenerator, furniture.benches], [CarGenerator, furniture.cars]]) {
    const generator = new Generator(); group.add(generator.build(placements)); resources.push(generator);
  }
  return { group, plan, colliders: plan.buildings.map(b => b.collider), dispose() {
    group.removeFromParent();
    group.traverse(object => { if (object.isInstancedMesh) object.dispose(); });
    const sharedMaterials = new Set();
    resources.forEach(resource => { if (resource.material) sharedMaterials.add(resource.material); resource.dispose(); });
    sharedMaterials.forEach(material => material.dispose());
    batch.dispose(); Object.values(materials).forEach(material => material.dispose());
  }, materials };
}

// All generated instances use translation, yaw and scale. Eight matrix
// components therefore represent each transform without quantisation loss.
const PACKED_MATRIX_COMPONENTS = [0, 2, 5, 8, 10, 12, 13, 14];
export function packInstanceMatrices(matrices, count) {
  const packed = new Float32Array(count * PACKED_MATRIX_COMPONENTS.length);
  for (let i = 0; i < count; i++) for (let j = 0; j < PACKED_MATRIX_COMPONENTS.length; j++) packed[i*8+j] = matrices[i*16+PACKED_MATRIX_COMPONENTS[j]];
  return packed;
}
export function unpackInstanceMatrices(packed, matrices, count) {
  for (let i = 0; i < count; i++) {
    for (let j = 0; j < PACKED_MATRIX_COMPONENTS.length; j++) matrices[i*16+PACKED_MATRIX_COMPONENTS[j]] = packed[i*8+j];
    matrices[i*16+15] = 1;
  }
}

// Glazing is made of independent quads. A winding bit per pane losslessly
// replaces six indices; groups of 16 panes form 64-vertex, 32-triangle leaves.
export function packGlazingTopology(index, positions) {
  if (index.length % 6 !== 0 || positions.length !== index.length / 6 * 12) return null;
  const panes=index.length/6, winding=new Uint8Array(Math.ceil(panes/8));
  for(let i=0;i<panes;i++) {
    const j=i*6, base=i*4;
    const forward=[base,base+1,base+2,base,base+2,base+3];
    const backward=[base,base+2,base+1,base,base+3,base+2];
    const matches=values=>values.every((v,k)=>index[j+k]===v);
    if(matches(forward)) winding[i>>3]|=1<<(i&7);
    else if(!matches(backward)) return null;
  }
  const leaves=Math.ceil(panes/16), nodeCount=Math.max(0,leaves*2-1);
  const bounds=new Float32Array(nodeCount*6), nodes=new Int32Array(nodeCount*4);
  let next=0;
  function build(first,last) {
    const node=next++, offset=node*6;
    if(last-first===1) {
      const paneStart=first*16, paneEnd=Math.min(panes,paneStart+16);
      let minX=Infinity,minY=Infinity,minZ=Infinity,maxX=-Infinity,maxY=-Infinity,maxZ=-Infinity;
      for(let i=paneStart*12;i<paneEnd*12;i+=3) {
        minX=Math.min(minX,positions[i]);minY=Math.min(minY,positions[i+1]);minZ=Math.min(minZ,positions[i+2]);
        maxX=Math.max(maxX,positions[i]);maxY=Math.max(maxY,positions[i+1]);maxZ=Math.max(maxZ,positions[i+2]);
      }
      bounds.set([minX,minY,minZ,maxX,maxY,maxZ],offset);nodes.set([-1,-1,paneStart*6,(paneEnd-paneStart)*6],node*4);
    } else {
      const middle=Math.floor((first+last)/2), a=build(first,middle), b=build(middle,last);
      for(let k=0;k<3;k++){bounds[offset+k]=Math.min(bounds[a*6+k],bounds[b*6+k]);bounds[offset+3+k]=Math.max(bounds[a*6+3+k],bounds[b*6+3+k]);}
      nodes.set([a,b,0,0],node*4);
    }
    return node;
  }
  if(leaves) build(0,leaves);
  return { panes,winding,bounds,nodes,index32:index.BYTES_PER_ELEMENT===4 };
}
export function unpackGlazingTopology(page) {
  const index=page.index32 ? new Uint32Array(page.panes*6) : new Uint16Array(page.panes*6);
  for(let i=0;i<page.panes;i++) {
    const base=i*4,j=i*6, forward=(page.winding[i>>3]&(1<<(i&7)))!==0;
    index[j]=base; index[j+1]=base+(forward ? 1 : 2); index[j+2]=base+(forward ? 2 : 1);
    index[j+3]=base; index[j+4]=base+(forward ? 2 : 3); index[j+5]=base+(forward ? 3 : 2);
  }
  return index;
}

// Called by the worker once for each independent block. The result contains
// data only: no materials, Three.js objects, renderer or WebGPU handles.
export function buildBuildingChunk(buildings) {
  const dummy = new THREE.MeshBasicMaterial(), materials = new Proxy({}, { get: () => dummy });
  const group = new THREE.Group(), near = new Batches(materials), far = new Batches(materials), resources = [];
  near.context = 'building'; far.context = 'far';
  addBuildings(near, buildings, group, resources, () => dummy);
  near.build(group);
  for (const building of buildings) if (building.kind !== 'heritage') farBuilding(far, building);
  far.build(group);
  const transfers = [], meshes = [];
  const copyAttribute = attribute => {
    const array = attribute.array.slice(); transfers.push(array.buffer);
    return { array, itemSize: attribute.itemSize, normalized: attribute.normalized };
  };
  for (const mesh of group.children) {
    const bounds=mesh.userData.visibilityBounds;
    const data = { name:mesh.name, visible:mesh.visible, castShadow:mesh.castShadow, receiveShadow:mesh.receiveShadow,
      position:mesh.position.toArray(), feature:mesh.userData.visibilityFeature || 0, role:mesh.userData.visibilityRole || 0,
      block:mesh.userData.visibilityBlock, palette:mesh.userData.heritagePalette,
      bounds:bounds ? { min:bounds.min.toArray(), max:bounds.max.toArray() } : null };
    if (mesh.isInstancedMesh) {
      data.instanced=true; data.count=mesh.count; data.kind=mesh.name.startsWith('cylinder:') ? 'cylinder' : 'box';
      data.material=mesh.name.split(':')[1]; data.matrices=packInstanceMatrices(mesh.instanceMatrix.array,mesh.count);
      transfers.push(data.matrices.buffer);
      data.sphere={ center:mesh.boundingSphere.center.toArray(), radius:mesh.boundingSphere.radius };
    } else {
      data.instanced=false; data.glazing=mesh.name.startsWith('glazing:'); data.attributes={};
      for (const [name,attribute] of Object.entries(mesh.geometry.attributes)) data.attributes[name]=copyAttribute(attribute);
      if(mesh.geometry.index) {
        const page=data.glazing ? packGlazingTopology(mesh.geometry.index.array,mesh.geometry.attributes.position.array) : null;
        if(page) { data.indexPage=page;transfers.push(page.winding.buffer,page.bounds.buffer,page.nodes.buffer); }
        else data.index=copyAttribute(mesh.geometry.index);
      }
    }
    meshes.push(data);
  }
  resources.forEach(resource => resource.dispose()); near.dispose(); far.dispose(); dummy.dispose();
  return { meshes, transfers };
}

// Construct streets immediately; building chunks are attached as worker data
// arrives. Render materials and GPU uploads remain owned by the main thread.
export function buildCityShell(seed, library = null) {
  const plan=planCity(seed), group=new THREE.Group(), materials=makeMaterials(library);
  const batch=new Batches(materials), furniture=streets(batch,plan,library), resources=[];
  batch.build(group);
  const trees=buildTrees(furniture.trees,seed); group.add(trees.group); resources.push(trees);
  for (const [Generator, placements] of [[StreetlightGenerator, furniture.lights], [BenchGenerator, furniture.benches], [CarGenerator, furniture.cars]]) {
    const generator=new Generator(); group.add(generator.build(placements)); resources.push(generator);
  }
  const heritage=heritageMaterialCache(library), geometries=[new THREE.BoxGeometry(1,1,1),new THREE.CylinderGeometry(1,1,1,24,1)], uniqueGeometries=[];
  function append(meshes) {
    for (const data of meshes) {
      let mesh;
      if (data.instanced) {
        const geometry=geometries[data.kind==='cylinder' ? 1 : 0];
        mesh=new THREE.InstancedMesh(geometry,materials[data.material],data.count);
        unpackInstanceMatrices(data.matrices,mesh.instanceMatrix.array,data.count); mesh.instanceMatrix.needsUpdate=true;
        mesh.boundingSphere=new THREE.Sphere(new THREE.Vector3(...data.sphere.center),data.sphere.radius);
      } else {
        const geometry=new THREE.BufferGeometry();
        for (const [name,a] of Object.entries(data.attributes)) geometry.setAttribute(name,new THREE.BufferAttribute(a.array,a.itemSize,a.normalized));
        if(data.indexPage) geometry.setIndex(new THREE.BufferAttribute(unpackGlazingTopology(data.indexPage),1));
        else if(data.index) geometry.setIndex(new THREE.BufferAttribute(data.index.array,data.index.itemSize,data.index.normalized));
        geometry.computeBoundingSphere(); uniqueGeometries.push(geometry);
        mesh=new THREE.Mesh(geometry,data.glazing ? batch.glazing.material : heritage.get(data.palette));
      }
      mesh.name=data.name; mesh.visible=data.visible; mesh.castShadow=data.castShadow; mesh.receiveShadow=data.receiveShadow;
      mesh.position.set(...data.position);
      if (data.bounds) mesh.userData.visibilityBounds=new THREE.Box3(new THREE.Vector3(...data.bounds.min),new THREE.Vector3(...data.bounds.max));
      mesh.userData.visibilityFeature=data.feature; mesh.userData.visibilityRole=data.role; mesh.userData.visibilityBlock=data.block;
      if(data.indexPage) mesh.userData.meshletHierarchy={bounds:data.indexPage.bounds,nodes:data.indexPage.nodes};
      group.add(mesh);
    }
  }
  return { group,plan,materials,colliders:plan.buildings.map(b=>b.collider),append,dispose() {
    group.removeFromParent(); group.traverse(object=>{if(object.isInstancedMesh)object.dispose();});
    uniqueGeometries.forEach(geometry=>geometry.dispose()); geometries.forEach(geometry=>geometry.dispose());
    resources.forEach(resource=>resource.dispose()); batch.dispose();
    for(const material of heritage.cache.values()) material.dispose();
    Object.values(materials).forEach(material=>material.dispose());
  } };
}
