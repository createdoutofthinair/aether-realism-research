// Dimensions are the physical width supplied by Poly Haven, in metres.
// Source checksums, authors and download URLs live beside the packaged maps.
export const MATERIAL_CATALOG = Object.freeze([
  { key: 'concrete', id: 'concrete_slab_wall_02', name: 'Precast concrete', metres: 2.1023, pattern: 'structured', normalStrength: .7 },
  { key: 'limestone', id: 'sandstone_blocks_08', name: 'Sandstone blocks', metres: 3, pattern: 'structured', normalStrength: .72 },
  { key: 'brick', id: 'red_brick', name: 'Weathered red brick', metres: 1.4, pattern: 'structured', normalStrength: .8 },
  { key: 'pale', id: 'grey_plaster_03', name: 'Mineral plaster', metres: 1, pattern: 'stochastic', normalStrength: .55 },
  { key: 'sidewalk', id: 'concrete_pavement', name: 'Concrete pavers', metres: 1.8, pattern: 'structured', normalStrength: .75 },
  { key: 'road', id: 'asphalt_03', name: 'Worn asphalt', metres: 2.05, pattern: 'stochastic', normalStrength: .65 },
]);

export function materialMapPath(base, id, map) {
  return `${base}materials/${id}/${map}.jpg`;
}
