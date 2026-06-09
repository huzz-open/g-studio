@tool
extends EditorPlugin

var _watcher: Node
var _manager: Node


func _enter_tree() -> void:
	_watcher = preload("gs_file_watcher.gd").new()
	_manager = preload("gs_scene_manager.gd").new()
	add_child(_watcher)
	add_child(_manager)
	_watcher.gs_file_changed.connect(_manager.on_gs_changed)
	call_deferred("_initial_sync")
	print("[G-Studio] Plugin enabled")


func _exit_tree() -> void:
	if _watcher:
		_watcher.queue_free()
	if _manager:
		_manager.queue_free()
	print("[G-Studio] Plugin disabled")


func _scene_changed(scene_root: Node) -> void:
	if _manager and scene_root:
		_manager.on_scene_opened(scene_root)


func _save_external_data() -> void:
	if _manager:
		_manager.on_scene_saving()


func _initial_sync() -> void:
	if _watcher and _manager:
		_manager.initial_sync(_watcher.get_tracked_paths())
