"""Measure raw/final meshes from generation_benchmark.py; no semantic pass score.

Requires the generation Python, and local raw.glb artifacts (benchmark --jobs).
Topology excludes zero-area triangles. Surface distances are deterministic sample
estimates in independently centered/scaled coordinates, not exact Hausdorff.
"""
import argparse
import json
from pathlib import Path
import numpy as np
import trimesh
from scipy.spatial import cKDTree


def compare(folder):
    meshes, result = [], {}
    for name in ('raw', 'shadow'):
        mesh = trimesh.load(folder / (name + '.glb'), force='mesh', process=True)
        original = len(mesh.faces)
        keep = mesh.area_faces > 1e-12
        mesh.update_faces(keep)
        mesh.remove_unreferenced_vertices()
        if not len(mesh.faces) or not np.isfinite(mesh.vertices).all():
            raise ValueError('Invalid mesh: ' + str(folder / name))
        # split() may repair small holes and would alter the topology under test.
        components = sorted((len(c) for c in trimesh.graph.connected_components(
            mesh.face_adjacency, nodes=np.arange(len(mesh.faces)), min_len=1)), reverse=True)
        result[name] = {'originalFaces': original, 'removedDegenerateFaces': int((~keep).sum()),
            'faces': len(mesh.faces), 'vertices': len(mesh.vertices), 'watertight': bool(mesh.is_watertight),
            'components': len(components), 'largestComponentFaces': components[:10], 'bounds': mesh.bounds.tolist()}
        lo, hi = mesh.bounds
        mesh.vertices = (mesh.vertices - (lo + hi) / 2) * (2 / max(hi - lo))
        meshes.append(mesh)
    points = [trimesh.sample.sample_surface(mesh, 20000, seed=12345)[0] for mesh in meshes]
    distances = np.concatenate([cKDTree(points[1]).query(points[0])[0], cKDTree(points[0]).query(points[1])[0]])
    result['sampledSurfaceDistance'] = {'samplesPerMesh': 20000, 'seed': 12345, 'normalizedLongestSide': 2,
        'mean': float(distances.mean()), 'p95': float(np.percentile(distances, 95)), 'max': float(distances.max()),
        'note': 'Independent centering/scaling; includes sampling error; not a semantic quality score.'}
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('report', type=Path)
    args = parser.parse_args()
    report = json.loads(args.report.read_text())
    for run in report['runs']:
        if run['job']['status'] == 'succeeded':
            run['meshMetrics'] = compare(args.report.parent / run['artifactDirectory'])
    args.report.write_text(json.dumps(report, indent=2) + '\n')
