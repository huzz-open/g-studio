extends SceneTree
var failures:=0
func _initialize() -> void:call_deferred("run")
func run() -> void:
	var scene=load("res://qing_feng_zhen_3d.tscn").instantiate()
	root.add_child(scene)
	var player=scene.get_node("Player")
	var camera:Camera3D=scene.get_node("CameraRig/Camera3D")
	player.input_enabled=false
	player.set_physics_process(false)
	var measurements:=[]
	for direction in [Vector2.RIGHT,Vector2.LEFT,Vector2.UP,Vector2.DOWN,Vector2(1,1),Vector2(1,-1),Vector2(-1,1),Vector2(-1,-1)]:
		player.position=Vector3(-3,0.02,1)
		player.velocity=Vector3.ZERO
		for i in range(20):
			await physics_frame
			player.move_in_direction(Vector2.ZERO,1.0/60.0)
		var before:=camera.unproject_position(player.global_position)
		for i in range(30):
			await physics_frame
			player.move_in_direction(direction,1.0/60.0)
		var displacement:=camera.unproject_position(player.global_position)-before
		measurements.append(displacement.length())
		if displacement.normalized().dot(direction.normalized())<0.999:
			failures+=1;push_error("Screen movement direction mismatch")
	var baseline:float=measurements[0]
	for value in measurements:
		if abs(value-baseline)>baseline*0.005:
			failures+=1;push_error("Eight-direction speed mismatch")
	print("Eight-direction projected distances: ",measurements,"; failures: ",failures)
	quit(1 if failures else 0)
