# Aether · City Realism Lab

A first research prototype for a **walkable, procedurally assembled WebGPU city**. The target is a cinematic, high-fidelity city suitable for a commercial game. This repository is an experimental starting point, not a finished AAA renderer or part of the main Aether game yet.

Read [the research and production roadmap](docs/RESEARCH.md) for the overall design, and [the material system](docs/MATERIAL_SYSTEM.md) for sources, implementation and next steps.

## Explore the city

1. Install Node.js 20.19+ or 22.12+ and a recent browser with WebGPU and hardware acceleration enabled.
2. Run:

   ```sh
   npm ci
   npm run dev
   ```

3. Open the local address printed by Vite. GitHub Pages or another HTTPS host can also serve the built `dist` directory. WebGPU requires a secure context; localhost is treated as secure.
4. Select **Enter the City** and use **WASD** or arrow keys to walk, the **mouse** to look, **Shift** to run, **R** to return to the start, and **Escape** to release the pointer. **Overview** switches to an elevated view; **Street View** returns to street level.
5. Try another numeric seed, lighting atmosphere, quality setting, or **Surface Weathering** amount. Open **Explore Material Sets** to inspect the six sources.

The controls are designed for a desktop keyboard and mouse. Touch navigation is not implemented yet. The prototype reports an error when WebGPU is unavailable rather than silently switching renderers.

## What is actually implemented

- A deterministic 4 × 4 block layout with 64 building lots, pavements, street markings, geometric street trees, streetlights, benches and parked cars.
- Six seeded families: heritage, modern, residential, stepped, round and lobed. Generic buildings are assembled from piers, spandrels, recessed window frames, balconies, roof equipment and curved fins. Glazing uses shader-generated room interiors; the heritage family uses the Three.js procedural skyscraper generator.
- Block-grouped instancing for repeated components, ordinary frustum culling, conservative building collision and wall sliding.
- Six CC0 photographic PBR sets for brick, precast concrete, stone, plaster, pavement and asphalt, with physical scale, coordinated procedural weathering and stochastic anti-tiling on unstructured surfaces. Aligned structure is preserved on masonry and paving.
- An analytic sky, three cascaded directional shadow maps, a camera-proximate proxy-city reflection probe, screen-space ambient occlusion, tone mapping, subtle bloom and FXAA.
- Golden-hour, blue-hour and overcast presets. Quality settings control pixel ratio, shadow-map size and AO resolution.

## Important limitations

This is a compact research scene with a fixed road grid. It does not yet provide irregular parcels, a complete authored building kit, global illumination, ray-traced reflections, temporal antialiasing, streaming, LODs or mobile navigation. Glass combines opaque interior mapping or reflective panels with a shared proxy-city cubemap that changes near the player; it is not physically accurate refractive glazing or detailed, parallax-correct reflection. The AO, environment lighting and shadows are approximations, not ray tracing. Frame rate, memory and visual quality need evaluation on target hardware.

Standard browser WebGPU does not currently offer a generally available hardware ray-tracing API. Software ray tracing in compute is a possible future experiment, with material performance and denoising trade-offs. See the research document for sources and a plan.

## Verification

```sh
npm test
npm run build
```

Tests cover seed reproducibility, non-overlapping layout, walking collision, spatial batches and packaged material-map provenance. They do not replace testing the actual render on supported GPUs. The GitHub Actions workflow builds and tests the app and publishes the built site when GitHub Pages is configured to use GitHub Actions.

## Project structure

- `src/plan.js` — deterministic city layout and movement collision.
- `src/city.js` — architectural assembly, instances and streetscape.
- `src/materials.js`, `src/materialLibrary.js`, `src/surfaceNodes.js` — scanned material sets and GPU procedural overlays.
- `src/glazing.js`, `src/foliage.js`, `src/reflections.js` — recessed glazing, geometric trees and the proxy reflection probe.
- `src/main.js` — WebGPU scene, controls, lighting, and post-processing.
- `docs/RESEARCH.md`, `docs/MATERIAL_SYSTEM.md` — research, constraints, validation and roadmap.
- `tests/` — layout and collision invariants.

## Third-party notices

This project uses Three.js, including its procedural city generators, under the MIT license. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Vite is a build dependency. The interface requests Google Fonts when available and has local system-font fallbacks. The included Poly Haven PBR textures are CC0; their sources and authors are recorded in the notices and provenance manifest. A full commercial distribution must retain required notices and review the licences and dependencies actually shipped.
