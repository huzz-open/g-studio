# Standard parts and the shared editor

## User flow

1. Import an ordinary sprite sheet. Double-click a detected sprite (or choose **编辑部件 / Edit part**). A stable part asset is created in the local library.
2. Inspect the original, normal map, or **光照与阴影 / Light and shadows**. The latter mounts the same `LightingViewport` and renderer used by the scene. Unknown images start with an explicitly labelled **silhouette approximation**; they are not assigned a guessed object type.
3. Choose box/cylinder geometry, one of the six example templates, or apply validated compound geometry JSON. Edit dimensions, image anchor, offsets, alignment scale and normal settings. Light and receiver environment changes here are preview-only.
4. **保存并返回 / Save and return** commits the shared asset. **加入场景 / Add to scene** saves then creates an instance. The slicer toolbar adds all export-checked sprites; its context action adds the highlighted subset.
5. Select/double-click an instance to edit the same asset. Closing returns to the unchanged scene. **在精灵图中打开 / Open in Sprite Slicer** locates an already-open linked sprite; if the source sheet is closed, it opens the saved crop as a linked single-sprite tab.

Edits are drafts until saved. Cancelling/discarding does not modify the library. Saving updates all references, while instance position/scale/cast/receive flags remain independent. Numeric sprite indexes and names are not asset identities.

## Asset v1

`src/shared/parts/schema.ts` is the contract and validator:

```json
{
  "format": "g-studio/part",
  "version": 1,
  "id": "stable-uuid",
  "revision": 1,
  "name": "prop",
  "image": { "uri": "data:image/png;base64,...", "width": 64, "height": 64 },
  "normal": { "alphaThreshold": 0.03, "shapeRadius": 4, "shapeStrength": 1.15, "shapeSoftness": 1.15, "detailStrength": 6, "detailScale": 0.6, "normalStrength": 1.5, "normalFormat": "opengl", "invertX": false, "invertY": false },
  "geometry": { "kind": "box", "size": [1, 2, 0.6] },
  "alignment": { "anchor": [0.5, 1], "offset": [0, 0], "scale": 1 }
}
```

- `image.uri`: embedded PNG; built-in examples may use `builtin:<known-template>` internally. Portable export embeds their pixels. Arbitrary remote URLs are rejected.
- `geometry.kind`: `silhouette`, `box`, `cylinder`, `template` or `compound`. Templates use a known `template` id. Compound geometry supplies 1–64 `parts`, each a `box`, `cylinder` or `ellipsoid` with `position` and `size` triples. Primitive positions are bottom-center coordinates (ellipsoid centers are derived); the complete compound is centered, grounded and resized to the asset's overall `size`.
- `alignment.anchor`: normalized image coordinate of the anchor, measured from top-left. Offsets are in the fixed camera's right/up basis; alignment scale affects the image projection, not the physical geometry.
- Optional `source` stores SHA-256 hashes of the source image encoding and extracted PNG, the source filename, crop rectangle and optional `.gs` path. Exact source/crop/pixel matches reuse the same asset. Changed crops/pixels become new assets; existing scenes keep their previous assets.
- Normal textures are deterministic derivatives of pixels and normal settings. Front-surface depth and normals are derived by the shared renderer and invalidated when geometry/alignment changes; they are not editable independent truth.

The library uses IndexedDB (`g-studio-parts-v1`); images are not placed in localStorage. Saves check revisions in a read/write transaction. Disk/newer library revisions win over older sheet snapshots. Local preview requires normal browser storage; errors are shown rather than reporting a false successful save.

## Scene references and portability

A scene instance contains `id`, `assetId`, `x`, `z`, `scale`, `visible`, `casts`, `receives`. Repeating an asset creates a new instance id. The local scene stores references only, supports up to 24 instances, and keeps its light, selection and environment while the part editor is open.

- **导出资产 JSON**: standalone `.gpart.json` including embedded color and all asset parameters; can be imported from the scene library.
- **导出部件包 ZIP**: `part.json`, `color.png`, `normal.png`; extract `part.json` to import through the JSON importer.
- **导出场景与部件**: version-2 `g-studio/scene` JSON with instance state and deduplicated portable assets. Import resolves equal assets; a conflicting asset id is cloned/remapped rather than silently overwriting a different local asset.
- `.gs` sprite entries optionally include a full `partAsset` snapshot. Older sheets without that field remain valid. Normal settings remain mirrored for existing color/normal export. Undo/redo of sprite structure retains links; shared asset revisions remain authoritative.
- Source PNGs are unchanged. Derived normal maps and depth caches regenerate as necessary.

This stage does not call an AI service. Geometry can be authored in the editor or supplied through the validated JSON interface. Hidden structure and missing depth still require approximation or authored geometry.

## Checks

`npm run test:parts`, `npm run test:scene-lighting`, and `npm run build` cover schema compatibility, arbitrary asset geometry, references, source identity, old `.gs` files and rendering geometry.

Browser acceptance: import a sheet, edit and save six parts, batch-add, add a repeated instance, edit through the scene, open the linked sprite, verify every reference updates without resetting light/positions, cancel a draft, export/import a complete scene, and reload to verify persistence. The shared scene store and library preserve identity through Vite hot replacement as well.

## Editor layout

Scene lighting uses the same `EditorShell`, `ShellTabBar`, resizable side panel and `useEditorTabs` as the other editors. The scene tab's + creates an empty scene; double-click a tab to rename it. Objects, lights, selection and undo history are independent per tab. Open tabs and recently closed scenes are saved locally; the reopen icon restores a closed scene. Existing single-scene saves migrate to the first tab without removing the legacy save.

The six bundled props are registered in `shared/parts/builtins.ts`. The Parts panel combines built-in and imported assets in one searchable thumbnail grid. Hover/focus reveals the name and Add/Edit actions; click selects for batch add, or drag a thumbnail onto the viewport to place it at the ground intersection. Existing distinct assets are preserved even if their names match. Presets open a separate scene tab. Asset edits are still shared across scenes that reference the asset.

Scene controls, the part library, part editor and sprite-slicer sidebar use the shared `ScrollArea` overlay scrollbar. Native scrolling remains responsible for wheel/touch/keyboard positioning; native chrome is hidden. The custom thumb supports dragging, track paging and Home/End/PageUp/PageDown. Technical diagnostics are collapsed by default, with detailed explanations available through help buttons.


Scene display controls and the name visibility switch live in the left sidebar; selected instance properties live in the shared right sidebar. There is no duplicate scene-instance list. Object picking still works with names hidden. The sun handle adjusts height only, while the ground handle moves the light in X/Z only; both support keyboard arrows. Name visibility persists per scene and defaults to visible for old saves.

Settled sprite detection results automatically register in the shared part library after a short debounce, including while the scene route is open. Source hashes/crop identity reuse existing parts; changed source pixels produce a new asset so existing scenes remain intact. Registration cancels when source processing changes or the slicer instance closes. New parts use the existing silhouette geometry default; automatic registration does not infer a new 3D model.


## Shared controls and history

`SegmentedControl.label` renders a same-row label for parameter choices. Section headings remain for multi-field or collapsible sections; actual document tabs remain in `ShellTabBar`. Presets are at the top of the scene sidebar. Objects and the two light handles are picked directly; there is no move-tool mode switch.

`EditorShell.history` connects any `HistoryController` to the fixed Undo/Redo buttons at the right of the tab strip and Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, Ctrl+Y. Text inputs retain native undo. Modal dialogs block background editor history. The shared `HistoryControls` is also used by the split editor's local history.

`createHistoryStack` is the common snapshot/transaction mechanism. `createObservedHistory` adapts serializable editable state to it, and the shell brackets pointer/arrow-key gestures so a drag records one step. Transactions ignore late commits from obsolete owners; a changed edit clears redo. Scene instances, lights, environment and display settings use this adapter; selection and zoom are navigation and do not consume undo steps. Scene tabs have independent in-memory histories; reloading or closing a tab resets its undo stack, while the scene content remains saved.

Sprite slicing and region editing retain their existing document snapshots through the same shell interface. Tileset parameters use observed history; clicking the terrain preview selects its existing painting history for the same buttons/shortcuts. Loading a new tileset source establishes a fresh parameter-history baseline. File IO, asset-library revisions and document-tab creation/closing are not undone by a scene snapshot (closed scene tabs still have their separate reopen action).


Part-editor geometry changes preserve the authored dimensions and image alignment, the preview instance pose, camera and light. Initial framing runs once; the explicit Fit View button changes only the camera. Geometry updates are prepared offscreen and published as one current batch. Superseded/failed updates retain the previous assets, and routine updates do not flash a loading badge over an already usable preview.
