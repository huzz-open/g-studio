extends SceneTree
var failures:=0
func _initialize() -> void:call_deferred("run")
func check(ok:bool,message:String) -> void:
	if not ok:failures+=1;push_error(message)
func run() -> void:
	var scene=load("res://qing_feng_zhen_3d.tscn").instantiate()
	root.add_child(scene)
	current_scene=scene
	var player=scene.get_node("Player")
	player.input_enabled=false
	player.flicker=false
	for i in range(30):await physics_frame
	check(scene is Node3D,"3D root")
	var floor_visual:MeshInstance3D=scene.get_node("Ground/Visual")
	var floor_collision:CollisionShape3D=scene.get_node("Ground/CollisionShape3D")
	var collision_top:Vector3=floor_collision.global_transform*Vector3(0,floor_collision.shape.size.y/2.0,0)
	check(abs(collision_top.y-floor_visual.global_position.y)<0.000001,"Visible floor top matches collision top")
	var alpha_fixture:=Image.create(4,4,false,Image.FORMAT_RGBA8)
	alpha_fixture.fill(Color.TRANSPARENT)
	alpha_fixture.set_pixel(1,1,Color.WHITE)
	alpha_fixture.set_pixel(1,3,Color(1,1,1,0.01))
	check(preload("res://addons/gstudio_2d/camera_facing_sprite.gd").visible_pixel_bounds(alpha_fixture)==Rect2(1,1,1,1),"Invisible alpha fringe does not define floor contact")
	check(player.is_on_floor(),"Player lands on actual floor")
	check(not root.has_meta("gs_world"),"No hidden 2D lighting compositor")
	check(scene.get_node("CameraRig/Camera3D").projection==Camera3D.PROJECTION_ORTHOGONAL,"Fixed orthographic camera")
	var models=get_nodes_in_group("gs_visible_models")
	check(models.size()==7,"Seven actual models")
	for model in models:
		check(model.mesh_snapshot.get_script().is_tool() and model.surface_fields.get_script().is_tool(),"Mesh and surface resources support editor preview")
		check(model.visual.mesh==model.mesh_snapshot.get_mesh(),"Frozen GS mesh is unchanged")
		var camera:Camera3D=scene.get_node("CameraRig/Camera3D")
		check(model.image.global_transform.basis.z.normalized().dot(camera.global_transform.basis.z.normalized())>0.999999,"Image plane perpendicular to camera view")
		check(model.global_transform.basis.y.normalized().dot(Vector3.UP)>0.999999,"Image facing does not tilt physics body")
		var bounds:Rect2=model.image.get("visible_bounds")
		check(not model.image.region_enabled,"Exported static texture needs no runtime crop")
		check(bounds==Rect2(Vector2.ZERO,model.source_image.get_size()),"Full exported image defines the display plane")
		check(preload("res://addons/gstudio_2d/camera_facing_sprite.gd").visible_pixel_bounds(model.source_image.get_image())==bounds,"PNG itself has no invisible outer rows or columns")
		var aabb:AABB=model.image.get_aabb()
		check(abs(aabb.size.x-bounds.size.x*model.image.pixel_size)<0.00001 and abs(aabb.size.y-bounds.size.y*model.image.pixel_size)<0.00001,"Actual quad dimensions match cropped region")
		var bottom_y:=INF
		for x in [bounds.position.x,bounds.end.x]:
			for y in [bounds.position.y,bounds.end.y]:
				var local:Vector3=Vector3(float(x)-bounds.get_center().x,bounds.get_center().y-float(y),0)*model.image.pixel_size
				bottom_y=minf(bottom_y,(model.image.global_transform*local).y)
				check((model.image.global_transform*local).y>=model.global_position.y-0.002,"Ground does not clip the visible image")
		check(abs(bottom_y-floor_visual.global_position.y-0.001)<0.0001,"Visible image bottom rests on floor top")
		var center_screen:=camera.unproject_position(model.global_position)
		var unit_pixels:=center_screen.distance_to(camera.unproject_position(model.global_position+camera.global_transform.basis.x))
		var expected:Vector2=center_screen+model.image_offset*model.global_transform.basis.get_scale().x*unit_pixels/model.pixels_per_unit
		var original_center:Vector3=Vector3(model.source_image.get_width()*0.5-bounds.get_center().x,bounds.get_center().y-model.source_image.get_height()*0.5,0)*model.image.pixel_size
		check(camera.unproject_position(model.image.global_transform*original_center).distance_to(expected)<0.01,"Cropping and depth placement preserve original pixel projection")
		check(model.visual.cast_shadow==GeometryInstance3D.SHADOW_CASTING_SETTING_SHADOWS_ONLY,"Frozen mesh casts the image shadow")
		check(model.get_node("ModelCollision").shape is ConcavePolygonShape3D,"Actual static geometry collision")
		check(model.get_node("ModelCollision").shape.get_faces().size()==model.mesh_snapshot.positions.size(),"Collision uses all snapshot triangles")
	if DisplayServer.get_name()!="headless":
		for i in range(12):await process_frame
		await RenderingServer.frame_post_draw
		DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path("res://../output/direct-3d"))
		root.get_texture().get_image().save_png("res://../output/direct-3d/textured.png")
		for model in models:model.set_textured(false)
		scene.get_node("Help/Mode").text="Geometry only"
		for i in range(12):await process_frame
		await RenderingServer.frame_post_draw
		root.get_texture().get_image().save_png("res://../output/direct-3d/geometry.png")
	player.set_physics_process(false)
	var barrel=scene.get_node("barrel")
	player.position=barrel.position+Vector3(0,0.02,1.2)
	for i in range(180):
		await physics_frame
		player.move_in_direction(Vector2.UP,1.0/60.0)
	check(player.position.z>barrel.position.z+0.3 and player.position.z<barrel.position.z+0.8,"Actual barrel mesh stops the player")
	var socket:Vector2=player.animation_root.get_node("Visuals/TorchSocket").position
	var projected:=Vector2(player.torch.position.x,player.torch.position.z*sin(deg_to_rad(20.0))-player.torch.position.y*cos(deg_to_rad(20.0)))*100.0
	check(projected.distance_to(socket)<0.001,"3D flame projects to animated hand socket")
	check(abs(player.torch.position.y-0.8)<0.001,"Same physical torch height as 2D comparison")
	print("Direct 3D acceptance failures: ",failures)
	quit(1 if failures else 0)
