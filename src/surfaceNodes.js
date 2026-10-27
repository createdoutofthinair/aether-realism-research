import {
  cameraViewMatrix, color, float, max, mix, mx_noise_float, normalWorldGeometry, positionView,
  positionWorld, select, smoothstep, texture, vec2, vec3, vec4,
} from 'three/tsl';
import { mxHextileCoord, mxHextileComputeBlendWeights } from 'three/addons/loaders/materialx/MaterialXHextile.js';

// World-space planar projection in metres. Brick courses and paving stay aligned
// across the instanced panels; horizontal faces use XZ instead of stretching XY.
function surfaceFrame() {
  const n = normalWorldGeometry.normalize(), a = n.abs();
  const horizontal = a.y.greaterThan(a.x.max(a.z));
  const sideX = a.x.greaterThan(a.z);
  const coords = select(horizontal, positionWorld.xz, select(sideX, positionWorld.zy, positionWorld.xy));
  const u = select(horizontal, vec3(1,0,0), select(sideX, vec3(0,0,1), vec3(1,0,0)));
  const v = select(horizontal, vec3(0,0,1), vec3(0,1,0));
  return { n, coords, u, v, horizontal };
}

function textureSamples(coordinate, stochastic) {
  if (!stochastic) return {
    color: map => texture(map, coordinate).rgb,
    normal: map => texture(map, coordinate).rgb.mul(2).sub(1),
  };
  // Translation only: preserves normal-map axes and avoids rotating directional
  // features. Explicit original gradients prevent false mip levels at cell edges.
  const hex = mxHextileCoord(coordinate, float(0), vec2(0,0), float(0), vec2(1,1), float(1), vec2(0,1));
  const weights = mxHextileComputeBlendWeights(vec3(1), hex.weights, float(.5));
  const reads = map => [0,1,2].map(i => texture(map, hex.coords[i]).grad(hex.ddx[i], hex.ddy[i]).rgb);
  const blend = values => values[0].mul(weights.x).add(values[1].mul(weights.y)).add(values[2].mul(weights.z));
  return {
    color: map => blend(reads(map)),
    normal: map => {
      // Blend tangent-space height derivatives instead of raw normals.
      const normals = reads(map).map(value => value.mul(2).sub(1));
      const slopes = normals.map(n => n.xy.div(n.z.max(.12)));
      const combined = blend(slopes);
      return vec3(combined.x, combined.y, 1).normalize();
    },
  };
}

// Reorient tangent-space normals using the same projection frame as the sampled
// maps. Perturb again with an independent, small procedural surface gradient.
function mappedNormal(frame, tangentNormal, strength, height) {
  const nWorld = frame.u.mul(tangentNormal.x.mul(strength)).add(frame.v.mul(tangentNormal.y.mul(strength)))
    .add(frame.n.mul(max(tangentNormal.z, .12))).normalize();
  const n = cameraViewMatrix.mul(vec4(nWorld, 0)).xyz.normalize();
  const dx = positionView.dFdx(), dy = positionView.dFdy();
  const r1 = dy.cross(n), r2 = n.cross(dx), determinant = dx.dot(r1);
  const grad = determinant.sign().mul(height.dFdx().mul(r1).add(height.dFdy().mul(r2)));
  return determinant.abs().mul(n).sub(grad).normalize();
}

export function scannedSurfaceNodes(asset, weather) {
  const frame = surfaceFrame(); const coord = frame.coords.div(asset.metres);
  const sample = textureSamples(coord, asset.pattern === 'stochastic');
  const base = sample.color(asset.color), tangentNormal = sample.normal(asset.normal), arm = sample.color(asset.arm);
  const macro = mx_noise_float(positionWorld.mul(.035));
  const fine = mx_noise_float(positionWorld.mul(1.2));
  const streak = mx_noise_float(vec3(positionWorld.x.mul(.36), positionWorld.y.mul(.035), positionWorld.z.mul(.36)));
  const vertical = float(1).sub(smoothstep(.3,.8,frame.n.y.abs()));
  const ground = float(1).sub(smoothstep(.3, 9, positionWorld.y));
  const deposits = smoothstep(-.12,.52,streak).mul(vertical).mul(.12)
    .add(smoothstep(-.12,.5,macro).mul(ground).mul(.08))
    .add(smoothstep(.05,.55,macro).mul(float(1).sub(vertical)).mul(.035));
  const dirt = deposits.mul(weather).clamp(0,.34);
  // Correlated overlays modify albedo, roughness and bump together; no stains
  // are claimed to be physically simulated water or material displacement.
  const albedo = mix(base.mul(float(1).add(macro.mul(.09))), color(0x5a5147), dirt);
  const rough = arm.g.add(dirt.mul(.24)).clamp(.09, 1);
  const height = fine.mul(.0025).mul(weather);
  return { albedo, rough, ao: mix(float(1), arm.r, .65), normal: mappedNormal(frame, tangentNormal, asset.normalStrength, height) };
}
