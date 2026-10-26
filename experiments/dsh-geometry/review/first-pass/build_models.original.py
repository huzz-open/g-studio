#!/usr/bin/env python3
"""Build simplified 3D proxy models for an umbrella, a vase and a chair.

The models are derived only from the three reference images in ``inputs/``.
They are intended as low-detail lighting / shadow proxies for a pixel game:
real 3D volumes, openwork, overhangs and support relationships are preserved,
but painted decoration and fine carving are deliberately omitted.

Output conventions for every exported GLB:
    * Z is up.
    * The lowest point is at Z = 0.
    * The XY bounding-box centre is at the origin.
    * The largest bounding-box dimension is 2.0.

Dependencies: Python 3.12, numpy, trimesh.  No external meshes or textures.
"""

from __future__ import annotations

import math
from pathlib import Path

import numpy as np
import trimesh


# ---------------------------------------------------------------------------
# Output and shared appearance settings
# ---------------------------------------------------------------------------

ROOT = Path(__file__).resolve().parent
OUTPUT_DIR = ROOT / "outputs"
TARGET_LONGEST_SIDE = 2.0

COLORS = {
    # Umbrella
    "paper": (225, 200, 153, 255),
    "wood": (132, 76, 38, 255),
    "wood_dark": (103, 56, 28, 255),
    "tassel_red": (158, 34, 34, 255),
    # Vase
    "porcelain": (231, 228, 215, 255),
    "cobalt": (32, 70, 145, 255),
    # Chair
    "rosewood": (119, 64, 30, 255),
    "seat_wood": (151, 88, 45, 255),
    "splat_wood": (137, 76, 36, 255),
}


# ---------------------------------------------------------------------------
# Primary dimensions
# ---------------------------------------------------------------------------
# All dimensions below are in the model's pre-normalisation space.  Only the
# relative proportions matter: each finished model is normalised to size 2.

PARAMS = {
    "umbrella": {
        "canopy_segments": 24,
        "rib_count": 24,
        "spreader_count": 24,
        "canopy_radius": 0.910,
        "canopy_thickness": 0.030,
        "rim_z": 1.340,
        "apex_z": 1.945,
        "inner_radius": 0.070,
        # (radius, top_z, bottom_z), ordered from rim towards the centre.
        "canopy_stations": [
            (0.820, 1.460, 1.430),
            (0.660, 1.610, 1.580),
            (0.460, 1.760, 1.730),
            (0.260, 1.880, 1.850),
        ],
        "edge_tip_radius": 0.940,
        "rib_radius": 0.009,
        "rib_tip_radius": 0.014,
        "spreader_radius": 0.006,
        "shaft_radius": 0.018,
        "shaft_bottom_z": 0.300,
        "shaft_top_z": 1.900,
        "finial_top_z": 2.000,
        "runner_z": 1.690,
        "tassel_top_z": 0.255,
        "tassel_bottom_z": 0.000,
    },
    "vase": {
        "sections": 64,
        # Outer silhouette from the bottom centre up to the outside of the lip.
        "outer_profile": [
            (0.000, 0.000),
            (0.300, 0.000),
            (0.338, 0.015),
            (0.350, 0.040),
            (0.344, 0.070),
            (0.292, 0.095),
            (0.338, 0.135),
            (0.410, 0.205),
            (0.480, 0.300),
            (0.535, 0.420),
            (0.565, 0.550),
            (0.570, 0.650),
            (0.555, 0.780),
            (0.515, 0.920),
            (0.455, 1.050),
            (0.385, 1.150),
            (0.320, 1.220),
            (0.285, 1.270),
            (0.268, 1.320),
            (0.262, 1.400),
            (0.267, 1.480),
            (0.280, 1.545),
            (0.305, 1.605),
            (0.335, 1.655),
            (0.360, 1.700),
            (0.370, 1.735),
            (0.365, 1.755),
        ],
        # Inner cavity, from the inside of the lip down to the inner floor.
        # It is joined to the outer profile by the flat rim between these two
        # first points.
        "inner_profile": [
            (0.305, 1.755),
            (0.300, 1.735),
            (0.280, 1.700),
            (0.252, 1.645),
            (0.235, 1.580),
            (0.225, 1.500),
            (0.222, 1.420),
            (0.222, 1.340),
            (0.235, 1.260),
            (0.270, 1.180),
            (0.325, 1.090),
            (0.385, 0.975),
            (0.440, 0.845),
            (0.480, 0.700),
            (0.494, 0.565),
            (0.482, 0.450),
            (0.440, 0.350),
            (0.365, 0.275),
            (0.250, 0.230),
            (0.120, 0.210),
            (0.000, 0.205),
        ],
        "blue_rim_min_z": 1.715,
        "blue_foot_max_z": 0.075,
    },
    "chair": {
        "seat_width": 1.100,
        "seat_depth": 0.800,
        "seat_center_z": 0.930,
        "seat_thickness": 0.075,
        "leg_section": 0.080,
        "leg_x": 0.460,
        "front_leg_y": -0.320,
        "back_leg_y": 0.320,
        "front_post_top_z": 1.310,
        "back_post_top_z": 1.880,
        "arm_z": 1.270,
        "arm_width": 0.075,
        "arm_height": 0.070,
        "crest_width": 1.200,
        "crest_depth": 0.115,
        "crest_height": 0.105,
        "crest_center_z": 1.885,
        "crest_end_width": 0.150,
        "crest_end_depth": 0.140,
        "crest_end_height": 0.130,
        "crest_end_x": 0.625,
        "crest_end_z": 1.920,
        "splat_width": 0.440,
        "splat_bottom_z": 0.990,
        "splat_top_z": 1.790,
        "splat_depth": 0.060,
        "splat_stile_width": 0.035,
        "splat_rail_height": 0.050,
        "lattice_vertical_x": 0.075,
        "lattice_vertical_width": 0.025,
        "lattice_horizontal_z": (1.180, 1.420, 1.660),
        "lattice_horizontal_height": 0.025,
        "apron_z": 0.865,
        "front_stretcher_z": 0.200,
        "back_stretcher_z": 0.300,
        "side_stretcher_z": 0.250,
    },
}


# ---------------------------------------------------------------------------
# Small geometry helpers
# ---------------------------------------------------------------------------

def _rgba(color: tuple[int, int, int, int]) -> np.ndarray:
    return np.asarray(color, dtype=np.uint8)


def _paint(mesh: trimesh.Trimesh, color: tuple[int, int, int, int]) -> trimesh.Trimesh:
    """Apply one flat face colour to a mesh."""
    rgba = _rgba(color).reshape(1, 4)
    face_colors = np.repeat(rgba, len(mesh.faces), axis=0)
    mesh.visual = trimesh.visual.ColorVisuals(mesh=mesh, face_colors=face_colors)
    return mesh


def _merge(meshes: list[trimesh.Trimesh]) -> trimesh.Trimesh:
    """Concatenate geometries without welding their separate shells together."""
    if not meshes:
        raise ValueError("cannot merge an empty mesh list")
    if len(meshes) == 1:
        return meshes[0]

    vertices = []
    faces = []
    offset = 0
    for mesh in meshes:
        vertices.append(np.asarray(mesh.vertices, dtype=float))
        faces.append(np.asarray(mesh.faces, dtype=np.int64) + offset)
        offset += len(mesh.vertices)

    return trimesh.Trimesh(
        vertices=np.vstack(vertices),
        faces=np.vstack(faces),
        process=False,
    )


def _box(extents, center) -> trimesh.Trimesh:
    mesh = trimesh.creation.box(extents=np.asarray(extents, dtype=float))
    mesh.apply_translation(np.asarray(center, dtype=float))
    return mesh


def _cylinder(radius: float, height: float, center, sections: int = 16) -> trimesh.Trimesh:
    mesh = trimesh.creation.cylinder(
        radius=float(radius),
        height=float(height),
        sections=int(sections),
    )
    mesh.apply_translation(np.asarray(center, dtype=float))
    return mesh


def _frame_from_z(direction: np.ndarray) -> np.ndarray:
    """Return a rotation matrix whose local +Z maps to ``direction``."""
    z_axis = np.asarray(direction, dtype=float)
    length = float(np.linalg.norm(z_axis))
    if length < 1e-12:
        raise ValueError("zero-length beam")
    z_axis = z_axis / length

    reference = np.array([1.0, 0.0, 0.0])
    if abs(float(np.dot(reference, z_axis))) > 0.92:
        reference = np.array([0.0, 1.0, 0.0])

    x_axis = np.cross(reference, z_axis)
    x_axis /= np.linalg.norm(x_axis)
    y_axis = np.cross(z_axis, x_axis)
    return np.column_stack((x_axis, y_axis, z_axis))


def _beam_between(
    p0,
    p1,
    *,
    radius: float | None = None,
    width: float | None = None,
    depth: float | None = None,
    sections: int = 8,
) -> trimesh.Trimesh:
    """A round or rectangular beam between two points."""
    start = np.asarray(p0, dtype=float)
    end = np.asarray(p1, dtype=float)
    delta = end - start
    length = float(np.linalg.norm(delta))
    if length < 1e-12:
        raise ValueError("zero-length beam")

    rotation = _frame_from_z(delta)
    if radius is not None:
        mesh = trimesh.creation.cylinder(
            radius=float(radius),
            height=length,
            sections=int(sections),
        )
    else:
        if width is None or depth is None:
            raise ValueError("a rectangular beam needs width and depth")
        mesh = trimesh.creation.box(extents=[float(width), float(depth), length])

    mesh.vertices = np.asarray(mesh.vertices) @ rotation.T + (start + end) * 0.5
    return mesh


def _lathe(
    profile: list[tuple[float, float]],
    *,
    sections: int = 48,
    closed: bool = False,
) -> trimesh.Trimesh:
    """Revolve a radial profile around Z.

    Points with radius zero become single poles.  With ``closed=True`` the last
    profile point is joined back to the first, which is used for hollow shells
    such as the umbrella canopy.
    """
    points = [(float(r), float(z)) for r, z in profile]
    if len(points) < 2:
        raise ValueError("a lathe profile needs at least two points")

    vertices: list[tuple[float, float, float]] = []
    rings: list[tuple[str, int | list[int]]] = []

    for radius, z_value in points:
        if radius <= 1e-9:
            index = len(vertices)
            vertices.append((0.0, 0.0, z_value))
            rings.append(("axis", index))
        else:
            indices = []
            for step in range(sections):
                angle = 2.0 * math.pi * step / sections
                indices.append(len(vertices))
                vertices.append(
                    (radius * math.cos(angle), radius * math.sin(angle), z_value)
                )
            rings.append(("ring", indices))

    edges = list(range(len(points) - 1))
    if closed:
        edges.append(len(points) - 1)

    faces: list[tuple[int, int, int]] = []
    for edge in edges:
        next_edge = (edge + 1) % len(points)
        kind_a, data_a = rings[edge]
        kind_b, data_b = rings[next_edge]

        if kind_a == "axis" and kind_b == "axis":
            continue

        for step in range(sections):
            step_next = (step + 1) % sections
            if kind_a == "axis":
                # Start pole, for example the underside of a turned foot.
                faces.append((int(data_a), int(data_b[step_next]), int(data_b[step])))
            elif kind_b == "axis":
                # End pole, for example the top of a finial.
                faces.append((int(data_a[step]), int(data_a[step_next]), int(data_b)))
            else:
                a0 = int(data_a[step])
                a1 = int(data_a[step_next])
                b0 = int(data_b[step])
                b1 = int(data_b[step_next])
                faces.append((a0, a1, b1))
                faces.append((a0, b1, b0))

    return trimesh.Trimesh(
        vertices=np.asarray(vertices, dtype=float),
        faces=np.asarray(faces, dtype=np.int64),
        process=True,
    )


def _paint_by_height(
    mesh: trimesh.Trimesh,
    base_color: tuple[int, int, int, int],
    accent_color: tuple[int, int, int, int],
    *,
    accent_above: float | None = None,
    accent_below: float | None = None,
) -> trimesh.Trimesh:
    """Paint horizontal colour bands without adding textures or relief."""
    centers = np.asarray(mesh.vertices, dtype=float)[np.asarray(mesh.faces)].mean(axis=1)
    colors = np.repeat(_rgba(base_color).reshape(1, 4), len(centers), axis=0)

    accent = _rgba(accent_color).reshape(1, 4)
    if accent_above is not None:
        colors[centers[:, 2] >= accent_above] = accent
    if accent_below is not None:
        colors[centers[:, 2] <= accent_below] = accent

    mesh.visual = trimesh.visual.ColorVisuals(mesh=mesh, face_colors=colors)
    return mesh


# ---------------------------------------------------------------------------
# Scene finalisation
# ---------------------------------------------------------------------------

def _combined_bounds(meshes: list[trimesh.Trimesh]) -> tuple[np.ndarray, np.ndarray]:
    lo = np.min(
        np.asarray([np.asarray(mesh.vertices).min(axis=0) for mesh in meshes]),
        axis=0,
    )
    hi = np.max(
        np.asarray([np.asarray(mesh.vertices).max(axis=0) for mesh in meshes]),
        axis=0,
    )
    return lo, hi


def _export_model(filename: str, parts: list[tuple[str, trimesh.Trimesh]]) -> None:
    """Normalise, validate and export a named multi-material GLB."""
    meshes = [mesh for _, mesh in parts]
    lo, hi = _combined_bounds(meshes)
    size = hi - lo
    largest = float(np.max(size))
    if largest <= 1e-12:
        raise ValueError(f"{filename}: degenerate model bounds")

    scale = TARGET_LONGEST_SIDE / largest
    center_x = 0.5 * float(lo[0] + hi[0])
    center_y = 0.5 * float(lo[1] + hi[1])
    bottom_z = float(lo[2])

    transform = np.eye(4, dtype=float)
    transform[0, 0] = scale
    transform[1, 1] = scale
    transform[2, 2] = scale
    transform[0, 3] = -center_x * scale
    transform[1, 3] = -center_y * scale
    transform[2, 3] = -bottom_z * scale

    for mesh in meshes:
        mesh.apply_transform(transform)

    lo, hi = _combined_bounds(meshes)
    final_size = hi - lo

    # These are the explicit delivery constraints, checked rather than assumed.
    if not np.isclose(float(lo[2]), 0.0, atol=1e-6):
        raise RuntimeError(f"{filename}: bottom is not at Z=0")
    if not np.isclose(float(lo[0] + hi[0]), 0.0, atol=1e-6):
        raise RuntimeError(f"{filename}: X is not centred")
    if not np.isclose(float(lo[1] + hi[1]), 0.0, atol=1e-6):
        raise RuntimeError(f"{filename}: Y is not centred")
    if not np.isclose(float(np.max(final_size)), TARGET_LONGEST_SIDE, atol=1e-6):
        raise RuntimeError(f"{filename}: longest side is not 2.0")

    scene = trimesh.Scene()
    for name, mesh in parts:
        scene.add_geometry(mesh, node_name=name, geom_name=name)

    path = OUTPUT_DIR / filename
    scene.export(file_obj=str(path), file_type="glb")

    print(
        f"{filename}: {len(parts)} part(s), bounds "
        f"x={final_size[0]:.4f}, y={final_size[1]:.4f}, z={final_size[2]:.4f}"
    )


# ---------------------------------------------------------------------------
# Umbrella
# ---------------------------------------------------------------------------

def _umbrella_canopy_profile(params: dict) -> list[tuple[float, float]]:
    radius = params["canopy_radius"]
    thickness = params["canopy_thickness"]
    rim_z = params["rim_z"]
    apex_z = params["apex_z"]
    inner_radius = params["inner_radius"]
    stations = params["canopy_stations"]

    # Trace the closed shell outline so the revolved surface has outward
    # normals: outer edge upwards, across the top towards the centre, down the
    # inner hole, then back out along the underside.
    profile = [
        (radius, rim_z - thickness),
        (radius, rim_z),
    ]
    profile.extend((r, top_z) for r, top_z, _ in stations)
    profile.append((inner_radius, apex_z))
    profile.append((inner_radius, apex_z - thickness))
    profile.extend((r, bottom_z) for r, _, bottom_z in reversed(stations))
    return profile


def build_umbrella() -> None:
    params = PARAMS["umbrella"]
    parts: list[tuple[str, trimesh.Trimesh]] = []

    canopy = _lathe(
        _umbrella_canopy_profile(params),
        sections=params["canopy_segments"],
        closed=True,
    )
    parts.append(("canopy_paper", _paint(canopy, COLORS["paper"])))

    # The underside curve is used to keep the ribs just below the paper shell.
    undersides = [(params["inner_radius"], params["apex_z"] - params["canopy_thickness"])]
    undersides.extend((r, bottom_z) for r, _, bottom_z in params["canopy_stations"])
    undersides.append(
        (params["canopy_radius"], params["rim_z"] - params["canopy_thickness"])
    )
    undersides.sort(key=lambda item: item[0])
    under_x = np.asarray([item[0] for item in undersides], dtype=float)
    under_z = np.asarray([item[1] for item in undersides], dtype=float)

    def canopy_under_z(radius: float) -> float:
        return float(np.interp(radius, under_x, under_z))

    frame_meshes: list[trimesh.Trimesh] = []
    rib_count = int(params["rib_count"])
    mid_radius = params["canopy_radius"] * 0.52
    outer_radius = params["canopy_radius"]

    for rib in range(rib_count):
        angle = 2.0 * math.pi * rib / rib_count
        cos_a = math.cos(angle)
        sin_a = math.sin(angle)

        center = np.array(
            (0.022 * cos_a, 0.022 * sin_a, params["apex_z"] - 0.060),
            dtype=float,
        )
        mid = np.array(
            (
                mid_radius * cos_a,
                mid_radius * sin_a,
                canopy_under_z(mid_radius) - 0.012,
            ),
            dtype=float,
        )
        outer = np.array(
            (
                outer_radius * cos_a,
                outer_radius * sin_a,
                canopy_under_z(outer_radius) - 0.012,
            ),
            dtype=float,
        )
        tip = np.array(
            (
                params["edge_tip_radius"] * cos_a,
                params["edge_tip_radius"] * sin_a,
                canopy_under_z(outer_radius) - 0.018,
            ),
            dtype=float,
        )

        frame_meshes.append(
            _beam_between(center, mid, radius=params["rib_radius"], sections=6)
        )
        frame_meshes.append(
            _beam_between(mid, outer, radius=params["rib_radius"] * 0.92, sections=6)
        )
        frame_meshes.append(
            _beam_between(
                outer,
                tip,
                radius=params["rib_tip_radius"],
                sections=6,
            )
        )

    # Short stretchers from a runner on the shaft up to the ribs.  They make
    # the canopy / rib / shaft support relationship readable from the side.
    for spreader in range(int(params["spreader_count"])):
        angle = 2.0 * math.pi * spreader / params["spreader_count"]
        cos_a = math.cos(angle)
        sin_a = math.sin(angle)
        start = np.array(
            (
                0.024 * cos_a,
                0.024 * sin_a,
                params["runner_z"] + 0.012,
            ),
            dtype=float,
        )
        end_radius = params["canopy_radius"] * 0.40
        end = np.array(
            (
                end_radius * cos_a,
                end_radius * sin_a,
                canopy_under_z(end_radius) - 0.016,
            ),
            dtype=float,
        )
        frame_meshes.append(
            _beam_between(
                start,
                end,
                radius=params["spreader_radius"],
                sections=6,
            )
        )

    frame_meshes.append(
        _cylinder(
            radius=0.033,
            height=0.070,
            center=(0.0, 0.0, params["runner_z"]),
            sections=12,
        )
    )
    # The central cap closes the small hole at the top of the revolved canopy
    # and also gives the finial a believable wooden seat.
    frame_meshes.append(
        _cylinder(
            radius=0.092,
            height=0.080,
            center=(0.0, 0.0, params["apex_z"] - 0.030),
            sections=16,
        )
    )
    parts.append(("ribs_and_runner", _paint(_merge(frame_meshes), COLORS["wood_dark"])))

    # Main shaft, the turned grip around its lower part and the top finial.
    shaft_height = params["shaft_top_z"] - params["shaft_bottom_z"]
    shaft_meshes = [
        _cylinder(
            radius=params["shaft_radius"],
            height=shaft_height,
            center=(0.0, 0.0, 0.5 * (params["shaft_bottom_z"] + params["shaft_top_z"])),
            sections=12,
        )
    ]

    handle_profile = [
        (0.000, 0.360),
        (0.028, 0.360),
        (0.038, 0.390),
        (0.042, 0.420),
        (0.060, 0.460),
        (0.072, 0.500),
        (0.058, 0.545),
        (0.038, 0.575),
        (0.033, 0.600),
        (0.040, 0.625),
        (0.070, 0.650),
        (0.050, 0.690),
        (0.030, 0.715),
        (0.000, 0.720),
    ]
    shaft_meshes.append(_lathe(handle_profile, sections=20, closed=False))

    finial_profile = [
        (0.000, 1.875),
        (0.082, 1.875),
        (0.090, 1.890),
        (0.078, 1.910),
        (0.050, 1.930),
        (0.060, 1.950),
        (0.045, 1.970),
        (0.025, 1.985),
        (0.000, params["finial_top_z"]),
    ]
    shaft_meshes.append(_lathe(finial_profile, sections=20, closed=False))
    parts.append(("shaft_handle_finial", _paint(_merge(shaft_meshes), COLORS["wood"])))

    # Red bead + tassel skirt.  These are volumes, not a flat card.
    bead_profile = [
        (0.000, 0.252),
        (0.030, 0.256),
        (0.046, 0.276),
        (0.046, 0.300),
        (0.032, 0.318),
        (0.000, 0.322),
    ]
    tassel_profile = [
        (0.000, params["tassel_bottom_z"]),
        (0.030, params["tassel_bottom_z"]),
        (0.052, 0.025),
        (0.058, 0.075),
        (0.056, 0.130),
        (0.048, 0.185),
        (0.035, 0.225),
        (0.025, params["tassel_top_z"]),
        (0.000, params["tassel_top_z"]),
    ]
    tassel = _merge(
        [
            _lathe(bead_profile, sections=16, closed=False),
            _lathe(tassel_profile, sections=16, closed=False),
        ]
    )
    parts.append(("tassel", _paint(tassel, COLORS["tassel_red"])))

    _export_model("umbrella.glb", parts)


# ---------------------------------------------------------------------------
# Vase
# ---------------------------------------------------------------------------

def build_vase() -> None:
    params = PARAMS["vase"]

    # The outer profile starts at the bottom pole and ends at the outer lip;
    # the inner profile starts at the inner lip and ends at the cavity floor.
    # Joining them makes the hollow opening and the flat rim.
    profile = list(params["outer_profile"]) + list(params["inner_profile"])
    vase = _lathe(profile, sections=params["sections"], closed=False)
    vase = _paint_by_height(
        vase,
        COLORS["porcelain"],
        COLORS["cobalt"],
        accent_above=params["blue_rim_min_z"],
        accent_below=params["blue_foot_max_z"],
    )

    _export_model("vase.glb", [("porcelain_body", vase)])


# ---------------------------------------------------------------------------
# Chair
# ---------------------------------------------------------------------------

def build_chair() -> None:
    params = PARAMS["chair"]
    parts: list[tuple[str, trimesh.Trimesh]] = []

    seat_width = params["seat_width"]
    seat_depth = params["seat_depth"]
    leg = params["leg_section"]
    leg_x = params["leg_x"]
    front_y = params["front_leg_y"]
    back_y = params["back_leg_y"]

    structure: list[trimesh.Trimesh] = []

    # Four legs.  The rear pair continues into the tall back posts.
    for side in (-1.0, 1.0):
        x_value = side * leg_x
        structure.append(
            _box(
                (leg, leg, params["front_post_top_z"]),
                (x_value, front_y, params["front_post_top_z"] * 0.5),
            )
        )
        structure.append(
            _box(
                (leg, leg, params["back_post_top_z"]),
                (x_value, back_y, params["back_post_top_z"] * 0.5),
            )
        )

    # Seat apron / rails below the slab.
    apron_height = 0.095
    structure.append(
        _box(
            (seat_width - 0.10, 0.045, apron_height),
            (0.0, front_y - leg * 0.45, params["apron_z"]),
        )
    )
    structure.append(
        _box(
            (seat_width - 0.10, 0.045, apron_height),
            (0.0, back_y + leg * 0.45, params["apron_z"]),
        )
    )
    for side in (-1.0, 1.0):
        structure.append(
            _box(
                (0.045, seat_depth - 0.12, apron_height - 0.005),
                (side * leg_x, 0.0, params["apron_z"]),
            )
        )

    # Arms run from the back posts to the front posts.
    arm_length = (back_y + 0.02) - (front_y - 0.02)
    arm_y = 0.5 * ((back_y + 0.02) + (front_y - 0.02))
    for side in (-1.0, 1.0):
        structure.append(
            _box(
                (params["arm_width"], arm_length, params["arm_height"]),
                (side * leg_x, arm_y, params["arm_z"]),
            )
        )

    # Crest rail and its raised end scrolls.
    structure.append(
        _box(
            (params["crest_width"], params["crest_depth"], params["crest_height"]),
            (0.0, back_y, params["crest_center_z"]),
        )
    )
    for side in (-1.0, 1.0):
        structure.append(
            _box(
                (
                    params["crest_end_width"],
                    params["crest_end_depth"],
                    params["crest_end_height"],
                ),
                (side * params["crest_end_x"], back_y, params["crest_end_z"]),
            )
        )

    # Lower stretchers form an open H-frame between the legs.
    structure.append(
        _box(
            (2.0 * leg_x - leg * 0.5, 0.055, 0.060),
            (0.0, front_y, params["front_stretcher_z"]),
        )
    )
    structure.append(
        _box(
            (2.0 * leg_x - leg * 0.5, 0.055, 0.060),
            (0.0, back_y, params["back_stretcher_z"]),
        )
    )
    for side in (-1.0, 1.0):
        structure.append(
            _box(
                (0.055, 2.0 * back_y - 0.060, 0.060),
                (side * leg_x, 0.0, params["side_stretcher_z"]),
            )
        )

    parts.append(("chair_frame", _paint(_merge(structure), COLORS["rosewood"])))

    seat = _box(
        (seat_width, seat_depth, params["seat_thickness"]),
        (0.0, 0.0, params["seat_center_z"]),
    )
    parts.append(("seat", _paint(seat, COLORS["seat_wood"])))

    # Pierced back splat.  It is a frame plus a real open lattice, leaving
    # holes all the way through instead of painting them on a board.
    splat: list[trimesh.Trimesh] = []
    splat_center_z = 0.5 * (params["splat_bottom_z"] + params["splat_top_z"])
    splat_height = params["splat_top_z"] - params["splat_bottom_z"]
    stile_x = 0.5 * (params["splat_width"] - params["splat_stile_width"])

    for side in (-1.0, 1.0):
        splat.append(
            _box(
                (
                    params["splat_stile_width"],
                    params["splat_depth"],
                    splat_height,
                ),
                (side * stile_x, back_y, splat_center_z),
            )
        )

    splat.append(
        _box(
            (
                params["splat_width"],
                params["splat_depth"],
                params["splat_rail_height"],
            ),
            (
                0.0,
                back_y,
                params["splat_bottom_z"] + 0.5 * params["splat_rail_height"],
            ),
        )
    )
    splat.append(
        _box(
            (
                params["splat_width"],
                params["splat_depth"],
                params["splat_rail_height"],
            ),
            (
                0.0,
                back_y,
                params["splat_top_z"] - 0.5 * params["splat_rail_height"],
            ),
        )
    )

    lattice_bottom = params["splat_bottom_z"] + params["splat_rail_height"] + 0.006
    lattice_top = params["splat_top_z"] - params["splat_rail_height"] - 0.006
    vertical_height = lattice_top - lattice_bottom
    for side in (-1.0, 1.0):
        splat.append(
            _box(
                (
                    params["lattice_vertical_width"],
                    params["splat_depth"] * 0.86,
                    vertical_height,
                ),
                (
                    side * params["lattice_vertical_x"],
                    back_y,
                    0.5 * (lattice_bottom + lattice_top),
                ),
            )
        )

    horizontal_width = (
        params["splat_width"]
        - 2.0 * params["splat_stile_width"]
        - 0.012
    )
    for z_value in params["lattice_horizontal_z"]:
        splat.append(
            _box(
                (
                    horizontal_width,
                    params["splat_depth"] * 0.86,
                    params["lattice_horizontal_height"],
                ),
                (0.0, back_y, z_value),
            )
        )

    parts.append(("pierced_splat", _paint(_merge(splat), COLORS["splat_wood"])))

    _export_model("chair.glb", parts)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    build_umbrella()
    build_vase()
    build_chair()
    print(f"Wrote GLB files to: {OUTPUT_DIR}")


if __name__ == "__main__":
    main()
