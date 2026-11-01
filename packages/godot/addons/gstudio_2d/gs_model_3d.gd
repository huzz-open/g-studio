@tool
extends StaticBody3D
## Camera-facing image presentation; frozen geometry supplies shadows and collision.
@export var mesh_snapshot: Resource
@export var source_image: Texture2D
@export var normal_texture: Texture2D
@export var textured := true
@export var surface_fields:Resource
var image_offset:Vector2:
	get:return mesh_snapshot.image_offset if mesh_snapshot else Vector2.ZERO
@export var pixels_per_unit:=100.0
var image:Sprite3D
var visual: MeshInstance3D
func _ready() -> void:
	if mesh_snapshot == null:return
	collision_layer=2
	collision_mask=0
	visual=MeshInstance3D.new()
	visual.name="Model"
	visual.mesh=mesh_snapshot.get_mesh()
	visual.cast_shadow=GeometryInstance3D.SHADOW_CASTING_SETTING_DOUBLE_SIDED
	var material:=StandardMaterial3D.new()
	material.albedo_color=Color(0.42,0.44,0.46)
	material.roughness=1.0
	material.metallic_specular=0.0
	material.cull_mode=BaseMaterial3D.CULL_DISABLED
	visual.material_override=material
	add_child(visual)
	image=Sprite3D.new()
	image.name="Image"
	image.set_script(preload("res://addons/gstudio_2d/camera_facing_sprite.gd"))
	image.texture=source_image
	image.pixel_size=1.0/pixels_per_unit
	image.set("pixels_per_unit",pixels_per_unit)
	image.set("anchor_offset",image_offset)
	image.texture_filter=BaseMaterial3D.TEXTURE_FILTER_NEAREST
	image.alpha_cut=SpriteBase3D.ALPHA_CUT_DISCARD
	image.cast_shadow=GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	if surface_fields:
		var shading:=ShaderMaterial.new()
		shading.shader=preload("res://addons/gstudio_2d/camera_sprite_light.gdshader")
		var maps:Array=surface_fields.get_textures()
		shading.set_shader_parameter("color_image",source_image)
		shading.set_shader_parameter("surface_position",maps[0])
		shading.set_shader_parameter("surface_normal",maps[1])
		shading.set_shader_parameter("detail_normal",normal_texture)
		shading.set_shader_parameter("use_detail_normal",normal_texture!=null)
		shading.set_shader_parameter("reference_pitch",deg_to_rad(mesh_snapshot.reference_pitch))
		image.material_override=shading
	add_child(image)
	set_textured(textured)
	var collider:=CollisionShape3D.new()
	collider.name="ModelCollision"
	# Static concave collision preserves holes instead of filling a single convex hull.
	var shape:=ConcavePolygonShape3D.new()
	var arrays=visual.mesh.surface_get_arrays(0)
	var vertices:PackedVector3Array=arrays[Mesh.ARRAY_VERTEX]
	var indices:PackedInt32Array=arrays[Mesh.ARRAY_INDEX]
	var faces:=PackedVector3Array()
	for index in indices:faces.append(vertices[index])
	shape.set_faces(faces)
	shape.backface_collision=true
	collider.shape=shape
	add_child(collider)
	add_to_group("gs_visible_models")
func set_textured(value:bool) -> void:
	textured=value
	if image:image.visible=value
	if visual:visual.cast_shadow=GeometryInstance3D.SHADOW_CASTING_SETTING_SHADOWS_ONLY if value else GeometryInstance3D.SHADOW_CASTING_SETTING_DOUBLE_SIDED
func _process(_delta:float) -> void:
	if image and image.material_override is ShaderMaterial:image.material_override.set_shader_parameter("asset_transform",global_transform)
