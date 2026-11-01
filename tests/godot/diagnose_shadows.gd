extends SceneTree
func _initialize() -> void:call_deferred("run")
func save_view(scene,manager,label: String) -> void:
	for i in range(12):await process_frame
	await RenderingServer.frame_post_draw
	root.get_texture().get_image().save_png("res://../output/gs-shadow-diagnosis/"+label+".png")
	manager.view.get_texture().get_image().save_png("res://../output/gs-shadow-diagnosis/"+label+"-light.png")
func run() -> void:
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path("res://../output/gs-shadow-diagnosis"))
	var scene=load("res://qing_feng_zhen.tscn").instantiate()
	root.add_child(scene)
	var player=scene.get_node("Player")
	player.input_enabled=false
	player.set_physics_process(false)
	player.position=Vector2(760,300)
	var lamp=player.get_node("Visuals/TorchSocket/TorchLight")
	lamp.flicker_enabled=false
	await process_frame
	await process_frame
	var manager=root.get_meta("gs_world")
	await save_view(scene,manager,"01-current")
	for asset in get_nodes_in_group("gs_assets"):asset.casts_shadow=asset.name=="NormalSprite2D6"
	await save_view(scene,manager,"01b-barrel-only")
	for asset in get_nodes_in_group("gs_assets"):asset.casts_shadow=asset.name=="NormalSprite2D7"
	await save_view(scene,manager,"01c-jar-only")
	for asset in get_nodes_in_group("gs_assets"):asset.casts_shadow=false
	await save_view(scene,manager,"02-no-casters")
	for node in manager.bindings.values():
		for mesh in node.find_children("*","MeshInstance3D",true,false):
			if mesh.layers==1 and mesh.material_override is ShaderMaterial:mesh.material_override.set_shader_parameter("use_detail_normal",false)
	await save_view(scene,manager,"03-geometric-normals")
	manager.set_process(false)
	for node in manager.bindings.values():
		for mesh in node.find_children("*","MeshInstance3D",true,false):
			mesh.visible=mesh.layers==2
			if mesh.layers==2:mesh.cast_shadow=GeometryInstance3D.SHADOW_CASTING_SETTING_ON;mesh.material_override=manager.white_material()
	await save_view(scene,manager,"04-models")
	print("diagnostic views saved")
	quit()
