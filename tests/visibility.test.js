import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three/webgpu';
import { createOccluders, featurePixels, isOccluded, projectedBounds } from '../src/visibilityMath.js';
import { planCity } from '../src/plan.js';
import { buildCity } from '../src/city.js';

function cameraAt(x=0, y=5, z=10, look=[0,5,-10]) {
  const camera=new THREE.PerspectiveCamera(60,1,.1,100);
  camera.coordinateSystem=THREE.WebGPUCoordinateSystem; camera.updateProjectionMatrix();
  camera.position.set(x,y,z); camera.lookAt(...look); camera.updateMatrixWorld();
  return {eye:[x,y,z], matrix:new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse)};
}
const occ={min:[-4,0,-1],max:[4,10,1]};

test('only a wholly covered, farther cluster is occluded by an opaque face', () => {
  const {eye,matrix}=cameraAt();
  assert.equal(isOccluded({min:[-1,3,-12],max:[1,7,-10]},eye,matrix,[occ]),true);
  assert.equal(isOccluded({min:[8,3,-12],max:[10,7,-10]},eye,matrix,[occ]),false);
  assert.equal(isOccluded({min:[-1,3,4],max:[1,7,6]},eye,matrix,[occ]),false);
  assert.equal(isOccluded({min:[6,3,-12],max:[12,7,-10]},eye,matrix,[occ]),false);
  assert.equal(isOccluded({min:[-1,3,9.95],max:[1,7,10.05]},eye,matrix,[occ]),false, 'near-plane intersections stay visible');
});

test('camera movement can reveal a previously hidden cluster', () => {
  const box={min:[-1,3,-12],max:[1,7,-10]};
  const before=cameraAt(),after=cameraAt(20,5,10,[0,5,-10]);
  assert.ok(projectedBounds(box,before.matrix));
  assert.equal(isOccluded(box,before.eye,before.matrix,[occ]),true);
  assert.equal(isOccluded(box,after.eye,after.matrix,[occ]),false);
});

test('detail size scales with projection and distance', () => {
  const box={min:[-1,-1,-21],max:[1,1,-19],feature:.05};
  assert.ok(featurePixels(box,[0,0,0],900) > featurePixels(box,[0,0,0],450));
  assert.ok(featurePixels(box,[0,0,-15],900) > featurePixels(box,[0,0,0],900));
});

test('building occluders are inset opaque cores and exclude unverified shapes', () => {
  const plan=planCity(1827), boxes=createOccluders(plan);
  assert.ok(boxes.length>0 && boxes.length<plan.buildings.length);
  for(const o of boxes){
    const building=plan.buildings.find(b=>b.id===o.id);
    assert.ok(!['heritage','round','lobed'].includes(building.kind));
    assert.ok(o.min[0]>building.collider.minX && o.max[0]<building.collider.maxX);
    assert.ok(o.min[2]>building.collider.minZ && o.max[2]<building.collider.maxZ);
    assert.ok(o.min[1]>.19 && o.max[1]<.19+building.floors*building.floorHeight);
  }
});

test('every generated occluder is backed by an actual opaque core instance', () => {
  const city=buildCity(1827), matrix=new THREE.Matrix4(), position=new THREE.Vector3(), rotation=new THREE.Quaternion(), scale=new THREE.Vector3();
  const candidates=city.group.children.filter(mesh=>mesh.isInstancedMesh && mesh.name.startsWith('box:') && mesh.userData.visibilityRole===1);
  for(const box of createOccluders(city.plan)) {
    const center=new THREE.Vector3(...box.min).add(new THREE.Vector3(...box.max)).multiplyScalar(.5);
    const size=new THREE.Vector3(...box.max).sub(new THREE.Vector3(...box.min)).addScalar(.16);
    let found=false;
    for(const mesh of candidates) {
      if (!mesh.userData.visibilityBounds.containsPoint(center)) continue;
      for(let i=0;i<mesh.count;i++) {
        mesh.getMatrixAt(i,matrix);matrix.decompose(position,rotation,scale);
        if(position.distanceTo(center)<.001 && scale.distanceTo(size)<.001) { found=true; break; }
      }
      if(found) break;
    }
    assert.ok(found,`opaque core exists for ${box.id}`);
  }
  city.dispose();
});

test('culled random boxes have every corner behind the opaque volume', () => {
  const {eye,matrix}=cameraAt(), eye3=new THREE.Vector3(...eye), occBox=new THREE.Box3(new THREE.Vector3(...occ.min),new THREE.Vector3(...occ.max));
  let seed=31, count=0;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  for(let i=0;i<500;i++) {
    const x=random()*20-10,y=random()*8,z=-4-random()*30;
    const box={min:[x,y,z],max:[x+.1+random()*3,y+.1+random()*3,z+.1+random()*3]};
    if(!isOccluded(box,eye,matrix,[occ])) continue;
    count++;
    for(const px of [box.min[0],box.max[0]]) for(const py of [box.min[1],box.max[1]]) for(const pz of [box.min[2],box.max[2]]) {
      const target=new THREE.Vector3(px,py,pz),delta=target.clone().sub(eye3),ray=new THREE.Ray(eye3,delta.clone().normalize()),hit=ray.intersectBox(occBox,new THREE.Vector3());
      assert.ok(hit && hit.distanceTo(eye3) < delta.length(), 'each corner ray intersects the occluder first');
    }
  }
  assert.ok(count>0);
});
