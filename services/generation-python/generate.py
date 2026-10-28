"""One bounded task process; providers export the same self-contained GLB."""

import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import time


def progress(phase, **extra):
    print(json.dumps({"phase": phase, **extra}), flush=True)


def silhouette(folder):
    import numpy as np
    import trimesh
    from PIL import Image

    im = Image.open(folder / "input.png").convert("RGBA")
    im.thumbnail((48, 48))
    mask = np.asarray(im)[:, :, 3] > 127
    h, w = mask.shape
    meshes = []
    for y, x in np.argwhere(mask):
        box = trimesh.creation.box(extents=[2 / max(w, h), 2 / max(w, h), 0.08])
        box.apply_translation(
            [(x + 0.5 - w / 2) * 2 / max(w, h), (h - y - 0.5) * 2 / max(w, h), 0]
        )
        meshes.append(box)
    if not meshes:
        raise ValueError("Input has no visible pixels")
    trimesh.util.concatenate(meshes).export(folder / "raw.glb")


def hunyuan(folder, request):
    import shutil

    # Preserve the upload separately from the normalized preview.
    if not (folder / "original.png").exists():
        shutil.copyfile(folder / "input.png", folder / "original.png")
    for phase in ("encode", "sample", "mesh"):
        progress(phase)
        subprocess.run(
            [
                sys.executable,
                "-u",
                str(Path(__file__).with_name("phase.py")),
                phase,
                str(folder),
                "--steps",
                str(request.get("parameters", {}).get("steps", __import__("model_catalog").MODELS[request.get("providerId", "hunyuan-mini")]["steps"])),
                "--resolution",
                str(request.get("parameters", {}).get("resolution", 256)),
                "--seed",
                str(request.get("seed", 12345)),
            ],
            check=True,
        )


def finish(folder, request):
    import numpy as np
    import trimesh
    import fast_simplification

    mesh = trimesh.load(folder / "raw.glb", force="mesh", process=False)
    if not len(mesh.faces) or not np.isfinite(mesh.vertices).all():
        raise ValueError("Invalid generated mesh")
    lo, hi = mesh.bounds.copy()
    if not np.isfinite([lo, hi]).all() or max(hi - lo) <= 0:
        raise ValueError("Invalid mesh bounds")
    scale = 2 / max(hi - lo)
    mesh.vertices = (
        mesh.vertices - [(lo[0] + hi[0]) / 2, lo[1], (lo[2] + hi[2]) / 2]
    ) * scale
    mesh.update_faces(mesh.area_faces > 1e-12)
    mesh.remove_unreferenced_vertices()
    target = request.get("targetFaces", 12000)
    if len(mesh.faces) > target:
        v, f = fast_simplification.simplify(
            np.asarray(mesh.vertices),
            np.asarray(mesh.faces),
            target_count=target,
            agg=7.0,
            preserve_border=True,
        )
        mesh = trimesh.Trimesh(vertices=v, faces=f, process=False)
        mesh.update_faces(mesh.area_faces > 1e-12)
        mesh.remove_unreferenced_vertices()
    if not len(mesh.faces):
        raise ValueError("Empty output after simplification")
    # Decimation may shift extrema slightly; restore the protocol's ground/pivot.
    final_lo, final_hi = mesh.bounds
    mesh.vertices -= np.array(
        [(final_lo[0] + final_hi[0]) / 2, final_lo[1], (final_lo[2] + final_hi[2]) / 2]
    )
    normals = np.asarray(mesh.vertex_normals).copy()
    lengths = np.linalg.norm(normals, axis=1)
    for i in np.flatnonzero((~np.isfinite(normals).all(axis=1)) | (lengths < 1e-8)):
        incident = mesh.vertex_faces[i]
        incident = incident[incident >= 0]
        normals[i] = mesh.face_normals[incident[0]] if len(incident) else [0, 1, 0]
    mesh.vertex_normals = normals / np.maximum(
        np.linalg.norm(normals, axis=1, keepdims=True), 1e-12
    )
    mesh.export(folder / "shadow.glb")
    return {
        "triangles": len(mesh.faces),
        "bounds": mesh.bounds.tolist(),
        "coordinateSystem": "right-handed-y-up",
        "normalization": {
            "scale": float(scale),
            "sourceMin": lo.tolist(),
            "sourceMax": hi.tolist(),
        },
        "warnings": [
            "Single-view inferred geometry; inspect openings and alignment before applying."
        ]
        if request["providerId"] != "silhouette"
        else ["Silhouette approximation, not AI reconstruction."],
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("folder", type=Path)
    a = parser.parse_args()
    request = json.loads((a.folder / "request.json").read_text("utf-8"))
    start = time.monotonic()
    progress("generating")
    from providers import PROVIDERS

    PROVIDERS[request["providerId"]].generate(a.folder, request)
    progress("simplifying")
    meta = finish(a.folder, request)
    meta["elapsedSeconds"] = time.monotonic() - start
    meta["phaseStats"] = [json.loads(p.read_text()) for p in sorted(a.folder.glob("*-stats.json"))]
    (a.folder / "output.json").write_text(json.dumps(meta), encoding="utf-8")
    progress("complete")
