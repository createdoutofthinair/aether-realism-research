import { buildBuildingChunk } from './city.js';
import { CITY } from './plan.js';
import { openChunkCache, chunkTransfers, chunkKey } from './chunkCache.js';

// Pages are requested nearest-first. A worker may be terminated when the seed
// changes; its last committed IndexedDB transaction remains consistent.
self.onmessage = async event => {
  const { plan, origin } = event.data;
  const cache=await openChunkCache();
  try {
    const blocks = [...plan.blocks].sort((a,b) => Math.hypot(a.x-origin.x,a.z-origin.z)-Math.hypot(b.x-origin.x,b.z-origin.z));
    for (let i=0; i<blocks.length; i++) {
      const block=blocks[i];
      const buildings=plan.buildings.filter(b=>Math.floor(b.x/CITY.span)===block.bx && Math.floor(b.z/CITY.span)===block.bz);
      const key=chunkKey(plan.seed,block.bx,block.bz,buildings);
      let meshes=await cache?.get(key), cached=!!meshes;
      if(!meshes) {
        meshes=buildBuildingChunk(buildings).meshes;
      }
      const transfers=chunkTransfers(meshes), bytes=transfers.reduce((sum,buffer)=>sum+buffer.byteLength,0);
      if(!cached) await cache?.put(key,meshes,bytes);
      self.postMessage({ type:'chunk', key:`${block.bx},${block.bz}`, meshes, completed:i+1, total:blocks.length, cached, bytes },transfers);
    }
    self.postMessage({type:'done'});
  } catch(error) {
    self.postMessage({type:'error',message:error instanceof Error ? error.message : String(error)});
  } finally { cache?.close(); }
};
