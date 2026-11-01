@tool
extends Resource
@export var snapshot_hash: String
@export var width: int
@export var height: int
@export var positions: PackedFloat32Array
@export var normals: PackedFloat32Array
var cached: Array[Texture2D] = []
func get_textures() -> Array[Texture2D]:
	if not cached.is_empty():return cached
	assert(positions.size()==width*height*4 and normals.size()==width*height*4)
	cached.append(ImageTexture.create_from_image(Image.create_from_data(width,height,false,Image.FORMAT_RGBAF,positions.to_byte_array())))
	cached.append(ImageTexture.create_from_image(Image.create_from_data(width,height,false,Image.FORMAT_RGBAF,normals.to_byte_array())))
	return cached
