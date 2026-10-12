# TwoManyProjectors — Projection Simulator Beta

## Summary

Build a desktop-oriented browser editor using **Svelte 5, TypeScript, Vite, and Threlte**, delivered first in the local workspace with a portable static build.

The beta includes all requested capabilities: model/cloud/splat imports, positioning and rotation, two-point scaling, custom and catalogue projectors, projected images and shadows, adjustable filled frustums, analysis overlays, and optional material response.

Confirmed defaults: **1–8 active projectors**, planning estimates, static grids/images, conventional lenses, direct approximate projection onto scans, and local project files without accounts.

## Editor and asset workflow

- Use a dark workspace with a resizable scene tree, central viewport, property inspector, and compact tools for importing, transforming, measuring, and analyzing.
- Provide an infinite adaptive grid, orbit/pan/dolly navigation, keyboard fly mode, frame-selection/home commands, and perspective/orthographic switching.
- Build the view cube around Threlte’s `Gizmo`: styled cube faces, edge/corner targets, hover feedback, and smooth camera transitions. Keep its orientation and orbit target synchronized with navigation. [Threlte Gizmo documentation](https://threlte.xyz/docs/reference/extras/gizmo/)
- Support selection, translation/rotation gizmos, numeric transforms, snapping, duplicate/delete, visibility, and undo/redo. A completed drag creates one undo operation; transforming objects temporarily pauses camera controls.
- Include simple plane, box, and cylinder receivers for testing projection without importing assets.

| Asset | Beta formats |
|---|---|
| Meshes | GLB/glTF, OBJ with MTL/textures, STL, mesh PLY |
| Point clouds | PLY, PCD, XYZ |
| Gaussian splats | Gaussian PLY, SPLAT, SPZ |
| Projection images | PNG, JPEG, WebP |

Imports resolve accompanying files locally, preserve model hierarchies/materials, and expose progress, cancellation, and actionable errors. Inspect PLY properties to distinguish meshes, clouds, and splats. Provide unit/up-axis controls without automatically fitting assets to an arbitrary size. Spark supplies the selected splat loaders. [Spark loading documentation](https://sparkjs.dev/docs/loading-splats/)

**Two-point scaling:** select one imported asset, pick two points on it, enter their real distance and unit, then preview and apply uniform scaling. Scale the entire asset around the first picked point, preserving that point’s world position and the asset’s rotation. Reject coincident points and invalid distances; support cancellation and undo.

## Projectors and simulation

**Equipment and optics**

- Each projector exposes position, rotation, native resolution, output lumens, output multiplier, throw ratio/zoom, horizontal/vertical lens shift, and visualization settings.
- Derive an asymmetric perspective camera from throw ratio, aspect ratio, and lens shift. Use its matrices consistently for image projection, frustum geometry, shadows, picking, and analysis.
- Place the transform origin at the optical center; allow free rotation and an aim-at-surface command.
- Seed a verified catalogue with Epson EB-PU1007B/1008B and ELPLM08, plus Panasonic PT-RZ790/RZ990 and ET-DLE150/170/250. Record specifications and compatibility per pairing, with manufacturer references and verification dates. Presets remain editable through a custom copy. [Epson specifications](https://files.support.epson.com/pdf/specs/specifications_ebpu2010series_en_r106.pdf), [Panasonic specifications and lenses](https://docs.connect.panasonic.com/projector/download/catalog/pdf/PT_RZ990_S_2P_ctlg_Eng_PC.pdf)
- Normalize manufacturer lens-shift conventions before use; enforce documented pairing limits rather than combining independent maximum shifts.

**Projection rendering**

- Generate grids, checkerboards, crosshairs, numbered alignment patterns, color bars, and solid white. Imported images default to contain-with-black-borders, with cover/stretch controls.
- Project textures in world space, with projector-space depth tests preventing illumination behind blockers. Sum overlapping projector contributions in linear color space.
- Provide independent controls for frustum outlines and filled volume opacity, color, and maximum extent. Filled volumes are visualization helpers and never cast shadows or receive projection.
- Render meshes through material shader extensions, clouds through a point shader, and splats through Spark world-space color modifiers. Use thresholded scan depth passes for approximate occlusion.
- Use imported cloud normals when available; otherwise estimate them in a worker. Estimate splat normals from their smallest covariance axis. Mark unreliable scan measurements unavailable instead of displaying misleading numbers. Spark exposes modifier and custom rendering hooks for this integration. [Spark modifiers](https://sparkjs.dev/docs/splat-mesh/), [Spark rendering](https://sparkjs.dev/docs/spark-renderer/)

**Analysis and materials**

- Offer projection preview, illuminance, pixel density, and pixel distortion modes with legends, adjustable ranges, and click-to-probe values.
- Report illuminance in **lux**, plus estimated intercepted lumens for a selected receiver. Lux is luminous flux per surface area. [BIPM photometry definitions](https://www.bipm.org/documents/20126/41749107/Principles%20governing%20photometry/8365350c-bf72-3cf2-bf03-324bf5c01b62)
- Assume uniform emitted flux across native projector pixels. Derive illuminance from each pixel’s flux and projected surface footprint, accounting for distance, incidence, occlusion, and output multiplier. Do not redistribute light that misses the scene.
- Display pixel density as directional pixels/metre and millimetres/pixel. Define distortion as the ratio between the largest and smallest local pixel-footprint dimensions; front-on square pixels yield 1.
- Brightness can show one projector or their sum. Density and distortion always identify the selected projector.
- Enable material response by default, with a neutral-surface toggle. Provide editable white screen, concrete, dark metal, and glass presets using reflectance/color, roughness, and transmission.
- Separate incident lux from visible surface response. Diffuse luminance uses `L = Eρ/π`; metal and glass appearance remains an approximation. Glass transmission controls the surface preview; transmitted secondary images, refraction, and caustics are outside this beta.
- Treat captured scan colors as appearance data, with explicit material overrides rather than assuming they are measured reflectance.

## Architecture, persistence, and performance

- Use **WebGL2** for the initial renderer because Spark integrates with Three.js `WebGLRenderer`. Keep rendering behind adapters so later backend changes do not affect editor state. [Spark renderer requirements](https://sparkjs.dev/docs/spark-renderer/)
- Separate serializable Svelte state from runtime Three.js objects and GPU resources. Use command-based edits and small subsystem components for the viewport, inspector, imports, optics, and analysis.
- Define shared typed interfaces: `SceneDocument`, `AssetRecord`, `SurfaceMaterial`, `ProjectorConfig`, and `AnalysisSample`. Use metres internally, quaternion rotations, stable IDs, and explicit measurement confidence.
- Give mesh, cloud, and splat adapters common loading, picking, projection/depth, and disposal responsibilities. Share optics and analysis mathematics between CPU probes and GPU shaders.
- Save a versioned `.tmp3d` ZIP containing the scene document and original assets/images. Embed resolved projector specifications so catalogue updates cannot change saved projects. Use IndexedDB for recovery autosaves, with explicit save/open/download controls.
- Render on demand, including camera animation and Spark completion events. Cache projector depth maps and rebuild only when their inputs change.
- Pack media and depth maps into GPU atlases, use worker preprocessing and spatial picking indexes, and apply cloud/splat LOD. Reduce preview resolution during manipulation and refine after release; analysis always uses native projector resolution.
- Support eight enabled projectors, while retaining additional disabled projectors in the scene. Handle failed imports, storage exhaustion, and WebGL context loss without discarding the saved document.

Implement in order: editor/state foundation → imports and scaling → mesh projection/optics → scan adapters → analysis/materials → persistence and optimization. These are development checkpoints within the same beta.

## Validation and acceptance

- **Optics:** a 16:10 projector at 6 m with throw ratio 1 produces a 6 × 3.75 m footprint. Verify zoom endpoints, lens shift, orientation, and catalogue compatibility.
- **Photometry:** 6,000 lm across that white footprint averages approximately 266.7 lux. Doubling distance quarters illuminance; identical overlapping projectors double it.
- **Analysis:** front-on square pixels yield distortion 1; oblique surfaces increase anisotropy. CPU probes and GPU overlays agree on deterministic fixtures.
- **Occlusion/materials:** blockers prevent projection behind them; helpers do not interfere. Lower diffuse reflectance reduces visible brightness without changing incident lux.
- **Assets/scaling:** exercise every supported format, accompanying textures, ambiguous PLY files, malformed imports, and scan approximation labels. Verify calibration after rotation and existing scale, anchor preservation, cancellation, and undo.
- **Editor/persistence:** verify cube faces/edges/corners, orthographic switching, gizmo/camera isolation, numeric edits, and complete save/open round trips.
- **Performance:** benchmark representative scenes with a few million primitives and eight projectors at 1080p. Target at least 30 FPS during navigation on a recent desktop GPU using adaptive preview quality; record hardware and measured results.
- Run TypeScript/Svelte checks, mathematical unit tests, browser workflow tests, and visual QA. Deliver source, sample scenes, development/build instructions, and the verified static build.

Desktop mouse/keyboard use is the priority. Video, UST optics, digital keystone, survey formats, cloud accounts, collaboration, and deployment remain later additions.
