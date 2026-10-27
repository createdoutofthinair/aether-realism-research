import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three/webgpu';
import { buildCity, buildCityShell, buildBuildingChunk, packInstanceMatrices, unpackInstanceMatrices, packGlazingTopology, unpackGlazingTopology } from '../src/city.js';
import { GlazingBatch } from '../src/glazing.js';
import { CITY } from '../src/plan.js';

test('packed yaw and scale transforms round-trip without numerical changes', () => {
  const original=new Float32Array(16*3), result=new Float32Array(16*3), o=new THREE.Object3D();
  for(let i=0;i<3;i++) { o.position.set(i+1,i+2,-i-3);o.rotation.y=i*.57;o.scale.set(1+i,2+i,3+i);o.updateMatrix();original.set(o.matrix.elements,i*16); }
  const packed=packInstanceMatrices(original,3);unpackInstanceMatrices(packed,result,3);
  assert.equal(packed.byteLength,original.byteLength/2);
  for(let i=0;i<original.length;i++) assert.equal(result[i],original[i],`matrix element ${i}`);
});

test('compressed glazing meshlets preserve winding, indices and conservative hierarchical bounds', () => {
  const batch=new GlazingBatch();
  for(let i=0;i<41;i++) batch.add({x:i-20,y:3+i%7,z:i%5,width:1.4,height:2,axis:i%2?'x':'z',sign:i%3?1:-1});
  const mesh=batch.build(), positions=mesh.geometry.attributes.position.array, index=mesh.geometry.index.array;
  const page=packGlazingTopology(index,positions);
  assert.deepEqual(unpackGlazingTopology(page),index);
  assert.ok(page.winding.byteLength+page.nodes.byteLength+page.bounds.byteLength<index.byteLength);
  const check=node=>{
    const n=node*4, b=node*6, left=page.nodes[n],right=page.nodes[n+1];
    if(left<0) {
      const first=page.nodes[n+2],count=page.nodes[n+3];
      assert.ok(count<=32*3);
      for(let j=first;j<first+count;j++) {
        const p=index[j]*3;
        for(let k=0;k<3;k++) assert.ok(positions[p+k]>=page.bounds[b+k] && positions[p+k]<=page.bounds[b+3+k]);
      }
    } else {
      for(const child of [left,right]) {
        for(let k=0;k<3;k++) assert.ok(page.bounds[child*6+k]>=page.bounds[b+k] && page.bounds[child*6+3+k]<=page.bounds[b+3+k]);
        check(child);
      }
    }
  };
  check(0);batch.dispose();
});

test('independent building chunks preserve generated architecture and bounds', () => {
  const source=buildCity(1827), streamed=buildCityShell(1827);
  for(const block of source.plan.blocks) {
    const buildings=source.plan.buildings.filter(b=>Math.floor(b.x/CITY.span)===block.bx && Math.floor(b.z/CITY.span)===block.bz);
    streamed.append(buildBuildingChunk(buildings).meshes);
  }
  const collect = city => {
    const instances=[], heritage=[], glazing=[];
    city.group.traverse(mesh=>{
      if(!mesh.userData.visibilityBounds) return;
      if(mesh.isInstancedMesh) {
        const matrix=new THREE.Matrix4();
        for(let i=0;i<mesh.count;i++) {mesh.getMatrixAt(i,matrix);instances.push(`${mesh.name.split(':')[1]}|${mesh.userData.visibilityRole}|${mesh.userData.visibilityFeature}|${matrix.elements.join(',')}`);}
      } else if(mesh.name.startsWith('glazing:')) {
        const positions=mesh.geometry.getAttribute('position').array;
        for(let i=0;i<positions.length;i+=3) glazing.push(`${positions[i]},${positions[i+1]},${positions[i+2]}`);
      } else heritage.push(`${mesh.position.x},${mesh.position.z}:${mesh.geometry.getAttribute('position').count}`);
      assert.ok(mesh.userData.visibilityBounds && !mesh.userData.visibilityBounds.isEmpty());
    });
    return {instances:instances.sort(),glazing:glazing.sort(),heritage:heritage.sort()};
  };
  assert.deepEqual(collect(streamed),collect(source));
  streamed.dispose(); source.dispose();
});

test('page cache budget evicts oldest pages and refuses a page larger than the budget', async () => {
  const { selectEvictions, chunkKey }=await import('../src/chunkCache.js');
  const items=[{key:'a',bytes:4,touched:1},{key:'b',bytes:5,touched:3},{key:'c',bytes:3,touched:2}];
  assert.deepEqual(selectEvictions(items,'d',6,12),{remove:['a','c'],fits:true});
  assert.deepEqual(selectEvictions(items,'b',2,12),{remove:[],fits:true});
  assert.deepEqual(selectEvictions(items,'d',20,12),{remove:['a','c','b'],fits:false});
  assert.notEqual(chunkKey(1,0,0,[{x:1}]),chunkKey(1,0,0,[{x:2}]));
});
