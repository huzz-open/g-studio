# Bundled Hunyuan shape source

This directory is committed to Git, including the small `.whl` binary. It contains
the unmodified shape inference Python sources used by G-Studio, from upstream
commit `f8db63096c8282cb27354314d896feba5ba6ff8a`. It is a G-Studio distribution,
**not an official Tencent wheel or the complete Hunyuan3D package**. Texture
generation, demos, examples, model weights and native extensions are excluded.

`source-manifest.json` records the exact upstream URLs, lengths and SHA256 hashes.
Upstream LICENSE and NOTICE are retained inside the wheel's `.dist-info/licenses/`.
`wheel.json` records the wheel size and SHA256. Dependency versions remain in
`../../requirements-model.lock`; this source-only wheel intentionally does not
ask pip to resolve the full upstream dependency set.

## Source series

| Series | Source manifest | Wheel metadata | Runtime destination |
| --- | --- | --- | --- |
| 2.0 (Mini and Turbo) | [source-manifest.json](source-manifest.json) | [wheel.json](wheel.json) | `vendor/Hunyuan3D-2/` |
| 2.1 Shape | [source-manifest.json](../wheels-2.1/source-manifest.json) | [wheel.json](../wheels-2.1/wheel.json) | `vendor/Hunyuan3D-2.1/hy3dshape/` |

The 2.1 wheel uses its own pinned source revision and cannot be replaced by the 2.0 wheel. [Model manifests and notices](../README.md) track model resources separately.

## Rebuild the 2.0 wheel

Rebuild from the project root with Python 3.10+ (standard library only):

```sh
python scripts/generation/build_hunyuan_wheel.py --cache runtime/generation
```

The builder reuses matching cached source files, or fetches the pinned URLs during
this explicit build step. It verifies every input and writes deterministic ZIP
members and a wheel RECORD. Review changes to both manifests and commit the new
wheel together when upgrading. Startup never fetches these source URLs.

## Runtime use

During model preparation, `source_wheel.py` verifies the bundled wheel and
materializes its pure-Python contents into `GEN_HOME/vendor/Hunyuan3D-2`, repairing
missing or changed files. This preserves the existing private import path and
memory/device adaptations without changing installed Python dependencies. It
works offline and uses the existing preparation lock. It is intentionally a
restricted source-wheel unpacker, not a general-purpose wheel installer.

For use with a standard Python installer, this is also a valid wheel:

```sh
python -m pip install --no-deps /path/to/g_studio_hunyuan_shape-2.0.2+f8db63096c82-py3-none-any.whl
```

That command installs only sources; G-Studio's locked runtime dependencies and
model weights are still required. The six-file Mini resource set is described
by its model manifest; Turbo and 2.1 have their own manifests.
