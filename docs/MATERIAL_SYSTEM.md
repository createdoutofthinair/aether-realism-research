# Material sets and procedural wear

**Status: implemented research prototype, not final game-quality art.** This is the practical material pipeline for the playable city. It combines photographic surface data with GPU-evaluated variation; neither a larger texture nor noise alone is a substitute for authored geometry, coherent lighting or art direction.

## 1. Base material sets

Each set contains a colour, OpenGL tangent-space normal, and packed ambient-occlusion/roughness/metalness (ARM) map at 1024 × 1024. The original Poly Haven JPEGs are included with the site, so the renderer does not depend on Poly Haven being online. The source photographs and scans are distributed under [Poly Haven's CC0 licence](https://polyhaven.com/license), including commercial use. The exact download URLs, contributor credits, physical widths, byte counts and SHA-256 hashes are in [`public/materials/provenance.json`](../public/materials/provenance.json); credits are also listed in [the third-party notices](../THIRD_PARTY_NOTICES.md).

| City material | Source | Physical tile width | Surface treatment |
| --- | --- | ---: | --- |
| Brick | [Red Brick](https://polyhaven.com/a/red_brick) | 1.40 m | Aligned courses and mortar |
| Precast concrete | [Concrete Slab Wall 02](https://polyhaven.com/a/concrete_slab_wall_02) | 2.10 m | Aligned panel features |
| Stone | [Sandstone Blocks 08](https://polyhaven.com/a/sandstone_blocks_08) | 3.00 m | Aligned blocks and joints |
| Plaster | [Grey Plaster 03](https://polyhaven.com/a/grey_plaster_03) | 1.00 m | Stochastic hex tiling |
| Sidewalk | [Concrete Pavement](https://polyhaven.com/a/concrete_pavement) | 1.80 m | Aligned paver joints |
| Road | [Asphalt 03](https://polyhaven.com/a/asphalt_03) | 2.05 m | Stochastic hex tiling |

Colour is decoded from sRGB; normals and ARM are linear data. ARM's red and green channels drive material occlusion and roughness; these six materials are non-metallic, so metalness is zero. The Three.js ambient-occlusion context combines material AO with the screen-space AO pass. All maps repeat, generate mipmaps and use up to 8× anisotropic filtering where supported. Source-aligned colour, normal and roughness features must stay together: applying unrelated random transformations to each map would make highlights detach from the visible surface. This follows the channel/colour-space distinction in the [glTF metallic-roughness specification](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#metallic-roughness-material).

## 2. How the overlay works

The shader projects a set in world space at its real physical tile scale. It chooses a dominant axis for vertical and horizontal faces, so architectural pieces align across instanced meshes. It is not blended triplanar projection: diagonal and curved surfaces can show projection changes, and the coordinates are anchored in world space rather than to moving objects.

On asphalt and plaster, the shader blends three spatially offset samples using Three.js's implementation of [Mikkelsen's real-time hex tiling](https://jcgt.org/published/0011/03/05/). Explicit source gradients preserve mip selection at hex-cell boundaries. The same offsets and weights are used for colour, normal and ARM; the normal samples are blended as slopes rather than raw RGB vectors. There is no arbitrary rotation, because that would rotate directional texture features and their normal axes. This reduces obvious repetition but is not histogram-preserving; softening, visible large features and blend artifacts still need art review. [Histogram-preserving blending](https://jcgt.org/published/0008/04/02/) is a later option, not implemented here.

Brick, stone, concrete panels and paving contain structural lines. They deliberately use aligned single samples instead of randomised blending, which would break mortar courses and joints. Their broad colour variation and the procedural overlay break up some repetition without scrambling construction. This does not remove all repetition; an authored set of compatible tiles, modular geometry and controlled decals is the next step.

The procedural layer uses multiple world-space frequencies: broad colour variation, vertically stretched weather streaks, near-ground deposits, and small surface-height perturbations. The weathering control affects connected colour, roughness and fine normal changes rather than placing random coloured noise over a texture. The masks are heuristic, not simulated rain, dirt transport, cracks, physical displacement or an artist-authored damage system. The original façade's windows and interiors are kept separate from the masonry treatment. If any map in a set fails to load, that set falls back to the previous procedural material; a status message reports this.

## 3. Lighting and cost

A 256-pixel cube probe captures a simplified city proxy at a nearby intersection. As the player moves, the shared environment is updated from a small four-entry cache, with checks approximately 1.8 seconds apart. It gives windows an approximation of the local district; the proxy does not reflect detailed geometry, dynamic objects or accurate parallax. Probe changes can visibly pop or cost a burst of six renders. There is no screen-space reflection, ray tracing or global illumination in this implementation.

The six sets download about **11.6 MB** of JPEG data. If decoded into RGBA8 textures with a complete mip chain, 18 1K maps are roughly **96 MiB** of texture memory; the actual allocation is implementation-dependent. The stochastic materials take three samples per map rather than one, and weathering adds arithmetic. Block-sized instance batches enable ordinary frustum culling, trading more draw calls for less off-screen facade work. This is not streaming, occlusion culling or LOD. None of these costs is a target-device benchmark, and the existing quality menu does not reduce material sampling.

## 4. Add or create a new material set

1. Choose a physically plausible source with documented rights, or capture your own material under controlled diffuse lighting. Record the source, authors, licence, real-world scale and hashes. Avoid baked shadows and highlights in base colour.
2. Produce aligned, seamless colour, OpenGL normal and ARM maps. For nonmetal materials, use roughness and AO as linear data and verify that all maps depict the same features. Check colour and gloss under overcast, low sun and grazing angles.
3. Put the three maps under `public/materials/<id>/`, add their provenance to `provenance.json`, and add a descriptor to `src/materialCatalog.js` with a material key, physical width, normal strength and `structured` or `stochastic` pattern. Use structured mapping where edges, courses and joints must align.
4. Add the material to the city or a building kit; do not indiscriminately apply damage over glazing. Run `npm test` and `npm run build`, then inspect street-level and oblique views while moving on an actual WebGPU device. Adjust real-world scale before adjusting intensity.
5. For production, retain higher-resolution masters and export platform-specific, mipmapped GPU-compressed variants. JPEG is a convenient prototype delivery format, not the recommended final normal/roughness format: it introduces artifacts and expands after upload. Evaluate [KTX 2.0](https://registry.khronos.org/KTX/specs/2.0/ktxspec.v2.html) and compatible WebGPU compression formats on target adapters before selecting a pipeline.

## 5. Next steps, in priority order

1. **Visual and GPU review:** use a fixed seed and camera path on the intended browser/GPU. Capture close-up brick, asphalt, pavement, curved façades and a long avenue under all three lighting modes. Check texture blur, normal orientation, seam changes, stain scale, probe popping, frame-time spikes and memory. Adjust against reference photographs; do not judge the system from a software-rendered screenshot.
2. **Author a reference block:** build a small, art-directed set of modular ground floors, entrances, corners, façades and roof pieces with real dimensional constraints. Add several related texture variants and deliberate grime, leaks, repair patches and decals. Expand only once the block reads convincingly close up.
3. **Production material pipeline:** create 2K/4K source masters and platform-specific KTX2-compressed derivatives with correct colour spaces, mips and normal handling. Evaluate compatible multi-tile/edge-matched variants or Wang tiles for masonry and pavement; benchmark hex tiling and contrast-preserving blending on unstructured surfaces. Add debug views for colour, roughness, normals, AO and masks.
4. **Stable lighting:** evaluate local reflection probes with parallax correction and screen-space reflections with probe fallback; compare a screen-space GI experiment and temporal filtering against a reference render. Treat screen-space misses and probe interpolation as explicit constraints. Do not equate them with ray tracing.
5. **Scale and budgets:** measure CPU/GPU timing, draw calls, visible triangles, texture memory and probe refresh cost on named target hardware. Add chunk streaming, LOD and selective shadow/detail policies only after measurement. Set separate quality budgets for 1080p and high-resolution targets.

The broader urban, architecture and rendering roadmap is in [RESEARCH.md](RESEARCH.md).
