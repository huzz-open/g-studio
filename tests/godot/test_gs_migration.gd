extends SceneTree
var failures := 0
func _initialize() -> void:call_deferred("run")
func check(ok: bool,message: String) -> void:
	if not ok:failures+=1;push_error(message)
func run() -> void:
	var scene=load("res://qing_feng_zhen.tscn").instantiate()
	root.add_child(scene)
	var player=scene.get_node("Player")
	player.input_enabled=false
	for i in range(5):await process_frame
	var manager=root.get_meta("gs_world")
	check(manager.bindings.size()==7,"All seven generated assets registered")
	check(manager.lights.size()==1,"Player carries a standard emitter")
	check(scene.get_node_or_null("ProxyShadowWorld")==null,"No demo-specific shadow manager")
	player.set_physics_process(false)
	var bodies: Array=[]
	for prop in get_nodes_in_group("gs_assets"):
		check(prop.mesh_snapshot!=null,"Surface depth/normal mesh present")
		check(prop.shadow_proxy_scene.resource_path.begins_with("res://assets/gstudio/"),"Generated shadow mesh instead of manual proxy")
		var body=prop.get_node("CollisionBody")
		bodies.append(body);body.collision_layer=0
	await physics_frame
	for body in bodies:
		body.collision_layer=2
		await physics_frame
		var shape=body.get_child(0) as CollisionPolygon2D
		var point:=Vector2.ZERO
		for v in shape.polygon:point+=v
		point=shape.to_global(point/shape.polygon.size())
		for direction in [Vector2.LEFT,Vector2.RIGHT,Vector2.UP,Vector2.DOWN]:
			player.position=point+direction*100+Vector2(0,4)
			var hit=player.move_and_collide(-direction*200)
			check(hit!=null and hit.get_collider()==body,"Generated footprint blocks movement: "+str(body.get_path()))
		body.collision_layer=0
	for body in bodies:body.collision_layer=2
	player.position=Vector2(480,335)
	for i in range(20):await process_frame
	if DisplayServer.get_name()!="headless":
		await RenderingServer.frame_post_draw
		DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path("res://../output/gs-addon"))
		root.get_texture().get_image().save_png("res://../output/gs-addon/qing-feng-zhen.png")
	print("GS migration: 7 generated models, ground physics, generic light registration; failures: ",failures)
	quit(1 if failures else 0)
