@tool
class_name GSWorld2D
extends Node2D
@export var pixels_per_unit := 100.0
@export_range(5.0,80.0) var view_elevation := 20.0
@export var ambient := Color(0.25,0.25,0.28)
@export var render_scale := 1.0
var view: SubViewport
var world: Node3D
var camera: Camera3D
var floor_mesh: MeshInstance3D
var bindings := {}
var lights := {}
var rect := Rect2()
var was_lit := true
static func ensure(viewport: Viewport) -> void:
	if viewport.has_meta("gs_world") and is_instance_valid(viewport.get_meta("gs_world")): return
	var script = load("res://addons/gstudio_2d/gs_world_2d.gd")
	var manager = Node2D.new()
	manager.set_script(script)
	manager.name = "GSWorld2D"
	viewport.set_meta("gs_world",manager)
	viewport.add_child.call_deferred(manager)
func _enter_tree() -> void:
	var viewport := get_viewport()
	if viewport.has_meta("gs_world") and is_instance_valid(viewport.get_meta("gs_world")) and viewport.get_meta("gs_world")!=self:
		push_warning("Only one GSWorld2D is allowed per viewport")
		queue_free()
		return
	viewport.set_meta("gs_world",self)
func _ready() -> void:
	if is_queued_for_deletion():return
	view = SubViewport.new()
	view.name = "Illumination"
	view.world_3d = World3D.new()
	view.positional_shadow_atlas_size = 2048
	view.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	add_child(view)
	world = Node3D.new()
	view.add_child(world)
	var environment := WorldEnvironment.new()
	environment.environment = Environment.new()
	environment.environment.background_mode = Environment.BG_COLOR
	environment.environment.background_color = Color.BLACK
	environment.environment.ambient_light_source = Environment.AMBIENT_SOURCE_DISABLED
	world.add_child(environment)
	camera = Camera3D.new()
	camera.projection = Camera3D.PROJECTION_ORTHOGONAL
	camera.cull_mask = 3
	camera.current = true
	world.add_child(camera)
	floor_mesh = MeshInstance3D.new()
	floor_mesh.mesh = PlaneMesh.new()
	floor_mesh.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	floor_mesh.material_override = white_material()
	world.add_child(floor_mesh)
func white_material() -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = Color.WHITE
	m.metallic_specular = 0.0
	m.roughness = 1.0
	m.cull_mode = BaseMaterial3D.CULL_DISABLED
	return m
func ground(p: Vector2) -> Vector3:
	return Vector3(p.x/pixels_per_unit,0,p.y/(pixels_per_unit*sin(deg_to_rad(view_elevation))))
func projection(p: Vector3) -> Vector2:
	var a := deg_to_rad(view_elevation)
	return Vector2(p.x,p.z*sin(a)-p.y*cos(a))*pixels_per_unit
func _process(_delta: float) -> void:
	if view == null:return
	var viewport := get_viewport()
	var inverse := viewport.get_canvas_transform().affine_inverse()
	var size := viewport.get_visible_rect().size
	# Axis-aligned coverage also supports a rotated Camera2D.
	var corners := [inverse*Vector2.ZERO,inverse*Vector2(size.x,0),inverse*size,inverse*Vector2(0,size.y)]
	rect = Rect2(corners[0],Vector2.ZERO)
	for p in corners:rect = rect.expand(p)
	rect = rect.grow(32)
	var resolution := Vector2i(rect.size*minf(render_scale,2048.0/maxf(rect.size.x,rect.size.y)))
	view.size = resolution.max(Vector2i(2,2))
	var center := ground(rect.get_center())
	var a := deg_to_rad(view_elevation)
	camera.size = rect.size.y/pixels_per_unit
	camera.position = center+Vector3(0,sin(a),cos(a))*60.0
	camera.look_at(center)
	floor_mesh.position = center
	floor_mesh.mesh.size = Vector2(rect.size.x,rect.size.y/sin(a))/pixels_per_unit
	var seen := {}
	for asset in get_tree().get_nodes_in_group("gs_assets"):
		if asset.get_viewport()!=viewport:continue
		var id: int = asset.get_instance_id()
		seen[id] = true
		if not bindings.has(id):
			var node := Node3D.new()
			world.add_child(node)
			if asset.shadow_proxy_scene:
				var proxy = asset.shadow_proxy_scene.instantiate()
				node.add_child(proxy)
				for mesh in proxy.find_children("*","MeshInstance3D",true,false):
					mesh.layers = 2
					var caster_material := StandardMaterial3D.new()
					caster_material.cull_mode = BaseMaterial3D.CULL_DISABLED
					mesh.material_override = caster_material
					mesh.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_SHADOWS_ONLY
			if asset.surface_fields:
				var surface := MeshInstance3D.new()
				var quad := QuadMesh.new()
				quad.size = asset.base_texture.get_size()/pixels_per_unit
				surface.mesh = quad
				surface.rotation.x = -a
				surface.position = Vector3(asset.offset.x,-asset.offset.y*cos(a),asset.offset.y*sin(a))/pixels_per_unit
				surface.extra_cull_margin = 20.0
				surface.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
				var m := ShaderMaterial.new()
				m.shader = preload("res://addons/gstudio_2d/surface_light.gdshader")
				m.set_shader_parameter("source_mask",asset.surface_mask)
				var maps: Array = asset.surface_fields.get_textures()
				m.set_shader_parameter("surface_position",maps[0])
				m.set_shader_parameter("surface_normal",maps[1])
				m.set_shader_parameter("directx_normal",asset.directx_normal)
				m.set_shader_parameter("reference_pitch",deg_to_rad(asset.mesh_snapshot.reference_pitch))
				m.set_shader_parameter("detail_normal",asset.normal_texture)
				m.set_shader_parameter("use_detail_normal",asset.normal_texture!=null)
				surface.material_override = m
				node.add_child(surface)
			bindings[id] = node
		var node: Node3D = bindings[id]
		node.position = ground(asset.global_position)
		node.scale = Vector3(asset.global_scale.x,asset.global_scale.y,asset.global_scale.x)
		node.visible = asset.is_visible_in_tree()
		for mesh in node.find_children("*","MeshInstance3D",true,false):
			if mesh.layers==2:mesh.visible = asset.casts_shadow
			elif mesh.material_override is ShaderMaterial:mesh.material_override.set_shader_parameter("asset_transform",node.global_transform)
		asset.material.set_shader_parameter("receives_lighting",asset.receives_light)
		asset.material.set_shader_parameter("illumination",view.get_texture())
		asset.material.set_shader_parameter("world_rect",Vector4(rect.position.x,rect.position.y,rect.size.x,rect.size.y))
		asset.material.set_shader_parameter("ambient",Vector3(ambient.r,ambient.g,ambient.b) if asset.receives_light else Vector3.ONE)
	for receiver in get_tree().get_nodes_in_group("gs_receivers"):
		if receiver.get_viewport()!=viewport:continue
		receiver.material.set_shader_parameter("illumination",view.get_texture())
		receiver.material.set_shader_parameter("world_rect",Vector4(rect.position.x,rect.position.y,rect.size.x,rect.size.y))
		receiver.material.set_shader_parameter("ambient",Vector3(ambient.r,ambient.g,ambient.b))
	for id in bindings.keys():
		if not seen.has(id):bindings[id].queue_free();bindings.erase(id)
	seen.clear()
	for source in get_tree().get_nodes_in_group("gs_lights"):
		if source.get_viewport()!=viewport:continue
		var id: int = source.get_instance_id()
		seen[id]=true
		if not lights.has(id):
			var lamp := OmniLight3D.new()
			lamp.omni_shadow_mode = OmniLight3D.SHADOW_CUBE
			lamp.light_cull_mask = 3
			lamp.shadow_bias = 0.03
			lamp.shadow_normal_bias = 0.2
			world.add_child(lamp)
			lights[id]=lamp
		var lamp: OmniLight3D = lights[id]
		lamp.visible = source.enabled and source.is_visible_in_tree()
		lamp.light_color = source.color
		lamp.light_energy = source.energy
		lamp.omni_range = source.range_world
		lamp.shadow_enabled = source.shadow_enabled
		var point: Vector2 = source.to_global(source.offset)+Vector2(0,source.height_world*cos(a)*pixels_per_unit)
		lamp.position = ground(point)+Vector3.UP*source.height_world
	for id in lights.keys():
		if not seen.has(id):lights[id].queue_free();lights.erase(id)
	var lit := false
	for lamp in lights.values():
		if lamp.visible and lamp.light_energy>0.0:lit=true
	view.render_target_update_mode = SubViewport.UPDATE_ALWAYS if lit else (SubViewport.UPDATE_ONCE if was_lit else SubViewport.UPDATE_DISABLED)
	was_lit = lit
func _exit_tree() -> void:
	if get_viewport().has_meta("gs_world") and get_viewport().get_meta("gs_world")==self:get_viewport().remove_meta("gs_world")
