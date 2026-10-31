/** Product limits; the face maximum follows the upstream Hunyuan3D export UI. */
export const TARGET_FACES_MIN = 1_000;
export const TARGET_FACES_DEFAULT = 40_000;
export const TARGET_FACES_MAX = 1_000_000;
export const MAX_MESH_BYTES = 128 * 1024 * 1024;
export const MAX_MESH_URI_LENGTH = Math.ceil(MAX_MESH_BYTES / 3) * 4 + 'data:model/gltf-binary;base64,'.length;
