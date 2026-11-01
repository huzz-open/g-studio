@tool
extends MeshInstance3D
@export var snapshot: Resource
func _ready() -> void:
	if snapshot:mesh=snapshot.get_mesh()
