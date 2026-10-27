import * as THREE from 'three/webgpu';
import { color, float, floor, fract, fwidth, mix, mod, mx_noise_float, normalWorldGeometry, positionWorld, smoothstep, vec3 } from 'three/tsl';
import { bumpNormal } from 'three/addons/generators/city/CityGeneratorUtils.js';
import { attribute, select } from 'three/tsl';
import { scannedSurfaceNodes } from './surfaceNodes.js';

// World-space structure, age and fine surface relief are evaluated per fragment.
// The independent layers stay subtle and use derivatives to filter fine joints.
function mineral(hex, roughness = .83, scale = 2.2, relief = .008, masonry = null) {
  const material = new THREE.MeshStandardNodeMaterial({ roughness, metalness: 0 });
  const broad = mx_noise_float(positionWorld.mul(.075));
  const grain = mx_noise_float(positionWorld.mul(scale));
  const streak = mx_noise_float(vec3(positionWorld.x.mul(.55), positionWorld.y.mul(.045), positionWorld.z.mul(.55)));
  const variation = float(1).add(broad.mul(.17)).add(grain.mul(.08)).add(streak.mul(.09));
  let surface = color(hex).mul(variation);
  let height = grain.mul(relief);
  let joint = float(0);
  if (masonry) {
    const n = normalWorldGeometry.abs();
    const vertical = float(1).sub(smoothstep(.32, .78, n.y));
    const across = positionWorld.x.mul(n.z).add(positionWorld.z.mul(n.x));
    const row = positionWorld.y.div(masonry.h);
    const column = across.div(masonry.w).add(masonry.bond ? mod(floor(row), 2).mul(.5) : float(0));
    const line = coord => {
      const f = fract(coord), edge = f.min(float(1).sub(f));
      const pixel = fwidth(coord).max(.002);
      return float(1).sub(smoothstep(.012, float(.012).add(pixel), edge));
    };
    joint = line(row).max(line(column)).mul(vertical);
    surface = mix(surface, color(masonry.joint), joint.mul(.46));
    height = height.sub(joint.mul(masonry.depth));
  }
  const low = float(1).sub(smoothstep(0, 11, positionWorld.y));
  const grime = smoothstep(-.15, .45, streak).mul(low).mul(.12);
  material.colorNode = mix(surface, color(0x514b42), grime);
  material.roughnessNode = float(roughness).add(grain.mul(.06)).add(joint.mul(.06)).clamp(.18, 1);
  material.normalNode = bumpNormal(height);
  return material;
}

export function makeMaterials(library = null) {
  const materials = {
    concrete: mineral(0xa69e90, .84, 3.5, .012, { w: 2.4, h: 1.1, joint: 0x79756f, depth: .003 }),
    limestone: mineral(0xc5baa6, .8, 2.2, .009, { w: 1.3, h: .55, joint: 0x81786e, depth: .004 }),
    brick: mineral(0x8d6958, .9, 3.4, .012, { w: .60, h: .25, joint: 0x8c8376, depth: .005, bond: true }),
    charcoal: mineral(0x59616a, .75, 2.9, .008),
    pale: mineral(0xc5bdad, .78, 2.4, .008, { w: 2.1, h: 1.2, joint: 0x8d8881, depth: .003 }),
    road: mineral(0x373a39, .96, 4.4, .013),
    sidewalk: mineral(0x93928a, .93, 3.2, .01),
    dark: new THREE.MeshStandardNodeMaterial({ color: 0x252e32, metalness: .62, roughness: .34 }),
    windowFrame: new THREE.MeshStandardNodeMaterial({ color: 0x414748, metalness: .58, roughness: .32 }),
    metal: new THREE.MeshStandardNodeMaterial({ color: 0x737b7b, metalness: .72, roughness: .34 }),
    white: new THREE.MeshStandardNodeMaterial({ color: 0xd8d0bd, roughness: .87 }),
    blindWarm: new THREE.MeshStandardNodeMaterial({ color: 0x9e998c, roughness: .82 }),
    blindCool: new THREE.MeshStandardNodeMaterial({ color: 0x858f8b, roughness: .82 }),
    awning: new THREE.MeshStandardNodeMaterial({ color: 0x51464a, roughness: .94 }),
    glass: new THREE.MeshStandardNodeMaterial({ color: 0x80919a, metalness: .42, roughness: .16 }),
    glassMid: new THREE.MeshStandardNodeMaterial({ color: 0x71858c, metalness: .38, roughness: .24 }),
    glassDark: new THREE.MeshStandardNodeMaterial({ color: 0x36454b, metalness: .42, roughness: .25 }),
    glassWarm: new THREE.MeshStandardNodeMaterial({ color: 0x958e80, metalness: .28, roughness: .29, emissive: 0x9e754a, emissiveIntensity: .05 }),
    greenery: new THREE.MeshStandardNodeMaterial({ color: 0x526749, roughness: 1 }),
    marking: new THREE.MeshStandardNodeMaterial({ color: 0xc0bbaf, roughness: .95 }),
  };
  if (library) for (const [key, asset] of Object.entries(library.sets)) {
    if (!materials[key]) continue;
    const nodes = scannedSurfaceNodes(asset, library.weather);
    const material = new THREE.MeshStandardNodeMaterial({ metalness: 0, roughness: .8 });
    material.colorNode = nodes.albedo; material.roughnessNode = nodes.rough;
    material.aoNode = nodes.ao; material.normalNode = nodes.normal;
    materials[key].dispose(); materials[key] = material;
  }
  return materials;
}

// The heritage shader handles rooms, trim and shopfronts in one geometry. Only
// wall and pier zones receive the photographed masonry, preserving its interiors.
export function applyHeritageMaterial(material, library) {
  const asset = library?.sets.brick; if (!asset) return material;
  const nodes = scannedSurfaceNodes(asset, library.weather);
  const wall = attribute('partId', 'float').lessThan(1.5);
  const oldColor = material.colorNode, oldRoughness = material.roughnessNode, oldNormal = material.normalNode;
  material.colorNode = select(wall, mix(nodes.albedo, oldColor, .18), oldColor);
  material.roughnessNode = select(wall, nodes.rough, oldRoughness);
  material.normalNode = select(wall, nodes.normal, oldNormal);
  material.aoNode = select(wall, nodes.ao, float(1));
  return material;
}
