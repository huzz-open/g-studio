# Scene lighting preview

Open **场景光影 / Scene lighting** from the navigation or dashboard (`#/scene-lighting`).

The orthographic camera stays at 20° elevation and 25° azimuth. Wheel zoom does not change that angle. Six approved pixel props are bundled with their normal maps, so the preview works without a connected workspace.

Use the three presets to compare open ground, a wall corner, and cross-object shadows. Drag sprites or their labels to move them on the ground; use the light tool to place the point light, drag its handle, or use the position and height sliders. Focus the canvas and use arrow keys for 0.1-unit movements (Shift: 0.5). Movement is constrained by each proxy's footprint to keep it inside the room.

Each prop has independent visibility, cast-shadow and receive-shadow switches. The shadow toggle is global. Geometry and shadows-only modes help inspect receivers separately from the original artwork. Settings are saved in browser local storage and can be exported as JSON. Presets reset the scene.

Object names and the selected object's ground ring have independent display switches. Both are hidden in the single-part editor, which has no additional switches for these annotations. Hiding either annotation does not disable canvas picking or object movement.

## Rendering assumptions

- One point light with a six-face 1024² packed radial-depth cubemap. Ground, walls and visible enabled casters share this map. All receiving surfaces compare their world position against it. PCF filters jagged edges; this is not area-light softness.
- The umbrella has an elevated canopy and narrow shaft, the chair has separate seat/slats/legs, and other props use boxes, surfaces of revolution and branch/foliage approximations.
- Pixel artwork is rendered as camera-facing cutouts. A per-prop front-surface depth and normal map is baked from its proxy at the fixed camera angle. Covered sprite pixels reconstruct a world position, receive scene shadows and write the corresponding depth. Original normal maps add fine surface variation.
- Pixels outside the projected proxy use a plane approximation and ignore that proxy's own shadow. The sidebar reports this coverage limitation. Proxy silhouettes, hidden geometry, gaps and artwork are not exact matches; the geometry view is the authoritative representation of the physical assumptions.
- No bitmap pixels are changed. The sprite-slicer part editor and the scene now use the same `LightingViewport` and renderer; see [standard parts](standard-parts.md).

## Light-facing ground shadow investigation (2026-10-26)

The built-in chest reproduces an exposed dark strip below the light-facing edge in the single-part preview. Switching between sprite and geometry modes with the same camera and light shows that the geometric front face extends below the corresponding artwork edge. In geometry mode that face hides the ground underneath; in sprite mode transparent image pixels expose the same shadowed ground. Turning a face toward the light does not by itself guarantee that all ground below the depicted edge receives light.

This is a mismatch between the physical proxy and the drawn silhouette, rather than evidence that the light direction is reversed. `spriteBounds` fits the projected height and preserves image aspect ratio; `alignedBounds` adds an anchor, offset and uniform scale. Neither aligns the full alpha contour or individual contact edges. The shadow pass draws the complete proxy mesh, whereas the sprite pass discards transparent pixels. Therefore a proxy can cast a valid shadow that looks misplaced relative to the artwork. Image padding, illustrated perspective, feet and gaps can all expose this limitation for arbitrary assets.

The observed comparison does not establish a shadow-map direction or depth-comparison bug, so the shadow renderer and chest geometry were left unchanged. A general improvement should measure and visualize proxy/image contour and contact-edge disagreement, then fit or reconstruct geometry against those constraints. Validate both point and directional lights, different light heights, and objects with gaps or overhangs. Removing shadows on the light-facing side or clipping them to the camera-view alpha mask would hide valid occlusion and would not solve the underlying geometry mismatch.

Local review captures: `output/shadow-alignment-review/sprites.png` and `output/shadow-alignment-review/geometry.png`, taken with unchanged camera and lighting between modes.

## Verification

`npm run test:scene-lighting` checks camera picking, finite geometry, paired assets, umbrella clearance, chair gaps, wall receivers, an elevated cross-object receiver and movement limits. `npm run build` type-checks the module and packages its assets.

For browser verification, inspect all three presets, move objects/light, change light height, toggle the vase's receive flag and umbrella's cast flag in the cross-shadow preset, and compare geometry/shadows-only views. **Check shadow receivers** reads the actual GPU cubemap and reports sampled surfaces occluded by another object (not self-shadow and not back-facing diffuse darkness). Counts are diagnostic samples, not screen pixel areas. Changes invalidate the report until checked again.

Reload to verify persistence. Scene JSON export includes portable assets and instance references, and can be reimported. The six initial props are examples in the same asset library used for arbitrary imported sprites.
