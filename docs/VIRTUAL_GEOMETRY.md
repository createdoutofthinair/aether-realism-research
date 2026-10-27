# GPU visibility, geometry pages and detail

**Status:** a WebGPU research implementation for the procedural city, not a production Nanite-equivalent renderer. It combines independently generated geometry pages, conservative GPU visibility and two building representations. Measure it on the intended device before drawing performance or visual-quality conclusions.

## Page generation and storage

The seeded layout and collision data are prepared on the CPU. Streets and shared materials are assembled on the main thread, while a Web Worker generates building blocks nearest the initial camera first. The loader releases after the four nearest blocks arrive; remaining blocks continue to arrive in the background. GPU visibility is enabled after all blocks are present. Regeneration terminates the old worker; worker failure falls back to the original synchronous generator.

Pages contain full-detail and distant building data. Instance transforms use eight 32-bit matrix components instead of 16, with no quantization. Recessed glazing uses independent quads: its six indices per pane become a single winding bit. Groups of up to 16 panes form leaves of 64 vertices and 32 triangles, with a binary hierarchy of conservative bounds. The vertex attributes remain full-precision. The main thread reconstructs standard Three.js geometry, and the GPU executes the rendering.

Pages are optionally stored in IndexedDB under a versioned seed, block and plan fingerprint. On later visits the worker can retrieve the page instead of rebuilding it. Least-recently-used pages are evicted against a **64 MiB encoded-payload budget**; IndexedDB bookkeeping and temporary copies are additional. If storage is unavailable or a write exceeds quota, the worker regenerates the page. Diagnostics show cache hits and the times until nearby and all blocks are ready. Generator format changes require a `PAGE_FORMAT` version bump.

This streams generated pages from the worker and, on cache hits, from browser storage. It does **not** yet bound total CPU/GPU scene memory or fetch a large world from a server. All blocks are eventually loaded in the present small city. A separate residency policy can discard GPU buffers for distant glazing and reload them from retained CPU geometry; other geometry remains resident so full-detail shadows remain correct.

## GPU visibility

Three.js performs frustum culling and submits indirect draws. WebGPU compute selects detail and updates the commands without a per-frame CPU readback. Camera draws use filtered commands; shadow cameras use unfiltered full-detail commands. The distant proxies do not duplicate those shadows. Heritage buildings retain their detailed representation. Trees, streets and furniture do not use the new detail or occlusion paths; collision stays independent.

The default analytic occlusion test uses inset opaque cores that correspond to real building solids. Rounded, lobed and heritage buildings are excluded as occluders. A group is hidden only if its projected bounds lie wholly inside one closer opaque face; candidates crossing the near plane remain visible. This intentionally misses occlusion opportunities.

The optional **Depth hierarchy experiment** adds a same-frame 64 × 64 conservative depth grid computed from those opaque faces. A tile is covered only when the full tile is inside one face; its value is the face's farthest depth. Six max-reduction levels preserve uncovered tiles. The group test queries a conservative mip level, which can combine coverage from multiple occluders. This is an analytic depth hierarchy, not a depth pyramid generated from the scene's rasterized depth buffer. Building and reducing it adds GPU passes; compare its cost with the default on target hardware.

The optional **Glazing meshlet experiment** scans the glazing leaves on the GPU. It applies the same conservative face test, atomically compacts the indices of visible leaves, and writes a single indirect indexed draw per glazing mesh. This avoids a separate draw for every leaf. Glazing casts no shadows; evicted buffers and the original geometry are restored when modes change. The hierarchy's leaves are currently scanned rather than traversed as a GPU tree. The rest of the city's geometry does not use this meshlet path.

## Detail transitions

The default **Conservative quality** mode keeps fine geometry. For each block, the GPU projects a box encompassing both geometric alternatives. The projected diagonal is a conservative positional bound between points in those alternatives: the distant representation is selected only below **0.85 pixels** and the near representation returns above **1.15 pixels**. Blocks that cross the near plane stay near. This is deliberately very cautious and may not switch at normal viewing distances in this small scene. The bound concerns projected positions; it does not guarantee identical color, lighting, shadows or anti-aliasing, and visual inspection remains necessary.

The opt-in **GPU adaptive** mode instead estimates the projected size of a 3.25 m storey and removes selected thin features. It selects distant geometry below **3.4 pixels** per storey and returns above **4.6 pixels**. Fine groups use a **1.25-pixel** target with 15% hysteresis. This faster heuristic is not a maximum geometric-error bound, and transitions can differ visibly. Glazing buffers can be evicted below 2.8 pixels per storey and are restored above 3.8; forced distant inspection also evicts them. Conservative quality and full/occlusion-only modes restore glazing. The distant representation preserves massing and roof lines where supported; it is simplified 3D geometry rather than a photograph or billboard.

## Inspect and measure

- **Conservative quality:** stable default with conservative positional LOD and full fine detail.
- **GPU adaptive:** analytic occlusion, thin-feature selection and heuristic distant LOD.
- **Depth hierarchy experiment:** GPU adaptive plus the same-frame depth hierarchy.
- **Glazing meshlet experiment:** GPU adaptive plus GPU compaction of visible glazing meshlets.
- **Full geometry:** full near geometry and no GPU occlusion.
- **Adaptive detail only / Occlusion only:** isolate those decisions for comparison.
- **Inspect distant geometry:** force distant geometry, including at close range, to inspect the approximation.

**Performance Details** reports page-cache hits, readiness stages, GPU-hidden groups, distant groups, glazing eviction, and meshlet indices before and after compaction. The panel reads counts asynchronously; ordinary rendering has no per-frame visibility readback. Optional timestamp queries report visibility compute separately from sampled render passes. Three.js's submitted triangle statistic is an upper bound for indirect draws. Compare the same seed, route, resolution and lighting on target hardware, with and without diagnostics.

Run `npm test` and `npm run build`. For the browser-level test start `npm run dev` and open `/tests/webgpu-smoke.html` on the local server. It checks page-cache budget and round trips, full versus culled reference pixels, indirect draws and shadows, LOD hysteresis, depth hierarchy, GPU meshlet compaction and buffer restoration. The test has run on a software WebGPU adapter; that validates behavior, not hardware speed or the full city's visual quality.

## Integration and remaining work

Three.js is pinned to r186. Its public `BufferGeometry.setIndirect` supports WebGPU indirect draws, but the integration obtains shared buffers through private renderer attribute/backend interfaces. Recheck it when upgrading Three.js. If visibility initialization fails, the full-detail city stays available.

Compared with [Epic's Nanite description](https://dev.epicgames.com/documentation/en-us/unreal-engine/nanite-virtualized-geometry-in-unreal-engine), this implementation lacks a general imported-mesh cluster DAG, crack-free multilevel simplification, an on-demand GPU page pool, visibility-buffer rasterization, full-world streaming and a production shadow LOD system. Its page hierarchy is currently specialized to glazing, and the geometric bound is deliberately coarse. [Three.js documents](https://threejs.org/docs/pages/BufferGeometry.html) its indirect geometry interface as WebGPU-only. The remaining work is hardware profiling and moving-camera visual review; a larger representative city; general-purpose compressed cluster assets and GPU hierarchy traversal; budgeted asynchronous GPU residency and shadow proxies; and stronger per-cluster error and material continuity measurements.
