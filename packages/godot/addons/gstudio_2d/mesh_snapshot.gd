@tool
extends Resource
@export var snapshot_hash: String
@export var positions: PackedVector3Array
@export var normals: PackedVector3Array
@export var reference_pitch := 20.0
@export var image_offset := Vector2.ZERO
@export var uv: PackedVector2Array
var cached: ArrayMesh
func get_mesh() -> ArrayMesh:
	if cached != null:return cached
	assert(positions.size()==normals.size() and positions.size()==uv.size() and positions.size()%3==0)
	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX]=positions
	arrays[Mesh.ARRAY_NORMAL]=normals
	arrays[Mesh.ARRAY_TEX_UV]=uv
	var tangents := PackedFloat32Array()
	var up := Vector3(0,cos(deg_to_rad(reference_pitch)),-sin(deg_to_rad(reference_pitch)))
	for raw in normals:
		var n := raw.normalized()
		var t := Vector3.RIGHT-n*n.dot(Vector3.RIGHT)
		if t.length_squared()<0.0001:t=up.cross(n)
		t=t.normalized()
		tangents.append_array(PackedFloat32Array([t.x,t.y,t.z,1.0]))
	arrays[Mesh.ARRAY_TANGENT]=tangents
	var indices := PackedInt32Array()
	for i in range(0,positions.size(),3):indices.append(i);indices.append(i+2);indices.append(i+1)
	arrays[Mesh.ARRAY_INDEX]=indices
	cached=ArrayMesh.new()
	cached.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES,arrays,[],{},0)
	return cached
