// WebGPU compute pass for conservative opaque-box occlusion and screen-space
// removal of small architectural features. Shadow commands are never changed.
export const VISIBILITY_WGSL = /* wgsl */ `
struct Cluster { low: vec4f, high: vec4f, lod: vec4f }
struct Occluder { low: vec4f, high: vec4f }
struct Block { low: vec4f, high: vec4f }
struct Command { indexCount: u32, instanceCount: u32, firstIndex: u32, baseVertex: i32, firstInstance: u32 }
struct Frame { viewProjection: mat4x4f, eye: vec4f, control: vec4f, viewport: vec4f }
struct PyramidLevel { sourceOffset: u32, destinationOffset: u32, sourceSize: u32, destinationSize: u32 }
struct ProjectedBounds { low: vec2f, high: vec2f, nearDepth: f32, valid: u32 }
@group(0) @binding(0) var<storage, read> clusters: array<Cluster>;
@group(0) @binding(1) var<storage, read_write> commands: array<Command>;
@group(0) @binding(2) var<storage, read> occluders: array<Occluder>;
@group(0) @binding(3) var<uniform> frame: Frame;
@group(0) @binding(4) var<storage, read_write> lodState: array<u32>;
@group(0) @binding(5) var<storage, read> blocks: array<Block>;
@group(0) @binding(6) var<storage, read_write> pyramid: array<f32>;
@group(0) @binding(7) var<uniform> level: PyramidLevel;

fn cross2(a: vec2f, b: vec2f) -> f32 { return a.x*b.y - a.y*b.x; }
fn projected(p: vec3f) -> vec4f { return frame.viewProjection * vec4f(p, 1.0); }
fn projectBounds(box: Cluster) -> ProjectedBounds {
  var low = vec2f(1e20); var high = vec2f(-1e20); var nearest = 1e20;
  for (var i = 0u; i < 8u; i++) {
    let p = vec3f(select(box.low.x, box.high.x, (i & 1u) != 0u),
                  select(box.low.y, box.high.y, (i & 2u) != 0u),
                  select(box.low.z, box.high.z, (i & 4u) != 0u));
    let clip = projected(p);
    if (clip.w <= 0.0001 || clip.z <= 0.0) { return ProjectedBounds(low, high, nearest, 0u); }
    let ndc = clip.xyz / clip.w;
    low = min(low, ndc.xy); high = max(high, ndc.xy); nearest = min(nearest, ndc.z);
  }
  return ProjectedBounds(low, high, nearest, 1u);
}
fn edgeInside(a: vec2f, b: vec2f, p: vec2f, sign: f32, margin: f32) -> bool {
  let edge = b - a;
  return cross2(edge, p-a) * sign > margin * length(edge);
}
fn rectInsideFace(rect: ProjectedBounds, a: vec2f, b: vec2f, c: vec2f, d: vec2f) -> bool {
  let winding = cross2(b-a, c-a);
  if (abs(winding) < 0.00000001) { return false; }
  let sign = select(-1.0, 1.0, winding > 0.0);
  let margin = 4.0 / max(1.0, min(frame.viewport.x, frame.viewport.y));
  var p: array<vec2f, 4>;
  p[0]=rect.low; p[1]=vec2f(rect.high.x,rect.low.y); p[2]=rect.high; p[3]=vec2f(rect.low.x,rect.high.y);
  for (var i=0u; i<4u; i++) {
    if (!edgeInside(a,b,p[i],sign,margin) || !edgeInside(b,c,p[i],sign,margin) ||
        !edgeInside(c,d,p[i],sign,margin) || !edgeInside(d,a,p[i],sign,margin)) { return false; }
  }
  return true;
}
fn faceOccludes(rect: ProjectedBounds, p0: vec3f, p1: vec3f, p2: vec3f, p3: vec3f) -> bool {
  let a=projected(p0); let b=projected(p1); let c=projected(p2); let d=projected(p3);
  if (min(min(a.w,b.w),min(c.w,d.w)) <= 0.0001 || min(min(a.z,b.z),min(c.z,d.z)) <= 0.0) { return false; }
  let aa=a.xyz/a.w; let bb=b.xyz/b.w; let cc=c.xyz/c.w; let dd=d.xyz/d.w;
  if (max(max(aa.z,bb.z),max(cc.z,dd.z)) + 0.00005 >= rect.nearDepth) { return false; }
  return rectInsideFace(rect, aa.xy, bb.xy, cc.xy, dd.xy);
}
fn occludes(rect: ProjectedBounds, box: Occluder) -> bool {
  let lo=box.low.xyz; let hi=box.high.xyz; let eye=frame.eye.xyz;
  if (eye.x < lo.x || eye.x > hi.x) {
    let x=select(hi.x,lo.x,eye.x < lo.x);
    if (faceOccludes(rect,vec3f(x,lo.y,lo.z),vec3f(x,hi.y,lo.z),vec3f(x,hi.y,hi.z),vec3f(x,lo.y,hi.z))) { return true; }
  }
  if (eye.z < lo.z || eye.z > hi.z) {
    let z=select(hi.z,lo.z,eye.z < lo.z);
    if (faceOccludes(rect,vec3f(lo.x,lo.y,z),vec3f(hi.x,lo.y,z),vec3f(hi.x,hi.y,z),vec3f(lo.x,hi.y,z))) { return true; }
  }
  return false;
}
// A tile is covered only if every corner is strictly inside one *opaque* face.
// Store the farthest depth of that face; a clear tile stores 1.0 (far plane).
fn faceTileDepth(rect: ProjectedBounds, p0: vec3f, p1: vec3f, p2: vec3f, p3: vec3f) -> f32 {
  let a=projected(p0); let b=projected(p1); let c=projected(p2); let d=projected(p3);
  if (min(min(a.w,b.w),min(c.w,d.w)) <= .0001 || min(min(a.z,b.z),min(c.z,d.z)) <= 0.0) { return 1.0; }
  let aa=a.xyz/a.w; let bb=b.xyz/b.w; let cc=c.xyz/c.w; let dd=d.xyz/d.w;
  if (!rectInsideFace(rect,aa.xy,bb.xy,cc.xy,dd.xy)) { return 1.0; }
  return clamp(max(max(aa.z,bb.z),max(cc.z,dd.z)),0.0,1.0);
}
@compute @workgroup_size(64)
fn buildPyramidBase(@builtin(global_invocation_id) invocation: vec3u) {
  let i=invocation.x; let size=level.destinationSize;
  if (i >= size*size) { return; }
  let x=i%size; let y=i/size;
  let low=vec2f(f32(x),f32(y))*2.0/f32(size)-vec2f(1.0);
  let high=vec2f(f32(x+1u),f32(y+1u))*2.0/f32(size)-vec2f(1.0);
  let rect=ProjectedBounds(low,high,0.0,1u);
  var depth=1.0;
  for (var j=0u; j<u32(frame.control.z); j++) {
    let box=occluders[j]; let lo=box.low.xyz; let hi=box.high.xyz; let eye=frame.eye.xyz;
    if (eye.x < lo.x || eye.x > hi.x) {
      let xx=select(hi.x,lo.x,eye.x<lo.x);
      depth=min(depth,faceTileDepth(rect,vec3f(xx,lo.y,lo.z),vec3f(xx,hi.y,lo.z),vec3f(xx,hi.y,hi.z),vec3f(xx,lo.y,hi.z)));
    }
    if (eye.z < lo.z || eye.z > hi.z) {
      let zz=select(hi.z,lo.z,eye.z<lo.z);
      depth=min(depth,faceTileDepth(rect,vec3f(lo.x,lo.y,zz),vec3f(hi.x,lo.y,zz),vec3f(hi.x,hi.y,zz),vec3f(lo.x,hi.y,zz)));
    }
  }
  pyramid[level.destinationOffset+i]=depth;
}
@compute @workgroup_size(64)
fn reducePyramid(@builtin(global_invocation_id) invocation: vec3u) {
  let i=invocation.x; let size=level.destinationSize;
  if (i >= size*size) { return; }
  let x=(i%size)*2u; let y=(i/size)*2u; let row=level.sourceOffset+y*level.sourceSize+x;
  pyramid[level.destinationOffset+i]=max(max(pyramid[row],pyramid[row+1u]),max(pyramid[row+level.sourceSize],pyramid[row+level.sourceSize+1u]));
}
fn pyramidOccludes(rect: ProjectedBounds) -> bool {
  let margin=vec2f(4.0/max(1.0,min(frame.viewport.x,frame.viewport.y)));
  let low=rect.low-margin; let high=rect.high+margin;
  if (any(low < vec2f(-1.0)) || any(high > vec2f(1.0)) || rect.nearDepth >= 1.0) { return false; }
  var size=64u; var offset=0u;
  var start=vec2u(clamp(floor((low+vec2f(1.0))*0.5*f32(size)),vec2f(0.0),vec2f(f32(size-1u))));
  var end=vec2u(clamp(floor((high+vec2f(1.0))*0.5*f32(size)),vec2f(0.0),vec2f(f32(size-1u))));
  loop {
    if (all(end-start <= vec2u(1u)) || size == 1u) { break; }
    offset+=size*size; size/=2u; start/=2u; end/=2u;
  }
  var farthest=0.0;
  for(var y=start.y; y<=end.y; y++) { for(var x=start.x; x<=end.x; x++) { farthest=max(farthest,pyramid[offset+y*size+x]); } }
  return farthest + .00005 < rect.nearDepth;
}
@compute @workgroup_size(64)
fn selectLod(@builtin(global_invocation_id) invocation: vec3u) {
  let i=invocation.x;
  if (i >= arrayLength(&blocks)) { return; }
  let flags=u32(frame.control.w);
  if ((flags & 4u) != 0u) { lodState[i]=1u; return; }
  if ((flags & 1u) == 0u) { lodState[i]=0u; return; }
  let box=blocks[i];
  if ((flags & 16u) != 0u) {
    // Both alternatives lie inside this union box. Its entire projected
    // diagonal bounds their possible positional difference in screen space.
    let projectedBox=projectBounds(Cluster(box.low,box.high,vec4f(0.0)));
    if (projectedBox.valid == 0u) { lodState[i]=0u; return; }
    let diagonal=length((projectedBox.high-projectedBox.low)*frame.viewport.xy*.5);
    if (lodState[i] == 0u && diagonal < .85) { lodState[i]=1u; }
    if (lodState[i] == 1u && diagonal > 1.15) { lodState[i]=0u; }
    return;
  }
  let delta=max(max(box.low.xyz-frame.eye.xyz,frame.eye.xyz-box.high.xyz),vec3f(0.0));
  let storeyPixels=box.low.w*frame.control.x/max(.01,length(delta));
  let threshold=frame.viewport.z;
  if (lodState[i] == 0u && storeyPixels < threshold*0.85) { lodState[i]=1u; }
  if (lodState[i] == 1u && storeyPixels > threshold*1.15) { lodState[i]=0u; }
}
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) invocation: vec3u) {
  let i=invocation.x;
  if (i >= arrayLength(&clusters)) { return; }
  let box=clusters[i]; let flags=u32(frame.control.w);
  var visible=true;
  let role=u32(box.lod.x); let block=u32(box.lod.y);
  if ((role == 1u && lodState[block] == 1u) || (role == 2u && lodState[block] == 0u)) { visible=false; }
  if (visible && (flags & 1u) != 0u && (flags & 32u) == 0u && box.low.w > 0.0) {
    let delta=max(max(box.low.xyz-frame.eye.xyz,frame.eye.xyz-box.high.xyz),vec3f(0.0));
    let projectedSize=box.low.w*frame.control.x/max(.01,length(delta));
    let wasVisible=commands[2u*i].instanceCount > 0u;
    let hysteresis=select(1.15,0.85,wasVisible);
    visible=projectedSize >= frame.control.y*hysteresis;
  }
  if (visible && (flags & 2u) != 0u) {
    let rect=projectBounds(box);
    if (rect.valid != 0u) {
      for (var j=0u; j<u32(frame.control.z); j++) {
        if (occludes(rect,occluders[j])) { visible=false; break; }
      }
      if (visible && (flags & 8u) != 0u && pyramidOccludes(rect)) { visible=false; }
    }
  }
  commands[2u*i].instanceCount=select(0u,u32(box.high.w),visible);
}
`;
