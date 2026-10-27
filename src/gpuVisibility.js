import * as THREE from 'three/webgpu';
import { AttributeType } from 'three/src/renderers/common/Constants.js';
import { createOccluders } from './visibilityMath.js';
import { VISIBILITY_WGSL } from './visibilityShader.js';
import { MESHLET_WGSL } from './meshletShader.js';
import { CITY } from './plan.js';

// This small WebGPU subsystem shares an indirect buffer with Three.js. Its
// pinned-r186 renderer attribute manager initializes the shared buffer; the
// backend accessor supplies it to our WGSL compute pass.
const pipelines = new WeakMap();
const meshletPipelines = new WeakMap();
async function getMeshletPipeline(device) {
  if(!meshletPipelines.has(device)) meshletPipelines.set(device,(async()=>{
    const module=device.createShaderModule({label:'glazing meshlet visibility',code:MESHLET_WGSL});
    const info=await module.getCompilationInfo(), errors=info.messages.filter(message=>message.type==='error');
    if(errors.length) throw new Error(errors.map(error=>`${error.lineNum}:${error.linePos} ${error.message}`).join('\n'));
    const bindings=['read-only-storage','read-only-storage','storage','storage','uniform','read-only-storage','storage','uniform'];
    const layout=device.createBindGroupLayout({entries:bindings.map((type,binding)=>({binding,visibility:GPUShaderStage.COMPUTE,buffer:{type}}))});
    const pipelineLayout=device.createPipelineLayout({bindGroupLayouts:[layout]});
    const [compact,finish]=await Promise.all(['compact','finish'].map(entryPoint=>device.createComputePipelineAsync({layout:pipelineLayout,compute:{module,entryPoint}})));
    return {layout,compact,finish};
  })());
  return meshletPipelines.get(device);
}
async function getPipeline(device) {
  if (!pipelines.has(device)) pipelines.set(device, (async () => {
    const module = device.createShaderModule({ label: 'city visibility', code: VISIBILITY_WGSL });
    const info = await module.getCompilationInfo();
    const errors = info.messages.filter(message => message.type === 'error');
    if (errors.length) throw new Error(errors.map(error => `${error.lineNum}:${error.linePos} ${error.message}`).join('\n'));
    const bindings=['read-only-storage','storage','read-only-storage','uniform','storage','read-only-storage','storage','uniform'];
    const layout=device.createBindGroupLayout({entries:bindings.map((type,binding)=>({binding,visibility:GPUShaderStage.COMPUTE,buffer:{type}}))});
    const pipelineLayout=device.createPipelineLayout({bindGroupLayouts:[layout]});
    const [main,select,base,reduce]=await Promise.all(['main','selectLod','buildPyramidBase','reducePyramid'].map(entryPoint => device.createComputePipelineAsync({
      label:`city visibility ${entryPoint}`,layout:pipelineLayout,compute:{module,entryPoint},
    })));
    return {layout,main,select,base,reduce};
  })());
  return pipelines.get(device);
}
function storageBuffer(device, data, label) {
  const size = Math.max(32, data.byteLength);
  const buffer = device.createBuffer({ label, size, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  if (data.byteLength) device.queue.writeBuffer(buffer, 0, data);
  return buffer;
}
function geometryView(source, indirect, offset) {
  const view = new THREE.BufferGeometry();
  view.index = source.index; view.attributes = { ...source.attributes };
  view.morphAttributes = { ...source.morphAttributes }; view.morphTargetsRelative = source.morphTargetsRelative;
  view.groups = source.groups.map(group => ({ ...group }));
  view.drawRange = { ...source.drawRange };
  view.boundingBox = source.boundingBox; view.boundingSphere = source.boundingSphere;
  view.setIndirect(indirect, offset);
  return view;
}

export class GpuVisibility {
  static async create(renderer, city, camera) {
    if (!renderer.backend?.isWebGPUBackend || !renderer.backend.device) return null;
    const controller = new GpuVisibility(renderer, city, camera);
    try { await controller.init(); return controller; }
    catch (error) { controller.dispose(); throw error; }
  }
  constructor(renderer, city, camera) {
    this.renderer=renderer; this.city=city; this.camera=camera; this.device=renderer.backend.device;
    this.entries=[]; this.resources=[]; this.mode='adaptive'; this.threshold=1.25; this.matrix=new THREE.Matrix4(); this.size=new THREE.Vector2();
    this.timingSupported=this.device.features.has('timestamp-query'); this.timingRequested=false; this.timingPending=false; this.timingMs=null; this.disposed=false;
  }
  async init() {
    this.city.group.traverse(mesh => {
      if (!mesh.isMesh || !mesh.userData.visibilityBounds || Array.isArray(mesh.material)) return;
      const bounds=mesh.userData.visibilityBounds, count=mesh.isInstancedMesh ? mesh.count : 1;
      const vertices=mesh.geometry.index?.count ?? mesh.geometry.attributes.position?.count ?? 0;
      if (!vertices || !count || bounds.isEmpty()) return;
      this.entries.push({ mesh, bounds, count, vertices, feature: mesh.userData.visibilityFeature || 0,
        role: mesh.userData.visibilityRole || 0, block: mesh.userData.visibilityBlock });
    });
    if (!this.entries.length) throw new Error('No eligible visibility clusters');
    const blocks=new Map();
    for(const building of this.city.plan.buildings) {
      const bx=Math.floor(building.x/CITY.span),bz=Math.floor(building.z/CITY.span),key=`${bx},${bz}`;
      if(!blocks.has(key)) blocks.set(key,{bx,bz,top:0});
      const block=blocks.get(key);block.top=Math.max(block.top,CITY.curb+building.floors*building.floorHeight+5);
    }
    if (!blocks.size) blocks.set('0,0',{bx:0,bz:0,top:1});
    // Include actual near and far group bounds, even when a facade projects
    // across the nominal block edge. This supports the conservative error mode.
    for (const entry of this.entries) {
      const block=blocks.get(entry.block);
      if(!block || !entry.role) continue;
      if(!block.geometryBounds) block.geometryBounds=entry.bounds.clone();
      else block.geometryBounds.union(entry.bounds);
    }
    const blockIndices=new Map(),blockData=new Float32Array(blocks.size*8);
    this.blockBounds=[];
    [...blocks.entries()].forEach(([key,b],i)=>{
      const low=[b.bx*CITY.span,0,b.bz*CITY.span], high=[(b.bx+1)*CITY.span,b.top,(b.bz+1)*CITY.span];
      if(b.geometryBounds) for(let axis=0;axis<3;axis++) {
        low[axis]=Math.min(low[axis],b.geometryBounds.min.getComponent(axis));
        high[axis]=Math.max(high[axis],b.geometryBounds.max.getComponent(axis));
      }
      blockIndices.set(key,i);this.blockBounds.push({low,high});blockData.set([...low,3.25,...high,0],i*8);
    });
    this.blockCount=blocks.size;
    const commandData=new Uint32Array(this.entries.length * 10), clusterData=new Float32Array(this.entries.length * 12);
    this.entries.forEach((entry, i) => {
      const block=blockIndices.get(entry.block);
      if (block===undefined) entry.role=0;
      entry.blockIndex=block??0; entry.streamable=entry.role===1 && entry.mesh.name.startsWith('glazing:'); entry.resident=true;
      for (const off of [i*10, i*10+5]) { commandData[off]=entry.vertices; commandData[off+1]=entry.role===2 ? 0 : entry.count; }
      const a=entry.bounds.min,b=entry.bounds.max;
      clusterData.set([a.x,a.y,a.z,entry.feature,b.x,b.y,b.z,entry.count,entry.role,block??0,0,0],i*12);
    });
    const occluders=createOccluders(this.city.plan), occluderData=new Float32Array(occluders.length*8);
    occluders.forEach((o,i) => occluderData.set([...o.min,0,...o.max,0],i*8));
    this.occluderCount=occluders.length;
    this.indirect=new THREE.IndirectStorageBufferAttribute(commandData,1);
    this.renderer._attributes.update(this.indirect,AttributeType.INDIRECT);
    const indirectBuffer=this.renderer.backend.get(this.indirect).buffer;
    if (!indirectBuffer) throw new Error('Three.js did not initialize the indirect buffer');
    const [pipeline,meshletPipeline]=await Promise.all([getPipeline(this.device),getMeshletPipeline(this.device)]);
    this.clusterBuffer=storageBuffer(this.device,clusterData,'city cluster bounds');
    this.occluderBuffer=storageBuffer(this.device,occluderData,'city opaque occluders');
    this.blockBuffer=storageBuffer(this.device,blockData,'city lod blocks');
    this.lodBuffer=storageBuffer(this.device,new Uint32Array(this.blockCount),'city lod state');
    this.frameBuffer=this.device.createBuffer({label:'city visibility camera',size:112,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
    const pyramidSize=64*64+32*32+16*16+8*8+4*4+2*2+1;
    this.pyramidBuffer=storageBuffer(this.device,new Float32Array(pyramidSize),'conservative depth pyramid');
    this.resources.push(this.clusterBuffer,this.occluderBuffer,this.blockBuffer,this.lodBuffer,this.frameBuffer,this.pyramidBuffer);
    this.pipeline=pipeline;this.meshletPipeline=meshletPipeline;this.indirectBuffer=indirectBuffer;
    this.pyramidLevels=[];
    let offset=0, size=64;
    while(size>=1) {
      const sourceSize=size===64 ? 64 : size*2;
      const sourceOffset=size===64 ? 0 : offset-sourceSize*sourceSize;
      const parameters=this.device.createBuffer({label:'pyramid level',size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
      this.device.queue.writeBuffer(parameters,0,new Uint32Array([sourceOffset,offset,sourceSize,size]));
      this.resources.push(parameters);
      const bindGroup=this.device.createBindGroup({layout:pipeline.layout,entries:[
        {binding:0,resource:{buffer:this.clusterBuffer}}, {binding:1,resource:{buffer:indirectBuffer}},
        {binding:2,resource:{buffer:this.occluderBuffer}}, {binding:3,resource:{buffer:this.frameBuffer}},
        {binding:4,resource:{buffer:this.lodBuffer}}, {binding:5,resource:{buffer:this.blockBuffer}},
        {binding:6,resource:{buffer:this.pyramidBuffer}}, {binding:7,resource:{buffer:parameters}},
      ]});
      this.pyramidLevels.push({size,bindGroup});offset+=size*size;size=Math.floor(size/2);
    }
    this.bindGroup=this.pyramidLevels[0].bindGroup;
    this.entries.forEach((entry,i) => {
      const mesh=entry.mesh, original=mesh.geometry, oldCallback=mesh.onBeforeRender;
      const view=geometryView(original,this.indirect,i*40);
      entry.original=original; entry.view=view; entry.callback=oldCallback;
      entry.originalVisible=mesh.visible;
      mesh.geometry=view;
      if (entry.role===2) mesh.visible=true;
      // Camera culling cannot discard off-screen shadow casters. Shadow cameras
      // always use an unfiltered command; the scene camera uses the GPU result.
      mesh.onBeforeRender=(render,scene,camera,geometry,material,group) => {
        view.indirectOffset=i*40+(camera===this.camera ? 0 : 20);
        oldCallback.call(mesh,render,scene,camera,geometry,material,group);
      };
    });
  }
  prepareMeshlet(entry, entryIndex) {
    if(!entry.mesh.userData.meshletHierarchy || !entry.original.index || entry.mesh.castShadow) return null;
    let compact=entry.compaction;
    if(!compact) {
      const hierarchy=entry.mesh.userData.meshletHierarchy, nodes=hierarchy.nodes, bounds=hierarchy.bounds, leaves=[];
      for(let i=0;i<nodes.length/4;i++) if(nodes[i*4]<0) {
        const b=i*6,n=i*4;
        leaves.push(bounds[b],bounds[b+1],bounds[b+2],nodes[n+2],bounds[b+3],bounds[b+4],bounds[b+5],nodes[n+3]);
      }
      if(!leaves.length) return null;
      const leafBuffer=storageBuffer(this.device,new Float32Array(leaves),'glazing meshlet bounds');
      const sourceBuffer=storageBuffer(this.device,new Uint32Array(entry.original.index.array),'glazing source indices');
      const counter=storageBuffer(this.device,new Uint32Array(1),'visible meshlet index count');
      const config=this.device.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
      this.device.queue.writeBuffer(config,0,new Uint32Array([entryIndex*2,0,0,0]));
      const index=new THREE.StorageBufferAttribute(new Uint32Array(entry.vertices),1);
      compact=entry.compaction={leafBuffer,sourceBuffer,counter,config,index,leafCount:leaves.length/8,bindGroup:null};
      this.resources.push(leafBuffer,sourceBuffer,counter,config);
    }
    if(!compact.bindGroup) {
      this.renderer._attributes.update(compact.index,AttributeType.INDEX);
      const output=this.renderer.backend.get(compact.index).buffer;
      compact.bindGroup=this.device.createBindGroup({layout:this.meshletPipeline.layout,entries:[
        {binding:0,resource:{buffer:compact.leafBuffer}},{binding:1,resource:{buffer:compact.sourceBuffer}},
        {binding:2,resource:{buffer:output}},{binding:3,resource:{buffer:compact.counter}},
        {binding:4,resource:{buffer:this.frameBuffer}},{binding:5,resource:{buffer:this.occluderBuffer}},
        {binding:6,resource:{buffer:this.indirectBuffer}},{binding:7,resource:{buffer:compact.config}},
      ]});
    }
    return compact;
  }
  update() {
    const {renderer,camera,device}=this;
    if (camera.coordinateSystem !== renderer.coordinateSystem) { camera.coordinateSystem=renderer.coordinateSystem; camera.updateProjectionMatrix(); }
    camera.updateMatrixWorld();
    this.matrix.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);
    renderer.getDrawingBufferSize(this.size);
    const focal=camera.projectionMatrix.elements[5]*this.size.y/2;
    // Glazing has unique buffers and casts no shadows. Retain CPU source data,
    // but evict its GPU buffers only after the block has safely reached far LOD.
    // Reload before the near representation can become visible again.
    for (const entry of this.entries) if(entry.streamable && entry.view) {
      const block=this.blockBounds[entry.blockIndex], eye=camera.position;
      const dx=Math.max(block.low[0]-eye.x,0,eye.x-block.high[0]);
      const dy=Math.max(block.low[1]-eye.y,0,eye.y-block.high[1]);
      const dz=Math.max(block.low[2]-eye.z,0,eye.z-block.high[2]);
      const pixels=3.25*focal/Math.max(.01,Math.hypot(dx,dy,dz));
      const forceNear=this.mode==='full'||this.mode==='occlusion'||this.mode==='stable';
      const forceFar=this.mode==='distant';
      if(entry.resident && !forceNear && (forceFar || pixels<2.8)) {
        entry.mesh.visible=false;entry.view.index=entry.original.index;entry.view.dispose();entry.resident=false;
        if(entry.compaction) {this.renderer._attributes.delete(entry.compaction.index);entry.compaction.bindGroup=null;}
      } else if(!entry.resident && (forceNear || (!forceFar && pixels>3.8))) {
        entry.mesh.visible=entry.originalVisible;entry.resident=true;
      }
    }
    const compactions=[];
    this.entries.forEach((entry,i)=>{
      if(!entry.view || !entry.original.index) return;
      if(this.mode==='meshlet' && entry.resident) {
        const compact=this.prepareMeshlet(entry,i);
        if(compact) {
          entry.view.index=compact.index;this.device.queue.writeBuffer(compact.counter,0,new Uint32Array([0]));
          compactions.push(compact);return;
        }
      }
      entry.view.index=entry.original.index;
      if(entry.compaction && this.lastMode==='meshlet') this.device.queue.writeBuffer(this.indirectBuffer,i*40,new Uint32Array([entry.vertices]));
    });
    this.lastMode=this.mode;
    const frame=new Float32Array(28); frame.set(this.matrix.elements,0);
    frame.set([camera.position.x,camera.position.y,camera.position.z,0],16);
    const flags={ full:0, detail:1, occlusion:2, adaptive:3, distant:7, hierarchy:11, stable:51, meshlet:3 }[this.mode] ?? 3;
    frame.set([focal,this.threshold,this.occluderCount,flags],20);
    frame.set([this.size.x,this.size.y,4,0],24);
    device.queue.writeBuffer(this.frameBuffer,0,frame);
    const timing=this.timingRequested && !this.timingPending && this.timingSupported;
    if(timing && !this.querySet) {
      this.querySet=device.createQuerySet({type:'timestamp',count:2});
      this.queryResolve=device.createBuffer({size:16,usage:GPUBufferUsage.QUERY_RESOLVE|GPUBufferUsage.COPY_SRC});
      this.queryRead=device.createBuffer({size:16,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
      this.resources.push(this.querySet,this.queryResolve,this.queryRead);
    }
    const encoder=device.createCommandEncoder({label:'city visibility'});
    const lod=encoder.beginComputePass(timing ? {timestampWrites:{querySet:this.querySet,beginningOfPassWriteIndex:0}} : {});
    lod.setPipeline(this.pipeline.select);lod.setBindGroup(0,this.bindGroup);lod.dispatchWorkgroups(Math.ceil(this.blockCount/64));lod.end();
    if(this.mode==='hierarchy') for(let i=0;i<this.pyramidLevels.length;i++) {
      const level=this.pyramidLevels[i], step=encoder.beginComputePass();
      step.setPipeline(i===0 ? this.pipeline.base : this.pipeline.reduce);step.setBindGroup(0,level.bindGroup);
      step.dispatchWorkgroups(Math.ceil(level.size*level.size/64));step.end();
    }
    const pass=encoder.beginComputePass(timing && !compactions.length ? {timestampWrites:{querySet:this.querySet,endOfPassWriteIndex:1}} : {});
    pass.setPipeline(this.pipeline.main);pass.setBindGroup(0,this.bindGroup);pass.dispatchWorkgroups(Math.ceil(this.entries.length/64));pass.end();
    if(compactions.length) {
      const compactPass=encoder.beginComputePass();compactPass.setPipeline(this.meshletPipeline.compact);
      for(const compact of compactions) {compactPass.setBindGroup(0,compact.bindGroup);compactPass.dispatchWorkgroups(Math.ceil(compact.leafCount/64));}
      compactPass.end();
      const finishPass=encoder.beginComputePass(timing ? {timestampWrites:{querySet:this.querySet,endOfPassWriteIndex:1}} : {});
      finishPass.setPipeline(this.meshletPipeline.finish);
      for(const compact of compactions) {finishPass.setBindGroup(0,compact.bindGroup);finishPass.dispatchWorkgroups(1);}
      finishPass.end();
    }
    if(timing) { encoder.resolveQuerySet(this.querySet,0,2,this.queryResolve,0);encoder.copyBufferToBuffer(this.queryResolve,0,this.queryRead,0,16); }
    device.queue.submit([encoder.finish()]);
    if(timing) {
      this.timingRequested=false;this.timingPending=true;
      this.queryRead.mapAsync(GPUMapMode.READ).then(() => {
        const values=new BigUint64Array(this.queryRead.getMappedRange());
        if(!this.disposed && values[1]>=values[0]) this.timingMs=Number(values[1]-values[0])/1e6;
        this.queryRead.unmap();
      }).catch(() => {}).finally(() => { this.timingPending=false; });
    }
  }
  requestTiming() { if(this.timingSupported && !this.timingPending) this.timingRequested=true; }
  async sample() {
    const bytes=await this.renderer.getArrayBufferAsync(this.indirect), words=new Uint32Array(bytes);
    let hidden=0,detail=0,distant=0,meshletIndices=0,meshletTotal=0;
    this.entries.forEach((entry,i) => {
      if(entry.role===2) { if(words[i*10+1]!==0) distant++; }
      else if(words[i*10+1]===0) { hidden++; if(entry.feature) detail++; }
      if(this.mode==='meshlet' && entry.compaction && entry.resident) {meshletTotal+=entry.vertices;meshletIndices+=words[i*10];}
    });
    const streamable=this.entries.filter(entry=>entry.streamable), streamedOut=streamable.filter(entry=>!entry.resident).length;
    return { clusters:this.entries.filter(entry=>entry.role!==2).length,hidden,detail,distant,occluders:this.occluderCount,streamedOut,streamable:streamable.length,meshletIndices,meshletTotal };
  }
  dispose() {
    this.disposed=true;
    for (const entry of this.entries) if (entry.view) {
      entry.view.index=entry.original.index;
      entry.mesh.geometry=entry.original; entry.mesh.onBeforeRender=entry.callback; entry.mesh.visible=entry.originalVisible; entry.view.dispose();
      if(entry.compaction) this.renderer._attributes.delete(entry.compaction.index);
    }
    this.entries.length=0;
    for (const resource of this.resources) resource.destroy(); this.resources.length=0;
    // Three currently lacks BufferAttribute.dispose(); release its backend allocation.
    if (this.indirect && this.renderer._attributes) this.renderer._attributes.delete(this.indirect);
    this.indirect=null;
  }
}
