import * as THREE from 'three/webgpu';
import { color } from 'three/tsl';
import { SkyscraperGenerator, createSkyscraperMaterial } from 'three/addons/generators/city/SkyscraperGenerator.js';
import { StreetTreeGenerator } from 'three/addons/generators/city/StreetTreeGenerator.js';
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
    this.boxes = new Map();
    this.cylinders = new Map();
    this.temp = new THREE.Object3D();
    this.geometries = [new THREE.BoxGeometry(1, 1, 1), new THREE.CylinderGeometry(1, 1, 1, 24, 1)];
  }
  add(map, key, x, y, z, w, h, d, yaw = 0) {
    if (w <= 0 || h <= 0 || d <= 0) return;
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
      mesh.castShadow = !['glass', 'glassDark', 'glassWarm', 'marking'].includes(key);
      mesh.computeBoundingSphere();
      group.add(mesh);
    }
  }
  dispose() { this.geometries.forEach(g => g.dispose()); }
}

function facade(batch, rect, bottom, floors, fh, skin, type, random) {
  const { x, z, w, d } = rect;
  for (let floor = 0; floor < floors; floor++) {
    const yy = bottom + floor * fh;
    const ground = floor === 0 && bottom < 1;
    for (const axis of ['x', 'z']) for (const sign of [-1, 1]) {
      const len = axis === 'x' ? d : w;
      const count = Math.max(2, Math.floor(len / (type === 'modern' ? 2.7 : 3.4)));
      const spacing = len / count;
      const winHeight = ground ? fh * .72 : fh * (type === 'modern' ? .70 : .55);
      for (let bay = 0; bay < count; bay++) {
        const along = -len / 2 + (bay + .5) * spacing;
        const material = random() < .11 && !ground ? 'glassWarm' : (type === 'modern' ? 'glass' : 'glassDark');
        const wx = axis === 'x' ? x + sign * (w / 2 + .025) : x + along;
        const wz = axis === 'z' ? z + sign * (d / 2 + .025) : z + along;
        const pw = spacing * (ground ? .88 : type === 'modern' ? .88 : .65);
        const wy = yy + (ground ? fh * .46 : fh * .54);
        batch.box(material, wx, wy, wz, axis === 'x' ? .065 : pw, winHeight, axis === 'z' ? .065 : pw);
        // A projecting frame turns the opening into a dimensional facade component.
        const frameY = wy - winHeight / 2 - .035;
        batch.box('metal', wx + (axis === 'x' ? sign * .045 : 0), frameY, wz + (axis === 'z' ? sign * .045 : 0),
          axis === 'x' ? .17 : pw + .14, .11, axis === 'z' ? .17 : pw + .14);
        if (type === 'residential' && !ground && floor % 2 === 1 && bay % 2 === 0 && random() < .66) {
          const projection = 1.0;
          const cx = wx + (axis === 'x' ? sign * projection * .5 : 0);
          const cz = wz + (axis === 'z' ? sign * projection * .5 : 0);
          batch.box(skin, cx, yy + .2, cz, axis === 'x' ? projection : pw, .16, axis === 'z' ? projection : pw);
          batch.box('metal', wx + (axis === 'x' ? sign * projection : 0), yy + 1.12, wz + (axis === 'z' ? sign * projection : 0),
            axis === 'x' ? .07 : pw, .055, axis === 'z' ? .07 : pw);
        }
        if (ground && bay % 3 === 1 && type !== 'modern') {
          const ax = wx + (axis === 'x' ? sign * .45 : 0), az = wz + (axis === 'z' ? sign * .45 : 0);
          batch.box('dark', ax, yy + fh * .83, az, axis === 'x' ? .9 : pw, .1, axis === 'z' ? .9 : pw);
        }
      }
      // Continuous floor bands and slender mullions give the silhouette genuine depth.
      const faceX = axis === 'x' ? x + sign * (w / 2 + .07) : x;
      const faceZ = axis === 'z' ? z + sign * (d / 2 + .07) : z;
      batch.box(type === 'modern' ? 'metal' : skin, faceX, yy + fh - .12, faceZ,
        axis === 'x' ? .16 : len, .22, axis === 'z' ? .16 : len);
    }
  }
}

function volume(batch, r, bottom, floors, fh, skin, type, random) {
  const height = floors * fh;
  batch.box(skin, r.x, bottom + height / 2, r.z, r.w, height, r.d);
  facade(batch, r, bottom, floors, fh, skin, type, random);
  batch.box('dark', r.x, bottom + height + .15, r.z, r.w + .25, .3, r.d + .25);
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
  if (b.kind === 'stepped') {
    const lower = Math.max(3, Math.floor(b.floors * (.38 + b.variant * .14)));
    volume(batch, r, base, lower, fh, skin, 'modern', random);
    const upper = { ...r, x: r.x + .5, z: r.z - .4, w: r.w * .72, d: r.d * .72 };
    volume(batch, upper, base + lower * fh, b.floors - lower, fh, skin, 'modern', random);
  } else if (b.kind === 'residential' && b.variant > .57) {
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
  // Three joined circular wings create a recognisable lobed tower.
  const lobes = b.kind === 'lobed' ? [[-.60, 0], [.52, -.38], [.52, .38]] : [[0, 0]];
  for (const [ox, oz] of lobes) {
    const x = b.x + ox * r, z = b.z + oz * r;
    const levels = b.floors - (b.kind === 'lobed' && ox > 0 ? 2 : 0);
    const height = levels * fh;
    batch.cylinder('glass', x, base + height / 2, z, r, height);
    batch.cylinder(b.palette % 2 ? 'limestone' : 'concrete', x, base + .55, z, r + .12, 1.1);
    for (let f = 1; f <= levels; f++) {
      batch.cylinder('metal', x, base + f * fh, z, r + .06, .14);
    }
    // Real vertical fins wrap each lobe, tangent to the curved glass wall.
    const fins = Math.max(12, Math.round(r * 3));
    for (let n = 0; n < fins; n++) {
      const a = n * Math.PI * 2 / fins;
      batch.box('metal', x + Math.sin(a) * r, base + height / 2, z + Math.cos(a) * r, .12, height, .24, a);
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
  for (const [Generator, placements] of [[StreetTreeGenerator, furniture.trees], [StreetlightGenerator, furniture.lights], [BenchGenerator, furniture.benches], [CarGenerator, furniture.cars]]) {
    const generator = new Generator(); group.add(generator.build(placements)); resources.push(generator);
  }
  return { group, plan, dispose() {
    group.removeFromParent();
    group.traverse(object => { if (object.isInstancedMesh) object.dispose(); });
    resources.forEach(resource => { const material = resource.material; resource.dispose(); if (material) material.dispose(); });
    batch.dispose(); Object.values(materials).forEach(material => material.dispose());
  }, materials };
}
