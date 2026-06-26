@tool
extends EditorPlugin

var _manager # Variant — allows calling methods on RefCounted subclass
var _poll_timer: Timer


func _enter_tree() -> void:
	_manager = preload("gs_scene_manager.gd").new()

	scene_changed.connect(_on_scene_changed)

	_poll_timer = Timer.new()
	_poll_timer.wait_time = 2.0
	_poll_timer.one_shot = false
	_poll_timer.timeout.connect(_on_poll_timeout)
	add_child(_poll_timer)

	var efs = EditorInterface.get_resource_filesystem()
	if efs.is_scanning():
		efs.filesystem_changed.connect(_on_first_scan_done, CONNECT_ONE_SHOT)
	else:
		call_deferred("_do_initial_sync")

	print("[G-Studio] Plugin enabled")


func _exit_tree() -> void:
	if _poll_timer:
		_poll_timer.stop()
		_poll_timer.queue_free()
		_poll_timer = null
	if scene_changed.is_connected(_on_scene_changed):
		scene_changed.disconnect(_on_scene_changed)
	_manager = null
	print("[G-Studio] Plugin disabled")


func _save_external_data() -> void:
	if _manager:
		_manager.on_scene_saving()


func _on_scene_changed(scene_root: Node) -> void:
	if _manager and scene_root:
		_manager.on_scene_opened(scene_root)


func _on_first_scan_done() -> void:
	call_deferred("_do_initial_sync")


func _do_initial_sync() -> void:
	if _manager:
		_manager.initial_sync()
		_poll_timer.start()


func _on_poll_timeout() -> void:
	if _manager:
		_manager.poll_gs_changes()
