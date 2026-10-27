import * as THREE from 'three/webgpu';
import { color } from 'three/tsl';
import { createSkyscraperMaterial } from 'three/addons/generators/city/SkyscraperGenerator.js';

// A single indexed mesh carries the actual front planes of the recessed panes.
// The Three.js material raycasts an approximate room behind each pane in the shader.
// Room metadata is stored per vertex because a pane is only four vertices.
export class GlazingBatch {
  constructor() {
    this.position = []; this.normal = []; this.uv = []; this.center = [];
    this.roomSize = []; this.part = []; this.indices = [];
    this.count = 0; this.mesh = null;
  }

  add({ x, y, z, width, height, axis, sign }) {
    const hw = width / 2, hh = height / 2;
    const along = axis === 'x' ? [0, 0, 1] : [1, 0, 0];
    const outward = axis === 'x' ? [sign, 0, 0] : [0, 0, sign];
    const start = this.position.length / 3;
    for (const [u, v, tx, ty] of [[-hw,-hh,0,0], [hw,-hh,1,0], [hw,hh,1,1], [-hw,hh,0,1]]) {
      this.position.push(x + along[0] * u, y + v, z + along[2] * u);
      this.normal.push(...outward); this.uv.push(tx, ty); this.center.push(x, y, z);
      this.roomSize.push(width, height); this.part.push(4);
    }
    // +X across up is +Z; +Z across up is -X.
    const forward = axis === 'z' ? sign > 0 : sign < 0;
    if (forward) this.indices.push(start, start+1, start+2, start, start+2, start+3);
    else this.indices.push(start, start+2, start+1, start, start+3, start+2);
    this.count++;
  }

  build() {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.position, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(this.normal, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    geometry.setAttribute('roomCenter', new THREE.Float32BufferAttribute(this.center, 3));
    geometry.setAttribute('roomSize', new THREE.Float32BufferAttribute(this.roomSize, 2));
    geometry.setAttribute('partId', new THREE.Float32BufferAttribute(this.part, 1));
    geometry.setIndex(this.indices); geometry.computeBoundingSphere();
    const material = createSkyscraperMaterial(color(0xc6c0b2));
    const mesh = new THREE.Mesh(geometry, material); mesh.name = 'Recessed glazing and procedural interiors';
    mesh.receiveShadow = true; this.mesh = mesh; return mesh;
  }

  dispose() { if (this.mesh) { this.mesh.geometry.dispose(); this.mesh.material.dispose(); } }
}
