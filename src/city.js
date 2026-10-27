import * as THREE from 'three/webgpu';
import { color } from 'three/tsl';
import { SkyscraperGenerator, createSkyscraperMaterial } from 'three/addons/generators/city/SkyscraperGenerator.js';
import { GlazingBatch } from './glazing.js';
import { buildTrees } from './foliage.js';
import { StreetlightGenerator } from 'three/addons/generators/city/StreetlightGenerator.js';
import { CarGenerator } from 'three/addons/generators/city/CarGenerator.js';
import { BenchGenerator } from 'three/addons/generators/city/BenchGenerator.js';
import { CITY, planCity, randomFromSeed } from './plan.js';
import { makeMaterials } from './materials.js';

// Each material/geometry pair is instanced, keeping architectural repetition on
// the GPU without forcing the same silhouette or layout on every building.
class Batches {
  constructor(materials) {
    this.materials = materials;
    this.glazing = new GlazingBatch();
    this.boxes = new Map();
    this.cylinders = new Map();
    this.temp = new THREE.Object3D();
    this.geometries = [new THREE.BoxGeometry(1, 1, 1), new THREE.CylinderGeometry(1, 1, 1, 24, 1)];
  }
  add(map, key, x, y, z, w, h, d, yaw = 0) {
    if (w <= 0 || h <= 0 || d <= 0) return;
    if (!this.materials[key]) throw new Error(`Unknown city material: ${key}`);
    this.temp.position.set(x, y, z); this.temp.rotation.set(0, yaw, 0); this.temp.scale.set(w, h, d); this.temp.updateMatrix();
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(this.temp.matrix.clone());
  }
  box(key, x, y, z, w, h, d, yaw = 0) { this.add(this.boxes, key, x, y, z, w, h, d, yaw); }
  cylinder(key, x, y, z, r, h, yaw = 0) { this.add(this.cylinders, key, x, y, z, r, h, r, yaw); }
  build(group) {
    for (const [kind, map] of [[0, this.boxes], [1, this.cylinders]]) for (const [key, matrices] of map) {
      const mesh = new THREE.InstancedMesh(this.geometries[kind], this.materials[key], matrices.length);
      mesh.name = `${kind ? 'cylinder' : 'box'}:${key}`;
      for (let i = 0; i < matrices.length; i++) mesh.setMatrixAt(i, matrices[i]);
      mesh.instanceMatrix.needsUpdate = true;
      mesh.receiveShadow = true;
      // Glazing and painted markings should not create offset self shadows.
      mesh.castShadow = !['glass', 'glassMid', 'glassDark', 'glassWarm', 'marking'].includes(key);
      mesh.computeBoundingSphere();
      group.add(mesh);
    }
    group.add(this.glazing.build());
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
        // Deep surrounds, a slim central mullion and a projecting sill catch light.
        for (const side of [-1, 1]) {
          faceBox(batch, 'windowFrame', r, axis, sign, along + side * (paneWidth/2 - .045), wy, -.13, .09, winHeight, .26);
        }
        faceBox(batch, 'windowFrame', r, axis, sign, along, yy + winBottom + .045, -.13, paneWidth, .09, .26);
        faceBox(batch, 'windowFrame', r, axis, sign, along, yy + winTop - .045, -.13, paneWidth, .09, .26);
        if (!ground && (modern || paneWidth > 1.65)) {
          faceBox(batch, 'windowFrame', r, axis, sign, along, wy, -.20, .055, winHeight, .12);
        }
        faceBox(batch, modern ? 'metal' : skin, r, axis, sign, along, yy + winBottom - .055, .035, paneWidth + .18, .11, .36);
        // A few partially lowered blinds, with slats, create occupied windows.
        const blind = random();
        if (!ground && blind < .23) {
          const shadeH = winHeight * (.22 + random() * .42), shadeY = yy + winTop - shadeH/2;
          faceBox(batch, blind < .11 ? 'blindWarm' : 'blindCool', r, axis, sign, along, shadeY, -.235, paneWidth - .10, shadeH, .012);
          for (let i = 1; i <= 3; i++) {
            faceBox(batch, 'windowFrame', r, axis, sign, along, shadeY + shadeH/2 - shadeH * i/4, -.225, paneWidth - .12, .022, .025);
          }
        }
        if (type === 'residential' && !ground && floor % 2 === 1 && bay % 2 === 0 && random() < .45) {
          const projection = .95;
          faceBox(batch, skin, r, axis, sign, along, yy + .14, projection/2, paneWidth + .25, .16, projection);
          faceBox(batch, 'windowFrame', r, axis, sign, along, yy + 1.10, projection, paneWidth + .25, .065, .065);
          for (let k = -2; k <= 2; k++) faceBox(batch, 'windowFrame', r, axis, sign, along + k * paneWidth/4, yy + .62, projection, .045, .95, .045);
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
    for (let n = 0; n < panels; n++) {
      const a = n * Math.PI * 2 / panels;
      batch.box('metal', x + Math.sin(a) * r, base + height/2, z + Math.cos(a) * r, .075, height, .22, a);
    }
    batch.cylinder('dark', x, base + height + .18, z, r + .1, .36);
    if (random() > .4) batch.cylinder('metal', x, base + height + .7, z, r * .25, 1.0);
  }
}

function placeMatrix(x, z, yaw = 0, scale = 1) {
  return new THREE.Matrix4().compose(new THREE.Vector3(x, CITY.curb, z),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(scale, scale, scale));
}

function streets(batch, plan) {
  const half = CITY.half, street = CITY.street, trees = [], lights = [], benches = [], cars = [];
  batch.box('road', 0, -.22, 0, half * 2, .4, half * 2);
  for (const block of plan.blocks) {
    batch.box('sidewalk', block.x, CITY.curb / 2, block.z, CITY.block, CITY.curb, CITY.block);
    // Fine pavement score lines, kept in geometry rather than a repeated image.
    for (let i = -5; i <= 5; i++) {
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

export function buildCity(seed) {
  const plan = planCity(seed), group = new THREE.Group(), materials = makeMaterials();
  const batch = new Batches(materials), furniture = streets(batch, plan), resources = [];
  for (const b of plan.buildings) {
    if (b.kind === 'heritage') {
      const generator = new SkyscraperGenerator({
        seed: b.seed, totalHeight: b.floors * b.floorHeight,
        footprint: { width: b.width, depth: b.depth }, floorHeight: b.floorHeight,
        bayWidth: 2.4 + b.variant, pierWidth: .65, pierDepth: .4,
        chamferWidth: b.variant > .55 ? 2 : 0, chamferCornerX: 1, chamferCornerZ: 1,
        setbackDepth: b.variant > .6 ? .45 : 0, stringCourseEvery: 4,
      }, createSkyscraperMaterial(color([0xb79a82, 0xd0bda0, 0x8b7164, 0xc2b8a7][b.palette])));
      const mesh = generator.build(); mesh.position.set(b.x, CITY.curb, b.z);
      mesh.castShadow = mesh.receiveShadow = true; group.add(mesh); resources.push(generator);
    } else if (b.kind === 'round' || b.kind === 'lobed') roundedBuilding(batch, b);
    else angularBuilding(batch, b);
  }
  batch.build(group);
  const trees = buildTrees(furniture.trees, seed); group.add(trees.group); resources.push(trees);
  for (const [Generator, placements] of [[StreetlightGenerator, furniture.lights], [BenchGenerator, furniture.benches], [CarGenerator, furniture.cars]]) {
    const generator = new Generator(); group.add(generator.build(placements)); resources.push(generator);
  }
  return { group, plan, colliders: plan.buildings.map(b => b.collider), dispose() {
    group.removeFromParent();
    group.traverse(object => { if (object.isInstancedMesh) object.dispose(); });
    resources.forEach(resource => { const material = resource.material; resource.dispose(); if (material) material.dispose(); });
    batch.dispose(); Object.values(materials).forEach(material => material.dispose());
  }, materials };
}
