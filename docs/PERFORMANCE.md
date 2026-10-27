# WebGPU city performance

**Status:** prototype optimizations and measurements, not a production performance claim. GPU timings and visual quality still need to be measured on the target browser, GPU and display. Use the **Performance Details** button in the city to copy device-specific diagnostics.

## What runs where

| Work | Current execution | Implication |
| --- | --- | --- |
| City plan, streetscape, collision and scene assembly | JavaScript on the main thread | The base scene and material work can still pause the UI; collision remains immediately available. |
| Building pages and cache | Web Worker; IndexedDB when available | Pages are prioritized around spawn and later uploaded by the main thread. The 64 MiB page budget applies to cached payloads, not CPU or GPU memory. |
| Base image download and JPEG decode | Browser/network and image decode | Six sets contain 18 files totalling about 11.6 MB; decoding and uploading are separate from rendering. Image-load events do not guarantee all later decode/upload work has finished. |
| Shader graph construction and command submission | CPU/browser/driver | The first draw can trigger shader creation and compilation, independently of city generation. |
| Instanced geometry transforms, material sampling, hex tiling and procedural weathering | WebGPU vertex and fragment shaders | This is already GPU work. It still consumes GPU time; moving every task to the GPU is not automatically faster. |
| Building visibility and coarse detail selection | WebGPU compute writes indirect draw commands; Three.js submits the draws | No per-frame visibility readback is needed. The occlusion pass and extra batches have a cost, so an overall speedup is not assumed. |
| Distant glazing residency | CPU chooses conservative eviction/reload points; GPU buffers are freed and re-created | CPU geometry remains in memory; this is not network, disk or general mesh streaming. |
| Shadows, AO, lighting and postprocessing | GPU render passes | Screen resolution, shadows and multiple scene passes can dominate frame time. |
| Walking collision and controls | CPU | This avoids a GPU-to-CPU readback for every movement step and keeps gameplay semantics accessible. |
| Reflection proxy capture | CPU constructs/submits a proxy scene; GPU renders six cubemap faces | One face is submitted per frame and a four-entry cache limits repeat captures. Filtering can still have a cost. |

Each extra pass can render part of the scene again. The current shader-weathering system is per pixel, not a separate CPU texture generator or GPU compute dispatch. Indirect draws are still submitted, so Three.js's triangle statistic is an upper bound rather than the actual number executed after GPU culling.

## Implemented changes

- Material image requests start while the WebGPU device is being created. These stages overlap; the full set is still awaited before the city is shown, and actual upload and shader compilation may occur later.
- The AO prepass now uses a lightweight, unlit geometry-normal material with a single-sample target. The main beauty pass retains four-sample MSAA and FXAA. AO no longer uses material normal-map detail in this prepass; check the visual difference on target hardware.
- Instance matrices are accumulated in growing typed arrays instead of allocating a matrix object per instance. Bounds are accumulated as parts are added and conservatively cover rotated geometry. Existing instance transforms were compared byte-for-byte with the previous implementation across four seeds.
- Heritage buildings share materials by palette, reducing duplicate material graphs. The scene retains the same architecture and seeded transforms.
- Glazing, tree branches and leaves are divided into block-sized meshes, allowing ordinary view-frustum culling. This increases the number of potential draw calls, so measure the trade-off on the target device.
- New reflection captures are spread over six frames. The previous environment stays active until the new probe is complete; a sky environment supplies the initial lighting.
- The diagnostics panel displays device initialization, material loading, CPU assembly, first-frame submission, recent frame intervals, CPU render submission and counts across passes. Optional timestamp queries report the renderer's sampled render passes and visibility compute separately when supported; measurement adds overhead and does not cover all work. **CPU submission is not GPU execution time.** First-frame submission is not a guarantee that all shaders are compiled or a final image is visible. Frame intervals include browser scheduling and display synchronization.
- GPU-driven indirect commands implement conservative occlusion, projected-size detail selection and a coarse near/far building representation. Full-detail shadow commands remain independent of the view. See [VIRTUAL_GEOMETRY.md](VIRTUAL_GEOMETRY.md) for thresholds, debugging modes and constraints.

In a local Node.js microbenchmark of seed 1827, after two warm-up iterations, six alternating runs had a median CPU assembly time of 151.9 ms before and 143.1 ms after this change. The samples varied substantially; this modest result applies only to that test environment and is not a user-device benchmark or a measurement of shader compilation, GPU time or network loading.

## Why retain Three.js for now?

The current app uses Three.js's WebGPU renderer and node materials; drawing and procedural surface shading execute as WebGPU workloads. Replacing the scene library with a custom WebGPU engine would still require geometry submission, GPU buffers, shader compilation, texture transcoding, visibility, shadows, PBR, postprocessing and device compatibility. A custom renderer can eventually improve specific bottlenecks, but rewriting before measuring the current passes risks a large detour without demonstrated benefit.

Keep the current renderer while making independently measurable systems more data-oriented. The visibility, depth and glazing-meshlet compute paths need fixed-scene, identical-visual-output hardware/browser comparisons against full geometry, including their own GPU and submission costs. Three.js also provides [asynchronous material compilation](https://threejs.org/docs/pages/Renderer.html#compileAsync), although precompilation moves work and can lengthen startup; it must be tested with the actual passes and hardware.

## Next experiments

1. **Capture representative measurements.** Use a fixed seed and route at 1080p and native resolution. Compare the geometry modes with GPU timing enabled and disabled; record frame-time median and 95th/99th percentiles, draw calls, pass timings, startup stages, GPU/driver/browser and memory. [Timestamp queries](https://gpuweb.github.io/gpuweb/#timestamp-query) are optional and sampled; report unavailable rather than substituting CPU timings.
2. **Compress materials for the GPU.** Build mipmapped KTX2/Basis variants from higher-quality masters, feature-detect the supported GPU format, and compare transfer size, transcode/upload cost, VRAM, normal-map artifacts and cold/warm cache. JPEGs remain the current implementation. GPU compression and `timestamp-query` are optional WebGPU features and must be checked on the actual adapter.
3. **Reduce geometry and pass costs.** Add distance-aware façade, glazing, foliage and shadow LODs. Measure the visual impact of reduced shadow resolution, more conservative shadow updates and AO quality. Avoid globally lowering detail before profiling.
4. **Extend selective GPU compute.** Profile the current cluster-level culling against full geometry, then investigate GPU generation and finer-grained culling for high-volume decorative instances. Keep authoritative city layout, collisions and gameplay data accessible to the CPU, or use a carefully designed shared representation without per-frame readback. Verify deterministic seeds, bounds, buffer lifetimes and visual parity. Experimental multi-draw APIs must not be assumed available in every browser.
5. **Stream larger cities.** Extend the worker-generated and locally cached block pages to a larger world, add real CPU/GPU residency budgets, prioritize motion and view direction, and evict or replace distant shadow-casting geometry without losing visible shadows.
