# Procedural city realism for Aether: research and design

**Status:** research baseline and first playable experiment. **Reviewed:** 27 October 2026. The repository was empty when this study began. It is an independent research prototype, not yet the city system in Aether itself.

## 1. What “commercial-game strength” actually requires

Believable cities are not produced by putting a high-resolution facade texture on a large box. They need credible urban organisation, recognisable silhouettes, construction logic, lived-in ground floors, consistent materials, local light transport, street-scale detail, temporal stability and strong art direction. A procedural system must provide variation **and** control. Pure randomness produces repetition at one scale and incoherence at another.

The recommended approach is a **hybrid of authored modules and constrained procedural assembly**. Use a graph for roads and public spaces, parcel subdivision for land, a shape grammar for building masses, and a structured set of interchangeable facade and streetscape components. The generator should output semantic information as well as geometry, so navigation, lighting, collision, streaming and gameplay can use the same city description.

The first experiment in this repository is a limited vertical slice, not a claim of photorealism or shipping readiness. It is meant to expose the design choices in an actual walkable environment and provide a concrete basis for visual evaluation on the target machine.

## 2. Evidence and what it means for this project

| Evidence | Finding | Aether design implication |
| --- | --- | --- |
| Parish & Müller, *Procedural Modeling of Cities* [1] | Roads, blocks, lots and buildings form a hierarchy; global and local inputs can guide development. | Do not scatter buildings independently. Retain road/lot topology and controls for local density and function. |
| Wonka et al., *Instant Architecture* [2] | Split grammars and attributes can produce coherent architectural styles, rather than unrelated random shapes. | Define a typed building grammar with style-specific constraints and semantic zones. |
| Müller et al., *Procedural Modeling of Buildings* [3] | Context-sensitive shape rules can compose detailed building geometry from spatial rules. | Generate massing and facade modules together; preserve alignment of floor, bay, corner and roof dimensions. |
| Mikkelsen, *Practical Real-Time Hex-Tiling* [4] and Burley [5] | Randomised samples reduce repeated textures, but naive blending can wash out contrast or ghost structure. | Use filtered macro variation for stochastic surfaces; preserve brick/stone alignment using a different structural layer. |
| glTF 2.0 material specification [6] | Metallic/roughness PBR relies on correct colour spaces and separate surface parameters. | Treat colour, roughness, normal/height and metalness as coordinated outputs. Author in metres and validate under multiple lighting conditions. |
| GTAO and CACAO documentation [7,8] | Screen-space AO improves local contact shading but can only work with available depth/normals. | Use AO for contact, not as a substitute for bounced light or off-screen occluders. |
| WebGPU specification and GPUWeb ray-query/acceleration-structure proposals [9,10,11] | Standard WebGPU exposes raster and compute, while hardware ray query and acceleration structures are active proposals, not a generally available baseline. | Ship a robust raster/compute renderer now. Investigate software traversal as an optional tier, not assumed RTX-equivalent hardware access. |
| SVGF [12] | Low-sample ray tracing requires temporal accumulation and edge-aware reconstruction. | A later software ray path also needs history, motion, disocclusion handling and denoising; rays alone are not a solution. |
| Three.js WebGPU postprocessing [13] | Postprocessing requires deliberate pass composition and buffer formats. | Budget depth, normal, velocity and colour buffers together. Avoid enabling every effect at full resolution by default. |

These sources inform the proposed architecture; they do **not** validate the visual quality or frame rate of this specific prototype.

## 3. Urban structure: model a city, not a field of towers

### 3.1 Semantic hierarchy

A production generator should retain this chain:

1. **Region:** terrain, coastline, protected land, waterways, intended view corridors and landmarks.
2. **District:** use mix, architectural eras, density, height distribution, material palette, road patterns, vegetation and story cues.
3. **Transport graph:** intersections, hierarchy of roads, lanes, sidewalks, crossing positions, junction types and transit.
4. **Block:** polygon bounded by streets, courtyards or water; parcels, setbacks, frontage and access.
5. **Parcel:** buildable polygon, corner condition, sun orientation, neighboring heights, programme, service access and collision outline.
6. **Building:** ordered mass volumes, structural grid, floor heights, cores, facade zones, roof equipment and entrances.
7. **Module:** window bay, pier, curtain-wall panel, column, balcony, door, stair, signage, drain, HVAC and ornament.
8. **Surface:** physically plausible material stack, weathering, edge wear, decals and debris.

Use stable identifiers derived from world seed + district/block/parcel ID + purpose-specific rule seed. This keeps changes to, for example, traffic lights from unexpectedly regenerating the skyline. Version generator rules and record all authored overrides. The current prototype is deterministic for a seed, but does not yet guarantee all these independent seed streams across changes to the algorithm.

### 3.2 Road and parcel generation

**Recommended:** evolve from a fixed grid to a planar graph with primary roads, secondary streets and pedestrian routes. Guide roads with a controllable field or templates, then detect loops/blocks, offset curbs robustly and split buildable polygons. Tensor-field methods are valuable for mixing grids and curved networks, while example-driven methods can capture real street-pattern statistics [14]. A field alone does not solve arbitrary intersections, street-level access or parcel validity; add topology repair and explicit junction templates.

Parcel constraints should include minimum frontage, area, access, side clearances, corner status, usable depth and setbacks. Assign mixed building uses per district rather than uniform random selection. Allow selected irregular lots, wedge buildings, open courtyards, pocket parks and landmarks. Validate geometry against overlaps, disconnected roads, blocked sidewalks and unreachable entrances.

**In the current experiment:** a fixed 4 × 4 block grid, four rectangular lots per block, 18 m streets and a clear central spawn. It does not yet generate real road topology, curved districts or non-rectangular parcels.

## 4. Buildings: hierarchy, not a library of unrelated prefabs

### 4.1 Building recipe

A production `BuildingSpec` should include:

- identity and parcel relationship; district/era/programme;
- footprint polygon, setback envelope and street frontage;
- structural module width and storey heights, aligned at corners;
- mass graph containing a podium, one or more wings, terraces, towers and roof type;
- style grammar, material palette, facade orientation and entrance/retail rules;
- local seeds and artist overrides;
- collision/navigation mesh, shadow representation, detail and LOD policies.

A production `ModuleSpec` should carry dimensions in metres, attachment planes, pivot, permitted neighbours, supported scale range, semantic sockets, material slots, collision treatment, and equivalents for each representation. The modular contract must guarantee that a corner module and two adjoining facade panels share compatible heights, depths, joints and UV/material coordinates.

### 4.2 Shape families and constraints

Start with a few carefully authored families and broaden gradually: historic masonry slab, courtyard perimeter, modern curtain-wall slab, office podium-and-tower, residential stepped terraces, L/U-shaped buildings, cylindrical/lobed towers, and genuinely landmark-like custom forms. Vary silhouette first, then floor counts and setbacks, then the cadence and treatment of facades. A thousand random window patterns on the same box are not a thousand different buildings.

Examples of constraints:

- Every visible floor shares a credible floor-to-floor height and structural rhythm.
- Keep a primary entrance and active frontage on an accessible street edge.
- Prevent balconies, awnings and stairs from occupying the walking clearance.
- Let modules change across ground floor, typical floors and crown; explicitly solve corners.
- Where towers step back, add actual terrace slabs, parapets, equipment and drainage.
- Control neighboring heights and styles at district scale; preserve occasional deliberate contrast.
- Carry a footprint through collision, shadow proxies and distant representation; never replace a complex silhouette with an unrelated box at long range.

**In the current experiment:** independently seeded historic, modern, residential, stepped, round and lobed families. Windows, projecting sills, facade bands, balconies, awnings, rooftop machinery and curved fins are geometry. Historic buildings use the Three.js r186 `SkyscraperGenerator` for detailed masonry, piers, window frames and ground-floor storefronts. Non-heritage walls are assembled from piers and spandrels around inset glazing, with shader-generated room interiors behind the pane; some roof treatments remain deliberately simple. The six families are prototypes rather than an exhaustive grammar.

## 5. Materials and anti-repetition

### 5.1 A layered material recipe

For each surface preserve the difference between:

1. **Macro identity:** masonry, limestone, concrete, weathered metal, glass, asphalt, timber or vegetation.
2. **Structural pattern:** brick bond, slabs, panels, grout, floor seams and fabrication joints. Anchor these to local construction coordinates, not arbitrary world noise.
3. **Meso-scale variation:** stains below sills, drainage paths, soot on sheltered surfaces, ground splash, repairs, replacement panels and edge wear. Use geometry, orientation, height and exposure to place them.
4. **Micro detail:** aggregate, pores, scratches and subtle normal variation. Filter by footprint so sub-pixel detail does not sparkle.
5. **Decals:** signs, utility covers, dirt, graffiti and unique art-directed story elements.

Combine procedural evaluation with authored/scanned materials where it makes sense. For production, evaluate stochastic/hex tiling for low-structure layers [4,5]; do not arbitrarily rotate brick bonds or run procedural noise through windows. Derive colour, roughness and normal/height from a shared causal mask when plausible. Ensure gradients and mipmaps work under oblique viewing angles. Where possible use triplanar or explicit world/local projection with derivative-correct filtering; prevent projection from swimming as the world origin shifts.

**In the current experiment:** six 1K photographic PBR sets use coordinated colour, roughness and normal weathering in world space. Asphalt and plaster use stochastic hex tiling; masonry and paving retain aligned structure. Historic walls receive the brick set without painting over windows. There are no decals, virtual texturing or physically simulated aging. See [MATERIAL_SYSTEM.md](MATERIAL_SYSTEM.md) for sources, memory cost, implementation and production steps.

### 5.2 Glass

Real glass is dielectric and its appearance varies with viewing angle, thickness, dirt, interior illumination and surroundings. For a city, combine a restrained environment reflection, facade depth, differentiated interior occupancy, and physically credible frames; avoid relying on black or overly metallic windows. Screen-space reflections miss off-screen geometry and need fallback to probes/environment maps. Parallax interior mapping can provide depth but must be temporally stable and avoid repeated identical rooms.

The prototype uses shader-generated interiors for generic rectangular panes and heritage buildings, plus reflective opaque panels on curved towers. A shared city-proxy cubemap updates near the player and supplies approximate reflections. None of these is physically accurate refractive multi-layer glazing or per-building parallax-correct reflection.

## 6. Lighting, shadows and cinematic image quality

### 6.1 Available now

- Direct sun with three camera-relative cascaded shadow maps, restrained bias/normal bias and texel-aligned cascade placement.
- Atmospheric sky and fog plus a shared city-proxy environment capture for specular response.
- PBR materials, sky/ground fill and screen-space ambient occlusion.
- Tone mapping, modest bloom and FXAA; user-selectable light moods and render budgets.

The prototype uses Three.js CSMShadowNode with three cascades at 1024, 2048 or 4096 per map depending on quality. Its environment probe captures simplified city silhouettes from an intersection near the player and is rebuilt when the seed or atmosphere changes; the shared result is not a per-building parallax-correct reflection, SSR or HDR sky probe. Ambient fill is not indirect global illumination. FXAA does not address all temporal shimmer. AO is screen-space and cannot see hidden geometry. Emissive windows do not cast light. These are deliberate limitations to investigate, not evidence of AAA quality.

### 6.2 Recommended production order

1. Capture a controlled visual reference and work in linear HDR. Calibrate exposure, reference white, material values and tone mapping; include overcast, direct sun and night.
2. Validate the implemented camera-relative cascaded shadows on target GPUs. Tune cascade splits, texel stability, edge blending and slope/normal bias, and reserve fine contact shadows for nearby detail. Measure acne, detached shadows and movement shimmer [15].
3. Add temporally stable AO at half resolution, depth-aware upsampling and explicit history rejection. Keep AO in the indirect-light component, avoiding multiplication over direct sun.
4. Evaluate screen-space reflections and probe fallback. Preserve roughness response, test screen-edge disocclusions and compare against a path-traced reference. Reflective glass must not depend exclusively on screen space.
5. Add a GI approach suited to Aether's dynamic requirements: baked/probe lighting for static layout, dynamically updated probes or a sparse volumetric representation for larger changes. Screen-space GI is an optional contribution, not a complete world-space solution.
6. Add temporal anti-aliasing or temporal reconstruction with reliable motion vectors, depth/normal disocclusion, neighborhood clipping and a reactive policy for emissive/translucent surfaces. Compare thin geometry and camera motion against the FXAA baseline; do not claim a clean result without examining ghosting and crawling.
7. Add restrained volumetrics, local lights, reflection capture, physically grounded sky/weather and art-directed grading only after basic exposure and material calibration are reliable.

### 6.3 What about ray tracing?

WebGPU compute shaders can implement **software ray tracing**: build or upload a bounding-volume hierarchy (BVH), trace selected short rays, then accumulate and denoise. This might provide limited contact shadows, reflections, offline references or a high-end optional mode. Memory, build cost, traversal divergence and denoising are major risks for a large dynamic scene. Geometry changes need explicit acceleration-structure updates. Screen-space and probe fallbacks still matter.

As of the review date, hardware ray-query and acceleration-structure features are being discussed in the GPUWeb project [10,11]. Do not assume that standard browsers expose dedicated RT cores or a portable hardware-ray-tracing pipeline. Native `wgpu` experimental features are not equivalent to standard browser WebGPU [16]. If browser support changes, test and feature-detect it as an additional backend rather than making it a baseline. Nothing in the prototype traces rays.

## 7. Geometry detail, LOD and stability

The user should be able to move from street scale to skyline without suddenly replacing a complex structure with a noticeably different silhouette.

- **Near:** real facade components, recesses, balconies, door thresholds, signage, props and appropriate collision. Sub-centimetre details should be shaded, not modelled as unfiltered triangles.
- **Mid:** merge/instance repeated components, remove small internals and retain facade depth and major balcony profiles. Keep the same material colours and light response.
- **Far:** simplify within the same volume and preserve roofline, significant setbacks, large glazing frequencies and colours. Prefer multi-view/mesh impostors only after resolving view-dependent lighting, holes, parallax and shadows.
- Choose by **projected screen error** with hysteresis; use stable dithering or geometry morphs only where matching shapes permit it. Do not interpolate arbitrary positions over time, which creates the “pudding” effect.
- Split world into spatial chunks. Perform frustum and, when worthwhile, conservative occlusion culling. Keep collision and navigation independent from what happens to be visible.
- Do not equate native mesh-shader research with browser WebGPU support. Compute culling and indirect draws can be investigated within the actual WebGPU capability set [9,17].

**In the current experiment:** block-grouped instanced boxes/cylinders for generic components with frustum culling, plus one generated mesh per historic building and instanced furniture. There is no streaming, hierarchical LOD, occlusion culling, GPU-driven indirect draw or impostor system. The static scene is deliberately small.

## 8. Performance and commercial constraints

Decide target hardware and presentation resolution before committing to a technique. Track CPU generation and frame time separately from GPU frame time. An initial planning target might be 60 fps at 1080p on a defined midrange desktop and a separate high-end visual mode, but this is a **proposal, not a measurement or promise**. A 60 fps frame budget is 16.67 ms for all work; reserve budget for gameplay, animation, audio and browser composition rather than spending it all on scenery.

Measure median and 95th/99th-percentile frame times, shader compilation stalls, total scene generation time, JS heap, estimated GPU memory, draw calls, visible triangles, texture bytes, shadow passes, AO and postprocessing cost. Use WebGPU timestamp queries only where supported, with a fallback when unavailable. Compare a fixed seed, camera path, viewport, quality preset, browser version and adapter; capture both stills and a moving sequence.

For a commercial project, review every dependency, code example, texture, font, scan and reference asset for the actual distribution context. Three.js is MIT licensed; preserve the upstream notice [18]. A research paper is evidence, not an automatic code/asset licence. The prototype includes six Poly Haven CC0 scanned material sets, uses Three.js generators and requests Google Fonts through the page stylesheet, with local font fallbacks. Source records and hashes are in the material provenance manifest. Run an attribution and licence audit before shipping, and pin dependencies.

## 9. Validation plan and acceptance gates

The tests included now cover deterministic layouts, 100 seeds without overlapping building bounds or blocked spawn, collision sliding/tunnelling and outward-facing pane geometry. They do not prove appearance, frame rate, lighting, shader correctness on all adapters or navigation in a complex city.

A production validation set should include:

- Fixed seeds exercising every family, rare combinations, small/irregular parcels and edge cases; assert geometry and semantic invariants.
- Street-level capture: storefronts, intersections, curved facade, deep shadow, a narrow alley and a long straight avenue.
- Elevated capture: skyline and distant silhouettes; transition through each LOD boundary slowly and quickly.
- Lighting captures: low sun, midday, overcast and night. Test moving camera for shadow acne, detached shadows, crawling and AO halos.
- Collision and navigation paths along sidewalks, entries, corners, stairs and bridges; preserve a non-blocking accessibility route.
- Test native-resolution and high-DPI displays on named target GPUs/browsers. Record 1% lows and stable GPU/frame costs, not just average FPS.
- Compare representative stills with an offline path-traced reference and art-direction references. Record tolerances and have an artist inspect composition and repetition.
- Log unsupported WebGPU, device loss, memory pressure and recovery. Offer a truthful capability message, not an invisible switch to another renderer.

## 10. Recommended next milestones

**M1 — First visual review:** run this prototype on the intended GPU; record street and elevated views, frame timings, GPU/driver and the biggest visible problems. Do not tune blindly from a non-GPU screenshot.

**M2 — One reference-quality block:** replace the fixed generic block with authored modular building kits, correct ground-floor entrances, realistic glass, layered materials, pavement details and one distinctive landmark. Verify all angles before multiplying the content.

**M3 — Stable illumination:** validate and tune cascaded shadows, then introduce TAA, calibrated sky and spatially local environment probes, plus a GI experiment and objective visual comparisons. Establish separate quality modes with measured costs.

**M4 — District generation:** road graph, irregular blocks and parcels, district style and density controls, persistent artist overrides, semantic navigation and gameplay data.

**M5 — Scale:** chunked streaming, consistent multi-representation LOD, conservative culling, worker scheduling and measured memory limits. Test moving at speed through boundaries.

**M6 — Aether integration:** adapt the resulting generator to Aether's renderer, camera, coordinate system, asset pipeline and gameplay contracts; profile within the actual game. This repository does not yet modify Aether.

## References

1. Parish & Müller (2001), [Procedural Modeling of Cities](https://people.eecs.berkeley.edu/~sequin/CS285/PAPERS/Parish_Muller01.pdf).
2. Wonka et al. (2003), [Instant Architecture](https://www.cg.tuwien.ac.at/research/vr/instantarchitecture/).
3. Müller et al. (2006), [Procedural Modeling of Buildings](https://emeritus.icu.ee.ethz.ch/research/demos/procedural-modeling.html).
4. Mikkelsen (2022), [Practical Real-Time Hex-Tiling](https://jcgt.org/published/0011/03/05/).
5. Burley (2019), [On Histogram-Preserving Blending for Randomized Texture Tiling](https://jcgt.org/published/0008/04/02/).
6. Khronos, [glTF 2.0 specification, metallic-roughness materials](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html).
7. Three.js, [GTAONode](https://threejs.org/docs/pages/GTAONode.html).
8. AMD, [FidelityFX CACAO](https://gpuopen.com/fidelityfx-cacao/).
9. W3C GPU for the Web Community Group, [WebGPU specification](https://gpuweb.github.io/gpuweb/).
10. GPUWeb, [Ray Tracing extension discussion](https://github.com/gpuweb/gpuweb/issues/535).
11. GPUWeb, [Acceleration-structure proposal](https://github.com/gpuweb/gpuweb/issues/11053).
12. Schied et al. (2017), [Spatiotemporal Variance-Guided Filtering](https://research.nvidia.com/labs/rtr/publication/schied2017spatiotemporal/).
13. Three.js, [WebGPU postprocessing](https://threejs.org/manual/pages/webgpu-postprocessing.html).
14. Nishida et al. (2015), [Example-Driven Procedural Urban Roads](https://ignaciogarciadorado.com/p/2015_CGF/2015_CGF_ExampleRoads.pdf).
15. Three.js, [LightShadow](https://threejs.org/docs/pages/LightShadow.html).
16. wgpu, [Experimental ray-tracing extensions](https://github.com/gfx-rs/wgpu/blob/trunk/docs/api-specs/ray_tracing.md).
17. AMD, [From vertex shader to mesh shader](https://gpuopen.com/learn/mesh_shaders/mesh_shaders-from_vertex_shader_to_mesh_shader/). This is native API background, not a claim that WebGPU exposes mesh shaders.
18. Three.js, [MIT licence](https://github.com/mrdoob/three.js/blob/dev/LICENSE).
19. van Dongen (2008), [Interior Mapping](https://www.proun-game.com/Oogst3D/CODING/InteriorMapping/InteriorMapping.pdf).
20. Three.js, [CSMShadowNode](https://threejs.org/docs/pages/CSMShadowNode.html).
