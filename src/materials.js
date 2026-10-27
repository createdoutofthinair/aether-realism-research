import * as THREE from 'three/webgpu';
import { color, float, mx_noise_float, positionWorld, vec3 } from 'three/tsl';
import { bumpNormal } from 'three/addons/generators/city/CityGeneratorUtils.js';

// Procedural surface variation is evaluated on the GPU in world units. Fine height
// variation perturbs the PBR normal; these are not photographs or baked image maps.
function mineral(hex, roughness = .83, scale = 2.2, relief = .008) {
  const material = new THREE.MeshStandardNodeMaterial({ roughness, metalness: 0 });
  const broad = mx_noise_float(positionWorld.mul(.075));
  const grain = mx_noise_float(positionWorld.mul(scale));
  const streak = mx_noise_float(vec3(positionWorld.x.mul(.5), positionWorld.y.mul(.035), positionWorld.z.mul(.5)));
  material.colorNode = color(hex).mul(float(1).add(broad.mul(.12)).add(grain.mul(.045)).add(streak.mul(.045)));
  material.roughnessNode = float(roughness).add(grain.mul(.045)).clamp(.18, 1);
  material.normalNode = bumpNormal(grain.mul(relief));
  return material;
}

export function makeMaterials() {
  const materials = {
    concrete: mineral(0xb7aea0, .84, 3.5, .012),
    limestone: mineral(0xc7bca9, .8, 2.2, .009),
    brick: mineral(0x8a6253, .9, 3.4, .012),
    charcoal: mineral(0x59616a, .75, 2.9, .008),
    pale: mineral(0xd0c9b9, .78, 2.4, .008),
    road: mineral(0x383c3c, .96, 4.4, .013),
    sidewalk: mineral(0x97958d, .93, 3.2, .01),
    dark: new THREE.MeshStandardNodeMaterial({ color: 0x252e32, metalness: .62, roughness: .34 }),
    metal: new THREE.MeshStandardNodeMaterial({ color: 0x7e8786, metalness: .74, roughness: .31 }),
    white: new THREE.MeshStandardNodeMaterial({ color: 0xd8d0bd, roughness: .87 }),
    glass: new THREE.MeshStandardNodeMaterial({ color: 0x5d8192, metalness: .67, roughness: .19 }),
    glassDark: new THREE.MeshStandardNodeMaterial({ color: 0x263f4b, metalness: .72, roughness: .23 }),
    glassWarm: new THREE.MeshStandardNodeMaterial({ color: 0xb0926a, metalness: .35, roughness: .27, emissive: 0xb07438, emissiveIntensity: .05 }),
    greenery: new THREE.MeshStandardNodeMaterial({ color: 0x526749, roughness: 1 }),
    marking: new THREE.MeshStandardNodeMaterial({ color: 0xd2cdbb, roughness: .95 }),
  };
  return materials;
}
