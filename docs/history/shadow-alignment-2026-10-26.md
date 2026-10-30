# Shadow alignment investigation

[历史索引](README.md) · [当前文档](../README.md)

Date: 2026-10-26. Historical analysis, not a current setup guide. See [current rendering](../reference/lighting.md) and the [documentation index](../README.md).

The built-in chest reproduces an exposed dark strip below the light-facing edge in the single-part preview. Switching between sprite and geometry modes with the same camera and light shows that the geometric front face extends below the corresponding artwork edge. In geometry mode that face hides the ground underneath; in sprite mode transparent image pixels expose the same shadowed ground. Turning a face toward the light does not by itself guarantee that all ground below the depicted edge receives light.

This is a mismatch between the physical proxy and the drawn silhouette, rather than evidence that the light direction is reversed. `spriteBounds` fits the projected height and preserves image aspect ratio; `alignedBounds` adds an anchor, offset and uniform scale. Neither aligns the full alpha contour or individual contact edges. The shadow pass draws the complete proxy mesh, whereas the sprite pass discards transparent pixels. Therefore a proxy can cast a valid shadow that looks misplaced relative to the artwork. Image padding, illustrated perspective, feet and gaps can all expose this limitation for arbitrary assets.

The observed comparison does not establish a shadow-map direction or depth-comparison bug, so the shadow renderer and chest geometry were left unchanged. A general improvement should measure and visualize proxy/image contour and contact-edge disagreement, then fit or reconstruct geometry against those constraints. Validate both point and directional lights, different light heights, and objects with gaps or overhangs. Removing shadows on the light-facing side or clipping them to the camera-view alpha mask would hide valid occlusion and would not solve the underlying geometry mismatch.

Local-only evidence (not shipped with the repository): `output/shadow-alignment-review/sprites.png` and `output/shadow-alignment-review/geometry.png`, taken with unchanged camera and lighting between modes.

To reproduce the comparison, open the built-in chest in the part editor and switch between sprite and geometry views without changing the camera or light. Repeat for point and directional lights; saved local screenshots are not required to run the application.
