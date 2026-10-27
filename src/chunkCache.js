// The cache stores independently generated block pages. It is optional: browser
// storage restrictions or quota errors fall back to regenerating the pages.
export const PAGE_CACHE_BUDGET = 64 * 1024 * 1024;
export const PAGE_FORMAT = 'city-block-v1';
export function chunkKey(seed, bx, bz, buildings) {
  // Include the content of the plan as well as its seed. This prevents a
  // changed generator or a partial test plan from reusing an unrelated page.
  const text=JSON.stringify(buildings); let hash=2166136261;
  for(let i=0;i<text.length;i++) hash=Math.imul(hash^text.charCodeAt(i),16777619)>>>0;
  return `${PAGE_FORMAT}:${seed}:${bx},${bz}:${hash.toString(16)}`;
}

export function selectEvictions(records, incomingKey, incomingBytes, budget=PAGE_CACHE_BUDGET) {
  const rest=records.filter(record=>record.key!==incomingKey).sort((a,b)=>a.touched-b.touched);
  let total=rest.reduce((sum,record)=>sum+record.bytes,0)+incomingBytes;
  const remove=[];
  for(const item of rest) {
    if(total<=budget) break;
    remove.push(item.key);total-=item.bytes;
  }
  return {remove, fits:total<=budget};
}

function transactionDone(tx) {
  return new Promise((resolve,reject)=>{
    tx.oncomplete=()=>resolve();
    tx.onabort=tx.onerror=()=>reject(tx.error || new Error('Chunk storage transaction failed'));
  });
}
function requestResult(request) {
  return new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
}
export async function openChunkCache(indexedDb=globalThis.indexedDB, budget=PAGE_CACHE_BUDGET, name='aether-city-block-cache') {
  if(!indexedDb) return null;
  try {
    const request=indexedDb.open(name,1);
    request.onupgradeneeded=()=>{const db=request.result;db.createObjectStore('pages');db.createObjectStore('metadata',{keyPath:'key'});};
    const db=await new Promise((resolve,reject)=>{
      request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);request.onblocked=()=>reject(new Error('Chunk cache is blocked'));
    });
    db.onversionchange=()=>db.close();
    const metaTx=db.transaction('metadata','readonly');
    const records=await requestResult(metaTx.objectStore('metadata').getAll());
    const metadata=new Map(records.map(record=>[record.key,record]));
    return {
      async get(key) {
        try {
          if(!metadata.has(key)) return null;
          const tx=db.transaction('pages','readonly'), value=await requestResult(tx.objectStore('pages').get(key));
          if(!value) { metadata.delete(key); return null; }
          const record={...metadata.get(key),touched:Date.now()};
          const update=db.transaction('metadata','readwrite');update.objectStore('metadata').put(record);await transactionDone(update);
          metadata.set(key,record);return value;
        } catch { return null; }
      },
      async put(key,meshes,bytes) {
        try {
          const plan=selectEvictions([...metadata.values()],key,bytes,budget);
          if(!plan.fits) return false;
          const tx=db.transaction(['pages','metadata'],'readwrite');
          const pages=tx.objectStore('pages'),meta=tx.objectStore('metadata');
          for(const old of plan.remove) {pages.delete(old);meta.delete(old);}
          const record={key,bytes,touched:Date.now()};pages.put(meshes,key);meta.put(record);
          await transactionDone(tx);
          for(const old of plan.remove) metadata.delete(old);
          metadata.set(key,record);return true;
        } catch { return false; }
      },
      close() { db.close(); },
    };
  } catch { return null; }
}

export function chunkTransfers(meshes) {
  const result=[], seen=new Set();
  const add=array=>{if(array?.buffer && !seen.has(array.buffer)){seen.add(array.buffer);result.push(array.buffer);}};
  for(const mesh of meshes) {
    add(mesh.matrices);add(mesh.index?.array);
    for(const attr of Object.values(mesh.attributes || {})) add(attr.array);
    if(mesh.indexPage) {add(mesh.indexPage.winding);add(mesh.indexPage.bounds);add(mesh.indexPage.nodes);}
  }
  return result;
}
