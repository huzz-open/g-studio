"""Small deterministic CPU rasterizer; Z-up, orthographic camera, directional shadow map."""
import math
import numpy as np
from numba import njit
from PIL import Image


def basis(azimuth, elevation):
    a, e = np.deg2rad([azimuth, elevation])
    view = np.array([np.cos(a)*np.cos(e), np.sin(a)*np.cos(e), np.sin(e)])
    right = np.array([-np.sin(a), np.cos(a), 0.])
    return np.stack([right, np.cross(view, right), view])


@njit(cache=True)
def raster(vertices, faces, normals, colors, camera, center, extent, size):
    screen = (vertices - center) @ camera.T
    screen[:, 0] = (screen[:, 0] / extent + .5) * size
    screen[:, 1] = (.5 - screen[:, 1] / extent) * size
    depth = np.full((size, size), -1e20)
    positions = np.zeros((size, size, 3))
    normal = np.zeros((size, size, 3))
    rgb = np.zeros((size, size, 3))
    for ids in faces:
        p = screen[ids]
        den = (p[1,1]-p[2,1])*(p[0,0]-p[2,0]) + (p[2,0]-p[1,0])*(p[0,1]-p[2,1])
        if abs(den) < 1e-12:
            continue
        x0, x1 = max(0, int(math.floor(p[:,0].min()))), min(size-1, int(math.ceil(p[:,0].max())))
        y0, y1 = max(0, int(math.floor(p[:,1].min()))), min(size-1, int(math.ceil(p[:,1].max())))
        for y in range(y0, y1+1):
            for x in range(x0, x1+1):
                a = ((p[1,1]-p[2,1])*(x+.5-p[2,0]) + (p[2,0]-p[1,0])*(y+.5-p[2,1])) / den
                b = ((p[2,1]-p[0,1])*(x+.5-p[2,0]) + (p[0,0]-p[2,0])*(y+.5-p[2,1])) / den
                c = 1-a-b
                if min(a,b,c) < -1e-8:
                    continue
                z = a*p[0,2]+b*p[1,2]+c*p[2,2]
                if z > depth[y,x]:
                    depth[y,x] = z
                    for k in range(3):
                        positions[y,x,k] = a*vertices[ids[0],k]+b*vertices[ids[1],k]+c*vertices[ids[2],k]
                        normal[y,x,k] = a*normals[ids[0],k]+b*normals[ids[1],k]+c*normals[ids[2],k]
                        rgb[y,x,k] = a*colors[ids[0],k]+b*colors[ids[1],k]+c*colors[ids[2],k]
    return depth, positions, normal, rgb


def geometry(mesh):
    return (np.ascontiguousarray(mesh.vertices, dtype=np.float64),
            np.ascontiguousarray(mesh.faces, dtype=np.int64),
            np.ascontiguousarray(mesh.vertex_normals, dtype=np.float64),
            np.ascontiguousarray(mesh.visual.vertex_colors[:, :3] / 255., dtype=np.float64))


def render(mesh, azimuth=0, elevation=20, light_azimuth=-45, light_elevation=45,
           size=192, ground=True, clay=False, shadows=True, extent=3.4):
    vertices, faces, normals, colors = geometry(mesh)
    center = np.array([0., 0., .9])
    camera = basis(azimuth, elevation)
    light = basis(light_azimuth, light_elevation)
    # Fixed shadow volume contains normalized object and all ground receivers.
    shadow_extent = 8.
    shadow_size = 384
    shadow_depth = None
    if shadows:
        shadow_depth = raster(vertices, faces, normals, colors, light, center, shadow_extent, shadow_size)[0]
    if clay:
        colors = np.full_like(colors, [.66, .77, .85])
    if ground:
        n = len(vertices)
        vertices = np.concatenate([vertices, [[-4,-4,-.015], [4,-4,-.015], [4,4,-.015], [-4,4,-.015]]])
        faces = np.concatenate([faces, [[n,n+1,n+2], [n,n+2,n+3]]])
        normals = np.concatenate([normals, [[0,0,1]]*4])
        colors = np.concatenate([colors, [[.65,.69,.72]]*4])
    depth, pos, normal, rgb = raster(vertices, faces, normals, colors, camera, center, extent, size)
    mask = depth > -1e19
    normal /= np.maximum(np.linalg.norm(normal, axis=-1, keepdims=True), 1e-12)
    diffuse = np.maximum(0, normal @ light[2])
    occluded = np.zeros((size,size), dtype=bool)
    if shadow_depth is not None:
        lp = (pos - center) @ light.T
        sx = np.floor((lp[...,0]/shadow_extent+.5)*shadow_size).astype(int)
        sy = np.floor((.5-lp[...,1]/shadow_extent)*shadow_size).astype(int)
        inside = (sx >= 0) & (sx < shadow_size) & (sy >= 0) & (sy < shadow_size) & mask
        light_normal = normal @ light.T
        slope = (np.abs(light_normal[...,0])+np.abs(light_normal[...,1]))/np.maximum(diffuse,.05)
        bias = .008 + .8*shadow_extent/shadow_size*slope
        occluded[inside] = lp[...,2][inside] < shadow_depth[sy[inside], sx[inside]] - bias[inside]
    if ground:
        is_ground = pos[...,2] < -.01
        checker = (np.floor(pos[...,0]*2)+np.floor(pos[...,1]*2)).astype(int) % 2
        rgb[is_ground] *= (.94 + .06*checker[is_ground,None])
    intensity = .30 + .70 * diffuse * np.where(occluded, 0., 1.)
    shaded = np.clip(rgb * intensity[...,None] * 255, 0, 255).astype(np.uint8)
    shaded[~mask] = [31, 36, 46]
    return Image.fromarray(shaded), {'mask':mask, 'depth':depth, 'position':pos, 'normal':normal,
                                     'color':rgb, 'shadow':occluded, 'camera':camera, 'center':center, 'extent':extent}


def export_maps(mesh, folder, azimuth=0, elevation=20):
    folder.mkdir(parents=True, exist_ok=True)
    _, data = render(mesh, azimuth, elevation, size=256, ground=False, shadows=False)
    mask = data['mask']
    alpha = (mask*255).astype(np.uint8)
    normal = np.clip((data['normal']*.5+.5)*255, 0, 255).astype(np.uint8)
    Image.fromarray(np.dstack([normal,alpha])).save(folder/'normal-world.png')
    color = np.clip(data['color']*255, 0, 255).astype(np.uint8)
    Image.fromarray(np.dstack([color,alpha])).save(folder/'color.png')
    Image.fromarray(alpha).save(folder/'mask.png')
    values = data['depth'][mask]
    low, high = float(values.min()), float(values.max())
    depth_png = np.zeros(mask.shape, np.uint16)
    depth_png[mask] = 1 + np.rint((values-low)/max(high-low, 1e-9)*65534).astype(np.uint16)
    Image.fromarray(depth_png).save(folder/'depth16.png')
    np.savez_compressed(folder/'surface.npz', position=data['position'].astype('float32'),
                        normal=data['normal'].astype('float32'), mask=mask,
                        depth=np.where(mask,data['depth'],np.nan).astype('float32'))
    return {'camera_azimuth_degrees':azimuth, 'camera_elevation_degrees':elevation,
            'projection':'orthographic', 'center':data['center'].tolist(), 'extent':data['extent'],
            'normal_space':'world; RGB = (normal + 1) / 2; Z up',
            'depth16':{'background':0, 'min':low, 'max':high,
                       'decode':'min + (value - 1) / 65534 * (max - min)',
                       'meaning':'dot(world_position - camera_center, camera_to_eye); larger = nearer'},
            'alignment':'Model camera only. Not registered to the original sprite pixels.'}
