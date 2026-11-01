extends SceneTree
var failures := 0
func _initialize() -> void:call_deferred("run")
func check(ok: bool, message: String) -> void:
	if not ok:failures+=1;push_error(message)
func capture(manager) -> Image:
	for i in range(8):await process_frame
	await RenderingServer.frame_post_draw
	return manager.view.get_texture().get_image()
func energy(image: Image) -> float:
	var sum := 0.0
	for y in range(0,image.get_height(),4):
		for x in range(0,image.get_width(),4):sum+=image.get_pixel(x,y).get_luminance()
	return sum
func run() -> void:
	var scene := Node2D.new()
	root.add_child(scene)
	var barrel = load("res://assets/gstudio/barrel/barrel.tscn").instantiate()
	barrel.position = Vector2(400,350)
	barrel.scale = Vector2.ONE*0.3
	scene.add_child(barrel)
	var ground := Polygon2D.new()
	ground.set_script(load("res://addons/gstudio_2d/gs_ground_2d.gd"))
	ground.polygon = PackedVector2Array([Vector2.ZERO,Vector2(1280,0),Vector2(1280,720),Vector2(0,720)])
	ground.color=Color(0.5,0.5,0.5)
	ground.z_index=-100
	scene.add_child(ground)
	var a = load("res://addons/gstudio_2d/point_light.tscn").instantiate()
	a.position=Vector2(260,250);a.color=Color(1,.6,.25);a.base_energy=1.4;a.range_world=5.0
	scene.add_child(a)
	var b = load("res://addons/gstudio_2d/point_light.tscn").instantiate()
	b.position=Vector2(600,280);b.color=Color(.3,.6,1);b.base_energy=1.4;b.range_world=5.0
	scene.add_child(b)
	await process_frame
	await process_frame
	var manager = root.get_meta("gs_world")
	check(manager.bindings.size()==1,"Automatic asset registration in a blank scene")
	check(manager.lights.size()==2,"Independent lights, no player path")
	if DisplayServer.get_name() != "headless":
		var both := await capture(manager)
		b.enabled=false
		var only_a := await capture(manager)
		a.enabled=false;b.enabled=true
		var only_b := await capture(manager)
		check(energy(both)>maxf(energy(only_a),energy(only_b))*1.05,"Lights add instead of darkening each other")
		a.enabled=false;b.enabled=false
		var dark := await capture(manager)
		check(energy(dark)<energy(both)*0.01,"No lights leaves no stale illumination")
		a.enabled=true;b.enabled=true;barrel.casts_shadow=false
		var no_shadow := await capture(manager)
		var removed := 0
		for y in range(0,both.get_height(),2):
			for x in range(0,both.get_width(),2):
				if no_shadow.get_pixel(x,y).get_luminance()>both.get_pixel(x,y).get_luminance()+0.025:removed+=1
		check(removed>10,"Generated mesh actually occludes light")
		barrel.casts_shadow=true
		await capture(manager)
		DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path("res://../output/gs-addon"))
		root.get_texture().get_image().save_png("res://../output/gs-addon/two-lights.png")
		print("Energy both/A/B: ",energy(both)," / ",energy(only_a)," / ",energy(only_b),"; shadow pixels: ",removed)
	var second = load("res://assets/gstudio/barrel/barrel.tscn").instantiate()
	second.position = Vector2(800,350)
	second.scale = Vector2.ONE*0.3
	scene.add_child(second)
	await process_frame
	await process_frame
	check(manager.bindings.size()==2,"Multiple reusable asset instances")
	check(second.material!=barrel.material,"Instances do not share mutable shader parameters")
	second.queue_free()
	await process_frame
	await process_frame
	var old: Vector3 = manager.bindings[barrel.get_instance_id()].position
	barrel.position+=Vector2(25,10)
	await process_frame
	await process_frame
	check(manager.projection(manager.bindings[barrel.get_instance_id()].position-old).distance_to(Vector2(25,10))<0.001,"Movement shares projection")
	b.queue_free();barrel.queue_free()
	await process_frame
	await process_frame
	check(manager.bindings.is_empty() and manager.lights.size()==1,"Removal clears render objects")
	print("GS addon failures: ",failures)
	quit(1 if failures else 0)
