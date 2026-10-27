import * as THREE from 'three/webgpu';
import { TreeGenerator } from 'three/addons/generators/TreeGenerator.js';
import { randomFromSeed } from './plan.js';

// A small branchlet of real leaf-shaped triangles, instanced through each crown.
// This replaces solid low-poly canopy blobs; the tree branch skeleton is also geometry.
function makeLeafCluster() {
  const positions = [], normals = [], colors = [], indices = [];
  const palette = [new THREE.Color(0x617c4b), new THREE.Color(0x758e58), new THREE.Color(0x506f48), new THREE.Color(0x8b9a60)];
  const random = randomFromSeed(7219);
  const point = new THREE.Vector3(), normal = new THREE.Vector3(), matrix = new THREE.Matrix4();
  for (let i = 0; i < 12; i++) {
    const side = i % 2 ? 1 : -1, along = Math.floor(i / 2) * .15 - .42;
    matrix.makeRotationFromEuler(new THREE.Euler((random() - .5) * .65, random() * Math.PI, side * (.45 + random() * .6)));
    matrix.setPosition(side * .09, along, (random() - .5) * .07);
    const verts = [[0,-.10,0],[-.065,.02,0],[0,.22,.012],[.065,.02,0]];
    const base = positions.length / 3; const tint = palette[i % palette.length];
    normal.set(0, 0, 1).transformDirection(matrix);
    for (const [x,y,z] of verts) {
      point.set(x,y,z).applyMatrix4(matrix); positions.push(point.x, point.y, point.z);
      normals.push(normal.x,normal.y,normal.z); colors.push(tint.r,tint.g,tint.b);
    }
    indices.push(base,base+1,base+2,base,base+2,base+3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices); geometry.computeBoundingSphere();
  return geometry;
}

export function buildTrees(placements, seed) {
  const group = new THREE.Group(); group.name = 'Street trees with branches and leaf clusters';
  if (!placements.length) return { group, dispose() {} };
  const tree = new TreeGenerator().setSeed(812).setTrunkLength(4.0).setTrunkRadius(.17)
    .setLevels(3).setChildren([4, 5]).setTrunkClear(.58).setLengthRatio(.68)
    .setAngleVariance(18).setRadialSegments(6).build();
  const branches = new THREE.InstancedMesh(tree.geometry, tree.material, placements.length);
  placements.forEach((matrix, i) => branches.setMatrixAt(i, matrix));
  branches.instanceMatrix.needsUpdate = true; branches.castShadow = branches.receiveShadow = true;
  branches.computeBoundingSphere(); group.add(branches);

  const geometry = makeLeafCluster();
  const material = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: .9, side: THREE.DoubleSide });
  const countPerTree = 80, leaves = new THREE.InstancedMesh(geometry, material, placements.length * countPerTree);
  const random = randomFromSeed(seed ^ 0x76ab15), transform = new THREE.Object3D();
  const base = new THREE.Vector3(), scale = new THREE.Vector3(), quaternion = new THREE.Quaternion();
  let index = 0;
  for (const placement of placements) {
    placement.decompose(base, quaternion, scale);
    for (let j = 0; j < countPerTree; j++) {
      // Uniformly distributed foliage clusters make gaps through the crown visible.
      const azimuth = random() * Math.PI * 2, vertical = random() * 2 - 1;
      const radial = Math.sqrt(1 - vertical * vertical) * Math.cbrt(random());
      const offset = new THREE.Vector3(Math.cos(azimuth)*radial*2.2, 4.8 + vertical*1.55, Math.sin(azimuth)*radial*2.2);
      offset.multiply(scale).applyQuaternion(quaternion);
      transform.position.copy(base).add(offset);
      transform.rotation.set((random()-.5)*1.8, random()*Math.PI*2, (random()-.5)*1.8);
      const size = (1.2 + random() * .8) * scale.x; transform.scale.setScalar(size); transform.updateMatrix();
      leaves.setMatrixAt(index++, transform.matrix);
    }
  }
  leaves.instanceMatrix.needsUpdate = true; leaves.castShadow = leaves.receiveShadow = true;
  leaves.computeBoundingSphere(); group.add(leaves);
  return { group, dispose() { branches.dispose(); leaves.dispose(); tree.geometry.dispose(); tree.material.dispose(); geometry.dispose(); material.dispose(); } };
}
