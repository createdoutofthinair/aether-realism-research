import { CITY } from './plan.js';

// Each occluder is an inner, opaque box that is actually present in the near
// building core. Curved and heritage geometry are excluded until bounded.
export function createOccluders(plan) {
  const boxes = [];
  for (const b of plan.buildings) {
    if (['heritage', 'round', 'lobed'].includes(b.kind)) continue;
    let x = b.x, z = b.z, width = b.width, depth = b.depth, floors = b.floors;
    if (b.kind === 'stepped' || (b.kind === 'modern' && b.variant > .28)) {
      floors = Math.max(3, Math.floor(b.floors * (.28 + b.variant * .17)));
    } else if (b.kind === 'residential' && b.variant > .53) {
      x -= b.width * .15; width *= .70;
    }
    width = Math.max(.5, width - 1.25); depth = Math.max(.5, depth - 1.25);
    // An inset keeps the occluder inside the real core despite float rounding.
    const inset = .08, bottom = CITY.curb;
    boxes.push({ id: b.id, min: [x - width/2 + inset, bottom + inset, z - depth/2 + inset],
      max: [x + width/2 - inset, bottom + floors*b.floorHeight - inset, z + depth/2 - inset] });
  }
  return boxes;
}

export function featurePixels(bounds, camera, focalPixels) {
  const d = [0,1,2].map(i => Math.max(bounds.min[i] - camera[i], 0, camera[i] - bounds.max[i]));
  return bounds.feature * focalPixels / Math.max(.01, Math.hypot(...d));
}

// Reference for the GPU shader: work in clip space and refuse to cull across
// the near plane. A candidate is hidden only if its entire projected AABB lies
// strictly inside an opaque face that is wholly closer to the camera.
function project(p, matrix) {
  const e = matrix.elements, [x,y,z] = p;
  const cx=e[0]*x+e[4]*y+e[8]*z+e[12], cy=e[1]*x+e[5]*y+e[9]*z+e[13];
  const cz=e[2]*x+e[6]*y+e[10]*z+e[14], cw=e[3]*x+e[7]*y+e[11]*z+e[15];
  return cw > .0001 && cz > 0 ? [cx/cw, cy/cw, cz/cw] : null;
}
function cross(a,b,c) { return (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]); }
function inside(p, q, margin) {
  const area = cross(q[0],q[1],q[2]);
  if (Math.abs(area) < 1e-8) return false;
  const sign = Math.sign(area);
  return q.every((a,i) => {
    const b=q[(i+1)%4], dx=b[0]-a[0], dy=b[1]-a[1];
    return cross(a,b,p)*sign > margin*Math.hypot(dx,dy);
  });
}
export function projectedBounds(bounds, matrix) {
  const p=[];
  for (const x of [bounds.min[0],bounds.max[0]]) for (const y of [bounds.min[1],bounds.max[1]]) for (const z of [bounds.min[2],bounds.max[2]]) {
    const v=project([x,y,z],matrix); if (!v) return null; p.push(v);
  }
  return { min:[Math.min(...p.map(v=>v[0])),Math.min(...p.map(v=>v[1]))], max:[Math.max(...p.map(v=>v[0])),Math.max(...p.map(v=>v[1]))], depth:Math.min(...p.map(v=>v[2])) };
}
export function isOccluded(bounds, eye, matrix, occluders, margin = .004) {
  const rect=projectedBounds(bounds,matrix); if (!rect) return false;
  const corners=[[rect.min[0],rect.min[1]],[rect.max[0],rect.min[1]],[rect.max[0],rect.max[1]],[rect.min[0],rect.max[1]]];
  for (const box of occluders) {
    for (const axis of [0,2]) {
      const edge = eye[axis] < box.min[axis] ? box.min[axis] : eye[axis] > box.max[axis] ? box.max[axis] : null;
      if (edge === null) continue;
      const [lo,hi]=[box.min,box.max];
      const vertices = axis === 0 ? [[edge,lo[1],lo[2]],[edge,hi[1],lo[2]],[edge,hi[1],hi[2]],[edge,lo[1],hi[2]]]
        : [[lo[0],lo[1],edge],[hi[0],lo[1],edge],[hi[0],hi[1],edge],[lo[0],hi[1],edge]];
      const face=vertices.map(v=>project(v,matrix));
      if (face.some(v=>!v)) continue;
      if (Math.max(...face.map(v=>v[2])) + .00005 >= rect.depth) continue;
      if (corners.every(p=>inside(p,face,margin))) return true;
    }
  }
  return false;
}
