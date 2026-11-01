@tool
class_name GSAsset2D
extends Sprite2D
const WORLD = preload("res://addons/gstudio_2d/gs_world_2d.gd")
const SHADER = preload("res://addons/gstudio_2d/asset.gdshader")
@export var base_texture: Texture2D:
	set(value):
		base_texture = value
		texture = value
@export var shadow_proxy_scene: PackedScene
@export var mesh_snapshot: Resource
@export var surface_fields: Resource
@export var directx_normal := false
@export var surface_mask: Texture2D
@export var normal_texture: Texture2D
@export var render_snapshot_hash: String
@export var casts_shadow := true
@export var receives_light := true
func _ready() -> void:
	if Engine.is_editor_hint():return
	if render_snapshot_hash.length()!=64 or mesh_snapshot==null or surface_fields==null or surface_mask==null:
		push_error("Export this asset from a current GS render snapshot")
		return
	if mesh_snapshot.snapshot_hash!=render_snapshot_hash or surface_fields.snapshot_hash!=render_snapshot_hash:
		push_error("Mismatched GS model/surface snapshots")
		return
	add_to_group("gs_assets")
	var shading := ShaderMaterial.new()
	shading.shader = SHADER
	material = shading
	WORLD.ensure(get_viewport())
