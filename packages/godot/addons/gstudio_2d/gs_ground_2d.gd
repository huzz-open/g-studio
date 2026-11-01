@tool
class_name GSGround2D
extends Polygon2D
func _ready() -> void:
	if Engine.is_editor_hint():return
	add_to_group("gs_receivers")
	var shading := ShaderMaterial.new()
	shading.shader = preload("res://addons/gstudio_2d/asset.gdshader")
	material = shading
	preload("res://addons/gstudio_2d/gs_world_2d.gd").ensure(get_viewport())
