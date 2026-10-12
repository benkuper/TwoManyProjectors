# TwoManyProjectors

A local, desktop-first projection planning studio built with Svelte 5, TypeScript, Vite, Threlte, Three.js and Spark. No accounts or server-side storage. All imports, measurements, recovery data and project archives stay in the browser or on your disk.

Open the hosted studio at **[benkuper.github.io/TwoManyProjectors](https://benkuper.github.io/TwoManyProjectors/)** in a current WebGL2-capable desktop browser.

## Deploy

Push to `main` to publish through the [GitHub Pages workflow](.github/workflows/deploy-pages.yml). The workflow installs locked dependencies, checks Svelte/TypeScript, runs unit tests, and builds with the repository's Pages base path before deploying `dist/`. It can also be run manually from GitHub Actions. The default local build keeps relative URLs for portable hosting.

## Run

Requires Node.js 22.12+ (tested with Node 26) and a current WebGL2-capable desktop browser.

```powershell
npm ci
npm run dev
```

Open the local URL Vite prints. To build and serve the portable version:

```powershell
npm run build
node scripts/serve.mjs
```

Open **http://127.0.0.1:4173/**. The static build is in `dist/`. The portable archive includes `dist/`, the dependency-free Node HTTP server, and `Launch studio.cmd`. It needs Node, but no npm installation. Serve the files over HTTP; browser module and worker restrictions prevent opening `index.html` through `file://`.

## Use the studio

- Start with the sample screen and a 6,000 lm custom projector at 6 m, TR 1, native 1920 × 1200. Its footprint is 6 × 3.75 m, averaging 266.7 lux in the white-field model.
- Add projectors, planes, boxes or cylinders from the scene panel. Select, duplicate, hide, disable or delete objects. Up to eight projectors can be enabled; additional equipment stays in the document disabled.
- Use the padlock beside any projector or receiver to prevent selecting or editing it. Locked items are skipped by viewport clicks, range selection and Select all; they still render and participate in projection analysis. Unlock them from the scene list. Locks support undo and save/reload.
- Import GLB/glTF, OBJ with MTL/textures, STL, mesh/cloud/Gaussian PLY, PCD, XYZ, SPLAT or SPZ. Select companion buffers, MTL and images together. Specify units and Y/Z up before import. Import does not fit or normalize the asset to an invented size.
- Click an asset in the library to reveal and frame its scene instance. Drag it into the viewport to place a copy with its bottom center on a surface or the ground; the **+** button adds a copy at the original coordinates. Placement preserves the imported units and up axis and supports undo.
- Set position and Euler angles numerically, or use move, scale and locally oriented rotation gizmos. Drag any numeric field to adjust it live; hold Shift for precision, or click to type. Rotations are stored as quaternions. Snap uses 0.1 m, 15° and 0.1 scale steps. Splat scales are uniform. A completed drag is one undo operation.
- For two-point scaling, select an imported receiver, choose **Two-point scale**, and pick two points on it. Enter a real distance, preview, then apply. The first point stays fixed in world space and the rotation is preserved. Cancel restores the original transform.
- Choose a projector and then a compatible lens in separate controls. Epson EB-PU1007B, EB-PU1008B, EB-PU2220B and Panasonic PT-RZ790/PT-RZ990 are supported. Changing the body keeps a compatible selected lens or chooses its default; changing the lens updates throw range, shift limits and referenced light output. Verified presets require a custom copy before changing native specifications. Custom projectors allow editing manufacturer, model, lens, output, resolution, throw limits, shift limits and combined-shift shape. Lens shift uses fractions of full image width/height and enforces the coupled manufacturer polygon.
- Selecting an enabled projector shows a blue dashed envelope of every projection position reachable through lens shift at its current throw ratio and orientation. The envelope follows the lens's combined limits and shares the outline, filled volume, extent and opacity controls with the current frustum.
- Choose generated grid, checkerboard, crosshair, numbered alignment, color bars or white. Grid, checkerboard and numbered patterns use square cells with an editable size in native projector pixels (120 px by default), cropping partial cells at the edges. Enable **Preview native pixels** to rasterize test patterns and imported images at the projector's native resolution, including one-pixel grid lines; zoom in to compare edge detail. Import PNG/JPEG/WebP projection media and choose contain, cover or stretch. Each projector has independent outline, filled volume, color and extent controls. Shared volume/outline opacity sliders live in the viewport.
- Switch between projection, lux, directional pixel density and distortion. Set the analysis projector and legend range. **Probe** samples a receiver. Density/distortion always name one projector; lux can sum enabled projectors.
- **Materials** toggles visible surface response. Presets and editable color, reflectance, roughness and transmission live in the receiver inspector. Lux remains incident illumination, independent of material.
- Select a Gaussian receiver to adjust **Splat opacity** (0–5×) and **Splat size** (0.1–5×) in **Gaussian rendering**. Increase these to strengthen faint splats and fill gaps; 1× preserves the original appearance. These per-instance display settings support undo and save/reload without changing scan dimensions or measurements.
- Save/open `.tmp3d` projects. These versioned ZIPs embed `scene.json`, resolved equipment specifications, and original assets/images. Scene edits are checkpointed immediately; IndexedDB stores imported assets. Reloading automatically restores the latest project. Failed imports/open operations preserve the existing document.

## Navigation and shortcuts

| Action                         | Input                                         |
| ------------------------------ | --------------------------------------------- |
| Orbit / pan / dolly            | Left drag / middle drag / right drag or wheel |
| Frame selection / home         | F / Home                                      |
| Perspective / orthographic     | O                                             |
| Select / move / rotate / scale | V / W / R / S                                 |
| Toggle object selection        | Ctrl/Cmd+click (Shift+click also in viewport) |
| Select range in scene list     | Shift+click                                   |
| Select all objects             | Ctrl/Cmd+A                                    |
| Probe                          | P, then click a receiver                      |
| Duplicate / delete             | Ctrl+D / Delete                               |
| Undo / redo                    | Ctrl+Z / Ctrl+Shift+Z or Ctrl+Y               |
| Save / open                    | Ctrl+S / Ctrl+O                               |
| Deselect / help                | Escape / ?                                    |

The Threlte cube supports animated face, edge and corner targets. Scene and inspector panels resize by dragging their dividers or using arrow keys while a divider is focused.

Multiple selected objects share a center for moving, rotating and uniform scaling. The inspector edits their center position while preserving spacing. Duplicate, delete and frame apply to the whole selection; each group edit is one undo command. Group scaling moves projector origins while preserving their optics.

## Samples

Open `public/samples/studio.tmp3d` for the baseline room, or `scan-study.tmp3d` for a self-contained SPZ study. The same files ship under `dist/samples/`. Tiny original fixtures cover every supported format, including companion textures and malformed PLY. They are generated in-house and may be reused.

Regenerate the text/binary fixtures with `python scripts/generate-fixtures.py`. With the dev server on port 5174, `node scripts/generate-spz.mjs` and `node scripts/generate-projects.mjs` regenerate SPZ and project archives using installed Microsoft Edge.

## Math and rendering

Metres are the internal length unit. A conventional lens uses an asymmetric perspective matrix with width `distance / throwRatio` and height `width / nativeAspect`. The same matrix drives projection, frustum helpers and projector depth rendering.

Every native pixel carries `lumens × multiplier / (widthPixels × heightPixels)` flux. A ray-plane Jacobian computes the local pixel footprint, including distance and incidence. Lux is pixel flux divided by footprint area. Light missing receivers is never redistributed. Overlapping projector RGB contributions sum in linear space. Probes report X/Y pixels per metre, millimetres per pixel, and the singular-value ratio of the local footprint. Ideal front-on square pixels yield distortion 1. Diffuse luminance is `E × reflectance / π` cd/m².

Mesh materials use shader extensions; point clouds evaluate projection once per point; Spark splats use world-space color modifiers. Projected media and projector depth occupy 4 × 2 atlases. Filled frustums, outlines, grids and selection helpers are excluded from depth and receiver picking. Projector depth maps are cached per projector until geometry, transforms or optics change. Gaussian appearance controls update uniforms without rebuilding their shader; unrelated UI edits reuse generated splat colors. Rendering is on demand, with orbit damping, camera animation and Spark dirty events requesting frames. Gaussian LOD starts with a balanced budget and retains its learned detail between drags, avoiding a costly full-detail-to-preview rebuild on every pointer down. Interaction reduces raster resolution, adapting further if frames are slow and restoring full screen resolution on release. The LOD pixel threshold compensates for raster resolution so the prepared scan detail remains available; native analysis resolution stays fixed. Numeric drags publish at most one update per animation frame.

Mesh picking uses a BVH; cloud and splat depth/picking proxies use point BVHs. Clouds retain up to one million uniformly sampled preview points. Local PCA normal estimation runs in a worker with planarity/confidence gates; supplied cloud normals are validated. Splat proxies use their smallest covariance axis, with opacity and flatness thresholds. Spark supplies splat LOD.

## Practical limits

This is a **planning beta**, not a calibrated photometric or survey instrument. Uniform white-field output is used for incident lux even when the preview image contains dark pixels. The manufacturer output multiplier can model measured losses. Panasonic DLE150/250 presets use explicitly labeled standard-lens nominal output because the source does not specify transmission for those lenses. Lens-shift conventions and catalogue references are recorded in each preset.

Depth maps use 512 × 512 samples per projector. Mesh shadow boundaries have that raster precision; cloud/splat occlusion uses thresholded point proxies and is approximate. Scan density and lux are unavailable where normals cannot be trusted. Preview sampling/LOD can miss fine scan detail. Multi-million-point preprocessing and imports still depend on available browser memory; original bytes are retained for saving. ASCII Gaussian PLY is normalized to binary for Spark; XYZ accepts `x y z` or `x y z r g b` rows. Draco/KTX2 decoder-dependent glTF, animation playback, video, UST lenses, keystone, survey formats and secondary glass transmission/refraction/caustics are outside this beta.

Roughness and original mesh materials are retained as appearance inputs; metal/glass preview is approximate. Captured scan colors are appearance data, not measured reflectance. Intercepted lumens use 4,000 rays per enabled projector and are labeled estimates. The status bar's render FPS is CPU render-dispatch timing; the recorded benchmark uses actual animation-frame timing.

## Validate

```powershell
npm run check
npm test
npm run test:browser
npm run build
```

Browser tests use installed Microsoft Edge, a deterministic local dev server on port 5174, and isolated browser storage. Set `PLAYWRIGHT_CHANNEL` or edit `playwright.config.ts` for another installed browser. Test artifacts go to `test-results/`. See [VALIDATION.md](VALIDATION.md) for measured results and coverage.

With the dev server running, benchmark a local Gaussian scan using `node scripts/benchmark-scan.mjs "D:/Desktop/mudaac.ply"`. Optional studio URLs after the path compare separate checkouts. The script measures actual animation-frame timing during orbit, lens-shift edits and projector dragging, serving the scan only over localhost and writing JSON and screenshots to `test-results/`.

Add `--starts --isolated` to measure the first second of repeated camera/projector drags at DPR 2, alongside steady-state timing. This starts a temporary server with hot reload disabled and verifies that the viewport actually renders throughout each measurement.

## Source layout

- `src/lib/types.ts`, `store.ts`: serializable document, editor state and command history.
- `optics.ts`, `projection.ts`: CPU optics/photometry and GPU shader integration.
- `assets.ts`, `formats.ts`, `normal-worker.ts`: local asset loading, PLY disambiguation and scan preprocessing.
- `engine.ts`: Three/Spark adapter, navigation, transforms, depth cache, picking and probing.
- `persistence.ts`: validated ZIP projects and IndexedDB recovery.
- `src/components/`: Threlte scene, inspector and numeric controls.

Equipment sources: [Epson PU1000 specifications](https://files.support.epson.com/pdf/specs/specifications_ebpu2010series_en_r106.pdf), [Epson PU2220 specifications](https://files.support.epson.com/pdf/specs/specifications_ebpu2220series_en_r103.pdf), [Panasonic catalogue](https://docs.connect.panasonic.com/projector/download/catalog/pdf/PT_RZ990_S_2P_ctlg_Eng_PC.pdf), [Panasonic manual](https://eu.connect.panasonic.com/sites/default/files/media/document/2025-01/rz990_manual_en.pdf). EB-PU2220B output values use 220–240 V operation. Verified 2026-10-12. Fonts are bundled locally with their SIL Open Font Licenses in `public/fonts/`.
