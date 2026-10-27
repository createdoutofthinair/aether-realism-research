import { VISIBILITY_WGSL } from './visibilityShader.js';

// Reuse the exact conservative camera and opaque-face tests of the cluster path.
const helpers=VISIBILITY_WGSL.slice(VISIBILITY_WGSL.indexOf('fn cross2('),VISIBILITY_WGSL.indexOf('// A tile is covered'));
export const MESHLET_WGSL = /* wgsl */ `
struct Cluster { low: vec4f, high: vec4f, lod: vec4f }
struct Occluder { low: vec4f, high: vec4f }
struct Command { indexCount: u32, instanceCount: u32, firstIndex: u32, baseVertex: i32, firstInstance: u32 }
struct Frame { viewProjection: mat4x4f, eye: vec4f, control: vec4f, viewport: vec4f }
struct ProjectedBounds { low: vec2f, high: vec2f, nearDepth: f32, valid: u32 }
struct Leaf { low: vec4f, high: vec4f }
struct Config { commandIndex: u32, pad0: u32, pad1: u32, pad2: u32 }
@group(0) @binding(0) var<storage,read> leaves: array<Leaf>;
@group(0) @binding(1) var<storage,read> sourceIndices: array<u32>;
@group(0) @binding(2) var<storage,read_write> visibleIndices: array<u32>;
@group(0) @binding(3) var<storage,read_write> counter: atomic<u32>;
@group(0) @binding(4) var<uniform> frame: Frame;
@group(0) @binding(5) var<storage,read> occluders: array<Occluder>;
@group(0) @binding(6) var<storage,read_write> commands: array<Command>;
@group(0) @binding(7) var<uniform> config: Config;
${helpers}
@compute @workgroup_size(64)
fn compact(@builtin(global_invocation_id) invocation: vec3u) {
  let i=invocation.x;
  if(i>=arrayLength(&leaves) || commands[config.commandIndex].instanceCount==0u) { return; }
  let leaf=leaves[i]; let box=Cluster(vec4f(leaf.low.xyz,0.0),vec4f(leaf.high.xyz,0.0),vec4f(0.0));
  let rect=projectBounds(box);
  if(rect.valid != 0u) {
    for(var j=0u;j<u32(frame.control.z);j++) { if(occludes(rect,occluders[j])) { return; } }
  }
  let first=u32(leaf.low.w);let count=u32(leaf.high.w);
  let destination=atomicAdd(&counter,count);
  for(var j=0u;j<count;j++) { visibleIndices[destination+j]=sourceIndices[first+j]; }
}
@compute @workgroup_size(1)
fn finish() { commands[config.commandIndex].indexCount=atomicLoad(&counter); }
`;
